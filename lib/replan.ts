import { z } from "zod";
import { budgetFactorsFromSnapshot, calculateBudgetSummary, costItemLineTotals, hasProtectedCostFact } from "./budget";
import { planEventSchema, planEventStart, planEventEnd, preparePlanForStorage, type PlanEvent } from "./plan";
import type { PlanVersionRecord } from "./plan-service";
import { isActiveTicket } from "./tickets";
import type { RequestSnapshot } from "./trip-request";
import { executionProtectedIds, type ExecutionProgress } from "./execution";
import { deriveGeneratedPlanCosts } from "./generated-costs";
import { calibrateSuggestedCoordinates } from "./place-reference";

export class ReplanError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "ReplanError"; }
}
const coordinatePair = (value: { latitude?: number | null; longitude?: number | null; coordinateSystem?: string }) =>
  value.coordinateSystem === undefined && value.latitude === undefined && value.longitude === undefined || value.latitude === null && value.longitude === null ||
  typeof value.latitude === "number" && typeof value.longitude === "number";
const coordinatePairMessage = "建议坐标必须同时提供 WGS84 纬度与经度，未知时两项都留空。";
const fields = planEventSchema.pick({ dayNumber: true, date: true, endDate: true, startTime: true, endTime: true,
  title: true, locationName: true, latitude: true, longitude: true, costDraftCents: true, note: true }).partial()
  .extend({ coordinateSystem: z.literal("WGS84").optional() }).strict().refine(coordinatePair, coordinatePairMessage);
const addition = planEventSchema.pick({ dayNumber: true, date: true, endDate: true, startTime: true, endTime: true,
  title: true, locationName: true, latitude: true, longitude: true, costDraftCents: true, note: true }).extend({
  type: z.enum(["activity", "local_transport", "meal", "rest", "preparation"]),
  coordinateSystem: z.literal("WGS84").optional(),
}).strict().refine(coordinatePair, coordinatePairMessage);
export const replanProposalSchema = z.object({
  requirementChange: z.string().max(500).nullable(),
  edits: z.array(z.object({ eventId: z.string().min(1).max(80), remove: z.boolean(), fields }).strict()).max(64),
  additions: z.array(addition).max(16).optional(),
}).strict();
export type ReplanProposal = z.infer<typeof replanProposalSchema>;
export const replanWriteSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), reason: z.string().trim().min(2).max(600), expectedPlanVersion: z.number().int().positive(), expectedRequestRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("undo"), expectedPlanVersion: z.number().int().positive(), expectedRequestRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.enum(["apply", "cancel"]), candidateId: z.string().uuid(), expectedCandidateRevision: z.number().int().positive() }).strict(),
]);

export function protectedEvent(plan: PlanVersionRecord, event: PlanEvent, now: string, execution?: ExecutionProgress) {
  return (execution && executionProtectedIds(execution).has(event.id)) || event.locked || event.status === "confirmed" || planEventStart(event).getTime() <= Date.parse(now) ||
    plan.tickets.some((ticket) => isActiveTicket(ticket) && ticket.eventId === event.id) ||
    plan.costs.some((cost) => cost.linkedEventId === event.id && !cost.id.startsWith("route-") && hasProtectedCostFact(cost));
}
export function sameEvent(a: PlanEvent, b: PlanEvent) {
  const clean = (event: PlanEvent) => ({ ...event, order: undefined });
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b));
}
export function assertProtectedFacts(base: PlanVersionRecord, proposed: PlanVersionRecord, now: string, execution?: ExecutionProgress) {
  for (const before of base.events.filter((e) => protectedEvent(base, e, now, execution))) {
    const after = proposed.events.find((e) => e.id === before.id);
    if (!after || !sameEvent(before, after)) throw new ReplanError(`“${before.title}”已选为当前步骤、到达、完成、开始、锁定、确认或关联有效票据/费用，不能更改。`);
  }
  if (JSON.stringify(base.tickets) !== JSON.stringify(proposed.tickets)) throw new ReplanError("重新规划不能改写任何票据事实。");
  for (const cost of base.costs.filter(hasProtectedCostFact)) {
    const after = proposed.costs.find((c) => c.id === cost.id);
    if (!after) throw new ReplanError("已确认或已发生费用必须保留。");
    for (const key of ["unit", "unitAmountCents", "unitAmountMaxCents", "quantity", "dinerCount", "roomCount", "nightCount", "certainty", "paymentStatus", "source"] as const) {
      if (after[key] !== cost[key]) throw new ReplanError("已确认或已发生费用不能被重新计算覆盖。");
    }
    if (JSON.stringify(costItemLineTotals(cost, budgetFactorsFromSnapshot(base.requestSnapshot))) !==
      JSON.stringify(costItemLineTotals(after, budgetFactorsFromSnapshot(proposed.requestSnapshot)))) throw new ReplanError("新人数或住宿条件会改变已确认费用，请先在预算中明确费用数量后重试。");
  }
}

