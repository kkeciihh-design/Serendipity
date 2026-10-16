import { z } from "zod";
import { sortPlanEvents, type PlanEvent } from "./plan";
import type { RequestSnapshot } from "./trip-request";

export const costCategorySchema = z.enum([
  "transport",
  "accommodation",
  "meal",
  "ticket",
  "local_transport",
  "other",
]);

export type CostCategory = z.infer<typeof costCategorySchema>;

export const costCategoryOrder: readonly CostCategory[] = [
  "transport",
  "accommodation",
  "meal",
  "ticket",
  "local_transport",
  "other",
] as const;

export const costCategoryLabels: Record<CostCategory, string> = {
  transport: "交通",
  accommodation: "住宿",
  meal: "餐饮",
  ticket: "门票",
  local_transport: "城市交通",
  other: "其他",
};

export const costPricingUnitSchema = z.enum([
  "one_time",
  "per_person",
  "per_room_per_night",
  "per_night",
  "per_ticket",
]);

export type CostPricingUnit = z.infer<typeof costPricingUnitSchema>;

export const costUnitLabels: Record<CostPricingUnit, string> = {
  one_time: "一次性",
  per_person: "按人",
  per_room_per_night: "按房/晚",
  per_night: "按晚",
  per_ticket: "按票",
};

export const costCertaintySchema = z.enum([
  "estimated",
  "pending_confirmation",
  "user_confirmed",
]);

export type CostCertainty = z.infer<typeof costCertaintySchema>;

export const costCertaintyLabels: Record<CostCertainty, string> = {
  estimated: "估算",
  pending_confirmation: "待确认",
  user_confirmed: "已确认",
};

export const costPaymentStatusSchema = z.enum([
  "not_paid",
  "paid",
  "refund_pending",
]);

export type CostPaymentStatus = z.infer<typeof costPaymentStatusSchema>;

export const costPaymentLabels: Record<CostPaymentStatus, string> = {
  not_paid: "未支付",
  paid: "已支付",
  refund_pending: "退款待处理",
};

export const planCostItemSchema = z.object({
  id: z.string().trim().min(1).max(96),
  linkedEventId: z.string().trim().min(1).max(80),
  category: costCategorySchema,
  currency: z.literal("CNY"),
  unit: costPricingUnitSchema,
  unitAmountCents: z
    .number()
    .int()
    .min(0)
    .max(2_000_000_000)
    .nullable(),
  unitAmountMaxCents: z
    .number()
    .int()
    .min(0)
    .max(2_000_000_000)
    .nullable(),
  quantity: z.number().int().min(1).max(100).nullable(),
  // Explicit participants for this meal only; absent legacy rows retain the
  // plan snapshot's traveler count. A meal row always represents one occasion.
  dinerCount: z.number().int().min(1).max(100).optional(),
  roomCount: z.number().int().min(1).max(100).optional(),
  transferSide: z.enum(["access", "egress"]).optional(),
  // Absent on legacy snapshots: retain their original whole-trip night basis.
  // New daily accommodation rows explicitly cover one night.
  nightCount: z.number().int().min(1).max(4).optional(),
  certainty: costCertaintySchema,
  paymentStatus: costPaymentStatusSchema,
  source: z.enum(["ai_draft", "user_confirmed"]),
  eventRemoved: z.boolean(),
  note: z.string().trim().max(240).nullable(),
});

export type PlanCostItem = z.infer<typeof planCostItemSchema>;

export type PlanCostEditInput = {
  costId: string;
  unit: CostPricingUnit;
  unitAmountCents: number | null;
  unitAmountMaxCents: number | null;
  quantity: number | null;
  nightCount?: number;
  paymentStatus: CostPaymentStatus;
};

export type BudgetFactors = {
  travelerCount: number;
  roomCount: number;
  nightCount: number;
};

export type BudgetCategorySummary = {
  category: CostCategory;
  itemCount: number;
  knownItemCount: number;
  unknownItemCount: number;
  minTotalCents: number;
  maxTotalCents: number;
};

export type BudgetOverspendStatus =
  | "none"
  | "unknown_amounts"
  | "possible"
  | "confirmed";

export type BudgetSummary = {
  factors: BudgetFactors;
  totalMinCents: number;
  totalMaxCents: number;
  perPersonMinCents: number | null;
  perPersonMaxCents: number | null;
  unknownItemCount: number;
  categories: BudgetCategorySummary[];
  budgetTargetCents: number | null;
  budgetScope: "total" | "per_person" | null;
  overspendStatus: BudgetOverspendStatus;
  paidMinCents: number;
  paidItemCount: number;
  notPaidItemCount: number;
  refundPendingItemCount: number;
  estimatedItemCount: number;
  pendingItemCount: number;
  confirmedItemCount: number;
  rangeItemCount: number;
  removedEventItemCount: number;
};

