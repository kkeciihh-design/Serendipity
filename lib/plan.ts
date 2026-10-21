import { z } from "zod";
import type { RequestSnapshot } from "./trip-request";
import { budgetWarnings, calculateBudgetSummary, derivePlanCosts, type PlanCostItem } from "./budget";
import { asModelRecord, normalizeGeneratedChineseText, normalizeMoneyCents, normalizeNodeType, normalizeTime, parseModelJson } from "./ai-normalizer";
import { validateTripHardTimes } from "./trip-hard-constraints";
import { validateArrivalLunch, validateVisitHours } from "./planning-quality";
import { deriveGeneratedPlanCosts } from "./generated-costs";
import { confirmedRequestBudgetLimit } from "./budget-limit";
import { sanitizeTravelerText } from "./content-sanitizer";

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

export const planEventStatusSchema = z.enum(["suggested", "confirmed"]);

export type PlanEventStatus = z.infer<typeof planEventStatusSchema>;

const planDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "计划日期必须使用 YYYY-MM-DD。")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "计划日期不存在。");

const planTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间必须使用 HH:mm。");

export const planEventSchema = z.object({
  id: z.string().trim().min(1).max(80),
  dayNumber: z.number().int().min(1).max(4),
  date: planDate,
  endDate: planDate.nullable().optional(),
  startTime: planTime,
  endTime: planTime,
  type: planEventTypeSchema,
  title: z.string().trim().min(1).max(240),
  locationName: z.string().trim().max(160).nullable(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  coordinateSystem: z.enum(["WGS84", "GCJ-02"]).optional(),
  placeId: z.string().min(1).max(120).nullable().optional(),
  order: z.number().int().min(1).nullable().optional(),
  status: planEventStatusSchema.optional(),
  locked: z.boolean().optional(),
  ticketManaged: z.boolean().optional(),
  ticketAccessForEventId: z.string().min(1).max(80).optional(),
  ticketTimingPending: z.boolean().optional(),
  accommodationSelection: z.object({
    stayId: z.string().min(1).max(80),
    areaId: z.string().min(1).max(120),
    areaName: z.string().min(1).max(160),
    kind: z.enum(["area", "hotel"]),
    checkIn: planDate, checkOut: planDate,
    roomCount: z.number().int().min(1).max(100),
    nightCount: z.number().int().min(1).max(3),
    morningDepartureTime: planTime,
    checkInFrom: planTime.nullable(), checkOutBy: planTime.nullable(),
    luggageStorage: z.enum(["unknown", "available", "unavailable"]),
    conditionNote: z.string().trim().max(240),
    selectedAt: z.iso.datetime(),
    invalidatedAccessOrigins: z.array(z.object({ ticketId: z.string().min(1).max(120), originName: z.string().min(1).max(160) })).max(64).optional(),
  }).optional(),
  attractionSelection: z.object({
    catalogId: z.string().min(1).max(120).nullable(),
    action: z.enum(["keep", "replace"]),
    selectedAt: z.iso.datetime(),
  }).optional(),
  restaurantSelection: z.object({
    catalogId: z.string().min(1).max(120).nullable(),
    action: z.enum(["adjust", "replace"]),
    selectedAt: z.iso.datetime(),
    invalidatedAccessOrigins: z.array(z.object({ ticketId: z.string().min(1).max(120), originName: z.string().min(1).max(160) })).max(64).optional(),
  }).optional(),
  suggestedDurationSeconds: z
    .number()
    .int()
    .min(1, "建议时长必须大于 0 秒。")
    .max(86_400),
  costDraftCents: z.number().int().min(0).nullable(),
  costStatus: planCostStatusSchema,
  note: z.string().trim().max(6000).nullable().optional(),
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

export const planContentSchema = z.object({
  events: z.array(planEventSchema).min(1).max(64),
  pendingItems: z.array(planPendingItemSchema).max(24),
});

export type PlanContent = z.infer<typeof planContentSchema>;

// The model DTO has no user confirmation, lock or payment authority. Unknown
// fields (including event/root costs and payment fields) are stripped by Zod.
const aiEventSchema = planEventSchema.omit({ status: true, locked: true, order: true, placeId: true, ticketManaged: true, ticketAccessForEventId: true, ticketTimingPending: true, attractionSelection: true, restaurantSelection: true, accommodationSelection: true }).extend({
  costStatus: planCostStatusSchema.transform((status) =>
    status === "user_confirmed" ? "pending_confirmation" as const : status),
});
export const aiPlanOutputSchema = z.object({
  events: z.array(aiEventSchema).min(1).max(64),
  pendingItems: z.array(planPendingItemSchema).max(24),
});
export type AIPlanOutput = z.infer<typeof aiPlanOutputSchema>;

export const planValidationResultsSchema = z.object({
  scope: z.literal("remaining").optional(),
  status: z.enum(["valid", "needs_review", "invalid"]),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type PlanValidationResults = z.infer<
  typeof planValidationResultsSchema
>;

export type PlanCapture = {
  dataGeneration: string;
  tripId: string;
  expectedRequestRevision: number;
  expectedPlanVersion: number | null;
  expectedChecklistRevision: number;
  expectedExecutionRevision: number;
  requestSnapshot: RequestSnapshot;
  originalRequest: string;
};

function parseDate(value: string) {
  return parsePlanDateTime(value, "00:00");
}

function formatDate(date: Date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parsePlanDateTime(date: string, time: string) {
  // The current single-city MVP uses China local time (Asia/Shanghai),
  // independent of the browser/server OS timezone. No cross-zone plans yet.
  return new Date(`${date}T${time}:00+08:00`);
}

export function formatPlanDate(date: Date) {
  return formatDate(date);
}

export function nextPlanDate(date: string) {
  const next = parseDate(date);
  next.setTime(next.getTime() + 86_400_000);
  return formatDate(next);
}

export function planEventStart(event: PlanEvent) {
  return parsePlanDateTime(event.date, event.startTime);
}

export function planEventEnd(event: PlanEvent) {
  if (event.endDate) {
    return parsePlanDateTime(event.endDate, event.endTime);
  }

  const [startHour, startMinute] = event.startTime.split(":").map(Number);
  const [endHour, endMinute] = event.endTime.split(":").map(Number);
  const endDate =
    endHour * 60 + endMinute < startHour * 60 + startMinute
      ? nextPlanDate(event.date)
      : event.date;
  return parsePlanDateTime(endDate, event.endTime);
}

export function sortPlanEvents(events: PlanEvent[]) {
  return [...events].sort((left, right) => {
    const leftStart = planEventStart(left).getTime();
    const rightStart = planEventStart(right).getTime();
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id);
  });
}

export function planEventDurationSeconds(event: PlanEvent) {
  return (planEventEnd(event).getTime() - planEventStart(event).getTime()) / 1000;
}

/** Read projection for old generated copy; confirmed or locked event facts stay intact. */
export function normalizePlanChineseCopy(plan: PlanContent): PlanContent {
  return {
    events: plan.events.map((event) => {
      const normalized = event.locked || event.status === "confirmed" ? event : {
        ...event,
        title: normalizeGeneratedChineseText(event.title),
        locationName: event.locationName === null ? null : normalizeGeneratedChineseText(event.locationName),
      };
      const note = normalized.note == null ? null : event.locked || event.status === "confirmed"
        ? normalized.note : normalizeGeneratedChineseText(normalized.note);
      return { ...normalized, note: note == null ? null : sanitizeTravelerText(note) };
    }),
    pendingItems: plan.pendingItems.map((item) => ({
      ...item,
      title: normalizeGeneratedChineseText(item.title),
      reason: normalizeGeneratedChineseText(item.reason),
    })),
  };
}

export function preparePlanForStorage(plan: PlanContent): PlanContent {
  return {
    events: sortPlanEvents(plan.events).map((event, index) => {
      const end = planEventEnd(event);
      return {
        ...event,
        order: index + 1,
        status: event.status ?? "suggested",
        locked: event.locked ?? false,
        ticketManaged: event.ticketManaged ?? false,
        endDate: formatPlanDate(end),
        // Actual occupied time is authoritative; repair only the new snapshot.
        suggestedDurationSeconds: planEventDurationSeconds(event),
      };
    }),
    pendingItems: plan.pendingItems,
  };
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
    cursor.setTime(cursor.getTime() + 86_400_000);
  }
  return dates;
}

function eventEndsAfterStart(event: PlanEvent) {
  return planEventEnd(event).getTime() > planEventStart(event).getTime();
}

function overlaps(left: PlanEvent, right: PlanEvent) {
  return (
    planEventStart(left).getTime() < planEventEnd(right).getTime() &&
    planEventStart(right).getTime() < planEventEnd(left).getTime()
  );
}

export function validatePlan(
  plan: PlanContent,
  snapshot: RequestSnapshot,
  costs?: PlanCostItem[],
  scope?: "remaining",
): PlanValidationResults {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dates = tripDates(snapshot);

  const eventIds = new Set<string>();
  for (const event of plan.events) {
    const stay = event.accommodationSelection;
    if (stay && (event.type !== "accommodation" || event.date < stay.checkIn || event.date >= stay.checkOut ||
      Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000) !== stay.nightCount)) errors.push("住宿日期与入住资料不一致，请重新确认住宿。");
    if (stay && event.date === stay.checkIn && stay.checkInFrom && event.startTime < stay.checkInFrom && stay.luggageStorage === "unavailable") errors.push("未到入住时间且酒店不可寄存行李，请调整到店时刻或酒店。");
    if (stay) {
      const morningDate = nextPlanDate(event.date);
      const departureAt = Date.parse(`${morningDate}T${stay.morningDepartureTime}:00+08:00`);
      if (departureAt < planEventEnd(event).getTime()) errors.push(`${event.date} 的住宿结束晚于次日计划离店时刻，请先调整时间轴。`);
      if (morningDate === stay.checkOut && stay.checkOutBy && stay.morningDepartureTime > stay.checkOutBy) errors.push("最后一天计划离店晚于酒店退房截止，请提前离店或确认延迟退房。");
      for (const next of plan.events.filter((item) => item.date === morningDate && !item.ticketTimingPending)) {
        const atHotel = stay.kind === "hotel" && event.placeId && next.placeId === event.placeId;
        // Preparation, a meal or rest may happen in the hotel. An explicitly
        // different venue, a destination activity or transport requires leaving,
        // even when a hotel/route has not been precisely located yet.
        const requiresDeparture = ["local_transport", "departure_transport", "return_transport"].includes(next.type) ||
          (!atHotel && (["activity", "accommodation"].includes(next.type) || Boolean(next.placeId && next.placeId !== event.placeId) || Boolean(next.restaurantSelection)));
        if (requiresDeparture && planEventStart(next).getTime() < departureAt) {
          errors.push(`${morningDate} 计划${stay.morningDepartureTime}从住宿离店，晚于${next.title}的开始时刻${next.startTime}；请提前离店或调整该项安排。`);
        }
      }
    }
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
    if (
      event.endDate &&
      event.endDate !== event.date &&
      event.endDate !== nextPlanDate(event.date)
    ) {
      errors.push(`${event.title} 的结束日期只能当天或次日。`);
    }
    if (!eventEndsAfterStart(event)) {
      errors.push(`${event.title} 的结束时刻必须晚于开始时刻。`);
    }
    if (planEventDurationSeconds(event) > 86_400) {
      errors.push(`${event.title} 的时长不能超过 24 小时。`);
    }
    if (formatPlanDate(planEventEnd(event)) > dates[dates.length - 1]) {
      errors.push(`${event.title} 的结束日期超出行程日期范围。`);
    }

    if (
      ["meal", "activity", "accommodation"].includes(event.type) &&
      !event.locationName
    ) {
      errors.push(`${event.title} 缺少地点名称。`);
    }
  }

  const sortedEvents = sortPlanEvents(plan.events);
  for (let index = 1; index < sortedEvents.length; index += 1) {
    const left = sortedEvents[index - 1];
    const right = sortedEvents[index];
    if (overlaps(left, right)) {
      errors.push(`${left.title} 与 ${right.title} 的时段重叠。`);
    }
  }

  dates.forEach((date, index) => {
    const dayNumber = index + 1;
    const dayEvents = plan.events.filter(
      (event) => event.dayNumber === dayNumber,
    );
    if (dayEvents.length === 0) {
      (scope ? warnings : errors).push(`第 ${dayNumber} 天没有安排。`);
      return;
    }

    // A travel day can consist of transfers and one meal; preparation and rest
    // may live in another event's notes. Validate useful content, not a template
    // quota that forces the model to invent activities or meals around a train.
    if (!dayEvents.some((event) => event.type !== "preparation" && event.type !== "rest")) {
      (scope ? warnings : errors).push(`第 ${dayNumber} 天缺少实质行程，请安排交通、游览、餐饮或住宿。`);
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

  // Activities and accommodation belong to the destination stay. Meals and
  // preparation may legitimately happen at home before departure/after return.
  // Unknown ticket times retain their placeholders for display only.
  const departure = departureTransport.length === 1 ? departureTransport[0] : null;
  const returning = returnTransport.length === 1 ? returnTransport[0] : null;
  for (const event of plan.events.filter((item) => item.type === "activity" || item.type === "accommodation")) {
    if (departure && !departure.ticketTimingPending &&
      planEventStart(event).getTime() < planEventEnd(departure).getTime()) {
      errors.push(`${event.title} 在去程到达前开始，目的地活动和住宿必须安排在到达后。`);
    }
    if (returning && !returning.ticketTimingPending &&
      planEventEnd(event).getTime() > planEventStart(returning).getTime()) {
      errors.push(`${event.title} 在返程出发后结束，目的地活动和住宿必须安排在返程前。`);
    }
  }
  if (departure?.ticketTimingPending || returning?.ticketTimingPending) {
    warnings.push("去返程票面时刻尚不完整，目的地活动与交通的先后关系待补齐时刻后复核。");
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

  warnings.push(...budgetWarnings(costs ?? derivePlanCosts(plan.events), snapshot));
  errors.push(...validateTripHardTimes(plan.events, snapshot));
  errors.push(...validateVisitHours(plan.events, snapshot));

  return {
    ...(scope ? { scope } : {}),
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "needs_review" : "valid",
    errors,
    warnings,
  };
}

export function planEveningReturnGaps(plan: PlanContent, snapshot: RequestSnapshot) {
  const gaps: { dayNumber: number; stay: PlanEvent; after: PlanEvent }[] = [];
  const dates = tripDates(snapshot);
  for (let dayNumber = 1; dayNumber < dates.length; dayNumber += 1) {
    const dayEvents = plan.events.filter((event) => event.dayNumber === dayNumber);
    const stays = dayEvents.filter((event) => event.type === "accommodation");
    if (stays.length !== 1) continue;
    const hotelRest = (event: PlanEvent) => event.type === "accommodation" ||
      ["rest", "activity"].includes(event.type) && /(?:返回|回到|回)(?:酒店|民宿|住处|住宿).*(?:休息|休整|就寝|睡觉)/.test(event.title);
    const lastOutingEnd = Math.max(0, ...dayEvents.filter((event) =>
      !hotelRest(event) && ["meal", "activity", "local_transport"].includes(event.type),
    ).map((event) => planEventEnd(event).getTime()));
    // Closing the day's outings matters, not a fixed clock time: returning at
    // 17:30 after an early dinner is just as complete as a 22:00 hotel return.
    const hasEveningStay = dayEvents.some((event) => hotelRest(event) &&
      planEventStart(event).getTime() >= lastOutingEnd);
    if (!hasEveningStay) {
      const after = [...dayEvents].sort((left, right) => planEventEnd(right).getTime() - planEventEnd(left).getTime())[0];
      gaps.push({ dayNumber, stay: stays[0], after });
    }
  }
  return gaps;
}

/** Missing hotel-return detail is useful advice, not a reason to reject a usable itinerary. */
export function validateGeneratedPlan(plan: PlanContent, snapshot: RequestSnapshot): PlanValidationResults {
  const validation = validatePlan(plan, snapshot, deriveGeneratedPlanCosts(plan.events, snapshot));
  validation.errors.push(...validateArrivalLunch(plan.events));
  const hardBudget = confirmedRequestBudgetLimit(snapshot);
  if (hardBudget !== null && calculateBudgetSummary(deriveGeneratedPlanCosts(plan.events, snapshot), snapshot).totalMaxCents > hardBudget) {
    validation.errors.push(`预计费用区间上限超过已确认预算上限 ¥${hardBudget / 100}，请降低花费后重新安排。`);
  }
  const warnings = [...validation.warnings, ...planEveningReturnGaps(plan, snapshot).map(({ dayNumber }) =>
    `第 ${dayNumber} 天可在游览或住宿说明中补充晚间返回酒店的交通与休息建议，无需单独增加节点。`,
  )];
  return { ...validation, warnings, status: validation.errors.length ? "invalid" : warnings.length ? "needs_review" : "valid" };
}

export function normalizePlanOutput(output: PlanContent): PlanContent {
  const parsed = aiPlanOutputSchema.parse(normalizeAIPlanDraft(output));
  return preparePlanForStorage(normalizePlanChineseCopy({
    events: parsed.events.map((event) => ({
      ...event,
      status: "suggested",
      locked: false,
    })),
    pendingItems: parsed.pendingItems,
  }));
}

function modelField(record: Record<string, unknown>, ...keys: string[]) {
  return keys.map((key) => record[key]).find((value) => value !== undefined && value !== null && value !== "");
}

function modelText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(modelText).filter(Boolean).join(" → ") || null;
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => {
      const text = modelText(item);
      return text ? `${key}：${text}` : null;
    }).filter(Boolean).join("；") || null;
  }
  return null;
}

function modelNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function modelDate(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日|T.*)?$/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : value;
}

function modelCoordinates(event: Record<string, unknown>) {
  const location = asModelRecord(event.location);
  const source = event.coordinates ?? event.coordinate ?? event.coords ?? location.coordinates ?? location;
  const coordinate = asModelRecord(source);
  const longitude = modelNumber(modelField(event, "longitude", "lng", "lon") ?? modelField(coordinate, "longitude", "lng", "lon") ?? (Array.isArray(source) ? source[0] : null));
  const latitude = modelNumber(modelField(event, "latitude", "lat") ?? modelField(coordinate, "latitude", "lat") ?? (Array.isArray(source) ? source[1] : null));
  const system = String(event.coordinateSystem ?? coordinate.coordinateSystem ?? "").toUpperCase();
  return {
    latitude: latitude !== null && Math.abs(latitude) <= 90 ? latitude : null,
    longitude: longitude !== null && Math.abs(longitude) <= 180 ? longitude : null,
    coordinateSystem: /GCJ[-_]?02/.test(system) ? "GCJ-02" as const : /WGS[-_]?84/.test(system) ? "WGS84" as const : undefined,
  };
}

function modelEventCost(event: Record<string, unknown>, type: PlanEventType, snapshot?: RequestSnapshot) {
  const amountKeys = ["costDraftCents", "costCents", "estimatedCostCents", "costYuan", "priceYuan", "costPerPerson", "pricePerPerson", "costPerRoom", "cost", "price", "estimatedCost", "费用", "参考费用"];
  const selectedKey = amountKeys.find((key) => event[key] !== undefined && event[key] !== null && event[key] !== "");
  const money = selectedKey ? event[selectedKey] : undefined;
  const costUnit = modelText(event.costUnit);
  const currencyUnit = modelField(event, "currencyUnit", "amountUnit", "moneyUnit", "costCurrencyUnit") ??
    (costUnit && /^(?:元|分|人民币|[¥￥]|cents?|cny|rmb|yuan)$/i.test(costUnit) ? costUnit : undefined);
  let amount = normalizeMoneyCents(currencyUnit ? { amount: money, unit: currencyUnit } : money, selectedKey?.endsWith("Cents") ? "cents" : "yuan");
  if (amount === null && (type === "rest" || type === "preparation")) amount = 0;
  if (amount !== null && snapshot) {
    const basis = String(modelField(event, "costBasis", "pricingUnit", "costUnit") ??
      modelField(asModelRecord(money), "basis", "pricingUnit", "costBasis", "scope") ?? "");
    const annotatedAmount = typeof money === "string" ? money : "";
    const perPerson = /per_person|per_ticket|人均|每[人位]|\/\s*[人位]/i;
    const perRoom = /per_room|每[间房]|\/\s*[间房]/i;
    // Only the selected amount's own unit applies. A separate human-readable
    // per-person reference must never multiply an already supplied total again.
    if (selectedKey === "costPerPerson" || selectedKey === "pricePerPerson" || perPerson.test(basis) || perPerson.test(annotatedAmount)) amount *= snapshot.travelerCount ?? 1;
    else if (selectedKey === "costPerRoom" || perRoom.test(basis) || perRoom.test(annotatedAmount)) amount *= Math.ceil((snapshot.travelerCount ?? 1) / 2);
  }
  return amount;
}

function modelDurationMinutes(event: Record<string, unknown>) {
  const explicit = modelField(event, "durationMinutes", "时长分钟");
  if (explicit !== undefined) return modelNumber(explicit);
  const value = event.duration;
  if (typeof value !== "string") return modelNumber(value);
  const hours = value.match(/(\d+(?:\.\d+)?)\s*(?:小时|hours?|hrs?|h)(?![a-z])/i);
  const minutes = value.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分|minutes?|mins?|m)(?![a-z])/i);
  if (hours || minutes) return Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
  return modelNumber(value);
}

/** Model-only coercion preserves the supplied itinerary; it never creates local-catalog replacements. */
export function normalizeAIPlanDraft(value: unknown, snapshot?: RequestSnapshot) {
  let root = asModelRecord(value);
  for (const key of ["plan", "data", "result", "itinerary"]) {
    if (!root.events && !root.days && root[key] && !Array.isArray(root[key]) && typeof root[key] === "object") root = asModelRecord(root[key]);
  }
  const list = Array.isArray(value) ? value : modelField(root, "events", "days", "itinerary", "schedule", "plan", "data", "行程", "日程");
  const rawEvents: Record<string, unknown>[] = [];
  for (const [index, item] of (Array.isArray(list) ? list : []).entries()) {
    const day = asModelRecord(item);
    const nested = modelField(day, "events", "activities", "nodes", "items", "schedule", "行程", "安排");
    if (Array.isArray(nested)) {
      for (const entry of nested) {
        const record = asModelRecord(entry);
        rawEvents.push({
          ...record,
          dayNumber: modelField(record, "dayNumber", "day", "第几天") ?? modelField(day, "dayNumber", "day", "第几天") ?? index + 1,
          date: modelField(record, "date", "日期") ?? modelField(day, "date", "日期"),
        });
      }
    } else rawEvents.push(day);
  }
  const confirmedDates = snapshot ? tripDates(snapshot) : [];
  const suppliedDates = [...new Set(rawEvents.map((event) => modelDate(modelField(event, "date", "日期"))).filter((date): date is string => Boolean(date)))].sort();
  const events = rawEvents.map((event, index) => {
    const date = modelDate(modelField(event, "date", "日期"));
    const dayNumber = modelNumber(modelField(event, "dayNumber", "day", "dayIndex", "第几天")) ?? (date ? Math.max(0, (confirmedDates.length ? confirmedDates : suppliedDates).indexOf(date)) + 1 : 1);
    const timeRange = modelText(modelField(event, "time", "timeRange", "时间"))?.split(/\s*(?:—|–|－|-|~|～|至|到|→)\s*/);
    const startTime = normalizeTime(modelField(event, "startTime", "start", "beginTime", "开始时间") ?? timeRange?.[0]);
    let endTime = normalizeTime(modelField(event, "endTime", "end", "finishTime", "结束时间") ?? timeRange?.[1]);
    const explicitSeconds = modelNumber(event.suggestedDurationSeconds ?? event.durationSeconds);
    const minutes = modelDurationMinutes(event);
    if (!endTime && startTime && (explicitSeconds ?? minutes) !== null) {
      const [hour, minute] = startTime.split(":").map(Number);
      const endMinute = (hour * 60 + minute + Math.max(1, Math.round((explicitSeconds ?? (minutes ?? 60) * 60) / 60))) % 1440;
      endTime = `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
    }
    const location = asModelRecord(event.location);
    let title = modelText(modelField(event, "title", "name", "activityName", "标题", "名称"));
    const locationName = modelText(modelField(event, "locationName", "placeName", "place", "地点", "位置") ?? location.name ?? location.address ?? (typeof event.location === "string" ? event.location : null)) ?? title;
    const titleType = normalizeNodeType(title);
    const categoryType = normalizeNodeType(modelField(event, "type", "category", "eventType", "类别", "类型"));
    const type = categoryType === "local_transport" && (titleType === "departure_transport" || titleType === "return_transport")
      ? titleType : categoryType ?? titleType ?? "activity";
    const details = ["note", "notes", "description", "details", "说明", "攻略"].map((key) => modelText(event[key]));
    const detailFields: [string, string[]][] = [
      ["交通", ["transportDetails", "transport", "交通说明", "交通"]],
      ["游览动线", ["route", "visitRoute", "游览路线", "路线"]],
      ["预约与门票", ["booking", "reservation", "ticketInfo", "预约", "门票"]],
      ["餐饮", ["food", "dishes", "cuisine", "mealDetails", "特色菜", "餐饮"]],
      ["住宿", ["accommodationDetails", "lodging", "hotelAdvice", "住宿建议"]],
      ["随身与提醒", ["tips", "packing", "reminders", "注意事项", "必备物品"]],
    ];
    for (const [label, fields] of detailFields) {
      const text = [...new Set(fields.map((key) => modelText(event[key])).filter(Boolean))].join("；");
      if (text) details.push(`${label}：${text}`);
    }
    if (!title) title = locationName;
    if (type === "meal" && title && /^(?:到达后)?(?:早饭|午饭|晚饭|早餐|午餐|晚餐|用餐|餐饮)$/.test(title)) {
      const dish = modelText(modelField(event, "food", "dishes", "cuisine", "特色菜"));
      const detail = [dish, locationName && locationName !== title ? locationName : null].filter(Boolean).join(" · ");
      if (detail) title = `${title} · ${detail}`;
    }
    let duration = explicitSeconds;
    if (duration === null && startTime && endTime) {
      const [startHour, startMinute] = startTime.split(":").map(Number);
      const [endHour, endMinute] = endTime.split(":").map(Number);
      duration = ((endHour * 60 + endMinute - startHour * 60 - startMinute + 1440) % 1440) * 60;
    }
    const costDraftCents = modelEventCost(event, type, snapshot);
    const costStatus = event.costStatus === "user_confirmed" ? "pending_confirmation" : event.costStatus === "pending_confirmation" ? "pending_confirmation" : costDraftCents === null ? "pending_confirmation" : "estimated";
    return {
      ...event,
      id: modelText(event.id) ?? `ai-event-${index + 1}`,
      dayNumber,
      date: date ?? confirmedDates[dayNumber - 1] ?? modelDate(modelField(root, "startDate", "date")),
      endDate: modelDate(event.endDate),
      startTime, endTime, type,
      title: title === null ? null : normalizeGeneratedChineseText(title),
      locationName: locationName === null ? null : normalizeGeneratedChineseText(locationName),
      suggestedDurationSeconds: duration ?? (minutes !== null ? Math.round(minutes * 60) : 3600),
      costDraftCents, costStatus,
      note: normalizeGeneratedChineseText([...new Set(details.filter((text): text is string => Boolean(text)))].join("\n")) || null,
      ...modelCoordinates(event),
    };
  });
  const pending = modelField(root, "pendingItems", "pending", "reminders", "待办事项", "待确认事项");
  const pendingItems = (Array.isArray(pending) ? pending : []).map((item, index) => {
    const record = asModelRecord(item);
    const category = planPendingItemSchema.shape.category.safeParse(record.category);
    const title = modelText(record.title ?? record.name ?? (typeof item === "string" ? item : null));
    const deadline = planDate.safeParse(modelDate(record.requiredBefore));
    return {
      id: modelText(record.id)?.slice(0, 80) ?? `ai-pending-${index + 1}`,
      category: category.success ? category.data : "other",
      title: normalizeGeneratedChineseText(title ?? "出发前核对当地安排").slice(0, 160),
      reason: normalizeGeneratedChineseText(modelText(record.reason ?? record.note ?? record.description) ?? title ?? "出发前查看官方最新公告。").slice(0, 240),
      requiredBefore: deadline.success ? deadline.data : null,
    };
  });
  return { events, pendingItems };
}

function isModelPlanShape(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.some((item) => {
      const record = asModelRecord(item);
      return modelField(record, "events", "activities", "nodes", "startTime", "time", "date", "title", "name", "day", "dayNumber", "标题", "名称", "行程") !== undefined;
    });
  }
  const record = asModelRecord(value);
  if (["events", "days", "itinerary", "schedule", "行程", "日程"].some((key) => Array.isArray(record[key]))) return true;
  return ["plan", "data", "result", "itinerary"].some((key) => record[key] && typeof record[key] === "object" && isModelPlanShape(record[key]));
}

export function parseAIPlanOutput(raw: string, snapshot?: RequestSnapshot): AIPlanOutput {
  return aiPlanOutputSchema.parse(normalizeAIPlanDraft(parseModelJson(raw, isModelPlanShape), snapshot));
}
