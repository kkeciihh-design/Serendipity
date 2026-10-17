import { z } from "zod";
import { budgetFactorsFromSnapshot, calculateBudgetSummary, costItemLineTotals, derivePlanCosts, hasProtectedCostFact } from "./budget";
import { planEventSchema, planEventStart, preparePlanForStorage, type PlanEvent } from "./plan";
import type { PlanVersionRecord } from "./plan-service";
import { isActiveTicket } from "./tickets";
import type { RequestSnapshot } from "./trip-request";
import { executionProtectedIds, type ExecutionProgress } from "./execution";

export class ReplanError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "ReplanError"; }
}
const fields = planEventSchema.pick({ dayNumber: true, date: true, endDate: true, startTime: true, endTime: true,
  title: true, locationName: true, costDraftCents: true, note: true }).partial().strict();
export const replanProposalSchema = z.object({
  requirementChange: z.string().max(500).nullable(),
  edits: z.array(z.object({ eventId: z.string().min(1).max(80), remove: z.boolean(), fields }).strict()).max(64),
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

export function applyReplanProposal(base: PlanVersionRecord, snapshot: RequestSnapshot, revision: number, raw: unknown, now: string, execution?: ExecutionProgress) {
  const proposal = replanProposalSchema.parse(raw);
  if (proposal.requirementChange) throw new ReplanError(`这涉及旅行需求变更：${proposal.requirementChange}。请先在“旅行需求”保存并确认，再重新规划。`, 422);
  if (!proposal.edits.length || new Set(proposal.edits.map((e) => e.eventId)).size !== proposal.edits.length) throw new ReplanError("AI 没有提出有效变更，或重复修改同一活动。", 400);
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
    if (changedVenue) {
      after = { ...after, placeId: null, attractionSelection: undefined, restaurantSelection: undefined, accommodationSelection: undefined,
        costDraftCents: edit.fields.costDraftCents ?? null, costStatus: "estimated" };
    }
    if (changedVenue || after.costDraftCents !== before.costDraftCents) {
      costs = costs.filter((c) => c.linkedEventId !== before.id || c.id.startsWith("route-") || hasProtectedCostFact(c));
      costs.push(...derivePlanCosts([after]));
    }
    events = events.map((e) => e.id === after.id ? after : e);
  }
  const prepared = preparePlanForStorage({ events, pendingItems: base.pendingItems });
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