export class CostEditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostEditValidationError";
  }
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function categoryForEventType(type: PlanEvent["type"]): CostCategory {
  switch (type) {
    case "departure_transport":
    case "return_transport":
      return "transport";
    case "local_transport":
      return "local_transport";
    case "accommodation":
      return "accommodation";
    case "meal":
      return "meal";
    case "activity":
      return "ticket";
    case "rest":
    case "preparation":
      return "other";
  }
}

export function derivePlanCosts(events: PlanEvent[]): PlanCostItem[] {
  return sortPlanEvents(events).map((event) => ({
    id: `cost-${event.id}`,
    linkedEventId: event.id,
    category: categoryForEventType(event.type),
    currency: "CNY",
    unit: "one_time",
    unitAmountCents: event.costDraftCents,
    unitAmountMaxCents: null,
    quantity: null,
    ...(event.type === "accommodation" ? { nightCount: 1 } : {}),
    certainty:
      event.costStatus === "user_confirmed"
        ? "pending_confirmation"
        : event.costStatus,
    paymentStatus: "not_paid",
    source: "ai_draft",
    eventRemoved: false,
    note: null,
  }));
}

export function budgetFactorsFromSnapshot(
  snapshot: RequestSnapshot,
): BudgetFactors {
  const travelerCount = snapshot.travelerCount ?? 1;
  let nightCount = 0;
  if (snapshot.startDate && snapshot.endDate) {
    const start = parseLocalDate(snapshot.startDate).getTime();
    const end = parseLocalDate(snapshot.endDate).getTime();
    nightCount = Math.max(0, Math.round((end - start) / 86_400_000));
  }
  return {
    travelerCount,
    roomCount: Math.ceil(travelerCount / 2),
    nightCount,
  };
}

export function budgetTargetCentsFromSnapshot(snapshot: RequestSnapshot) {
  if (snapshot.budgetAmountCents === null) {
    return null;
  }
  return snapshot.budgetScope === "per_person"
    ? snapshot.budgetAmountCents * (snapshot.travelerCount ?? 1)
    : snapshot.budgetAmountCents;
}

export function costItemQuantity(
  item: Pick<PlanCostItem, "unit" | "quantity" | "nightCount" | "dinerCount" | "roomCount">,
  factors: BudgetFactors,
) {
  switch (item.unit) {
    case "one_time":
      return 1;
    case "per_person":
      return item.dinerCount ?? factors.travelerCount;
    case "per_room_per_night":
      return (item.roomCount ?? factors.roomCount) * (item.nightCount ?? factors.nightCount);
    case "per_night":
      return item.nightCount ?? factors.nightCount;
    case "per_ticket":
      return item.quantity ?? 1;
  }
}

export function costItemQuantityDescription(
  item: Pick<PlanCostItem, "unit" | "quantity" | "nightCount" | "dinerCount" | "roomCount">,
  factors: BudgetFactors,
) {
  const quantity = costItemQuantity(item, factors);
  switch (item.unit) {
    case "one_time":
      return "1 次";
    case "per_person":
      return `${quantity} 人`;
    case "per_room_per_night":
      return `${item.roomCount ?? factors.roomCount} 房 × ${item.nightCount ?? factors.nightCount} 晚`;
    case "per_night":
      return `${quantity} 晚`;
    case "per_ticket":
      return `${quantity} 张`;
  }
}

export function costItemLineTotals(
  item: PlanCostItem,
  factors: BudgetFactors,
) {
  const quantity = costItemQuantity(item, factors);
  if (item.unitAmountCents === null) {
    return { quantity, minCents: null, maxCents: null };
  }
  return {
    quantity,
    minCents: item.unitAmountCents * quantity,
    maxCents: (item.unitAmountMaxCents ?? item.unitAmountCents) * quantity,
  };
}

function overspendStatusFor(input: {
  totalMinCents: number;
  totalMaxCents: number;
  unknownItemCount: number;
  budgetTargetCents: number | null;
}): BudgetOverspendStatus {
  const target = input.budgetTargetCents;
  if (target === null) {
    return "none";
  }
  if (input.totalMinCents > target) {
    return "confirmed";
  }
  if (input.totalMaxCents > target) {
    return "possible";
  }
  if (input.unknownItemCount > 0) {
    return "unknown_amounts";
  }
  return "none";
}

