import { z } from "zod";
import type { RequestSnapshot } from "./trip-request";

export const planEventTypeSchema = z.enum([
  "departure_transport",
  "local_transport",
  "return_transport",
  "meal",
  "activity",
  "accommodation",
  "rest",
  "preparation",
]);

export type PlanEventType = z.infer<typeof planEventTypeSchema>;

export const planCostStatusSchema = z.enum([
  "estimated",
  "pending_confirmation",
  "user_confirmed",
]);

export type PlanCostStatus = z.infer<typeof planCostStatusSchema>;

const planDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "计划日期必须使用 YYYY-MM-DD。");

const planTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间必须使用 HH:mm。");

export const planEventSchema = z.object({
  id: z.string().trim().min(1).max(80),
  dayNumber: z.number().int().min(1).max(4),
  date: planDate,
  startTime: planTime,
  endTime: planTime,
  type: planEventTypeSchema,
  title: z.string().trim().min(1).max(120),
  locationName: z.string().trim().max(160).nullable(),
  suggestedDurationSeconds: z
    .number()
    .int()
    .min(1, "建议时长必须大于 0 秒。")
    .max(86_400),
  costDraftCents: z.number().int().min(0).nullable(),
  costStatus: planCostStatusSchema,
  note: z.string().trim().max(240).nullable().optional(),
});

export type PlanEvent = z.infer<typeof planEventSchema>;

export const planPendingItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  category: z.enum([
    "transport_ticket",
    "reservation",
    "opening_hours",
    "price",
    "route",
    "accommodation",
    "weather",
    "other",
  ]),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(240),
  requiredBefore: planDate.nullable(),
});

export type PlanPendingItem = z.infer<typeof planPendingItemSchema>;

export const aiPlanOutputSchema = z.object({
  events: z.array(planEventSchema).min(1).max(64),
  pendingItems: z.array(planPendingItemSchema).min(1).max(24),
});

export type AIPlanOutput = z.infer<typeof aiPlanOutputSchema>;

