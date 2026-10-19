import { getAttractionCatalog, findAttractionCatalogEntry, getAttractionImages, type AttractionCatalogEntry } from "./attraction-catalog";
import { confirmedRequestBudgetLimit } from "./budget-limit";
import { calculateBudgetSummary, type BudgetSummary, hasProtectedCostFact } from "./budget";
import { effectiveEvidenceStatus, evidenceFieldLabels, reservationRequirement, type EvidenceFactClient } from "./evidence";
import { formatPlanDate, planEventDurationSeconds, planEventEnd, planEventStart, sortPlanEvents, type PlanEvent } from "./plan";
import type { PlanVersionRecord } from "./plan-service";
import type { RouteLeg } from "./routes";

export type AttractionCard = AttractionCatalogEntry & {
  eventId: string; dayNumber: number; date: string; isCurrent: boolean;
  reasons: string[]; warnings: string[]; eligibility: "pending" | "excluded";
  incomingRoute: RouteLeg | null; outgoingRoute: RouteLeg | null;
  previousStop: string | null; nextStop: string | null;
};

export type AttractionRecommendations = {
  planVersionId: string; versionNumber: number; eventId: string; eventName: string;
  current: AttractionCard | null; candidates: AttractionCard[];
  excluded: { id: string; name: string; reasons: string[] }[];
  canReplace: boolean; readOnly: boolean; protectionReasons: string[]; notices: string[];
};

export type AttractionReplacementPreview = {
  previewToken: string; eventId: string; candidateId: string; expiresAt: string;
  changes: string[]; conflicts: string[]; warnings: string[]; canApply: boolean;
  beforeBudget: BudgetSummary; afterBudget: BudgetSummary; card: AttractionCard;
};

export function attractionProtectionReasons(plan: PlanVersionRecord, event: PlanEvent) {
  const reasons: string[] = [];
  if (!plan.isCurrent) reasons.push("历史版本只读，请回到当前计划操作。");
  if (event.type !== "activity") reasons.push("只有景点活动可以使用此替换入口。");
  if (event.locked || event.status === "confirmed") reasons.push("这项安排已锁定或确认，保留固定安排；如需修改请先在时间轴明确解除。");
  if (plan.tickets.some((ticket) => ticket.eventId === event.id && ticket.status === "active")) reasons.push("这项安排受有效票据约束，不能通过景点替换改写。");
  if (plan.costs.some((cost) => cost.linkedEventId === event.id && !cost.id.startsWith("route-") && hasProtectedCostFact(cost))) {
    reasons.push("这项活动已有确认或付款金额，替换会改变费用对象；请先核对原费用，原金额不会自动归零。");
  }
  return reasons;
}

function normalized(value: string) { return value.normalize("NFKC").replace(/\s|（区域参考点）/g, ""); }

export function catalogEntryForEvent(plan: PlanVersionRecord, event: PlanEvent) {
  const city = plan.requestSnapshot.destination ?? "";
  const place = plan.places.find((item) => item.id === event.placeId);
  // Confirmed POI identity wins over a stale title or previous card selection.
  if (place) {
    if (place.city.replace(/市$/, "") !== city.replace(/市$/, "")) return null;
    return getAttractionCatalog(city).find((entry) => entry.location?.provider === place.provider && entry.location.poiId === place.poiId) ??
      findAttractionCatalogEntry(normalized(place.name), city);
  }
  return findAttractionCatalogEntry(normalized(event.locationName || event.title), city);
}

export function attractionVisitMinutes(entry: AttractionCatalogEntry, plan: PlanVersionRecord) {
  return plan.requestSnapshot.pace === "relaxed" ? entry.visitMinutes.max :
    plan.requestSnapshot.pace === "packed" ? entry.visitMinutes.min : Math.round((entry.visitMinutes.min + entry.visitMinutes.max) / 2);
}

export function confirmedBudgetLimit(plan: PlanVersionRecord) {
  return confirmedRequestBudgetLimit(plan.requestSnapshot);
}