export function calculateBudgetSummary(
  costs: PlanCostItem[],
  snapshot: RequestSnapshot,
): BudgetSummary {
  const factors = budgetFactorsFromSnapshot(snapshot);
  const budgetTargetCents = budgetTargetCentsFromSnapshot(snapshot);

  const categories = costCategoryOrder.map((category) => {
    const items = costs.filter((cost) => cost.category === category);
    const known = items.filter((cost) => cost.unitAmountCents !== null);
    const lineTotals = known.map((cost) => costItemLineTotals(cost, factors));
    return {
      category,
      itemCount: items.length,
      knownItemCount: known.length,
      unknownItemCount: items.length - known.length,
      minTotalCents: lineTotals.reduce((total, line) => total + (line.minCents ?? 0), 0),
      maxTotalCents: lineTotals.reduce((total, line) => total + (line.maxCents ?? 0), 0),
    };
  });

  const knownCosts = costs.filter((cost) => cost.unitAmountCents !== null);
  const knownLineTotals = knownCosts.map((cost) =>
    costItemLineTotals(cost, factors),
  );
  const totalMinCents = knownLineTotals.reduce(
    (total, line) => total + (line.minCents ?? 0),
    0,
  );
  const totalMaxCents = knownLineTotals.reduce(
    (total, line) => total + (line.maxCents ?? 0),
    0,
  );
  const unknownItemCount = costs.length - knownCosts.length;

  const paidKnown = costs.filter(
    (cost) => cost.paymentStatus === "paid" && cost.unitAmountCents !== null,
  );
  const paidMinCents = paidKnown.reduce(
    (total, cost) =>
      total + (costItemLineTotals(cost, factors).minCents ?? 0),
    0,
  );

  return {
    factors,
    totalMinCents,
    totalMaxCents,
    perPersonMinCents:
      factors.travelerCount > 0
        ? Math.round(totalMinCents / factors.travelerCount)
        : null,
    perPersonMaxCents:
      factors.travelerCount > 0
        ? Math.round(totalMaxCents / factors.travelerCount)
        : null,
    unknownItemCount,
    categories,
    budgetTargetCents,
    budgetScope: snapshot.budgetScope,
    overspendStatus: overspendStatusFor({
      totalMinCents,
      totalMaxCents,
      unknownItemCount,
      budgetTargetCents,
    }),
    paidMinCents,
    paidItemCount: costs.filter((cost) => cost.paymentStatus === "paid").length,
    notPaidItemCount: costs.filter((cost) => cost.paymentStatus === "not_paid")
      .length,
    refundPendingItemCount: costs.filter(
      (cost) => cost.paymentStatus === "refund_pending",
    ).length,
    estimatedItemCount: costs.filter((cost) => cost.certainty === "estimated")
      .length,
    pendingItemCount: costs.filter(
      (cost) => cost.certainty === "pending_confirmation",
    ).length,
    confirmedItemCount: costs.filter(
      (cost) => cost.certainty === "user_confirmed",
    ).length,
    rangeItemCount: costs.filter(
      (cost) =>
        cost.unitAmountCents !== null &&
        cost.unitAmountMaxCents !== null &&
        cost.unitAmountMaxCents > cost.unitAmountCents,
    ).length,
    removedEventItemCount: costs.filter((cost) => cost.eventRemoved).length,
  };
}

/** One source for timeline amounts: route fares have their own route display. */
export function eventCostSummary(
  eventId: string,
  costs: PlanCostItem[],
  snapshot: RequestSnapshot,
) {
  const related = costs.filter((item) => item.linkedEventId === eventId && !item.id.startsWith("route-"));
  if (related.length === 0) return null;
  const factors = budgetFactorsFromSnapshot(snapshot);
  const lines = related.map((cost) => costItemLineTotals(cost, factors));
  const unknown = lines.some((line) => line.minCents === null || line.maxCents === null);
  const certainty: CostCertainty = unknown || related.some((cost) => cost.certainty === "pending_confirmation")
    ? "pending_confirmation" : related.some((cost) => cost.certainty === "estimated") ? "estimated" : "user_confirmed";
  const paymentStatus: CostPaymentStatus = related.some((cost) => cost.paymentStatus === "refund_pending")
    ? "refund_pending" : related.every((cost) => cost.paymentStatus === "paid") ? "paid" : "not_paid";
  return {
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    minCents: unknown ? null : lines.reduce((sum, line) => sum + line.minCents!, 0),
    maxCents: unknown ? null : lines.reduce((sum, line) => sum + line.maxCents!, 0),
    certainty,
    paymentStatus,
  };
}

