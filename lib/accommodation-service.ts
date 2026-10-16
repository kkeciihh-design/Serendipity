import crypto from "node:crypto";
import { buildStayRecommendations, nightsBetween, stayConditionChecks, stayEvents, stayInputIssues, stayInputSchema, stayPointDistance, type StayInput, type StayPreview } from "./accommodations";
import { calculateBudgetSummary, derivePlanCosts, hasProtectedCostFact, planCostItemSchema } from "./budget";
import { confirmedBudgetLimit } from "./attractions";
import { nextPlanDate, validatePlan } from "./plan";
import { applyRouteCost, getPlanVersion, PlanConflictError, PlanValidationError, savePlanRecommendationEdit, updateRoutesAfterEventChange, type PlanVersionRecord } from "./plan-service";
import { placeCandidateSchema, placeIdentity, placeSchema, type Place } from "./places";
import { verifySignedPayload } from "./security";
import { isRoutePair, routeDayEvents } from "./route-day";
import { queryPlanRoute } from "./route-service";
import { invalidateRouteReference, manualReferenceRoute, routeConflict } from "./routes";
import { buildPlanRedlines } from "./redline-service";

type Edit = Parameters<typeof savePlanRecommendationEdit>[0];
type Cached = { tripId: string; version: number; eventId: string; expires: number; result: StayPreview; edit: Edit };
const globalCache = globalThis as typeof globalThis & { stayPreviews?: Map<string, Cached> };
const previews = globalCache.stayPreviews ??= new Map<string, Cached>();
function active(signal?: AbortSignal) { if (signal?.aborted) throw new PlanConflictError("住宿预览已取消，请重新操作。"); }
export async function getPlanAccommodations(tripId: string, version: number, eventId: string) {
  const plan = await getPlanVersion(tripId, version);
  if (!plan.events.some((e) => e.id === eventId && e.type === "accommodation")) throw new PlanValidationError("没有找到住宿安排。");
  return buildStayRecommendations(plan, eventId);
}
function hotelPlace(plan: PlanVersionRecord, eventId: string, token: string | null): Place {
  const event = plan.events.find((e) => e.id === eventId)!;
  if (!token && event.accommodationSelection?.kind === "hotel") {
    const existing = plan.places.find((p) => p.id === event.placeId && p.precision === "poi");
    if (existing) return existing;
  }
  const data = token ? verifySignedPayload(token) : null;
  if (!data || data.scope !== "place-selection" || data.tripId !== plan.tripId || data.version !== plan.versionNumber || data.eventId !== eventId || typeof data.exp !== "number" || data.exp <= Date.now()) throw new PlanConflictError("请先搜索并选择本次入住的具体酒店；候选过期后需重新搜索。");
  const candidate = placeCandidateSchema.parse(data.candidate);
  if (/boundary:|place:|地名地址|行政地名/.test(candidate.category) || !/hotel|hostel|guest_house|motel|酒店|宾馆|旅馆|住宿/i.test(candidate.category)) throw new PlanValidationError("请选择地图中明确标为酒店或旅馆的具体地点，区域中点不能作为实际酒店。");
  const city = (v: string) => v.replace(/市|\s/g, "").toLowerCase();
  if (city(candidate.city) !== city(plan.requestSnapshot.destination ?? "")) throw new PlanValidationError("酒店城市与本计划目的地不符，请核对具体门店。");
  return placeSchema.parse({ ...candidate, id: placeIdentity(candidate, "poi"), precision: "poi", confirmation: "user_confirmed", confirmedAt: new Date().toISOString(), source: candidate.provider === "osm" ? "OpenStreetMap / Nominatim" : "高德地图地点搜索" });
}