export function attractionExclusionReasons(entry: AttractionCatalogEntry, plan: PlanVersionRecord, event: PlanEvent) {
  const reasons: string[] = [];
  const exactClosure = entry.opening.confirmedClosedDates?.find((closed) => closed.date === event.date && entry.sources.some((source) =>
    source.id === closed.sourceId && source.kind === "official" && source.retrievedAt === closed.retrievedAt && /^https:\/\//.test(source.url) && source.quote.trim()));
  if (exactClosure) reasons.push(`${event.date} 的官方公告明确闭馆；来源：${entry.sources.find((source) => source.id === exactClosure.sourceId)!.title}。`);
  const applicable = entry.opening.status === "verified" && entry.opening.applicableFrom !== null && entry.opening.applicableUntil !== null &&
    event.date >= entry.opening.applicableFrom && event.date <= entry.opening.applicableUntil;
  if (applicable && (entry.opening.closedDates.includes(event.date) || entry.opening.closedWeekdays.includes(new Date(`${event.date}T12:00:00+08:00`).getUTCDay()))) {
    reasons.push(`${event.date} 在已核验的闭馆日期内。`);
  }
  const constraints = plan.requestSnapshot.constraints.join("；");
  if ((/不去|不要|避开/).test(constraints) && [entry.name, ...entry.aliases, ...entry.interestTags].some((name) => constraints.includes(`不去${name}`) || constraints.includes(`不要${name}`) || constraints.includes(`避开${name}`))) {
    reasons.push("不符合本计划中明确保留的出行限制。");
  }
  if (plan.events.some((other) => other.id !== event.id && other.date === event.date && catalogEntryForEvent(plan, other)?.id === entry.id)) {
    reasons.push("当天已安排同一景点，避免重复到访。");
  }
  const limit = confirmedBudgetLimit(plan);
  if (limit !== null && entry.ticket.status === "verified" && entry.ticket.minCents !== null) {
    const baseCosts = plan.costs.filter((cost) => cost.linkedEventId !== event.id || cost.id.startsWith("route-") || hasProtectedCostFact(cost));
    const knownMinimum = calculateBudgetSummary(baseCosts, plan.requestSnapshot).totalMinCents + entry.ticket.minCents * (plan.requestSnapshot.travelerCount ?? 1);
    if (knownMinimum > limit) reasons.push("已知费用下限将超过用户明确给出的总预算上限。");
  }
  return reasons;
}

function applyCurrentEvidence(card: AttractionCard, facts: EvidenceFactClient[], plan: PlanVersionRecord) {
  const event = plan.events.find((item) => item.id === card.eventId)!;
  for (const fact of facts) {
    const key = fact.field === "opening_hours" ? "opening" : fact.field === "price" ? "ticket" : fact.field === "reservation" ? "reservation" : null;
    if (!key) continue;
    // Copies retain their old quote for audit, but a changed target must never
    // lend its old price, reservation or closure to the replacement venue.
    if (fact.lastRefreshStatus === "needs_review") {
      card.warnings.push(`原${evidenceFieldLabels[fact.field]}来源需要重新核验，未作为当前景点依据；可在时间轴的来源入口复核。`);
      continue;
    }
    const applies = fact.applicableFrom !== null && fact.applicableUntil !== null &&
      planEventStart(event).getTime() >= Date.parse(fact.applicableFrom) && planEventEnd(event).getTime() <= Date.parse(fact.applicableUntil);
    const status = effectiveEvidenceStatus(fact) === "verified" && applies ? "verified" as const : "pending" as const;
    const sourceId = `evidence-${fact.id}`;
    const changes = { status, text: fact.extractedValue || card[key].text,
      sourceIds: [sourceId], notes: status === "verified" ? "对应本计划字段的来源已核验；预约规则不等于已预约。" : fact.conflictReason ?? "来源需要重新确认。" };
    if (key === "opening") card.opening = { ...card.opening, ...changes,
      applicableFrom: fact.applicableFrom ? formatPlanDate(new Date(fact.applicableFrom)) : null,
      applicableUntil: fact.applicableUntil ? formatPlanDate(new Date(fact.applicableUntil)) : null };
    else if (key === "ticket") {
      const costs = plan.costs.filter((cost) => cost.linkedEventId === card.eventId && cost.category === "ticket" && !cost.eventRemoved);
      const price = costs.length === 1 && (costs[0].unit === "per_person" || costs[0].unitAmountCents === 0) ? costs[0] : null;
      card.ticket = { ...card.ticket, ...changes, status: status === "verified" && price ? "verified" : "pending",
        minCents: price?.unitAmountCents ?? null, maxCents: price?.unitAmountMaxCents ?? null };
    }
    else {
      const value = ["required", "not_required"].includes(fact.extractedValue) ? fact.extractedValue : reservationRequirement(fact.extractedValue);
      card.reservation = { ...card.reservation, ...changes, required: value === "required" ? true : value === "not_required" ? false : null,
        text: value === "required" ? "来源规则要求预约；尚未确认本人已预约。" : value === "not_required" ? "来源规则说明无需预约；仍须确认本次适用条件。" : changes.text };
    }
    card.sources.push({ id: sourceId, title: fact.sourceTitle, url: fact.sourceUrl, publisher: fact.sourcePublisher,
      retrievedAt: fact.retrievedAt, quote: fact.contentQuote, kind: "official" });
    if (status === "verified" && fact.field === "opening_hours" && /^(?:闭馆|关闭|closed)(?:[。.!！\s]|$)/i.test(fact.extractedValue)) {
      card.eligibility = "excluded";
      card.warnings.push("本次对应日期的来源确认关闭，请选择其他景点。");
    }
    if (fact.field === "opening_hours" && applies && fact.status === "conflict" && /本次到访日闭馆|暂停开放/.test(fact.conflictReason ?? "")) {
      card.eligibility = "excluded";
      card.warnings.push("本次日期的官方来源指出闭馆或暂停开放，请选择其他景点。");
    }
  }
}

export function buildAttractionCard(entry: AttractionCatalogEntry, plan: PlanVersionRecord, event: PlanEvent, isCurrent: boolean, facts: EvidenceFactClient[] = []): AttractionCard {
  const ordered = sortPlanEvents(plan.events.filter((item) => item.date === event.date && item.locationName));
  const index = ordered.findIndex((item) => item.id === event.id);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 ? ordered[index + 1] : null;
  const incomingRoute = isCurrent ? plan.routeLegs.find((route) => route.toEventId === event.id) ?? null : null;
  const outgoingRoute = isCurrent ? plan.routeLegs.find((route) => route.fromEventId === event.id) ?? null : null;
  const matching = plan.requestSnapshot.interests.filter((interest) => entry.interestTags.some((tag) => tag.includes(interest) || interest.includes(tag)));
  const reasons = matching.length ? [`与你在本计划中选择的“${matching.join("、")}”兴趣相符。`] : [plan.requestSnapshot.interests.length ? `作为“${plan.requestSnapshot.interests.join("、")}”偏好之外的备选，可比较体验取舍。` : "本计划尚未填写兴趣偏好，先按当天时间窗口提供少量候选。"];
  const pace = { relaxed: "舒缓", balanced: "均衡", packed: "紧凑" }[plan.requestSnapshot.pace ?? "balanced"];
  reasons.push(`${plan.requestSnapshot.pace ? `按本计划“${pace}”节奏` : "未指定节奏，按均衡节奏估算"}，建议预留 ${attractionVisitMinutes(entry, plan)} 分钟；原时段为 ${event.startTime}–${event.endTime}。`);
  if (isCurrent && incomingRoute?.distanceMeters != null) reasons.push(`上一段已有${Math.round(incomingRoute.distanceMeters)}米路线记录；实际适用时刻与状态见交通信息。`);
  else reasons.push(`安排在${previous?.title ?? "当天开始"}之后、${next?.title ?? "当天结束"}之前；候选交通需在替换预览中重查，尚无可比较的绕路耗时。`);
  const warnings = attractionExclusionReasons(entry, plan, event);
  const card: AttractionCard = { ...structuredClone(entry), images: getAttractionImages(entry), eventId: event.id,
    dayNumber: event.dayNumber, date: event.date, isCurrent, reasons, warnings: [...warnings], eligibility: warnings.length ? "excluded" : "pending",
    incomingRoute, outgoingRoute, previousStop: previous?.title ?? null, nextStop: next?.title ?? null };
  if (!entry.opening.applicableFrom || !entry.opening.applicableUntil || event.date < entry.opening.applicableFrom || event.date > entry.opening.applicableUntil) {
    card.opening.status = "pending";
  }
  if (isCurrent) applyCurrentEvidence(card, facts.filter((fact) => fact.planVersionId === plan.id && fact.targetId === event.id), plan);
  if (!isCurrent && attractionVisitMinutes(entry, plan) * 60 > planEventDurationSeconds(event)) card.warnings.push("建议游玩时长超过原活动窗口，替换预览会检查与后续安排是否冲突。");
  if (card.opening.status !== "verified") card.warnings.push("开放资料尚未核验适用于本次日期，出发前需确认临时闭馆与营业时间。");
  if (card.reservation.required !== false) card.warnings.push(card.reservation.required ? "需要预约；选择保留或替换不代表预约成功，请到官方入口办理。" : "预约要求未知，请先确认。");
  if (card.ticket.status !== "verified") card.warnings.push("门票为来源参考，适用人群、日期及特展范围待确认，不表示有票。");
  if (!card.location || card.location.category === "place:island") card.warnings.push("精确游览入口待确认；区域中心不能作为到门口的精确路线依据。");
  if (plan.requestSnapshot.constraints.some((value) => /少走路|步行.*(?:上限|不超过|最多)/.test(value))) card.warnings.push("本次候选尚无完整步行数据，不能把未知距离当作零或声称满足步行上限。");
  return card;
}

export function buildAttractionRecommendations(plan: PlanVersionRecord, eventId: string, facts: EvidenceFactClient[] = []): AttractionRecommendations {
  const event = plan.events.find((item) => item.id === eventId);
  if (!event || event.type !== "activity") throw new Error("没有找到对应景点活动。");
  const currentEntry = catalogEntryForEvent(plan, event);
  const entries = getAttractionCatalog(plan.requestSnapshot.destination ?? "");
  const excluded: AttractionRecommendations["excluded"] = [];
  const candidates = entries.filter((entry) => entry.id !== currentEntry?.id).map((entry) => buildAttractionCard(entry, plan, event, false))
    .filter((card) => { if (card.eligibility !== "excluded") return true; excluded.push({ id: card.id, name: card.name, reasons: card.warnings }); return false; });
  const score = (card: AttractionCard) => plan.requestSnapshot.interests.filter((interest) => card.interestTags.some((tag) => tag.includes(interest) || interest.includes(tag))).length;
  candidates.sort((left, right) => score(right) - score(left) || attractionVisitMinutes(left, plan) - attractionVisitMinutes(right, plan));
  const protectionReasons = attractionProtectionReasons(plan, event);
  return { planVersionId: plan.id, versionNumber: plan.versionNumber, eventId, eventName: event.locationName ?? event.title,
    current: currentEntry ? buildAttractionCard(currentEntry, plan, event, true, facts) : null,
    candidates: candidates.slice(0, 3), excluded, canReplace: protectionReasons.length === 0, readOnly: !plan.isCurrent, protectionReasons,
    notices: ["推荐采用此版本需求快照；资料未知时保留待确认，不代表可直接出行。",
      ...(!plan.requirementUpToDate ? ["当前需求已有修改，此处仍使用本计划原有偏好与日期。"] : []),
      ...(!entries.length ? ["这个城市暂无经过整理的图片景点资料，可继续使用时间轴与来源核验。"] : [])] };
}