export const planValidationResultsSchema = z.object({
  status: z.enum(["valid", "needs_review", "invalid"]),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type PlanValidationResults = z.infer<
  typeof planValidationResultsSchema
>;

export type PlanCapture = {
  tripId: string;
  expectedRequestRevision: number;
  expectedPlanVersion: number | null;
  requestSnapshot: RequestSnapshot;
  originalRequest: string;
};

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

export function tripDates(snapshot: RequestSnapshot) {
  if (!snapshot.startDate || !snapshot.endDate) {
    throw new Error("生成计划前必须有确认的出发和返回日期。");
  }

  const dates: string[] = [];
  const start = parseDate(snapshot.startDate);
  const end = parseDate(snapshot.endDate);
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function eventEndsAfterStart(event: PlanEvent) {
  return minutes(event.endTime) > minutes(event.startTime);
}

function overlaps(left: PlanEvent, right: PlanEvent) {
  return (
    minutes(left.startTime) < minutes(right.endTime) &&
    minutes(right.startTime) < minutes(left.endTime)
  );
}

function estimatedCostTotal(events: PlanEvent[]) {
  return events.reduce(
    (total, event) => total + (event.costDraftCents ?? 0),
    0,
  );
}

export function validatePlan(
  plan: AIPlanOutput,
  snapshot: RequestSnapshot,
): PlanValidationResults {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dates = tripDates(snapshot);

  const eventIds = new Set<string>();
  for (const event of plan.events) {
    if (eventIds.has(event.id)) {
      errors.push(`事件 ID 重复：${event.id}。`);
    }
    eventIds.add(event.id);

    if (!dates[event.dayNumber - 1]) {
      errors.push(`第 ${event.dayNumber} 天超出 2 到 4 天行程范围。`);
    } else if (dates[event.dayNumber - 1] !== event.date) {
      errors.push(
        `第 ${event.dayNumber} 天的日期必须等于 ${dates[event.dayNumber - 1]}。`,
      );
    }
    if (!eventEndsAfterStart(event)) {
      errors.push(`${event.title} 的结束时间必须晚于开始时间。`);
    }

    if (
      ["meal", "activity", "accommodation"].includes(event.type) &&
      !event.locationName
    ) {
      errors.push(`${event.title} 缺少地点名称。`);
    }
  }

  const sortedEvents = [...plan.events].sort(
    (left, right) =>
      left.dayNumber - right.dayNumber ||
      minutes(left.startTime) - minutes(right.startTime),
  );
  for (let index = 1; index < sortedEvents.length; index += 1) {
    const left = sortedEvents[index - 1];
    const right = sortedEvents[index];
    if (left.dayNumber === right.dayNumber && overlaps(left, right)) {
      errors.push(`${left.title} 与 ${right.title} 的时段重叠。`);
    }
  }

  dates.forEach((date, index) => {
    const dayNumber = index + 1;
    const dayEvents = plan.events.filter(
      (event) => event.dayNumber === dayNumber,
    );
    if (dayEvents.length === 0) {
      errors.push(`第 ${dayNumber} 天没有安排。`);
      return;
    }

    const meals = dayEvents.filter((event) => event.type === "meal");
    if (meals.length < 2) {
      errors.push(`第 ${dayNumber} 天至少要保留两餐。`);
    }
    const activities = dayEvents.filter(
      (event) => event.type === "activity",
    );
    if (activities.length === 0) {
      errors.push(`第 ${dayNumber} 天缺少活动。`);
    }
    const rest = dayEvents.filter((event) => event.type === "rest");
    if (rest.length === 0) {
      errors.push(`第 ${dayNumber} 天缺少休息安排。`);
    }
    const preparation = dayEvents.filter(
      (event) => event.type === "preparation",
    );
    if (preparation.length === 0) {
      errors.push(`第 ${dayNumber} 天缺少准备事项。`);
    }
    if (!dayEvents.some((event) => event.date === date)) {
      errors.push(`第 ${dayNumber} 天的日期不是 ${date}。`);
    }
  });

  const departureTransport = plan.events.filter(
    (event) => event.type === "departure_transport",
  );
  if (departureTransport.length !== 1 || departureTransport[0].dayNumber !== 1) {
    errors.push("第 1 天必须且只能有一个去程交通安排。");
  }
  const returnTransport = plan.events.filter(
    (event) => event.type === "return_transport",
  );
  if (
    returnTransport.length !== 1 ||
    returnTransport[0].dayNumber !== dates.length
  ) {
    errors.push(`第 ${dates.length} 天必须且只能有一个返程交通安排。`);
  }

  for (let dayNumber = 1; dayNumber < dates.length; dayNumber += 1) {
    const accommodation = plan.events.filter(
      (event) =>
        event.type === "accommodation" && event.dayNumber === dayNumber,
    );
    if (accommodation.length !== 1) {
      errors.push(`第 ${dayNumber} 天必须有一个住宿区域安排。`);
    }
  }

  if (plan.pendingItems.length === 0) {
    errors.push("基础计划必须列出至少一个待确认事项。");
  }

  if (snapshot.budgetAmountCents !== null) {
    const budgetTotalCents =
      snapshot.budgetScope === "per_person" && snapshot.travelerCount
        ? snapshot.budgetAmountCents * snapshot.travelerCount
        : snapshot.budgetAmountCents;
    const estimatedTotal = estimatedCostTotal(plan.events);
    if (estimatedTotal > budgetTotalCents) {
      warnings.push(
        `当前费用草稿合计 ${Math.round(estimatedTotal / 100)} 元，超过确认预算 ${Math.round(budgetTotalCents / 100)} 元；请调整安排或预算。`,
      );
    }
  }
  if (snapshot.budgetAmountCents !== null && snapshot.budgetAmountCents <= 1000) {
    warnings.push("确认预算非常低，请优先选择免费或低成本安排，并逐项确认费用。");
  }

  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "needs_review" : "valid",
    errors,
    warnings,
  };
}

export function normalizePlanOutput(output: AIPlanOutput): AIPlanOutput {
  return {
    events: output.events.map((event) => ({
      ...event,
      costStatus:
        event.costStatus === "user_confirmed"
          ? "pending_confirmation"
          : event.costStatus,
    })),
    pendingItems: output.pendingItems,
  };
}

export function parseAIPlanOutput(raw: string): AIPlanOutput {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("模型没有返回 JSON 对象。");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new Error("模型返回的 JSON 无法解析。");
  }

  return aiPlanOutputSchema.parse(payload);
}
