import { formatPlanDate, planEventEnd, planEventStart, sortPlanEvents, type PlanEvent } from "./plan";
import { applyRouteCost, PlanConflictError, updateRoutesAfterEventChange, type PlanVersionRecord } from "./plan-service";
import { queryPlanRoute } from "./route-service";
import { invalidateRouteReference, routeConflict, type RouteLeg } from "./routes";

function assertActive(signal?: AbortSignal) { if (signal?.aborted) throw new PlanConflictError("本次选择已取消，旧计划保持不变。"); }

export function occupiedEnd(event: PlanEvent, minutes: number) {
  const end = new Date(planEventStart(event).getTime() + minutes * 60_000);
  return { endDate: formatPlanDate(end), endTime: new Date(end.getTime() + 8 * 3600_000).toISOString().slice(11, 16), suggestedDurationSeconds: minutes * 60 };
}

function routeStillAdjacent(plan: PlanVersionRecord, route: RouteLeg) {
  const events = sortPlanEvents(plan.events.filter((event) => event.date === route.date && event.placeId));
  const from = events.findIndex((event) => event.id === route.fromEventId);
  return from >= 0 && events[from + 1]?.id === route.toEventId;
}

export async function replacementRoutes(plan: PlanVersionRecord, proposed: PlanVersionRecord, eventId: string, signal?: AbortSignal) {
  const warnings: string[] = [];
  const invalidated = updateRoutesAfterEventChange(plan.routeLegs, proposed.events, proposed.costs, eventId, plan.events);
  let costs = invalidated.costs;
  const routeLegs: RouteLeg[] = [];
  // Losing a precise POI removes adjacency from the generic map editor. Keep
  // these old meal legs explicitly unavailable, with an unknown fare, so an
  // unlocated replacement cannot appear to make its journey free.
  for (const prior of plan.routeLegs) {
    if ((prior.fromEventId === eventId || prior.toEventId === eventId) && !invalidated.routeLegs.some((route) => route.id === prior.id)) {
      const from = proposed.events.find((event) => event.id === prior.fromEventId);
      const to = proposed.events.find((event) => event.id === prior.toEventId);
      if (from && to && (!from.placeId || !to.placeId)) invalidated.routeLegs.push(invalidateRouteReference(prior, from.date, from.endTime));
    }
  }
  for (const prior of invalidated.routeLegs) {
    assertActive(signal);
    if (prior.fromEventId !== eventId && prior.toEventId !== eventId) { routeLegs.push(prior); continue; }
    const from = proposed.events.find((event) => event.id === prior.fromEventId)!;
    const to = proposed.events.find((event) => event.id === prior.toEventId)!;
    const departureTime = prior.fromEventId === eventId ? from.endTime : (plan.routeLegs.find((route) => route.id === prior.id)?.departureTime ?? from.endTime);
    const departure = Date.parse(`${from.date}T${departureTime}:00+08:00`) >= planEventEnd(from).getTime() ? departureTime : from.endTime;
    let route: RouteLeg;
    try {
      const hasArea = [from, to].some((event) => proposed.places.find((place) => place.id === event.placeId)?.precision === "area_reference");
      if (!routeStillAdjacent(proposed, prior) || hasArea) throw new Error("精确入口或相邻地点关系待确认");
      if (prior.manualReference) throw new Error("人工公交参考需按新用餐或游览地点重新查阅");
      route = await queryPlanRoute(proposed, { fromEventId: from.id, toEventId: to.id, mode: prior.mode, departureTime: departure }, signal);
      route = { ...route, transportEventIds: prior.transportEventIds,
        conflict: route.status === "unavailable" ? null : routeConflict({ route, earliestDate: to.date, earliestStartTime: to.startTime }) };
      if (route.status === "unavailable") warnings.push(`${from.title} → ${to.title} 暂无可用路线，交通时间与费用仍需确认。`);
    } catch {
      assertActive(signal);
      route = { ...invalidateRouteReference(prior, from.date, departure),
        scheduleBasis: "替换后未能取得适用新地点的路线，原路径与耗时已清除；请确认精确入口并重新查询。" };
      warnings.push(`${from.title} → ${to.title} 路线待重新确认，原路径、耗时和未确认费用不再沿用。`);
    }
    routeLegs.push(route);
    // An unavailable paid ride still has an unknown replacement cost. Keep an
    // unknown budget row instead of making its amount disappear into zero.
    costs = applyRouteCost(route.status === "unavailable" ? { ...route, status: "pending_confirmation" } : route, proposed.events, costs);
  }
  if (!plan.routeLegs.some((route) => route.fromEventId === eventId || route.toEventId === eventId)) warnings.push("此活动尚无已查询的相邻路线；地点已更新，交通时间和费用需要在地图中确认。");
  return { routeLegs, costs, warnings };
}
