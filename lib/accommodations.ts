import { z } from "zod";
import { budgetFactorsFromSnapshot, calculateBudgetSummary, costItemLineTotals, hasProtectedCostFact } from "./budget";
import { confirmedBudgetLimit } from "./attractions";
import { nextPlanDate, planEventEnd, sortPlanEvents, type PlanEvent } from "./plan";
import type { PlanVersionRecord } from "./plan-service";
import { toWgs84, type Place } from "./places";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const stayInputSchema = z.object({
  areaId: z.string().min(1).max(120), kind: z.enum(["area", "hotel"]),
  hotelToken: z.string().max(6000).nullable(),
  routeMode: z.enum(["walking", "driving", "public_transit"]),
  checkIn: date, checkOut: date, roomCount: z.number().int().min(1).max(100),
  minCents: z.number().int().min(0).max(2_000_000_000).nullable(),
  maxCents: z.number().int().min(0).max(2_000_000_000).nullable(),
  morningDepartureTime: time, checkInFrom: time.nullable(), checkOutBy: time.nullable(),
  luggageStorage: z.enum(["unknown", "available", "unavailable"]),
  conditionNote: z.string().trim().max(240), acknowledged: z.literal(true),
}).strict().refine((v) => v.checkOut > v.checkIn && nightsBetween(v.checkIn, v.checkOut) <= 3, "入住必须早于离店日期，最多连续3晚。")
  .refine((v) => v.maxCents === null || (v.minCents !== null && v.maxCents >= v.minCents), "上限不能小于下限，未知价格不能仅填上限。");