function venueAliases(name: string) {
  const clean = name.replace(/（[^）]*）|\([^)]*\)/g, "").trim();
  const aliases = /洛[伽迦]寺/.test(clean)
    ? [clean, "泉州石狮洛伽寺", "石狮市洛伽寺", "石狮洛伽寺", "洛伽寺", "洛迦寺"] : [clean];
  return [...new Set(aliases)].filter((alias) => alias.length >= 2 && !/^(景点|市区|市中心|博物馆|寺庙|海边|活动)$/.test(alias)).sort((a, b) => b.length - a.length);
}

/** Keep generated surrounding guidance aligned when an activity venue disappears. */
export function synchronizeReplanGuidance(base: PlanVersionRecord, events: PlanEvent[], now: string, execution?: ExecutionProgress) {
  const replacements = base.events.filter((event) => event.type === "activity" && event.locationName).flatMap((before) => {
    let after = events.find((event) => event.id === before.id);
    if (!after) {
      const added = events.filter((event) => event.type === "activity" && event.dayNumber === before.dayNumber && !base.events.some((old) => old.id === event.id) &&
        planEventStart(event).getTime() < planEventEnd(before).getTime() && planEventEnd(event).getTime() > planEventStart(before).getTime());
      if (added.length === 1) after = added[0];
    }
    if (!after?.locationName || after.locationName === before.locationName) return [];
    const aliases = venueAliases(before.locationName!);
    // A retained visit to the old venue makes cross-day references ambiguous.
    if (!aliases.length || aliases.some((alias) => after.locationName!.includes(alias)) || events.some((event) => event.type === "activity" && aliases.some((alias) => `${event.locationName ?? ""} ${event.title}`.includes(alias)))) return [];
    return [{ aliases, newName: after.locationName, dayNumber: before.dayNumber }];
  });
  let updatedEvents = events, pendingItems = base.pendingItems;
  for (const replacement of replacements) {
    const mentionsOld = (text: string) => replacement.aliases.some((alias) => text.includes(alias));
    const rename = (text: string) => replacement.aliases.reduce((value, alias) => value.split(alias).join(replacement.newName), text);
    updatedEvents = updatedEvents.map((event) => {
      if (!event.note || !mentionsOld(event.note) || Math.abs(event.dayNumber - replacement.dayNumber) > 1 || protectedEvent(base, event, now, execution)) return event;
      const note = event.note.split(/(?<=[。！？；])/).map((sentence) => {
        if (!mentionsOld(sentence)) return sentence;
        // Do not transplant the removed venue's tides, hours, fees or bookings
        // onto a different venue. The replacement gets a verification reminder.
        if (/潮汐|海边|风况|日落|门票|开放时间|闭馆|闭园|预约/.test(sentence)) {
          return `后续改去${replacement.newName}，请按新地点核对开放时间、预约及往返接驳。`;
        }
        return rename(sentence);
      }).join("").slice(0, 6000);
      return { ...event, note };
    });
    pendingItems = pendingItems.map((item) => {
      if (!mentionsOld(`${item.title} ${item.reason}`)) return item;
      return { ...item,
        title: (item.category === "weather" ? `核对天气与${replacement.newName}开放安排` : `核对${replacement.newName}的最新安排`).slice(0, 160),
        reason: `第${replacement.dayNumber}天已改为${replacement.newName}；请核实新地点开放时间、闭馆日、预约及费用。仍保留的户外安排需关注天气，雨天核对往返接驳。`.slice(0, 240) };
    });
  }
  return { events: updatedEvents, pendingItems };
}