export async function previewAccommodation(tripId: string, version: number, eventId: string, raw: StayInput, signal?: AbortSignal): Promise<StayPreview> {
  active(signal);
  const input = stayInputSchema.parse(raw), plan = await getPlanVersion(tripId, version);
  const data = buildStayRecommendations(plan, eventId), area = data.areas.find((a) => a.id === input.areaId);
  if (!area) throw new PlanValidationError("住宿区域已变化，请重新比较。");
  const issues = stayInputIssues(plan, eventId, input);
  if (issues.length) throw new PlanConflictError(issues[0]);
  const originals = stayEvents(plan, input.checkIn, input.checkOut), ids = new Set(originals.map((e) => e.id));
  let place: Place | null = null;
  if (input.kind === "hotel") place = hotelPlace(plan, eventId, input.hotelToken);
  else if (area.reference) place = { ...area.reference, id: placeIdentity(area.reference, "area_reference"), precision: "area_reference", name: `${area.name.slice(0, 130)}（区域参考点）`, confirmedAt: new Date().toISOString() };
  const name = input.kind === "hotel" ? place!.name : `${area.name.slice(0, 130)}（区域参考点）`;
  const selectedAt = new Date().toISOString(), stayId = `stay-${originals[0].id}`.slice(0, 80);
  const invalidatedAccessOrigins = originals.flatMap((e) => [
    ...(e.accommodationSelection?.invalidatedAccessOrigins ?? []),
    ...plan.tickets.filter((t) => t.status === "active" && t.chainOriginName === e.locationName && (t.date === e.date || t.date === nextPlanDate(e.date))).map((t) => ({ ticketId: t.id, originName: t.chainOriginName! })),
  ]).filter((v, i, all) => v.originName !== name && all.findIndex((o) => o.ticketId === v.ticketId && o.originName === v.originName) === i);
  const events = plan.events.map((event) => ids.has(event.id) ? { ...event, title: input.kind === "hotel" ? `入住 · ${name}`.slice(0, 120) : "住宿区域参考", locationName: name, placeId: place?.id ?? null,
    accommodationSelection: { stayId, areaId: area.id, areaName: area.name, kind: input.kind, checkIn: input.checkIn, checkOut: input.checkOut,
      roomCount: input.roomCount, nightCount: nightsBetween(input.checkIn, input.checkOut), morningDepartureTime: input.morningDepartureTime,
      checkInFrom: input.checkInFrom, checkOutBy: input.checkOutBy, luggageStorage: input.luggageStorage, conditionNote: input.conditionNote, selectedAt, invalidatedAccessOrigins },
    note: "仅记录住宿选择，未预订；价格、房态和入住/寄存条件分别核对。" } : event);
  const places = plan.places.filter((p) => events.some((e) => e.placeId === p.id));
  if (place && !places.some((p) => p.id === place.id)) places.push(place);
  const costs = plan.costs.filter((c) => !(ids.has(c.linkedEventId) && c.category === "accommodation" && !c.eventRemoved));
  for (const e of originals) {
    const old = plan.costs.find((c) => c.linkedEventId === e.id && c.category === "accommodation" && !c.eventRemoved) ?? derivePlanCosts([e])[0];
    costs.push(planCostItemSchema.parse({ ...old, unit: "per_room_per_night", roomCount: input.roomCount, nightCount: 1, quantity: null,
      unitAmountCents: input.minCents, unitAmountMaxCents: input.maxCents, certainty: input.minCents === null ? "pending_confirmation" : "estimated", paymentStatus: "not_paid", source: "ai_draft",
      note: `${e.date}入住的一晚，${input.roomCount}房；此行只计1晚，整次入住${nightsBetween(input.checkIn, input.checkOut)}晚按日分行。手填预算不是酒店报价或订房凭证。` }));
  }
  const conditions = stayConditionChecks(originals, input), warnings = [...conditions.warnings], conflicts = [...conditions.conflicts];
  const areaDistance = stayPointDistance(place, area.reference);
  if (input.kind === "hotel" && areaDistance !== null && areaDistance > 3000) warnings.push(`具体酒店距所选区域参考点直线约${(areaDistance / 1000).toFixed(1)}公里；位置取舍以实际酒店及重算路线为准。`);
  const pendingId = `stay-${originals[0].id}`.slice(0, 80);
  const pendingItems = plan.pendingItems.filter((p) => p.id !== pendingId);
  if (pendingItems.length < 24) pendingItems.push({ id: pendingId, category: "accommodation", title: "核对住宿房态与入住条件", reason: "确认具体酒店、实际房价、房型容量、入住/退房及寄存条件；应用只记录选择，不执行预订。", requiredBefore: input.checkIn });
  let proposed: PlanVersionRecord = { ...plan, events, places, costs, pendingItems };
  // Generic invalidation also protects prior paid journeys and handles routes
  // whose other endpoint has moved since the previous stay.
  for (const e of originals) {
    const updated = updateRoutesAfterEventChange(proposed.routeLegs, events, proposed.costs, e.id, plan.events);
    proposed = { ...proposed, ...updated };
  }
  const pairMap = new Map<string, { fromId: string; toId: string; date: string; departureTime: string }>();
  for (const date of new Set(originals.flatMap((e) => [e.date, nextPlanDate(e.date)]))) {
    const located = routeDayEvents(events, date).filter((e) => e.placeId);
    for (let i = 0; i < located.length - 1; i++) {
      const from = located[i], to = located[i + 1];
      if ((ids.has(from.id) || ids.has(to.id)) && !["departure_transport", "return_transport"].includes(from.type)) pairMap.set(`${from.id}:${to.id}`, { fromId: from.id, toId: to.id, date, departureTime: from.endTime });
    }
  }
  for (const pair of pairMap.values()) {
    active(signal);
    const old = plan.routeLegs.find((r) => r.fromEventId === pair.fromId && r.toEventId === pair.toId);
    let route = old ?? manualReferenceRoute({ tripId, date: pair.date, edit: { fromEventId: pair.fromId, toEventId: pair.toId, departureTime: pair.departureTime, manualReference: { availability: "no_service", instructions: "住宿地点或适用路线待确认", durationMinutes: null, fareCents: null, sourceName: "路线待查询", sourceUrl: null, checkedAt: selectedAt, acknowledged: true } } });
    if (!old) route = { ...route, manualReference: undefined };
    try {
      if (input.kind !== "hotel" || (old?.manualReference && input.routeMode === "public_transit") || !isRoutePair(events, pair.fromId, pair.toId)) throw new Error("需精确酒店或重新核对人工路线");
      route = await queryPlanRoute(proposed, { fromEventId: pair.fromId, toEventId: pair.toId, mode: input.routeMode, departureTime: pair.departureTime }, signal);
      const to = events.find((e) => e.id === pair.toId)!;
      route = { ...route, conflict: routeConflict({ route, earliestDate: to.date, earliestStartTime: to.startTime }) };
      if (route.durationSeconds !== null && route.conflict) conflicts.push(route.conflict);
    } catch {
      active(signal);
      route = { ...invalidateRouteReference(route, pair.date, pair.departureTime), mode: input.routeMode, scheduleBasis: "区域未精确到酒店、人工路线待核对或路线服务不可用；旧路径已清除，耗时与车费未知。" };
    }
    if (route.durationSeconds === null) warnings.push(`${events.find((e) => e.id === pair.fromId)!.title} → ${events.find((e) => e.id === pair.toId)!.title}：交通时间和费用待确认。`);
    proposed.routeLegs = [...proposed.routeLegs.filter((r) => !(r.fromEventId === pair.fromId && r.toEventId === pair.toId)), route];
    proposed.costs = applyRouteCost(route.status === "unavailable" ? { ...route, status: "pending_confirmation" } : route, events, proposed.costs);
  }
  // If the new area has no coordinates, retain unknown replacement journey
  // costs rather than erasing the old journey into a zero-price result.
  for (const old of plan.routeLegs.filter((r) => ids.has(r.fromEventId) || ids.has(r.toEventId))) {
    if (!proposed.routeLegs.some((r) => r.fromEventId === old.fromEventId && r.toEventId === old.toEventId)) {
      const unavailable = invalidateRouteReference(old, old.date, old.departureTime);
      proposed.routeLegs.push(unavailable);
      proposed.costs = applyRouteCost({ ...unavailable, status: "pending_confirmation" }, events, proposed.costs);
    }
  }
  if (!pairMap.size) warnings.push("相邻活动或住宿缺少定位；请补齐地图地点，当前无法计算进出酒店的交通。");
  const validation = validatePlan({ events, pendingItems }, plan.requestSnapshot, proposed.costs);
  conflicts.push(...validation.errors); warnings.push(...validation.warnings);
  const afterBudget = calculateBudgetSummary(proposed.costs, plan.requestSnapshot), hardBudget = confirmedBudgetLimit(plan);
  if (hardBudget !== null && afterBudget.totalMinCents > hardBudget) conflicts.push("住宿调整后已知费用下限超过明确预算上限。");
  const walking = plan.requestSnapshot.constraints.join("；").match(/(?:每日|每天)?步行(?:距离)?(?:上限|不超过|最多)\s*(\d+(?:\.\d+)?)\s*(公里|千米|km|米)/i);
  if (walking) {
    const limit = Number(walking[1]) * (walking[2] === "米" ? 1 : 1000);
    for (const date of new Set(proposed.routeLegs.map((r) => r.date))) if (proposed.routeLegs.filter((r) => r.date === date && r.mode === "walking").reduce((s, r) => s + (r.distanceMeters ?? 0), 0) > limit) conflicts.push(`${date}已知步行距离超过明确的每日步行上限。`);
    warnings.push("未定位或未查询的步行距离仍未知，不能保证满足步行上限。");
  }
  if (input.routeMode === "driving" && plan.requestSnapshot.constraints.some((c) => /不自驾/.test(c))) warnings.push("驾车路线仅作乘车路径参考；不安排自驾，打车候车时间与车费未知。");
  const [afterLines, beforeLines] = await Promise.all([buildPlanRedlines(proposed), buildPlanRedlines(plan)]);
  for (const line of afterLines) {
    warnings.push(...line.input.blockers);
    for (const message of line.conflicts) {
      if (line.suggestedAt && message.startsWith("上一项结束于") && !beforeLines.find((l) => l.input.id === line.input.id)?.conflicts.includes(message)) conflicts.push(`固定交通红线：${message}`);
      else warnings.push(`固定交通红线：${message}`);
    }
    const incoming = proposed.routeLegs.find((r) => r.toEventId === line.input.eventId && ids.has(r.fromEventId));
    if (incoming && line.suggestedAt && Date.parse(`${incoming.date}T${incoming.departureTime}:00+08:00`) > Date.parse(line.suggestedAt)) conflicts.push("计划离店时刻晚于返程红线，请提前离店并重新查询路线。");
  }
  for (const old of plan.costs.filter(hasProtectedCostFact)) if (!proposed.costs.some((c) => c.id === old.id)) proposed.costs.push(old);
  active(signal);
  if (!(await getPlanVersion(tripId, version)).isCurrent) throw new PlanConflictError("查询期间计划已变化，请重新预览。");
  const now = Date.now();
  for (const [key, value] of previews) if (value.expires <= now) previews.delete(key);
  if (previews.size >= 100) previews.delete(previews.keys().next().value!);
  const previewToken = crypto.randomBytes(32).toString("base64url"), expires = now + 10 * 60_000;
  const result: StayPreview = { previewToken, expiresAt: new Date(expires).toISOString(), beforeBudget: calculateBudgetSummary(plan.costs, plan.requestSnapshot), afterBudget,
    changes: [`${input.kind === "hotel" ? "确认实际酒店" : "选择区域偏好"}：${name}。`, `${input.checkIn} 入住 → ${input.checkOut} 离店，共${nightsBetween(input.checkIn, input.checkOut)}晚、${input.roomCount}房；预算按每晚分别计一次。`,
      `次日${input.morningDepartureTime}从住宿出发；相邻路线、费用和红线按同一版本重新计算。`, "只确认地点与入住资料，不表示已预订、有房或已付款；实际酒店价格、房态需分别核对。"],
    warnings: [...new Set(warnings)], conflicts: [...new Set(conflicts)], canApply: conflicts.length === 0,
    routes: proposed.routeLegs.filter((r) => ids.has(r.fromEventId) || ids.has(r.toEventId)).map((r) => ({ label: `${events.find((e) => e.id === r.fromEventId)?.locationName} → ${events.find((e) => e.id === r.toEventId)?.locationName}`, date: r.date, durationSeconds: r.durationSeconds, source: r.scheduleBasis })) };
  previews.set(previewToken, { tripId, version, eventId, expires, result, edit: { tripId, expectedPlanVersion: version, eventId, targetType: "accommodation", action: "replace",
    event: events.find((e) => e.id === eventId)!, relatedEvents: events.filter((e) => ids.has(e.id) && e.id !== eventId), places, costs: proposed.costs, routeLegs: proposed.routeLegs, pendingItems, warnings: result.warnings } });
  return result;
}
export async function applyAccommodation(tripId: string, version: number, eventId: string, token: string, signal?: AbortSignal) {
  active(signal);
  const cached = previews.get(token);
  if (!cached || cached.tripId !== tripId || cached.version !== version || cached.eventId !== eventId || cached.expires <= Date.now()) throw new PlanConflictError("住宿预览已过期或不属于本计划，请重新预览。");
  if (!cached.result.canApply) throw new PlanValidationError(cached.result.conflicts[0]);
  const ids = new Set([cached.eventId, ...(cached.edit.relatedEvents ?? []).map((e) => e.id)]);
  if (cached.edit.routeLegs.some((r) => (ids.has(r.fromEventId) || ids.has(r.toEventId)) && r.durationSeconds !== null && Date.now() - Date.parse(r.retrievedAt) > 15 * 60_000)) throw new PlanConflictError("路线已过期，请重新预览。");
  const saved = await savePlanRecommendationEdit({ ...cached.edit, abortSignal: signal });
  previews.delete(token);
  return saved;
}