export function budgetWarnings(costs: PlanCostItem[], snapshot: RequestSnapshot): string[] {
  const summary = calculateBudgetSummary(costs, snapshot);
  const warnings: string[] = [];
  if (summary.budgetTargetCents !== null) {
    if (summary.overspendStatus === "confirmed") {
      warnings.push(`当前费用合计 ${formatMoneyRange(summary.totalMinCents, summary.totalMaxCents)}，超过确认预算 ${formatMoneyValue(summary.budgetTargetCents)} 元；请调整安排或预算。`);
    } else if (summary.overspendStatus === "possible") {
      warnings.push(`当前费用区间 ${formatMoneyRange(summary.totalMinCents, summary.totalMaxCents)}，可能超过确认预算 ${formatMoneyValue(summary.budgetTargetCents)} 元；请逐项确认费用。`);
    }
  }
  if (snapshot.budgetAmountCents !== null && snapshot.budgetAmountCents <= 1000) {
    warnings.push("确认预算非常低，请优先选择免费或低成本安排，并逐项确认费用。");
  }
  return warnings;
}

export function hasProtectedCostFact(cost: PlanCostItem) {
  return cost.certainty === "user_confirmed" || cost.source === "user_confirmed" || cost.paymentStatus !== "not_paid";
}

export function validatePlanCosts(
  costs: PlanCostItem[],
  events: PlanEvent[],
): string[] {
  const errors: string[] = [];
  const eventIds = new Set(events.map((event) => event.id));
  const linkedEventIds = new Set<string>();
  const routeLinkedEventIds = new Set<string>();
  const costIds = new Set<string>();

  for (const cost of costs) {
    if (cost.roomCount !== undefined && (cost.category !== "accommodation" || cost.unit !== "per_room_per_night" || !Number.isInteger(cost.roomCount) || cost.roomCount < 1 || cost.roomCount > 100)) errors.push("房数只适用于按房每晚的住宿费用。");
    if (cost.dinerCount !== undefined && (cost.category !== "meal" || cost.unit !== "per_person" ||
      !Number.isInteger(cost.dinerCount) || cost.dinerCount < 1 || cost.dinerCount > 100)) {
      errors.push(`费用 ${cost.id} 的本餐人数只适用于按人计价的餐饮，且须为 1 到 100 的整数。`);
    }
    if (costIds.has(cost.id)) errors.push(`费用 ${cost.id} 重复。`);
    costIds.add(cost.id);
    const routeCost = cost.id.startsWith("route-");
    const ticketCost = cost.id.startsWith("ticket-");
    if (routeCost) {
      // A previous route's paid/confirmed amount survives route changes. Only
      // competing draft fares for the current destination are duplicates.
      if (cost.source !== "user_confirmed" && cost.paymentStatus === "not_paid") {
        if (routeLinkedEventIds.has(cost.linkedEventId)) {
          errors.push(`费用 ${cost.id} 与事件 ${cost.linkedEventId} 重复关联。`);
        }
        routeLinkedEventIds.add(cost.linkedEventId);
      }
    } else if (ticketCost) {
      // Several travelers can hold separate tickets for the same main transport
      // event. Each stable ticket keeps its own fare/payment history.
    } else {
      if (linkedEventIds.has(cost.linkedEventId)) {
        errors.push(`费用 ${cost.id} 与事件 ${cost.linkedEventId} 重复关联。`);
      }
      linkedEventIds.add(cost.linkedEventId);
    }

    if (!cost.eventRemoved && !eventIds.has(cost.linkedEventId)) {
      errors.push(`费用 ${cost.id} 关联的事件不存在。`);
    }
    if (cost.unit === "per_ticket" && (cost.quantity ?? 0) < 1) {
      errors.push(`费用 ${cost.id} 的票数必须至少为 1。`);
    }
    if (cost.nightCount !== undefined && (!Number.isInteger(cost.nightCount) || cost.nightCount < 1 || cost.nightCount > 4)) {
      errors.push(`费用 ${cost.id} 的计费晚数必须是 1 到 4 的整数。`);
    }
    if (
      cost.unitAmountCents === null &&
      cost.unitAmountMaxCents !== null
    ) {
      errors.push(`费用 ${cost.id} 金额未知时不能只填写区间上限。`);
    }
    if (
      cost.unitAmountCents !== null &&
      cost.unitAmountMaxCents !== null &&
      cost.unitAmountMaxCents < cost.unitAmountCents
    ) {
      errors.push(`费用 ${cost.id} 的区间上限不能低于下限。`);
    }
  }

  return errors;
}

