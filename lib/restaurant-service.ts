import crypto from "node:crypto";
import { confirmedBudgetLimit } from "./attractions";
import { calculateBudgetSummary, derivePlanCosts, validatePlanCosts } from "./budget";
import { listEvidenceFacts } from "./evidence-service";
import { planEventStart, preparePlanForStorage, validatePlan } from "./plan";
import { getPlanVersion, PlanConflictError, PlanValidationError, savePlanRecommendationEdit, type PlanVersionRecord } from "./plan-service";
import { placeIdentity, placeSchema } from "./places";
import { buildPlanRedlines } from "./redline-service";
import { occupiedEnd, replacementRoutes } from "./recommendation-service";
import { getRestaurantCatalogEntry, restaurantCityMatches } from "./restaurant-catalog";
import { buildRestaurantCard, buildRestaurantRecommendations, diningMinutes, mealCost, mealPricingSchema, priceMealCost, restaurantExclusions, restaurantForEvent, restaurantProtectionReasons, type MealPricing, type RestaurantPreview } from "./restaurants";

type PreparedEdit = Parameters<typeof savePlanRecommendationEdit>[0];
type CacheEntry = { tripId: string; version: number; eventId: string; expires: number; result: RestaurantPreview; edit: PreparedEdit };
const globalCache = globalThis as typeof globalThis & { restaurantPreviews?: Map<string, CacheEntry> };
const previews = globalCache.restaurantPreviews ??= new Map<string, CacheEntry>();
function active(signal?: AbortSignal) { if (signal?.aborted) throw new PlanConflictError("本次餐厅选择已取消，旧计划保持不变。"); }
function meal(plan: PlanVersionRecord, eventId: string) {
  const event = plan.events.find((item) => item.id === eventId);
  if (!event || event.type !== "meal") throw new PlanValidationError("没有找到对应用餐安排。");
  return event;
}
export async function getPlanRestaurants(tripId: string, version: number, eventId: string) {
  const [plan, facts] = await Promise.all([getPlanVersion(tripId, version), listEvidenceFacts(tripId)]);
  meal(plan, eventId);
  return buildRestaurantRecommendations(plan, eventId, facts);
}