export function applyReplanProposal(base: PlanVersionRecord, snapshot: RequestSnapshot, revision: number, raw: unknown, now: string, execution?: ExecutionProgress) {
  const proposal = replanProposalSchema.parse(raw);
  if (proposal.requirementChange) throw new ReplanError(`这涉及旅行需求变更：${proposal.requirementChange}。请先在“旅行需求”保存并确认，再重新规划。`, 422);
  if ((!proposal.edits.length && !proposal.additions?.length) || new Set(proposal.edits.map((e) => e.eventId)).size !== proposal.edits.length) throw new ReplanError("AI 没有提出有效变更，或重复修改同一活动。", 400);
  let events = [...base.events], costs = [...base.costs];
  for (const edit of proposal.edits) {
    const before = events.find((e) => e.id === edit.eventId);
    if (!before) throw new ReplanError("AI 返回了不存在的活动。", 400);
    if (protectedEvent(base, before, now, execution)) throw new ReplanError(`“${before.title}”属于保留事项，无法按本次要求调整。`);
    if (edit.remove) {
      if (["departure_transport", "return_transport", "accommodation"].includes(before.type)) throw new ReplanError("去返程和住宿需要保留，请调整时刻或先确认旅行需求。");
      events = events.filter((e) => e.id !== before.id);
      costs = costs.filter((c) => c.linkedEventId !== before.id || hasProtectedCostFact(c)).map((c) => c.linkedEventId === before.id ? { ...c, eventRemoved: true } : c);
      continue;
    }
    let after = planEventSchema.parse({ ...before, ...edit.fields });
    const changedVenue = after.title !== before.title || after.locationName !== before.locationName;
    if (!changedVenue && before.placeId && edit.fields.latitude !== undefined) throw new ReplanError("已确认地点坐标不能被 AI 建议覆盖，请通过地图修改地点。", 400);
    if (changedVenue) {
      after = { ...after, placeId: null, attractionSelection: undefined, restaurantSelection: undefined, accommodationSelection: undefined,
        latitude: edit.fields.latitude ?? null, longitude: edit.fields.longitude ?? null, coordinateSystem: "WGS84",
        costDraftCents: edit.fields.costDraftCents ?? null, costStatus: "estimated" };
    }
    if (changedVenue || edit.fields.latitude !== undefined) {
      after = calibrateSuggestedCoordinates([{ ...after, coordinateSystem: "WGS84" }], snapshot.destination)[0];
    }
    if (changedVenue || after.costDraftCents !== before.costDraftCents || after.note !== before.note) {
      costs = costs.filter((c) => c.linkedEventId !== before.id || c.id.startsWith("route-") || hasProtectedCostFact(c));
      costs.push(...deriveGeneratedPlanCosts(events.map((event) => event.id === after.id ? after : event), snapshot).filter((cost) => cost.linkedEventId === after.id));
    }
    events = events.map((e) => e.id === after.id ? after : e);
  }
  for (const [index, item] of (proposal.additions ?? []).entries()) {
    const id = `replan-${base.versionNumber}-${revision}-${index + 1}`;
    if (events.some((event) => event.id === id)) throw new ReplanError("新增活动标识冲突，请重新生成。", 400);
    let event = planEventSchema.parse({ ...item, id, status: "suggested", locked: false, placeId: null,
      latitude: item.latitude ?? null, longitude: item.longitude ?? null, coordinateSystem: "WGS84", costStatus: "estimated", suggestedDurationSeconds: 60 });
    event.suggestedDurationSeconds = (planEventEnd(event).getTime() - planEventStart(event).getTime()) / 1000;
    event = calibrateSuggestedCoordinates([event], snapshot.destination)[0];
    events.push(event); costs.push(...deriveGeneratedPlanCosts([event], snapshot));
  }
  const synchronized = synchronizeReplanGuidance(base, events, now, execution);
  const calibrated = synchronized.events.map((event) => protectedEvent(base, base.events.find((original) => original.id === event.id) ?? event, now, execution)
    ? event : calibrateSuggestedCoordinates([event], snapshot.destination)[0]);
  const prepared = preparePlanForStorage({ ...synchronized, events: calibrated });
  const proposed = { ...base, ...prepared, costs, requestSnapshot: snapshot, requestRevision: revision, requirementUpToDate: true,
    places: base.places.filter((p) => events.some((e) => e.placeId === p.id)) };
  assertProtectedFacts(base, proposed, now, execution);
  return proposed;
}

export function replanChanges(base: PlanVersionRecord, proposed: PlanVersionRecord) {
  const changes: { eventId: string; before: PlanEvent | null; after: PlanEvent | null }[] = base.events.flatMap((before) => {
    const after = proposed.events.find((e) => e.id === before.id);
    return !after || !sameEvent(before, after) ? [{ eventId: before.id, before, after: after ?? null }] : [];
  });
  return [...changes, ...proposed.events.filter((e) => !base.events.some((b) => b.id === e.id)).map((after) => ({ eventId: after.id, before: null, after }))];
}
export function replanBudget(base: PlanVersionRecord, proposed: PlanVersionRecord) {
  return { before: calculateBudgetSummary(base.costs, base.requestSnapshot), after: calculateBudgetSummary(proposed.costs, proposed.requestSnapshot) };
}

