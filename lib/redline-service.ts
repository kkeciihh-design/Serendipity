import type { PlanVersionRecord } from "./plan-service";
import { planEventEnd, planEventStart } from "./plan";
import { defaultRedlinePreferences } from "./redline-preferences";
import { isActiveTicket, type Ticket } from "./tickets";
import { readCachedRoute, routeCacheKey, writeCachedRoute, type RouteLeg } from "./routes";
import { cityRouteOriginIssue } from "./route-origin";
import { forwardCheck, isoAt, routeApplies, type RedlineDeadline, type RedlineInput, type RedlineStep, type TimingRoute } from "./redlines";
import { resolveRedline } from "./redline-resolver";

function routeTiming(route: RouteLeg): TimingRoute {
  const at = (time: string) => isoAt(Date.parse(`${route.date}T${time}:00+08:00`));
  return { kind: route.mode === "walking" ? "fixed" : "timed", durationSeconds: route.durationSeconds,
    status: route.status, source: `${route.source}；${route.scheduleBasis}`,
    applicableAt: at(route.departureTime), validFrom: at(route.validFromTime), validUntil: at(route.validUntilTime),
    futureCapability: route.futureQueryCapability, includedTimes: route.includedTimes,
    details: route.steps.map((s) => ({ label: s.instruction, seconds: s.durationSeconds })) };
}

export function ticketRedlineInput(plan: PlanVersionRecord, ticket: Ticket): RedlineInput {
  const p = ticket.redlinePreferences ?? defaultRedlinePreferences(ticket.bufferMinutes);
  const departureAt = ticket.date && ticket.departureTime ? isoAt(Date.parse(`${ticket.date}T${ticket.departureTime}:00+08:00`)) : null;
  const incoming = plan.routeLegs.find((r) => r.toEventId === ticket.eventId);
  const originEvent = incoming && plan.events.find((e) => e.id === incoming.fromEventId);
  const routeMatchesOrigin = originEvent?.locationName === ticket.chainOriginName && !cityRouteOriginIssue(originEvent);
  const linked = incoming && routeMatchesOrigin ? incoming : undefined;
  const replacedMealOrigin = !linked && plan.events.some((event) => event.restaurantSelection?.invalidatedAccessOrigins?.some((origin) =>
    origin.ticketId === ticket.id && origin.originName === ticket.chainOriginName && event.locationName !== origin.originName));
  const replacedHotelOrigin = !linked && plan.events.some((event) => event.accommodationSelection?.invalidatedAccessOrigins?.some((origin) =>
    origin.ticketId === ticket.id && origin.originName === ticket.chainOriginName && event.locationName !== origin.originName));
  const route: TimingRoute = linked ? routeTiming(linked) : {
    kind: ticket.accessMode === "walking" ? "fixed" : "timed",
    durationSeconds: replacedMealOrigin || replacedHotelOrigin || ticket.accessDurationMinutes === null ? null : ticket.accessDurationMinutes * 60,
    status: ticket.accessMode === "public_transit" ? "pending_confirmation" : "estimated",
    source: `手工接驳参考：${ticket.accessNote || "未提供路线依据"}`,
    applicableAt: null, validFrom: null, validUntil: null, futureCapability: false,
    includedTimes: ["步行", "候车", "乘车", "换乘"], details: [],
  };
  const assumptions = ["办理耗时与缓冲是可调整的个人估算，不是官方统一规定。", "当前出发检查假设你已在所列起点；实际位置不同请先修改起点。"];
  if (!linked) assumptions.push("接驳使用票面关联的人工总耗时；包含的候车、步行、换乘不再次相加。");
  if (incoming && !routeMatchesOrigin) assumptions.push("已存城市路线起点与本票起点不同，不能代用；请核对门到门起点和路线。");
  const steps: RedlineStep[] = [];
  const deadlines: RedlineDeadline[] = [];
  const cutoff = (id: string, label: string, minutes: number | null, afterStep: string, fallback?: number) => {
    const value = minutes ?? fallback;
    deadlines.push({ id, label, afterStep,
      at: departureAt && value !== undefined ? isoAt(Date.parse(departureAt) - value * 60_000) : null,
      nature: minutes === null && fallback === undefined ? "unknown" : "assumed",
      source: minutes === null ? (fallback === undefined ? "截止尚未提供" : `暂按发车前 ${fallback} 分钟估算，须核对实际班次`)
        : `用户手工填写：发车 / 起飞前 ${minutes} 分钟，尚未经官方来源核验` });
  };
  if (ticket.mode === "flight") {
    if (ticket.checkInCutoffMinutes !== 0) {
      steps.push({ id: "checkin", label: "完成值机", seconds: p.checkInSeconds, reason: "个人办理耗时估算" });
      cutoff("checkin", "停止值机", ticket.checkInCutoffMinutes, "checkin");
    }
    if (p.baggage !== "none") {
      steps.push({ id: "bag", label: "完成行李托运", seconds: p.bagDropSeconds, reason: "有托运或行李条件尚未确认" });
      cutoff("bag", "停止托运", p.baggage === "unknown" ? null : ticket.bagDropCutoffMinutes, "bag");
      if (p.baggage === "unknown") assumptions.push("托运行李未选择，暂保留托运耗时与未知截止；无托运请在详情明确选择。");
    }
  }
  steps.push({ id: "security", label: "完成排队、进站与安检", seconds: p.securitySeconds, reason: "必要办理耗时，单独计算" });
  steps.push({ id: "gate", label: ticket.mode === "train" ? "到达检票口" : "到达登机口", seconds: p.gateWalkingSeconds, reason: "站内步行耗时" });
  cutoff("boarding", ticket.mode === "train" ? "停止检票" : "停止登机", ticket.boardingCutoffMinutes, "gate", ticket.mode === "train" ? 5 : undefined);
  if (p.minimumArrivalSeconds !== null) deadlines.push({ id: "arrival", label: "最低提前到站要求", afterStep: "route",
    at: departureAt ? isoAt(Date.parse(departureAt) - p.minimumArrivalSeconds * 1000) : null,
    nature: "assumed", source: `用户设置至少提前 ${p.minimumArrivalSeconds / 60} 分钟到进站口；与其他截止取更严格者` });
  const buffers: RedlineStep[] = [{ id: "extra", label: "机动余量", seconds: p.extraBufferSeconds, reason: "用户额外缓冲，只计一次" }];
  if (p.firstVisit) buffers.push({ id: "first", label: "首次到访", seconds: 300, reason: "找入口与确认方向，建议增加 5 分钟" });
  if (p.slowWalking) buffers.push({ id: "slow", label: "步行较慢", seconds: 300, reason: "相对路线预计步速额外预留 5 分钟，不重复整段步行" });
  if (p.baggage === "checked") buffers.push({ id: "luggage", label: "携带大件 / 托运行李", seconds: 300, reason: "搬运行李额外预留 5 分钟；托运办理耗时另列" });
  const blockers: string[] = [];
  if (replacedHotelOrigin) blockers.push("原接驳起点的住宿已改变，请在门到门交通更新起点；旧酒店的接驳耗时不再适用。");
  if (replacedMealOrigin) blockers.push("原接驳起点的餐厅已替换，请更新门到门起点并重新核对接驳；旧餐厅耗时不再适用。");
  if (!ticket.chainOriginName || !ticket.fromName || !departureAt || !ticket.accessMode) blockers.push("起点、站点、票面日期时刻或接驳方式待补。");
  const peers = plan.tickets.filter((t) => isActiveTicket(t) && t.eventId === ticket.eventId);
  if (peers.some((t) => [t.date, t.departureTime, t.serviceNumber, t.fromName, t.fromDetail].join() !== [ticket.date, ticket.departureTime, ticket.serviceNumber, ticket.fromName, ticket.fromDetail].join())) blockers.push("同一主交通存在不同的有效班次，当前单线行程无法同时衔接。");
  const mainEvent = plan.events.find((e) => e.id === ticket.eventId);
  const departure = departureAt ? Date.parse(departureAt) : mainEvent ? planEventStart(mainEvent).getTime() : null;
  const routeStart = linked ? Date.parse(`${linked.date}T${linked.departureTime}:00+08:00`) : null;
  const routeEnd = routeStart !== null && linked?.durationSeconds != null ? routeStart + linked.durationSeconds * 1000 : null;
  // Only an explicitly associated transport interval already inside this
  // route's total may be excluded. Preparation and unrelated travel still
  // occupy time, including an earlier long event ending after a later one.
  const occupiedUntil = plan.events.filter((event) => event.id !== ticket.eventId && departure !== null &&
    planEventStart(event).getTime() <= departure).filter((event) => !(
    event.type === "local_transport" && linked?.transportEventIds?.includes(event.id) &&
    linked.status !== "unavailable" && linked.includedTimes.length > 0 && !linked.manualReference?.requiresReconfirmation &&
    routeStart !== null && routeEnd !== null && planEventStart(event).getTime() >= routeStart &&
    planEventEnd(event).getTime() <= routeEnd
  )).map((event) => planEventEnd(event).getTime());
  return { id: ticket.id, eventId: ticket.eventId, direction: ticket.direction,
    origin: ticket.chainOriginName || "起点待补", destination: ticket.fromName || "车站 / 机场待补", departureAt,
    route, steps, deadlines, buffers, assumptions, blockers,
    earliestDepartureAt: occupiedUntil.length ? isoAt(Math.max(...occupiedUntil)) : null };
}