export function planCostEditHasChanges(
  cost: PlanCostItem,
  input: PlanCostEditInput,
) {
  const normalizedQuantity =
    input.unit === "per_ticket" ? (input.quantity ?? 1) : null;
  return (
    cost.unit !== input.unit ||
    cost.unitAmountCents !== input.unitAmountCents ||
    cost.unitAmountMaxCents !== (input.unitAmountMaxCents ?? null) ||
    cost.quantity !== normalizedQuantity ||
    cost.paymentStatus !== input.paymentStatus ||
    (input.nightCount !== undefined && cost.nightCount !== input.nightCount) ||
    (input.unitAmountCents !== null && (cost.certainty !== "user_confirmed" || cost.source !== "user_confirmed"))
  );
}

export function applyPlanCostEdit(
  costs: PlanCostItem[],
  input: PlanCostEditInput,
  events: PlanEvent[] = [],
): PlanCostItem[] {
  const target = costs.find((cost) => cost.id === input.costId);
  if (!target) {
    throw new CostEditValidationError("没有找到要确认的费用项目。");
  }
  if (input.nightCount !== undefined && (!Number.isInteger(input.nightCount) || input.nightCount < 1 || input.nightCount > 4)) {
    throw new CostEditValidationError("计费晚数必须是 1 到 4 的整数。");
  }
  const nightly = (unit: CostPricingUnit) => unit === "per_room_per_night" || unit === "per_night";
  const nightCount = input.nightCount ?? target.nightCount ?? (
    nightly(input.unit) && !nightly(target.unit) && events.some((event) => event.id === target.linkedEventId && event.type === "accommodation")
      ? 1 : undefined
  );
  if (!planCostEditHasChanges(target, { ...input, ...(nightCount !== undefined ? { nightCount } : {}) })) {
    throw new CostEditValidationError("本次没有需要保存的费用修改。");
  }
  if (
    input.unitAmountCents === null &&
    input.unitAmountMaxCents !== null
  ) {
    throw new CostEditValidationError("金额未知时不能只填写区间上限。");
  }
  if (
    input.unitAmountCents !== null &&
    input.unitAmountMaxCents !== null &&
    input.unitAmountMaxCents < input.unitAmountCents
  ) {
    throw new CostEditValidationError("费用区间上限不能低于下限。");
  }
  if (input.unit === "per_ticket" && input.quantity !== null && input.quantity < 1) {
    throw new CostEditValidationError("按票计价时票数必须至少为 1。");
  }

  return costs.map((cost) =>
    cost.id === input.costId
      ? {
          ...cost,
          unit: input.unit,
          dinerCount: input.unit === "per_person" ? cost.dinerCount : undefined,
          roomCount: input.unit === "per_room_per_night" ? (events.find((event) => event.id === cost.linkedEventId)?.accommodationSelection?.roomCount ?? cost.roomCount) : undefined,
          unitAmountCents: input.unitAmountCents,
          unitAmountMaxCents: input.unitAmountMaxCents ?? null,
          quantity:
            input.unit === "per_ticket" ? (input.quantity ?? 1) : null,
          ...(nightCount !== undefined ? { nightCount } : {}),
          certainty:
            input.unitAmountCents === null
              ? "pending_confirmation"
              : "user_confirmed",
          paymentStatus: input.paymentStatus,
          source: "user_confirmed",
        }
      : cost,
  );
}

export function formatMoneyValue(cents: number) {
  const yuan = cents / 100;
  return Number.isInteger(yuan) ? `${yuan}` : yuan.toFixed(2);
}

export function formatMoneyRange(
  minCents: number | null,
  maxCents: number | null,
) {
  if (minCents === null) {
    return "待确认";
  }
  if (maxCents !== null && maxCents !== minCents) {
    return `${formatMoneyValue(minCents)}–${formatMoneyValue(maxCents)} 元`;
  }
  return `${formatMoneyValue(minCents)} 元`;
}

export const overspendStatusLabels: Record<BudgetOverspendStatus, string> = {
  none: "未超预算",
  unknown_amounts: "有未知金额，暂不能判断",
  possible: "可能超支",
  confirmed: "确定超支",
};
