import { z } from "zod";
import { confirmedBudgetLimit } from "./attractions";
import { budgetFactorsFromSnapshot, calculateBudgetSummary, costItemLineTotals, formatMoneyRange, hasProtectedCostFact, type BudgetSummary, type PlanCostItem } from "./budget";
import { effectiveEvidenceStatus, type EvidenceFactClient } from "./evidence";
import { planEventEnd, planEventStart, sortPlanEvents, type PlanEvent } from "./plan";
import type { PlanVersionRecord } from "./plan-service";
import { toWgs84 } from "./places";
import { getRestaurantCatalog, normalizedRestaurantName, restaurantCityMatches, restaurantImages, type RestaurantCatalogEntry } from "./restaurant-catalog";
import type { RouteLeg } from "./routes";

export const mealPricingSchema = z.object({
  dinerCount: z.number().int().min(1).max(100),
  minCents: z.number().int().min(0).max(2_000_000_000).nullable(),
  maxCents: z.number().int().min(0).max(2_000_000_000).nullable(),
}).strict().refine((value) => value.maxCents === null || (value.minCents !== null && value.maxCents >= value.minCents), "人均区间上限不能低于下限，金额未知时不能只填写上限。");
export type MealPricing = z.infer<typeof mealPricingSchema>;
export type RestaurantCard = RestaurantCatalogEntry & {
  eventId: string; dayNumber: number; date: string; isCurrent: boolean;
  reasons: string[]; warnings: string[]; eligibility: "pending" | "excluded";
  previousStop: string | null; nextStop: string | null; incomingRoute: RouteLeg | null; outgoingRoute: RouteLeg | null;
  diningFit: string; queueText: string; pricing: MealPricing; totalMinCents: number | null; totalMaxCents: number | null;
  budgetFit: "within_known" | "over_known" | "unknown";
  geographicDistanceMeters: number | null;
};
export type RestaurantRecommendations = {
  planVersionId: string; versionNumber: number; eventId: string; eventName: string;
  current: RestaurantCard | null; candidates: RestaurantCard[]; excluded: { id: string; name: string; reasons: string[] }[];
  pricing: MealPricing; currentMealTotal: { minCents: number | null; maxCents: number | null };
  canEdit: boolean; readOnly: boolean; protectionReasons: string[]; notices: string[];
};
export type RestaurantPreview = {
  previewToken: string; eventId: string; candidateId: string | null; expiresAt: string;
  changes: string[]; warnings: string[]; conflicts: string[]; canApply: boolean;
  beforeBudget: BudgetSummary; afterBudget: BudgetSummary; card: RestaurantCard | null; pricing: MealPricing;
};
export function mealCost(plan: PlanVersionRecord, eventId: string) {
  return plan.costs.find((cost) => cost.linkedEventId === eventId && cost.category === "meal" && !cost.id.startsWith("route-") && !cost.eventRemoved);
}
export function currentMealPricing(plan: PlanVersionRecord, eventId: string): MealPricing {
  const cost = mealCost(plan, eventId);
  return { dinerCount: cost?.dinerCount ?? plan.requestSnapshot.travelerCount ?? 1,
    minCents: cost?.unit === "per_person" ? cost.unitAmountCents : null,
    maxCents: cost?.unit === "per_person" ? cost.unitAmountMaxCents : null };
}
export function restaurantForEvent(plan: PlanVersionRecord, event: PlanEvent) {
  if (event.type !== "meal") return null;
  const entries = getRestaurantCatalog(plan.requestSnapshot.destination ?? "");
  const place = plan.places.find((item) => item.id === event.placeId);
  if (place && !restaurantCityMatches(place.city, plan.requestSnapshot.destination ?? "")) return null;
  // A confirmed POI must match the branch, not just the brand or stale selection.
  if (place) return entries.find((entry) => entry.location
    ? entry.location.provider === place.provider && entry.location.poiId === place.poiId &&
      Math.abs(entry.location.longitude - place.longitude) < 0.002 && Math.abs(entry.location.latitude - place.latitude) < 0.002
    : [entry.name, ...entry.aliases].some((name) => normalizedRestaurantName(name) === normalizedRestaurantName(place.name))) ?? null;
  return entries.find((entry) => [entry.name, ...entry.aliases].some((name) => normalizedRestaurantName(name) === normalizedRestaurantName(event.locationName || event.title))) ?? null;
}
export function restaurantProtectionReasons(plan: PlanVersionRecord, event: PlanEvent) {
  const reasons: string[] = [];
  if (!plan.isCurrent) reasons.push("历史版本只读，请回到当前计划操作。");
  if (event.type !== "meal") reasons.push("此入口只用于用餐安排。");
  if (event.locked || event.status === "confirmed") reasons.push("这餐已锁定或确认，请先在时间轴明确解除后再修改推荐。");
  if (plan.tickets.some((ticket) => ticket.eventId === event.id && ticket.status === "active")) reasons.push("这项安排受有效票据约束，不能通过餐厅推荐修改。");
  if (plan.costs.some((cost) => cost.linkedEventId === event.id && !cost.id.startsWith("route-") && hasProtectedCostFact(cost))) reasons.push("这餐已有已确认、已支付或退款中的费用，请在预算中核对真实金额；推荐不能覆盖这些事实。");
  return reasons;
}
export function diningMinutes(entry: RestaurantCatalogEntry, plan: PlanVersionRecord) {
  return plan.requestSnapshot.pace === "relaxed" ? entry.diningMinutes.max : plan.requestSnapshot.pace === "packed" ? entry.diningMinutes.min : Math.round((entry.diningMinutes.min + entry.diningMinutes.max) / 2);
}
export function mealFitsOpening(entry: RestaurantCatalogEntry, event: PlanEvent) {
  if (!entry.opening.periods.length) return null;
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = minute(event.startTime), end = start + (planEventEnd(event).getTime() - planEventStart(event).getTime()) / 60_000;
  return entry.opening.periods.some((period) => [-1440, 0].some((offset) => {
    const from = minute(period.start) + offset, to = minute(period.end) + offset + (period.end <= period.start ? 1440 : 0);
    return start >= from && end <= to;
  }));
}
function dated(from: string | null, until: string | null, event: PlanEvent) {
  return from !== null && until !== null && event.date >= from && (event.endDate ?? event.date) <= until;
}
function officialSources(entry: RestaurantCatalogEntry, ids: string[]) {
  return ids.some((id) => entry.sources.some((source) => source.id === id && source.kind === "official" && source.quote.trim() && /^https:\/\//.test(source.url)));
}
export function restaurantExclusions(entry: RestaurantCatalogEntry, plan: PlanVersionRecord, event: PlanEvent, pricing: MealPricing) {
  const reasons: string[] = [];
  if (entry.availability.state !== "unknown" && dated(entry.availability.applicableFrom, entry.availability.applicableUntil, event) && officialSources(entry, entry.availability.sourceIds)) {
    reasons.push(entry.availability.state === "relocated" ? "适用日期的门店来源明确搬迁，旧地址不能继续安排。" : "适用日期的门店来源明确停业。");
  }
  if (entry.opening.status === "verified" && dated(entry.opening.applicableFrom, entry.opening.applicableUntil, event) && officialSources(entry, entry.opening.sourceIds) && mealFitsOpening(entry, event) === false) reasons.push("本餐完整用餐时间超出已核验的营业时段。");
  for (const restriction of plan.requestSnapshot.constraints) {
    if ([entry.name, ...entry.aliases].some((name) => restriction.includes(`不去${name}`) || restriction.includes(`不要${name}`) || restriction.includes(`避开${name}`))) reasons.push("不符合本计划明确排除的门店限制。");
  }
  const hard = confirmedBudgetLimit(plan);
  if (hard !== null && pricing.minCents !== null) {
    const base = plan.costs.filter((cost) => cost.linkedEventId !== event.id || cost.category !== "meal" || hasProtectedCostFact(cost));
    if (calculateBudgetSummary(base, plan.requestSnapshot).totalMinCents + pricing.minCents * pricing.dinerCount > hard) reasons.push("本餐估算计入后，已知总额下限超过明确预算上限。");
  }
  return [...new Set(reasons)];
}
export function buildRestaurantCard(entry: RestaurantCatalogEntry, plan: PlanVersionRecord, event: PlanEvent, isCurrent: boolean, facts: EvidenceFactClient[] = [], override?: MealPricing): RestaurantCard {
  const pricing = override ?? (isCurrent ? currentMealPricing(plan, event.id) : { dinerCount: currentMealPricing(plan, event.id).dinerCount, minCents: entry.price.minCents, maxCents: entry.price.maxCents });
  const savedCost = isCurrent && !override ? mealCost(plan, event.id) : undefined;
  const savedTotal = savedCost ? costItemLineTotals(savedCost, budgetFactorsFromSnapshot(plan.requestSnapshot)) : null;
  const ordered = sortPlanEvents(plan.events.filter((item) => item.date === event.date && item.locationName && item.type !== "local_transport"));
  const index = ordered.findIndex((item) => item.id === event.id);
  const previous = ordered[index - 1], next = ordered[index + 1];
  const budget = calculateBudgetSummary(plan.costs.filter((cost) => cost.linkedEventId !== event.id || cost.category !== "meal"), plan.requestSnapshot);
  const budgetFit = budget.budgetTargetCents === null || pricing.minCents === null ? "unknown" :
    budget.totalMinCents + pricing.minCents * pricing.dinerCount > budget.budgetTargetCents ? "over_known" : "within_known";
  const neighbors = [previous, next].map((item) => plan.places.find((place) => place.id === item?.placeId));
  const geographicDistanceMeters = entry.location && neighbors.every((place) => place?.precision === "poi") ? Math.round(neighbors.reduce((sum, place) => {
    const from = toWgs84(place!, place!.coordinateSystem), to = toWgs84(entry.location!, entry.location!.coordinateSystem);
    const radians = Math.PI / 180, latitude = (from.latitude + to.latitude) / 2 * radians;
    return sum + Math.hypot((from.longitude - to.longitude) * Math.cos(latitude), from.latitude - to.latitude) * 111_195;
  }, 0)) : null;
  const diningFit = pricing.dinerCount === 1
    ? entry.service === "individual" ? "1人用餐：按碗点餐，份量仍需向门店核对。" : entry.service === "small_plates" ? "1人用餐：优先少量小吃，避免按整桌湘菜点单。" : "1人用餐：小份菜、最低消费及单人接待情况未知，请先确认。"
    : `${pricing.dinerCount}人用餐：${entry.service === "individual" ? "每人点餐，按实际碗数计费；" : entry.service === "small_plates" ? "可比较小份分享和个人主食；" : "菜量和点餐方式未知；"}座位、拼桌和接待人数上限待确认。`;
  const warnings = restaurantExclusions(entry, plan, event, pricing);
  const card: RestaurantCard = { ...structuredClone(entry), images: restaurantImages(entry), eventId: event.id, dayNumber: event.dayNumber, date: event.date, isCurrent,
    pricing, budgetFit, geographicDistanceMeters, totalMinCents: savedTotal ? savedTotal.minCents : pricing.minCents === null ? null : pricing.minCents * pricing.dinerCount,
    totalMaxCents: savedTotal ? savedTotal.maxCents : pricing.minCents === null ? null : (pricing.maxCents ?? pricing.minCents) * pricing.dinerCount,
    previousStop: previous?.title ?? null, nextStop: next?.title ?? null,
    incomingRoute: isCurrent ? plan.routeLegs.find((route) => route.toEventId === event.id) ?? null : null,
    outgoingRoute: isCurrent ? plan.routeLegs.find((route) => route.fromEventId === event.id) ?? null : null,
    reasons: [diningFit, `本餐窗口为 ${event.startTime}–${event.endTime}；建议预留 ${diningMinutes(entry, plan)} 分钟用餐（规则估算，不含排队）。`,
      `位于“${previous?.title ?? "当天开始"}”之后、“${next?.title ?? "当天结束"}”之前；替换预览会检查已有路线，缺数据时不承诺顺路。`,
      budget.budgetTargetCents === null ? "尚未设置旅行预算；人均和本餐合计分别展示。" : `本计划全程预算参考 ${formatMoneyRange(budget.budgetTargetCents, null)}；${budgetFit === "over_known" ? "计入本餐后已知下限将超过预算参考，可比较其他选择。" : budgetFit === "within_known" ? "计入本餐后已知下限尚在参考预算内，未知费用仍需补齐。" : "本餐金额未知，暂不能判断预算是否合适。"}`,
      ...(geographicDistanceMeters !== null ? [`地理位置参考：到前后两站的直线距离合计约 ${geographicDistanceMeters} 米，只用于粗略比较，实际道路距离、交通方式与耗时需查询。`] : [])],
    diningFit, queueText: "暂无可靠排队信息", warnings: [...warnings], eligibility: warnings.length ? "excluded" : "pending" };
  if (!dated(entry.opening.applicableFrom, entry.opening.applicableUntil, event)) card.opening.status = "pending";
  if (mealFitsOpening(entry, event) === false && card.eligibility !== "excluded") card.warnings.push("本餐超出来源参考营业时段，尚未确认当天规则；请另选时间或先联系门店。");
  card.warnings.push("营业、停止点餐和门店是否搬迁仍需出发前确认；排队未知，请预留余量。");
  if (!entry.location) card.warnings.push("未取得准确的门店地图点；替换将清除旧地点及不适用路线，需在地图中重新定位。");
  if (pricing.minCents === null) card.warnings.push(savedTotal?.minCents != null
    ? "本餐原合计已记录，但人均口径尚未确认；填写后请核对预览中的新计价。"
    : "本餐金额未知，不按免费或零元计入预算。");
  if (plan.requestSnapshot.constraints.some((value) => /过敏|忌口|素食|清真|不吃|不能吃/.test(value))) card.warnings.push(`饮食限制：${plan.requestSnapshot.constraints.filter((value) => /过敏|忌口|素食|清真|不吃|不能吃/.test(value)).join("；")}。现有菜单不能证明符合，请向门店逐项确认，未标为已满足。`);
  const queue = entry.queue;
  if (queue && officialSources(entry, queue.sourceIds) && Date.now() >= Date.parse(queue.observedAt) && Date.now() - Date.parse(queue.observedAt) <= 15 * 60_000 && Math.abs(planEventStart(event).getTime() - Date.now()) <= 15 * 60_000) card.queueText = `门店 ${queue.observedAt} 记录：${queue.minMinutes}–${queue.maxMinutes} 分钟（仅当时观察，随时变化）。`;
  if (isCurrent) for (const source of facts.filter((item) => item.planVersionId === plan.id && item.targetId === event.id && ["opening_hours", "price", "location"].includes(item.field))) {
    if (source.lastRefreshStatus === "needs_review") { card.warnings.push("原门店或费用来源需要重新核验，旧摘录未用于这家门店。"); continue; }
    const applies = source.applicableFrom !== null && source.applicableUntil !== null && planEventStart(event).getTime() >= Date.parse(source.applicableFrom) && planEventEnd(event).getTime() <= Date.parse(source.applicableUntil);
    const status = effectiveEvidenceStatus(source);
    if (applies && ["opening_hours", "location"].includes(source.field) && ["verified", "conflict"].includes(status)) card.sources.push({ id: `evidence-${source.id}`, title: source.sourceTitle, url: source.sourceUrl, publisher: source.sourcePublisher, kind: "official", retrievedAt: source.retrievedAt, quote: source.contentQuote });
    if (source.field === "opening_hours" && applies && status === "verified") {
      card.opening = { ...card.opening, status: "verified", text: source.extractedValue, sourceIds: [`evidence-${source.id}`], notes: "来源覆盖本餐起止时刻；仍不表示实时营业或有座。" };
      if (/^(?:关闭|闭馆|停业|closed)(?:[。.!！\s]|$)/i.test(source.extractedValue)) { card.eligibility = "excluded"; card.warnings.push("本次营业来源确认关闭，请选择其他候选。"); }
    }
    if (source.field === "opening_hours" && applies && status === "conflict") { card.eligibility = "excluded"; card.warnings.push(source.conflictReason ?? "本次营业来源与用餐安排冲突。"); }
    if (source.field === "location" && applies && status === "conflict") {
      card.eligibility = "excluded";
      card.warnings.push(`门店位置来源冲突，可能搬迁或选错分店，请重新定位：${source.conflictReason ?? "地址不一致"}`);
    }
  }
  return card;
}
export function buildRestaurantRecommendations(plan: PlanVersionRecord, eventId: string, facts: EvidenceFactClient[] = []): RestaurantRecommendations {
  const event = plan.events.find((item) => item.id === eventId);
  if (!event || event.type !== "meal") throw new Error("没有找到对应用餐安排。");
  const current = restaurantForEvent(plan, event), pricing = currentMealPricing(plan, eventId);
  const excluded: RestaurantRecommendations["excluded"] = [];
  const candidates = getRestaurantCatalog(plan.requestSnapshot.destination ?? "").filter((entry) => entry.id !== current?.id).map((entry) => buildRestaurantCard(entry, plan, event, false)).filter((card) => {
    if (card.eligibility !== "excluded") return true;
    excluded.push({ id: card.id, name: card.name, reasons: card.warnings }); return false;
  });
  const score = (card: RestaurantCard) => (card.service === "individual" && pricing.dinerCount === 1 ? 4 : card.service === "small_plates" ? 2 : 0) + (mealFitsOpening(card, event) === false ? -10 : 0) + (card.budgetFit === "over_known" ? -3 : card.budgetFit === "within_known" ? 1 : 0);
  candidates.sort((a, b) => score(b) - score(a) || (a.geographicDistanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.geographicDistanceMeters ?? Number.MAX_SAFE_INTEGER));
  const cost = mealCost(plan, eventId), protectionReasons = restaurantProtectionReasons(plan, event);
  return { planVersionId: plan.id, versionNumber: plan.versionNumber, eventId, eventName: event.locationName ?? event.title,
    current: current ? buildRestaurantCard(current, plan, event, true, facts) : null, candidates: candidates.slice(0, 3), excluded, pricing,
    currentMealTotal: cost ? costItemLineTotals(cost, budgetFactorsFromSnapshot(plan.requestSnapshot)) : { minCents: null, maxCents: null },
    canEdit: protectionReasons.length === 0, readOnly: !plan.isCurrent, protectionReasons,
    notices: ["本餐人数只改变这一餐的费用；整趟人数与预算目标仍来自本计划需求快照。",
      "人均为参考或估算，选择餐厅不会完成订餐、排队或来源核验。",
      ...(!plan.requirementUpToDate ? ["最新需求尚未应用，此处沿用本计划原人数、预算和日期。"] : []),
      ...(!getRestaurantCatalog(plan.requestSnapshot.destination ?? "").length ? ["这个城市暂无已整理的餐厅候选；可继续记录本餐人数、估算并使用地图与来源入口。"] : [])] };
}

export function priceMealCost(cost: PlanCostItem, pricing: MealPricing): PlanCostItem {
  return { ...cost, category: "meal", unit: "per_person", quantity: null, dinerCount: pricing.dinerCount,
    unitAmountCents: pricing.minCents, unitAmountMaxCents: pricing.maxCents, certainty: pricing.minCents === null ? "pending_confirmation" : "estimated",
    paymentStatus: "not_paid", source: "ai_draft", eventRemoved: false,
    note: "本餐预算估算：人均 × 本餐人数 × 1餐；不是已支付金额或已核验门店报价，可在预算中确认实际费用。" };
}