export async function buildPlanRedlines(plan: PlanVersionRecord, now = new Date().toISOString()) {
  return Promise.all(plan.tickets.filter(isActiveTicket).map(async (ticket) => {
    const input = ticketRedlineInput(plan, ticket);
    const candidates = plan.routeLegs.filter((r) => {
      const origin = plan.events.find((e) => e.id === r.fromEventId);
      return r.toEventId === ticket.eventId && origin?.locationName === input.origin && !cityRouteOriginIssue(origin);
    });
    return resolveRedline(input, now, plan.id, async (departureAt) => {
      const local = new Date(Date.parse(departureAt) + 8 * 3600_000).toISOString();
      for (const route of candidates) {
        const from = plan.places.find((p) => p.id === plan.events.find((e) => e.id === route.fromEventId)?.placeId);
        const to = plan.places.find((p) => p.id === plan.events.find((e) => e.id === route.toEventId)?.placeId);
        const key = from && to && !route.manualReference ? routeCacheKey({ date: local.slice(0, 10), departureTime: local.slice(11, 19),
          from, to, mode: route.mode, provider: `redline:${plan.id}:${route.id}` }) : null;
        const cached = key ? readCachedRoute(key) : null;
        const applicable = cached ?? route;
        if (routeApplies(routeTiming(applicable), departureAt)) {
          if (key && !cached) writeCachedRoute(key, route);
          return { route: routeTiming(applicable) };
        }
      }
      // Current providers do not promise future transit/driving data. Keep the
      // original window; a different departure must never inherit its waiting.
      return { route: { ...input.route, futureCapability: false } };
    });
  }));
}

// Current-time re-evaluation is also useful for callers with a fixed route.
export { forwardCheck };
