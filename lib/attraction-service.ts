import crypto from "node:crypto";
import { getAttractionCatalogEntry } from "./attraction-catalog";
import { attractionExclusionReasons, attractionProtectionReasons, attractionVisitMinutes, buildAttractionCard, buildAttractionRecommendations, catalogEntryForEvent, confirmedBudgetLimit, type AttractionReplacementPreview } from "./attractions";
import { calculateBudgetSummary, derivePlanCosts, hasProtectedCostFact, validatePlanCosts } from "./budget";
import { listEvidenceFacts } from "./evidence-service";
import { formatPlanDate, planEventEnd, planEventStart, preparePlanForStorage, sortPlanEvents, validatePlan, type PlanEvent } from "./plan";
import { applyRouteCost, getPlanVersion, PlanConflictError, PlanValidationError, savePlanAttractionEdit, updateRoutesAfterEventChange, type PlanVersionRecord } from "./plan-service";
import { placeIdentity, placeSchema } from "./places";
import { buildPlanRedlines } from "./redline-service";
import { queryPlanRoute } from "./route-service";
import { invalidateRouteReference, routeConflict, type RouteLeg } from "./routes";

type PreparedEdit = Parameters<typeof savePlanAttractionEdit>[0];
type PreviewEntry = { tripId: string; version: number; eventId: string; candidateId: string; expires: number; result: AttractionReplacementPreview; edit: PreparedEdit };
const previewGlobal = globalThis as typeof globalThis & { attractionPreviews?: Map<string, PreviewEntry> };
const previews = previewGlobal.attractionPreviews ??= new Map<string, PreviewEntry>();
const PREVIEW_TTL = 10 * 60_000;

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new PlanConflictError("本次景点选择已取消，旧计划保持不变。");
}

function getActivity(plan: PlanVersionRecord, eventId: string) {
  const event = plan.events.find((item) => item.id === eventId);
  if (!event || event.type !== "activity") throw new PlanValidationError("没有找到对应景点活动。");
  return event;
}

export async function getPlanAttractions(tripId: string, version: number, eventId: string) {
  const [plan, facts] = await Promise.all([getPlanVersion(tripId, version), listEvidenceFacts(tripId)]);
  getActivity(plan, eventId);
  return buildAttractionRecommendations(plan, eventId, facts);
}

function occupiedEnd(event: PlanEvent, minutes: number) {
  const end = new Date(planEventStart(event).getTime() + minutes * 60_000);
  return { endDate: formatPlanDate(end), endTime: new Date(end.getTime() + 8 * 3600_000).toISOString().slice(11, 16), suggestedDurationSeconds: minutes * 60 };
}

function routeStillAdjacent(plan: PlanVersionRecord, route: RouteLeg) {
  const events = sortPlanEvents(plan.events.filter((event) => event.date === route.date && event.placeId));
  const from = events.findIndex((event) => event.id === route.fromEventId);
  return from >= 0 && events[from + 1]?.id === route.toEventId;
}