export type StayInput = z.infer<typeof stayInputSchema>;
export type StayArea = {
  id: string; name: string; focus: string; reference: Place | null; reasons: string[];
  distances: { label: string; name: string; meters: number | null }[];
  price: { minCents: number | null; maxCents: number | null; source: string };
  warnings: string[]; conflicts: string[]; score: number;
};
export type StayRecommendations = ReturnType<typeof buildStayRecommendations>;
export type StayPreview = {
  previewToken: string; expiresAt: string; changes: string[]; warnings: string[]; conflicts: string[]; canApply: boolean;
  beforeBudget: ReturnType<typeof calculateBudgetSummary>; afterBudget: ReturnType<typeof calculateBudgetSummary>;
  routes: { label: string; date: string; durationSeconds: number | null; source: string }[];
};
export function nightsBetween(checkIn: string, checkOut: string) { return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000); }
export function stayEvents(plan: PlanVersionRecord, checkIn: string, checkOut: string) {
  return sortPlanEvents(plan.events.filter((e) => e.type === "accommodation" && e.date >= checkIn && e.date < checkOut));
}
export function stayProtection(plan: PlanVersionRecord, events: PlanEvent[]) {
  const reasons: string[] = [];
  if (!plan.isCurrent) reasons.push("历史版本只读，请返回当前计划选择住宿。");
  if (events.some((e) => e.locked || e.status === "confirmed")) reasons.push("住宿安排已锁定或确认，请先在时间轴解除后再调整。");
  if (plan.costs.some((c) => events.some((e) => e.id === c.linkedEventId) && !c.id.startsWith("route-") && hasProtectedCostFact(c))) reasons.push("住宿已有已确认或已支付费用，请先在预算核对，不能自动覆盖。");
  return reasons;
}
export function stayInputIssues(plan: PlanVersionRecord, eventId: string, input: StayInput) {
  const issues: string[] = [], events = stayEvents(plan, input.checkIn, input.checkOut);
  if (input.checkIn < (plan.requestSnapshot.startDate ?? "") || input.checkOut > (plan.requestSnapshot.endDate ?? "")) issues.push("入住与离店日期必须在本计划日期内。");
  if (!events.some((e) => e.id === eventId)) issues.push("所选日期必须包含当前住宿安排。");
  for (let d = input.checkIn; d < input.checkOut; d = nextPlanDate(d)) {
    if (events.filter((e) => e.date === d).length !== 1) issues.push(`${d} 没有唯一的住宿安排，请先核对时间轴。`);
  }
  const groups = new Set(events.map((e) => e.accommodationSelection?.stayId).filter(Boolean));
  if (plan.events.some((e) => e.accommodationSelection && groups.has(e.accommodationSelection.stayId) && !events.some((s) => s.id === e.id))) issues.push("所选日期只覆盖了原入住的一部分，请包含该次入住全部晚数后调整，避免重复计费。");
  issues.push(...stayProtection(plan, events));
  for (const e of events) {
    const morning = Date.parse(`${nextPlanDate(e.date)}T${input.morningDepartureTime}:00+08:00`);
    if (morning < planEventEnd(e).getTime()) issues.push(`${e.date} 的住宿结束晚于次日离店时刻，请先调整时间轴。`);
  }
  return issues;
}
export function stayPointDistance(a: Place | null, b: Place | null) {
  if (!a || !b) return null;
  const p = toWgs84(a, a.coordinateSystem), q = toWgs84(b, b.coordinateSystem), r = Math.PI / 180;
  const h = Math.sin((q.latitude - p.latitude) * r / 2) ** 2 + Math.cos(p.latitude * r) * Math.cos(q.latitude * r) * Math.sin((q.longitude - p.longitude) * r / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.min(1, Math.sqrt(h))));
}
export function buildStayRecommendations(plan: PlanVersionRecord, eventId: string) {
  const event = plan.events.find((e) => e.id === eventId && e.type === "accommodation");
  if (!event) throw new Error("没有找到住宿安排。");
  const existing = event.accommodationSelection;
  const checkIn = existing?.checkIn ?? event.date;
  const checkOut = existing?.checkOut ?? nextPlanDate(event.date);
  const roomCount = existing?.roomCount ?? budgetFactorsFromSnapshot(plan.requestSnapshot).roomCount;
  const today = sortPlanEvents(plan.events.filter((e) => e.type === "activity" && e.date === event.date)).at(-1);
  const tomorrow = sortPlanEvents(plan.events.filter((e) => e.type === "activity" && e.date === nextPlanDate(event.date)))[0];
  const returning = plan.events.find((e) => e.type === "return_transport");
  const ticket = plan.tickets.find((t) => t.direction === "return" && t.status === "active" && t.confirmedAt);
  const early = (ticket?.departureTime ?? returning?.startTime ?? "23:59") < "10:00";
  const ref = (e?: PlanEvent) => plan.places.find((p) => p.id === e?.placeId) ?? null;
  const returnPlace = ref(returning);
  const returnName = ticket?.fromName || returning?.locationName || "返程车站 / 机场";
  const anchors = [
    { id: "today", focus: "当天活动", event: today, name: today?.locationName || "当天主要活动", place: ref(today), reason: "晚间回住处更方便；次日出门和返程可能需要更长接驳。" },
    { id: "tomorrow", focus: "次日活动", event: tomorrow, name: tomorrow?.locationName || "次日主要活动", place: ref(tomorrow), reason: "把次日第一站放近一些；当天结束后可能需要先跨区。" },
    { id: "return", focus: "返程站", event: returning, name: returnName, place: returnPlace, reason: early ? "返程早于10:00，优先减少去车站的距离；末班、早班和办理时间仍须核对。" : "便于返程和携带行李；可能远离主要活动，需比较每天往返成本。" },
  ];
  const cost = plan.costs.find((c) => c.linkedEventId === eventId && c.category === "accommodation" && !c.eventRemoved);
  const line = cost ? costItemLineTotals(cost, budgetFactorsFromSnapshot(plan.requestSnapshot)) : null;
  const pricedNights = cost && ["per_room_per_night", "per_night"].includes(cost.unit)
    ? cost.nightCount ?? budgetFactorsFromSnapshot(plan.requestSnapshot).nightCount : 1;
  const divisor = roomCount * Math.max(1, pricedNights);
  const price = { minCents: line?.minCents == null ? null : Math.floor(line.minCents / divisor), maxCents: line?.maxCents == null ? null : Math.ceil(line.maxCents / divisor), source: "本计划原住宿预算分摊，仅作选区比较；不是当地酒店报价，房态未知。" };
  const budget = calculateBudgetSummary(plan.costs, plan.requestSnapshot), hard = confirmedBudgetLimit(plan);
  const areas: StayArea[] = anchors.map((anchor) => {
    const distances = anchors.map((other) => ({ label: other.focus, name: other.name, meters: stayPointDistance(anchor.place, other.place) }));
    const warnings = ["区域参考点仅作方位比较，直线距离不是道路里程或交通时间。", "酒店候选、实际房价与房态尚待查询，未预订。", "入住、离店和行李寄存条件须向具体酒店核对。"];
    if (!anchor.place) warnings.push("此参考点尚无已确认坐标，地图保持空缺，请先在地图定位相关活动或站点。");
    if (plan.requestSnapshot.accommodation) warnings.push(`你的住宿偏好：${plan.requestSnapshot.accommodation}；具体房型、噪声和容量待核对。`);
    const conflicts = hard !== null && budget.totalMinCents > hard ? ["原计划已知预算下限已超过明确上限；换区前需调整住宿报价或其他费用。"] : [];
    return { id: anchor.id, name: `${anchor.name.slice(0, 120)}周边`, focus: anchor.focus, reference: anchor.place, distances, price, warnings, conflicts,
      reasons: [anchor.reason, `当天：${anchors[0].name}；次日：${anchors[1].name}；返程：${returnName}。`, `以${roomCount}房比较；全程预算${budget.budgetTargetCents === null ? "未设" : `${budget.budgetTargetCents / 100}元`}，另有${budget.unknownItemCount}项未知费用。`],
      score: (distances[0].meters ?? 10000) + (distances[1].meters ?? 10000) * 1.3 + (distances[2].meters ?? 10000) * (early ? 3 : 0.5) + (anchor.id === "return" && early ? -20000 : 0) };
  }).sort((a, b) => a.score - b.score);
  const unique: StayArea[] = [];
  for (const area of areas) {
    const same = unique.find((a) => a.name === area.name || (a.reference && area.reference && (stayPointDistance(a.reference, area.reference) ?? Infinity) < 500));
    if (same) {
      same.focus += ` / ${area.focus}`; same.reasons[0] += ` ${area.reasons[0]}`;
      if (area.id === existing?.areaId) { same.id = area.id; same.name = area.name; same.reference = area.reference; }
    }
    else unique.push(area);
  }
  return { eventId, eventName: event.locationName ?? event.title, areas: unique, existing: existing ?? null, checkIn, checkOut, roomCount, price,
    protection: stayProtection(plan, stayEvents(plan, checkIn, checkOut)),
    conclusion: areas.every((a) => a.conflicts.length) ? "当前预算条件下暂无可行区域，请先调整预算或取得更低报价。" : "以下区域可按位置偏好比较；房价、房态与入住条件未齐，尚不能确认有区域满足全部约束。",
    todayArrivalTime: event.startTime, earlyReturn: early };
}

export function stayConditionChecks(events: PlanEvent[], input: StayInput) {
  const conflicts: string[] = [], warnings: string[] = [];
  const first = events[0];
  if (first && input.checkInFrom && first.startTime < input.checkInFrom) {
    warnings.push(`预计${first.startTime}到店，早于${input.checkInFrom}入住时间；不能假定可提前入住。`);
    if (input.luggageStorage === "unavailable") conflicts.push("未到入住时间且酒店不可寄存行李；请调整到店安排或选择可寄存的酒店。");
    else warnings.push(input.luggageStorage === "available" ? "已填写可寄存；寄存不等于可提前进房，费用与服务时段仍需核对。" : "行李寄存未知，请先向酒店确认或另选寄存点。");
  }
  if (!input.checkInFrom || !input.checkOutBy) warnings.push("入住 / 退房时间未完整提供，不能保证现有时段适用。");
  if (input.checkOutBy && input.morningDepartureTime > input.checkOutBy) conflicts.push("最后一天计划离店晚于已填写的退房截止，请提前离店或确认延迟退房。");
  if (input.kind === "hotel" && !input.conditionNote) warnings.push("酒店条件未填写来源说明；当前只作为用户输入，尚未经过酒店官方核验。");
  return { conflicts, warnings };
}