const indoorVenue = /室内|博物馆|展览|展馆|非遗|文化馆|美术馆|艺术馆|工坊|剧院/;
const venueText = (event: PlanEvent) => `${event.title} ${event.locationName ?? ""}`;
const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Validate the user's replacement goal, in addition to structural validity. */
export function assertReplacementGoal(base: PlanVersionRecord, proposed: PlanVersionRecord, reason: string) {
  if (!/(?:替换|换成|换为|改成|改为|改去)/.test(reason) || !indoorVenue.test(reason)) return;
  const dayMatch = reason.match(/第\s*([1-4一二三四])\s*天/);
  const requestedDay = dayMatch ? ({ 一: 1, 二: 2, 三: 3, 四: 4 }[dayMatch[1]] ?? Number(dayMatch[1])) : null;
  const activityChanges = replanChanges(base, proposed).filter((change) => change.before?.type === "activity" || change.after?.type === "activity");
  // Coordinates and surrounding guidance can change as a side effect of a
  // replan. They do not make a retained visit another replacement target.
  const venueChanges = activityChanges.filter((change) => !change.before || !change.after || venueText(change.before) !== venueText(change.after));
  const requestedTarget = reason.match(/(?:把|将)([^。；，,]{1,100}?)(?:替换|换成|换为|改成|改为|改去)/)?.[1]
    ?? reason.split(/替换|换成|换为|改成|改为|改去/)[0];
  const eligible = base.events.filter((event) => event.type === "activity" && (!requestedDay || event.dayNumber === requestedDay));
  const explicitlyNamed = eligible.filter((event) => venueAliases(event.locationName || event.title).some((alias) => requestedTarget.includes(alias)));
  const targets = explicitlyNamed.length ? explicitlyNamed : eligible.filter((event) => venueChanges.some((change) => change.eventId === event.id));
  const days = new Set(targets.length ? targets.map((event) => event.dayNumber) : requestedDay ? [requestedDay] : venueChanges.map((change) => (change.after ?? change.before)!.dayNumber));
  const replacements = activityChanges.flatMap((change) => change.after && change.after.type === "activity" && indoorVenue.test(venueText(change.after)) &&
    days.has(change.after.dayNumber) && (!change.before || venueText(change.before) !== venueText(change.after)) ? [change.after] : []);
  if (!replacements.length) throw new ReplanError("替换目标未完成：必须安排具体室内博物馆或非遗活动，不能只删除原活动或修改备注。", 400);
  for (const target of targets.filter((event) => !indoorVenue.test(venueText(event)))) {
    const unchanged = proposed.events.find((event) => event.id === target.id);
    if (unchanged && venueText(unchanged) === venueText(target)) throw new ReplanError(`替换目标未完成：“${target.title}”仍然保留，请用室内活动替代。`, 400);
  }
  for (const day of days) {
    const dayEvents = proposed.events.filter((event) => event.dayNumber === day && event.type !== "preparation")
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let index = 1; index < dayEvents.length; index++) {
      const from = dayEvents[index - 1], to = dayEvents[index];
      const gapStart = minute(from.endTime), gapEnd = minute(to.startTime);
      if (gapEnd - gapStart > 120 && targets.some((target) => target.dayNumber === day && minute(target.startTime) < gapEnd && minute(target.endTime) > gapStart)) {
        throw new ReplanError(`替换后第 ${day} 天 ${from.endTime}–${to.startTime} 留下过长空档，请补齐室内活动和接驳。`, 400);
      }
    }
    const originalTransfers = base.events.filter((event) => event.dayNumber === day && event.type === "local_transport" &&
      targets.some((target) => target.dayNumber === day && (event.endTime === target.startTime || event.startTime === target.endTime ||
        target.locationName && venueText(event).includes(target.locationName))));
    if (!originalTransfers.length) continue;
    for (const target of targets.filter((event) => event.dayNumber === day && !indoorVenue.test(venueText(event)))) {
      const name = /洛[伽迦]寺/.test(venueText(target)) ? "洛伽寺" : target.locationName;
      if (name && name.length >= 2 && dayEvents.some((event) => event.type === "local_transport" && venueText(event).replace(/洛迦寺/g, "洛伽寺").includes(name))) {
        throw new ReplanError(`接驳仍指向已移除的“${name}”，请改为室内替换地点及下一站。`, 400);
      }
    }
    for (const replacement of replacements.filter((event) => event.dayNumber === day)) {
      const transfers = dayEvents.filter((event) => event.type === "local_transport");
      const before = transfers.some((event) => minute(event.endTime) <= minute(replacement.startTime) && minute(replacement.startTime) - minute(event.endTime) <= 60);
      const after = transfers.some((event) => minute(event.startTime) >= minute(replacement.endTime) && minute(event.startTime) - minute(replacement.endTime) <= 60);
      if (!before || !after) throw new ReplanError(`“${replacement.title}”缺少前往或离开后的接驳安排，请补充交通节点（步行也可）。`, 400);
    }
  }
}

export function replanSummary(base: PlanVersionRecord, proposed: PlanVersionRecord) {
  const changes = replanChanges(base, proposed);
  return {
    removed: changes.filter((change) => change.before && (!change.after || change.before.title !== change.after.title)).map((change) => change.before!.title),
    added: changes.filter((change) => change.after && (!change.before || change.before.title !== change.after.title)).map((change) => change.after!.title),
  };
}