async function replacementRoutes(plan: PlanVersionRecord, proposed: PlanVersionRecord, eventId: string, signal?: AbortSignal) {
  const warnings: string[] = [];
  const invalidated = updateRoutesAfterEventChange(plan.routeLegs, proposed.events, proposed.costs, eventId, plan.events);
  let costs = invalidated.costs;
  const routeLegs: RouteLeg[] = [];
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
      if (prior.manualReference) throw new Error("人工公交参考需按新景点重新查阅");
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

export async function previewAttractionReplacement(tripId: string, version: number, eventId: string, candidateId: string, signal?: AbortSignal): Promise<AttractionReplacementPreview> {
  assertActive(signal);
  const plan = await getPlanVersion(tripId, version);
  const before = getActivity(plan, eventId);
  const protection = attractionProtectionReasons(plan, before);
  if (protection.length) throw new PlanConflictError(protection[0]);
  const entry = getAttractionCatalogEntry(candidateId);
  if (!entry || entry.city.replace(/市$/, "") !== (plan.requestSnapshot.destination ?? "").replace(/市$/, "")) throw new PlanValidationError("候选不属于本计划目的地。");
  if (catalogEntryForEvent(plan, before)?.id === entry.id) throw new PlanValidationError("当前已是这个景点，可直接选择保留。");
  const conflicts = attractionExclusionReasons(entry, plan, before);
  if (conflicts.length) throw new PlanValidationError(conflicts[0]);
  const selectedAt = new Date().toISOString();
  const precision = entry.location?.category === "place:island" ? "area_reference" as const : "poi" as const;
  const place = entry.location ? placeSchema.parse({ ...entry.location, id: placeIdentity(entry.location, precision), precision,
    confirmation: "user_confirmed", confirmedAt: selectedAt, source: entry.location.provider === "amap" ? "高德地图地点搜索" : "OpenStreetMap / Nominatim" }) : null;
  const event: PlanEvent = { ...before, title: entry.name, locationName: entry.name, placeId: place?.id ?? null,
    ...occupiedEnd(before, attractionVisitMinutes(entry, plan)), costDraftCents: entry.ticket.minCents, costStatus: "pending_confirmation",
    status: "suggested", locked: false, attractionSelection: { catalogId: entry.id, action: "replace", selectedAt },
    note: `景点资料待出行前核验；${entry.reservation.required === true ? "需要预约，尚未确认预约成功" : entry.reservation.required === false ? "预约规则以官方当日说明为准" : "预约要求待确认"}。` };
  const prepared = preparePlanForStorage({ events: plan.events.map((item) => item.id === eventId ? event : item), pendingItems: plan.pendingItems });
  const places = plan.places.filter((item) => prepared.events.some((candidate) => candidate.placeId === item.id));
  if (place && !places.some((item) => item.id === place.id)) places.push(place);
  const oldActivityCost = plan.costs.find((cost) => cost.linkedEventId === eventId && !cost.id.startsWith("route-"));
  const ticketCost = { ...(oldActivityCost ?? derivePlanCosts([event])[0]), unit: "per_person" as const,
    unitAmountCents: entry.ticket.minCents, unitAmountMaxCents: entry.ticket.maxCents, quantity: null,
    certainty: "pending_confirmation" as const, paymentStatus: "not_paid" as const, source: "ai_draft" as const,
    note: `新景点门票参考：${entry.ticket.text}；适用人群、日期与范围待确认。`.slice(0, 240) };
  const initialCosts = [...plan.costs.filter((cost) => cost.linkedEventId !== eventId || cost.id.startsWith("route-") || hasProtectedCostFact(cost)), ticketCost];
  let proposed: PlanVersionRecord = { ...plan, events: prepared.events, places, costs: initialCosts };
  const updated = await replacementRoutes(plan, proposed, eventId, signal);
  assertActive(signal);
  const pendingId = `attraction-${eventId}`.slice(0, 80);
  const pending = { id: pendingId, category: "reservation" as const, title: `${entry.name}出行前确认`.slice(0, 160),
    reason: `${entry.reservation.required === true ? "需要预约，尚未确认成功；" : "确认预约要求；"}复核营业、门票与新地点交通。`, requiredBefore: event.date };
  const pendingItems = plan.pendingItems.filter((item) => item.id !== pendingId);
  // Never silently discard an unrelated pending item to make room.
  if (pendingItems.length < 24) pendingItems.push(pending);
  proposed = { ...proposed, routeLegs: updated.routeLegs, costs: updated.costs, pendingItems };
  const validation = validatePlan({ events: proposed.events, pendingItems }, plan.requestSnapshot, proposed.costs);
  conflicts.push(...validation.errors, ...validatePlanCosts(proposed.costs, proposed.events));
  for (const route of proposed.routeLegs) {
    if ((route.fromEventId === eventId || route.toEventId === eventId) && route.durationSeconds !== null && route.conflict) conflicts.push(route.conflict);
  }
  const afterBudget = calculateBudgetSummary(proposed.costs, plan.requestSnapshot);
  const hardBudget = confirmedBudgetLimit(plan);
  if (hardBudget !== null && afterBudget.totalMinCents > hardBudget) conflicts.push("替换后的已知费用下限超过本计划明确的总预算上限。");
  const walkingConstraint = plan.requestSnapshot.constraints.join("；").match(/(?:每日|每天)?步行(?:距离)?(?:上限|不超过|最多)\s*(\d+(?:\.\d+)?)\s*(公里|千米|km|米)/i);
  const warnings = [...updated.warnings, ...validation.warnings];
  if (walkingConstraint) {
    const limit = Number(walkingConstraint[1]) * (walkingConstraint[2] === "米" ? 1 : 1000);
    const walkingRoutes = proposed.routeLegs.filter((route) => route.date === event.date && route.mode === "walking");
    if (walkingRoutes.reduce((sum, route) => sum + (route.distanceMeters ?? 0), 0) > limit) conflicts.push("已知步行距离已超过本计划明确的每日步行上限。");
    else warnings.push("步行上限仍待确认：路线未覆盖景点内步行，未知距离没有计为零。");
  }
  const [redlines, priorRedlines] = await Promise.all([buildPlanRedlines(proposed), buildPlanRedlines(plan)]);
  for (const redline of redlines) {
    const prior = priorRedlines.find((item) => item.input.id === redline.input.id);
    for (const conflict of redline.conflicts) {
      const message = `固定交通红线：${conflict}`;
      if (redline.suggestedAt && conflict.startsWith("上一项结束于") && !prior?.conflicts.includes(conflict)) conflicts.push(message);
      else warnings.push(message);
    }
  }
  const card = buildAttractionCard(entry, proposed, event, true);
  warnings.push(...card.warnings);
  const current = await getPlanVersion(tripId, version);
  if (!current.isCurrent) throw new PlanConflictError("查询期间计划已变化，请重新预览。");
  assertActive(signal);
  const now = Date.now();
  for (const [key, value] of previews) if (value.expires <= now) previews.delete(key);
  if (previews.size >= 100) previews.delete(previews.keys().next().value!);
  const previewToken = crypto.randomBytes(32).toString("base64url");
  const expires = now + PREVIEW_TTL;
  const result: AttractionReplacementPreview = { previewToken, eventId, candidateId, expiresAt: new Date(expires).toISOString(),
    changes: [`${before.locationName ?? before.title} → ${entry.name}；保留同一日程身份。`, `${before.startTime}–${before.endTime} → ${event.startTime}–${event.endTime}（${attractionVisitMinutes(entry, plan)} 分钟）。`,
      "地点、已有相邻路线、门票和交通费用在一个新版本中同时更新；固定交通红线根据新版本重算。", "原景点字段来源改为需重新核验；保留待确认预约和门票状态。"],
    conflicts: [...new Set(conflicts)], warnings: [...new Set(warnings)], canApply: conflicts.length === 0,
    beforeBudget: calculateBudgetSummary(plan.costs, plan.requestSnapshot), afterBudget, card };
  previews.set(previewToken, { tripId, version, eventId, candidateId, expires, result, edit: {
    tripId, expectedPlanVersion: version, eventId, action: "replace", event: proposed.events.find((item) => item.id === eventId)!,
    places, costs: proposed.costs, routeLegs: proposed.routeLegs, pendingItems, warnings: result.warnings,
  } });
  return result;
}

export async function applyAttractionReplacement(tripId: string, version: number, eventId: string, candidateId: string, previewToken: string, signal?: AbortSignal) {
  assertActive(signal);
  const preview = previews.get(previewToken);
  if (!preview || preview.expires <= Date.now() || preview.tripId !== tripId || preview.version !== version || preview.eventId !== eventId || preview.candidateId !== candidateId) {
    throw new PlanConflictError("替换预览已失效，请重新预览后确认。");
  }
  if (!preview.result.canApply) throw new PlanValidationError(preview.result.conflicts[0] ?? "替换存在冲突，旧计划未改变。");
  // The preview binds routes to the fixed itinerary date/time, not to the UI's
  // current clock. A cached result must still be recent at actual application.
  if (preview.edit.routeLegs.some((route) => (route.fromEventId === eventId || route.toEventId === eventId) && route.durationSeconds !== null &&
    Date.now() - Date.parse(route.retrievedAt) > 15 * 60_000)) throw new PlanConflictError("预览中的路线已需要刷新，请重新预览后确认。");
  const saved = await savePlanAttractionEdit({ ...preview.edit, abortSignal: signal });
  previews.delete(previewToken);
  return saved;
}

export async function keepPlanAttraction(tripId: string, version: number, eventId: string, candidateId?: string, signal?: AbortSignal) {
  assertActive(signal);
  const plan = await getPlanVersion(tripId, version);
  const event = getActivity(plan, eventId);
  assertActive(signal);
  if (!plan.isCurrent) throw new PlanConflictError("历史版本只读，请回到当前计划操作。");
  const entry = catalogEntryForEvent(plan, event);
  if (candidateId && candidateId !== entry?.id) throw new PlanValidationError("保留只适用于当前景点；选择其他景点请先预览替换。");
  const currentCard = entry ? buildAttractionCard(entry, plan, event, true, await listEvidenceFacts(tripId)) : null;
  if (currentCard?.eligibility === "excluded") throw new PlanValidationError(currentCard.warnings[0] ?? "当前景点存在已确认冲突，请选择其他候选。");
  assertActive(signal);
  if (event.attractionSelection?.action === "keep" && event.attractionSelection.catalogId === (entry?.id ?? null)) return plan;
  return savePlanAttractionEdit({ tripId, expectedPlanVersion: version, eventId, action: "keep",
    event: { ...event, attractionSelection: { catalogId: entry?.id ?? null, action: "keep", selectedAt: new Date().toISOString() } },
    places: plan.places, routeLegs: plan.routeLegs, costs: plan.costs, pendingItems: plan.pendingItems,
    warnings: ["已记录保留景点的选择；这不代表完成预约、购票或来源核验。"], abortSignal: signal });
}