export async function previewRestaurantEdit(tripId: string, version: number, eventId: string, candidateId: string | null, rawPricing: MealPricing, signal?: AbortSignal): Promise<RestaurantPreview> {
  active(signal);
  const pricing = mealPricingSchema.parse(rawPricing);
  const plan = await getPlanVersion(tripId, version), before = meal(plan, eventId);
  const protection = restaurantProtectionReasons(plan, before);
  if (protection.length) throw new PlanConflictError(protection[0]);
  const existing = restaurantForEvent(plan, before);
  const entry = candidateId ? getRestaurantCatalogEntry(candidateId) : existing;
  if (candidateId && (!entry || !restaurantCityMatches(entry.city, plan.requestSnapshot.destination ?? ""))) throw new PlanValidationError("候选不属于本计划目的地。");
  const replace = !!candidateId && candidateId !== existing?.id;
  const selectedAt = new Date().toISOString();
  const place = replace && entry?.location ? placeSchema.parse({ ...entry.location, id: placeIdentity(entry.location, "poi"), precision: "poi", confirmation: "user_confirmed", confirmedAt: selectedAt,
    source: entry.location.provider === "osm" ? "OpenStreetMap / Nominatim" : "高德地图地点搜索" }) : null;
  const invalidatedAccessOrigins = [...(before.restaurantSelection?.invalidatedAccessOrigins ?? []),
    ...(replace ? plan.tickets.filter((ticket) => ticket.status === "active" && ticket.chainOriginName === before.locationName && ticket.date === before.date && ticket.departureTime &&
      plan.events.filter((item) => item.locationName === ticket.chainOriginName && item.date === ticket.date && planEventStart(item).getTime() < Date.parse(`${ticket.date}T${ticket.departureTime}:00+08:00`))
        .sort((left, right) => planEventStart(right).getTime() - planEventStart(left).getTime())[0]?.id === before.id)
      .map((ticket) => ({ ticketId: ticket.id, originName: ticket.chainOriginName! })) : [])]
    .filter((item, index, all) => (replace ? entry!.name : before.locationName) !== item.originName && all.findIndex((other) => other.ticketId === item.ticketId && other.originName === item.originName) === index);
  const changed = { ...before,
    ...(replace && entry ? { title: entry.name, locationName: entry.name, placeId: place?.id ?? null, ...occupiedEnd(before, diningMinutes(entry, plan)),
      note: "餐厅地址、营业、菜单价格及下一站交通待复核；未订餐，暂无可靠排队信息。" } : {}),
    restaurantSelection: { catalogId: entry?.id ?? null, action: replace ? "replace" as const : "adjust" as const, selectedAt,
      ...(invalidatedAccessOrigins.length ? { invalidatedAccessOrigins } : {}) } };
  const prepared = preparePlanForStorage({ events: plan.events.map((event) => event.id === eventId ? changed : event), pendingItems: plan.pendingItems });
  const event = prepared.events.find((item) => item.id === eventId)!;
  const places = plan.places.filter((item) => prepared.events.some((itemEvent) => itemEvent.placeId === item.id));
  if (place && !places.some((item) => item.id === place.id)) places.push(place);
  const oldCost = mealCost(plan, eventId) ?? derivePlanCosts([event])[0];
  const costs = [...plan.costs.filter((cost) => cost.id !== oldCost.id), priceMealCost(oldCost, pricing)];
  let proposed: PlanVersionRecord = { ...plan, events: prepared.events, places, costs };
  const updated = replace ? await replacementRoutes(plan, proposed, eventId, signal) : { routeLegs: plan.routeLegs, costs, warnings: [] as string[] };
  active(signal);
  const pendingId = `restaurant-${eventId}`.slice(0, 80);
  const pendingItems = plan.pendingItems.filter((item) => item.id !== pendingId);
  if (pendingItems.length < 24) pendingItems.push({ id: pendingId, category: "opening_hours", title: `${event.locationName ?? event.title}用餐前核对`.slice(0, 160),
    reason: "确认具体门店、营业与停止点餐时间、实际菜单和下一站交通；排队资料未知，不保证有座。", requiredBefore: event.date });
  proposed = { ...proposed, routeLegs: updated.routeLegs, costs: updated.costs, pendingItems };
  const facts = replace ? [] : await listEvidenceFacts(tripId);
  const card = entry ? buildRestaurantCard(entry, proposed, event, true, facts, pricing) : null;
  const conflicts = entry ? restaurantExclusions(entry, proposed, event, pricing) : [];
  // A current branch with confirmed closure must not be retained by repricing.
  if (card?.eligibility === "excluded") conflicts.push(...card.warnings.filter((warning) => /关闭|冲突|搬迁|停业|超出|上限/.test(warning)));
  const validation = validatePlan({ events: proposed.events, pendingItems }, plan.requestSnapshot, proposed.costs, plan.validationResults.scope);
  conflicts.push(...validation.errors, ...validatePlanCosts(proposed.costs, proposed.events));
  if (replace) for (const route of proposed.routeLegs) if ((route.fromEventId === eventId || route.toEventId === eventId) && route.durationSeconds !== null && route.conflict) conflicts.push(route.conflict);
  const afterBudget = calculateBudgetSummary(proposed.costs, plan.requestSnapshot);
  const hardBudget = confirmedBudgetLimit(plan);
  if (hardBudget !== null && afterBudget.totalMinCents > hardBudget) conflicts.push("调整后的已知总额下限超过本计划明确预算上限。");
  const warnings = [...updated.warnings, ...validation.warnings, ...(card?.warnings ?? ["此门店暂无已整理资料，营业、排队和价格仍需确认。"])];
  const walking = plan.requestSnapshot.constraints.join("；").match(/(?:每日|每天)?步行(?:距离)?(?:上限|不超过|最多)\s*(\d+(?:\.\d+)?)\s*(公里|千米|km|米)/i);
  if (replace && walking) {
    const limit = Number(walking[1]) * (walking[2] === "米" ? 1 : 1000);
    const total = proposed.routeLegs.filter((route) => route.date === event.date && route.mode === "walking").reduce((sum, route) => sum + (route.distanceMeters ?? 0), 0);
    if (total > limit) conflicts.push("已知步行距离超过本计划明确的每日步行上限。");
    else warnings.push("步行数据仍不完整，未知距离未当作零，不能保证满足步行上限。");
  }
  if (replace) {
    const [after, prior] = await Promise.all([buildPlanRedlines(proposed), buildPlanRedlines(plan)]);
    for (const line of after) for (const conflict of line.conflicts) {
      if (line.suggestedAt && conflict.startsWith("上一项结束于") && !prior.find((item) => item.input.id === line.input.id)?.conflicts.includes(conflict)) conflicts.push(`固定交通红线：${conflict}`);
      else warnings.push(`固定交通红线：${conflict}`);
    }
    for (const line of after) warnings.push(...line.input.blockers.map((message) => `交通红线待补：${message}`));
  }
  active(signal);
  if (!(await getPlanVersion(tripId, version)).isCurrent) throw new PlanConflictError("查询期间计划已变化，请重新预览。");
  active(signal);
  const now = Date.now();
  for (const [key, value] of previews) if (value.expires <= now) previews.delete(key);
  if (previews.size >= 100) previews.delete(previews.keys().next().value!);
  const previewToken = crypto.randomBytes(32).toString("base64url"), expires = now + 10 * 60_000;
  const result: RestaurantPreview = { previewToken, eventId, candidateId, expiresAt: new Date(expires).toISOString(), pricing,
    beforeBudget: calculateBudgetSummary(plan.costs, plan.requestSnapshot), afterBudget, card,
    changes: [replace ? `${before.locationName ?? before.title} → ${entry!.name}，日程身份不变。` : `保留“${before.locationName ?? before.title}”，调整本餐预算。`,
      `${pricing.dinerCount} 人 × 人均${pricing.minCents === null ? "未知" : `${pricing.minCents / 100}${pricing.maxCents !== null && pricing.maxCents !== pricing.minCents ? `–${pricing.maxCents / 100}` : ""}元`} × 1 餐；未标记已付款。`,
      replace ? `${before.startTime}–${before.endTime} → ${event.startTime}–${event.endTime}；地点、已有相邻路线、预算和红线按同一新版本更新。` : "本餐人数不改整趟人数、其他餐次、路线或固定交通。",
      "修改过的门店或费用来源需重新核验；不会自动订餐或保证有座。"],
    conflicts: [...new Set(conflicts)], warnings: [...new Set(warnings)], canApply: conflicts.length === 0 };
  previews.set(previewToken, { tripId, version, eventId, expires, result, edit: {
    tripId, expectedPlanVersion: version, eventId, targetType: "meal", action: replace ? "replace" : "adjust", event,
    places, costs: proposed.costs, routeLegs: proposed.routeLegs, pendingItems, warnings: result.warnings } });
  return result;
}

export async function applyRestaurantEdit(tripId: string, version: number, eventId: string, token: string, signal?: AbortSignal) {
  active(signal);
  const cached = previews.get(token);
  if (!cached || cached.expires <= Date.now() || cached.tripId !== tripId || cached.version !== version || cached.eventId !== eventId) throw new PlanConflictError("用餐预览已失效，请重新预览后确认。");
  if (!cached.result.canApply) throw new PlanValidationError(cached.result.conflicts[0] ?? "存在冲突，旧计划未改变。");
  if (cached.edit.action === "adjust") {
    const latest = await getPlanRestaurants(tripId, version, eventId);
    if (latest.current?.eligibility === "excluded") throw new PlanValidationError("门店来源在预览后出现营业或位置冲突，请重新查看候选。");
  }
  if (cached.edit.action === "replace" && cached.edit.routeLegs.some((route) => (route.fromEventId === eventId || route.toEventId === eventId) && route.durationSeconds !== null && Date.now() - Date.parse(route.retrievedAt) > 15 * 60_000)) throw new PlanConflictError("路线资料已过期，请重新预览。");
  const saved = await savePlanRecommendationEdit({ ...cached.edit, abortSignal: signal });
  previews.delete(token);
  return saved;
}
