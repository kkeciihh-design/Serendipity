import type { PlanEvent } from "./plan";
import type { RequestSnapshot } from "./trip-request";

export type PlanOverviewDay = {
  dayNumber: number;
  date: string;
  theme: string;
  events: PlanEvent[];
};

export const planPaceLabels = {
  relaxed: "轻松",
  balanced: "均衡",
  packed: "紧凑",
} as const;

export function formatMoneyAmount(cents: number | null) {
  return cents === null ? "待确认" : `${Math.round(cents / 100)} 元`;
}

export function formatRequestDateRange(snapshot: RequestSnapshot) {
  if (!snapshot.startDate && !snapshot.endDate) {
    return "未确认";
  }
  if (!snapshot.startDate || !snapshot.endDate) {
    return snapshot.startDate ?? snapshot.endDate ?? "未确认";
  }
  return `${snapshot.startDate} 至 ${snapshot.endDate}`;
}

export function formatBudgetTarget(snapshot: RequestSnapshot) {
  if (snapshot.budgetAmountCents === null) {
    return "预算目标未确认";
  }
  const scope =
    snapshot.budgetScope === "per_person"
      ? "人均预算"
      : snapshot.budgetScope === "total"
        ? "全程总预算"
        : "预算口径未确认";
  return `预算目标 ${formatMoneyAmount(snapshot.budgetAmountCents)}（${scope}）`;
}

export function formatTravelerCount(snapshot: RequestSnapshot) {
  return snapshot.travelerCount === null
    ? "人数未确认"
    : `${snapshot.travelerCount} 人`;
}

export function formatPlanPace(snapshot: RequestSnapshot) {
  return snapshot.pace === null
    ? "节奏未确认"
    : planPaceLabels[snapshot.pace];
}

function dayTheme(events: PlanEvent[], snapshot: RequestSnapshot) {
  const destination = snapshot.destination ?? "目的地";
  if (events.some((event) => event.type === "departure_transport")) {
    return `抵达${destination}`;
  }
  if (events.some((event) => event.type === "return_transport")) {
    return `返程离开${destination}`;
  }
  return (
    events.find((event) => event.type === "activity")?.title ??
    `${destination}行程`
  );
}

export function buildPlanOverviewDays(
  events: PlanEvent[],
  snapshot: RequestSnapshot,
) {
  const grouped = new Map<number, PlanEvent[]>();
  for (const event of events) {
    const day = grouped.get(event.dayNumber) ?? [];
    day.push(event);
    grouped.set(event.dayNumber, day);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([dayNumber, dayEvents]) => ({
      dayNumber,
      date: dayEvents[0]?.date ?? "",
      theme: dayTheme(dayEvents, snapshot),
      events: [...dayEvents].sort((left, right) =>
        left.startTime.localeCompare(right.startTime),
      ),
    }));
}

export function planRequiresUpdate(input: {
  requestRevision: number;
  requirementUpToDate: boolean;
  latestRequestRevision: number;
}) {
  return (
    !input.requirementUpToDate ||
    input.requestRevision !== input.latestRequestRevision
  );
}

export function planStatusLabel(
  plan: {
    requestRevision: number;
    requirementUpToDate: boolean;
    isCurrent: boolean;
  } | null,
  latestRequestRevision: number,
) {
  if (!plan) {
    return "尚无计划";
  }
  const requiresUpdate = planRequiresUpdate({
    requestRevision: plan.requestRevision,
    requirementUpToDate: plan.requirementUpToDate,
    latestRequestRevision,
  });
  if (!plan.isCurrent) {
    return requiresUpdate ? "历史版本待更新" : "历史版本";
  }
  return requiresUpdate ? "当前计划待更新" : "需求依据当前有效";
}
