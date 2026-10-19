import { z } from "zod";
import { asModelRecord, normalizeMoneyCents, parseModelJson } from "./ai-normalizer";

export const REQUEST_FIELD_KEYS = [
  "destination",
  "startDate",
  "endDate",
  "travelerCount",
  "budgetAmountCents",
  "budgetScope",
  "pace",
  "interests",
  "accommodation",
  "constraints",
] as const;

export type RequestFieldKey = (typeof REQUEST_FIELD_KEYS)[number];

export const requestFieldSourceSchema = z.enum([
  "unspecified",
  "ai_extracted",
  "program_derived",
  "default_assumption",
  "user_confirmed",
]);

export type RequestFieldSource = z.infer<typeof requestFieldSourceSchema>;

export const requestQuestionFieldSchema = z.enum([
  "destination",
  "startDate",
  "endDate",
  "travelerCount",
  "budgetAmountCents",
  "budgetScope",
  "pace",
  "accommodation",
]);

export type RequestQuestionField = z.infer<typeof requestQuestionFieldSchema>;

const nullableText = (maxLength: number) =>
  z
    .string()
    .max(maxLength, `最长 ${maxLength} 字。`)
    .nullable()
    .transform((value) => (value === null ? null : value.trim()));

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须使用 YYYY-MM-DD。")
  .nullable();

export function isValidRequestDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const newDateString = dateString.refine((value) => value === null || isValidRequestDate(value), "日期不是有效的日历日期。");

const boundedStringList = (maxLength: number, itemMaxLength: number) =>
  z
    .array(z.string().trim().min(1).max(itemMaxLength))
    .max(maxLength)
    .transform((items) => [...new Set(items)].filter(Boolean));

export const requestSnapshotSchema = z.object({
  destination: nullableText(120),
  startDate: dateString,
  endDate: dateString,
  travelerCount: z.number().int().min(1).max(20).nullable(),
  budgetAmountCents: z
    .number()
    .int()
    .min(0)
    .max(2_000_000_000)
    .nullable(),
  budgetScope: z.enum(["total", "per_person"]).nullable(),
  pace: z.enum(["relaxed", "balanced", "packed"]).nullable(),
  interests: boundedStringList(12, 40),
  accommodation: nullableText(160),
  constraints: boundedStringList(12, 120),
  fieldSources: z.record(
    z.enum(REQUEST_FIELD_KEYS),
    requestFieldSourceSchema,
  ),
});

export type RequestSnapshot = z.infer<typeof requestSnapshotSchema>;

export const requestQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  field: requestQuestionFieldSchema,
  question: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(1).max(240),
  suggestedAnswer: z.string().trim().max(160).nullable().optional(),
});

export type RequestQuestion = z.infer<typeof requestQuestionSchema>;

export const defaultAssumptionSchema = z.object({
  field: z.enum(REQUEST_FIELD_KEYS),
  value: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(240),
});

export type DefaultAssumption = z.infer<typeof defaultAssumptionSchema>;

export const aiRequirementOutputSchema = z.object({
  // Keep the persisted snapshot reader compatible with older records; new AI
  // output and all writes have the stronger calendar validation.
  request: requestSnapshotSchema.extend({ startDate: newDateString, endDate: newDateString }),
  openQuestions: z.array(requestQuestionSchema).max(3).default([]),
  defaultAssumptions: z.array(defaultAssumptionSchema).max(8).default([]),
});

export type AIRequirementOutput = z.infer<typeof aiRequirementOutputSchema>;

export function emptyRequestSnapshot(): RequestSnapshot {
  return {
    destination: null,
    startDate: null,
    endDate: null,
    travelerCount: null,
    budgetAmountCents: null,
    budgetScope: null,
    pace: null,
    interests: [],
    accommodation: null,
    constraints: [],
    fieldSources: Object.fromEntries(
      REQUEST_FIELD_KEYS.map((key) => [key, "unspecified"]),
    ) as Record<RequestFieldKey, RequestFieldSource>,
  };
}

function sourceForField(
  snapshot: RequestSnapshot,
  field: RequestFieldKey,
): RequestFieldSource {
  return snapshot.fieldSources[field] ?? "unspecified";
}

export function normalizeRequestSnapshot(
  input: RequestSnapshot,
): RequestSnapshot {
  const snapshot: RequestSnapshot = {
    ...emptyRequestSnapshot(),
    ...input,
    fieldSources: {
      ...Object.fromEntries(
        REQUEST_FIELD_KEYS.map((key) => [key, "unspecified"]),
      ),
      ...input.fieldSources,
    } as Record<RequestFieldKey, RequestFieldSource>,
  };

  const assumptions: DefaultAssumption[] = [];
  if (snapshot.travelerCount === null) {
    snapshot.travelerCount = 1;
    snapshot.fieldSources.travelerCount = "default_assumption";
    assumptions.push({
      field: "travelerCount",
      value: "1 人",
      reason: "原话没有说明人数，先按 1 人整理，可修改后保存。",
    });
  }
  if (snapshot.budgetAmountCents !== null && snapshot.budgetScope === null) {
    snapshot.budgetScope = "total";
    snapshot.fieldSources.budgetScope = "default_assumption";
    assumptions.push({
      field: "budgetScope",
      value: "全程总预算",
      reason: "原话没有说明预算口径，先按全程总预算显示，可修改后保存。",
    });
  }
  if (snapshot.pace === null) {
    snapshot.pace = "balanced";
    snapshot.fieldSources.pace = "default_assumption";
    assumptions.push({
      field: "pace",
      value: "均衡",
      reason: "原话没有说明节奏，先按每天均衡安排，可修改后保存。",
    });
  }
  if (snapshot.interests.length > 0 && sourceForField(snapshot, "interests") === "unspecified") {
    snapshot.fieldSources.interests = "ai_extracted";
  }
  if (snapshot.constraints.length > 0 && sourceForField(snapshot, "constraints") === "unspecified") {
    snapshot.fieldSources.constraints = "ai_extracted";
  }
  if (snapshot.destination && sourceForField(snapshot, "destination") === "unspecified") {
    snapshot.fieldSources.destination = "ai_extracted";
  }
  if (snapshot.accommodation && sourceForField(snapshot, "accommodation") === "unspecified") {
    snapshot.fieldSources.accommodation = "ai_extracted";
  }

  return snapshot;
}

export function requestToday(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}

function addDateDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextWeekend(today: string) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDateDays(today, (6 - weekday + 7) % 7);
}

/** Resolve the month before the generic weekend branch (including December rollover). */
function requestedWeekendMonth(text: string, today: string) {
  const [year, month] = today.split("-").map(Number);
  const relative = text.match(/下下个?月|下个?月|本月|这个月/);
  if (relative) {
    const offset = relative[0].startsWith("下下") ? 2 : relative[0].startsWith("下") ? 1 : 0;
    return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
  }
  const explicit = text.match(/(?:(\d{4})年)?(1[0-2]|0?[1-9])月(?!\d)/);
  if (!explicit) return null;
  const targetMonth = Number(explicit[2]);
  const targetYear = explicit[1] ? Number(explicit[1]) : year + (targetMonth < month ? 1 : 0);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
}

function explicitDates(text: string, now: Date) {
  const today = requestToday(now);
  const dates: string[] = [];
  // A single pass prevents a full Chinese date being counted again as month/day.
  for (const match of text.matchAll(/(?<!\d)(?:(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日|(\d{4})-(\d{1,2})-(\d{1,2}))(?!\d)/g)) {
    const explicitYear = match[1] ?? match[4];
    const month = (match[2] ?? match[5]).padStart(2, "0");
    const day = (match[3] ?? match[6]).padStart(2, "0");
    const previous = dates.at(-1);
    let year = explicitYear ?? (previous ?? today).slice(0, 4);
    let value = `${year}-${month}-${day}`;
    if (!isValidRequestDate(value)) throw new Error(`原话中的日期“${match[0]}”不是有效的日历日期，请核对。`);
    if (!explicitYear && (previous ? month < previous.slice(5, 7) : value < today)) {
      year = String(Number(year) + 1).padStart(4, "0");
      value = `${year}-${month}-${day}`;
      if (!isValidRequestDate(value)) throw new Error(`原话中的日期“${match[0]}”不是有效的日历日期，请核对。`);
    }
    dates.push(value);
  }
  return dates;
}

export function explicitTripDays(text: string) {
  const chinese: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/[\d一二两三四五六七八九十]\s*(?:到|至|[-–—~～])\s*[\d一二两三四五六七八九十]\s*(?:天|日游)/.test(text)) return null;
  const counts = [...text.matchAll(/(?<![\d一二两三四五六七八九十])(\d{1,3}|[一二两三四五六七八九十])\s*(?:天|日游)/g)]
    .filter((match) => !/第\s*$/.test(text.slice(0, match.index)))
    .map((match) => chinese[match[1]] ?? Number(match[1]));
  const distinct = [...new Set(counts)];
  return distinct.length === 1 && distinct[0] >= 1 ? distinct[0] : null;
}

export function resolveRelativeDates(
  originalRequest: string,
  snapshot: RequestSnapshot,
  now: Date,
): RequestSnapshot {
  const text = originalRequest;
  const dates = explicitDates(text, now);
  const withDates = (startDate: string, endDate: string | null): RequestSnapshot => ({
    ...snapshot, startDate, endDate,
    fieldSources: { ...snapshot.fieldSources, startDate: "program_derived", endDate: endDate ? "program_derived" : "unspecified" },
  });
  if (dates.length >= 2) {
    return withDates(dates[0], dates[1]);
  }
  const days = explicitTripDays(text);
  const fromStart = (start: string) => withDates(start, days === null ? null : addDateDays(start, days - 1));
  if (dates.length === 1) return fromStart(dates[0]);
  const today = requestToday(now);
  if (/明天|明日/.test(text)) {
    return fromStart(addDateDays(today, 1));
  }
  if (/后天/.test(text)) {
    return fromStart(addDateDays(today, 2));
  }
  if (/周末/.test(text)) {
    const targetMonth = requestedWeekendMonth(text, today);
    // A complete weekend begins on Saturday, even if the month opens on Sunday.
    const anchor = targetMonth ? (targetMonth.slice(0, 7) === today.slice(0, 7) ? today : targetMonth) : today;
    const weekOffset = !targetMonth && /下下周末/.test(text) ? 14 : !targetMonth && /下周末/.test(text) ? 7 : 0;
    const start = addDateDays(nextWeekend(anchor), weekOffset);
    return withDates(start, addDateDays(start, (days ?? 2) - 1));
  }

  return snapshot;
}

function inclusiveDays(start: string, end: string) {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  return Math.round((endTime - startTime) / 86_400_000) + 1;
}

export function validateRequestSnapshot(
  snapshot: RequestSnapshot,
  now: Date,
  mode: "draft" | "confirmation",
): string[] {
  const errors: string[] = [];
  const today = requestToday(now);
  const startValid = snapshot.startDate !== null && isValidRequestDate(snapshot.startDate);
  const endValid = snapshot.endDate !== null && isValidRequestDate(snapshot.endDate);
  if (snapshot.startDate !== null && !startValid) errors.push("出发日期不是有效的日历日期。");
  if (snapshot.endDate !== null && !endValid) errors.push("返回日期不是有效的日历日期。");

  if (mode === "confirmation" && !snapshot.destination) {
    errors.push("请先确认目的地。");
  }
  if (mode === "confirmation" && (!snapshot.startDate || !snapshot.endDate)) {
    errors.push("请先确认具体出发和返回日期。");
  }
  if (startValid && snapshot.startDate! < today) errors.push("出发日期已经过去，请修改为未来日期。");
  if (startValid && endValid && snapshot.startDate && snapshot.endDate) {
    if (snapshot.startDate >= snapshot.endDate) {
      errors.push("返回日期必须晚于出发日期。");
    } else {
      const days = inclusiveDays(snapshot.startDate, snapshot.endDate);
      if (days < 2) {
        errors.push("本阶段仅支持 2 到 4 天的旅行，请调整日期。");
      }
      if (days > 4) {
        errors.push(`当前行程为 ${days} 天；本阶段仅支持 2 到 4 天，请缩短或修改日期。`);
      }
    }
  }

  if (snapshot.budgetAmountCents !== null && !snapshot.budgetScope) {
    errors.push("请确认预算口径：全程总预算或人均预算。");
  }
  if (snapshot.budgetAmountCents === null && snapshot.budgetScope) {
    errors.push("已选择预算口径，请填写预算金额。");
  }

  return errors;
}

export function requestDateQuestions(snapshot: RequestSnapshot): RequestQuestion[] {
  const questions: RequestQuestion[] = [];
  if (!snapshot.startDate) questions.push({ id: "confirm-start-date", field: "startDate", question: "计划哪天出发？",
    reason: "原话没有可确定的具体出发日期。", suggestedAnswer: null });
  if (!snapshot.endDate) questions.push({ id: "confirm-end-date", field: "endDate", question: "计划旅行几天，或哪天返回？",
    reason: "未明确旅行天数或返回日期，不能自行按两天安排。", suggestedAnswer: null });
  return questions;
}

export function requestSnapshotChanged(
  left: RequestSnapshot | null,
  right: RequestSnapshot | null,
) {
  return JSON.stringify(left ?? emptyRequestSnapshot()) !==
    JSON.stringify(right ?? emptyRequestSnapshot());
}

export function remainingQuestions(
  questions: RequestQuestion[],
  snapshot: RequestSnapshot,
) {
  const hasAnswer = (field: RequestQuestionField) => {
    switch (field) {
      case "destination":
        return Boolean(snapshot.destination);
      case "startDate":
        return Boolean(snapshot.startDate);
      case "endDate":
        return Boolean(snapshot.endDate);
      case "travelerCount":
        return snapshot.travelerCount !== null;
      case "budgetAmountCents":
        return snapshot.budgetAmountCents !== null;
      case "budgetScope":
        return snapshot.budgetScope !== null;
      case "pace":
        return snapshot.pace !== null;
      case "accommodation":
        return Boolean(snapshot.accommodation);
    }
  };

  return questions.filter((question) => !hasAnswer(question.field)).slice(0, 3);
}

function modelText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function modelStringList(value: unknown, maxLength: number, itemLength: number) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[、,，;；\n]/) : [];
  return [...new Set(items.map(modelText).filter((item): item is string => Boolean(item)))].slice(0, maxLength).map((item) => item.slice(0, itemLength));
}

function modelDate(value: unknown) {
  const text = modelText(value);
  if (!text) return null;
  const parts = text.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
  return parts ? `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}` : text;
}

function modelTravelerCount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 1 ? value : null;
  if (typeof value !== "string") return null;
  const count = value.match(/-?\d+/)?.[0];
  if (count) return Number(count) >= 1 ? Number(count) : null;
  const chinese: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return chinese[value.trim().charAt(0)] ?? null;
}

export function parseAIRequirementOutput(raw: string) {
  const parsed = parseModelJson(raw, (value) => {
    const object = asModelRecord(Array.isArray(value) && value.length === 1 ? value[0] : value);
    const request = asModelRecord(object.request ?? object.requirements ?? object.tripRequest ?? object);
    return Object.keys(request).some((key) => [...REQUEST_FIELD_KEYS, "city", "destinationName", "budget", "travelers", "start_date"].includes(key));
  });
  const payload = asModelRecord(Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed);
  const request = asModelRecord(payload.request ?? payload.requirements ?? payload.tripRequest ?? payload);
  if (!Object.keys(request).some((key) => [...REQUEST_FIELD_KEYS, "city", "destinationName", "budget", "travelers", "start_date"].includes(key))) {
    throw new Error("模型未返回可识别的旅行需求字段，请重新理解需求。");
  }
  const rawBudget = request.budgetAmountCents ?? request.budgetCents ?? request.budgetAmount ?? request.budgetYuan ?? request.budget;
  const budgetInCents = request.budgetAmountCents !== null && request.budgetAmountCents !== undefined || request.budgetCents !== null && request.budgetCents !== undefined;
  const budgetObject = asModelRecord(request.budget);
  const scope = String(request.budgetScope ?? request.budget_scope ?? budgetObject.scope ?? "").toLowerCase();
  const pace = String(request.pace ?? request.travelPace ?? "").toLowerCase();
  const snapshot = {
    destination: modelText(request.destination ?? request.destinationName ?? request.city),
    startDate: modelDate(request.startDate ?? request.start_date ?? request.departureDate),
    endDate: modelDate(request.endDate ?? request.end_date ?? request.returnDate),
    travelerCount: modelTravelerCount(request.travelerCount ?? request.travelers ?? request.people ?? request.peopleCount),
    budgetAmountCents: normalizeMoneyCents(rawBudget, budgetInCents ? "cents" : "yuan"),
    budgetScope: /^(total|全程|总预算|全程总预算|总额|合计)$/.test(scope) ? "total" : /^(per_person|per person|人均|每人)$/.test(scope) ? "per_person" : null,
    pace: /^(relaxed|轻松|休闲|慢游)$/.test(pace) ? "relaxed" : /^(packed|紧凑|充实|特种兵)$/.test(pace) ? "packed" : /^(balanced|均衡|适中)$/.test(pace) ? "balanced" : null,
    interests: modelStringList(request.interests, 12, 40),
    accommodation: modelText(request.accommodation ?? request.hotelPreference),
    constraints: modelStringList(request.constraints, 12, 120),
  };
  const sources = asModelRecord(request.fieldSources);
  const fieldSources = Object.fromEntries(REQUEST_FIELD_KEYS.map((key) => {
    const source = requestFieldSourceSchema.safeParse(sources[key]);
    const present = Array.isArray(snapshot[key]) ? snapshot[key].length > 0 : snapshot[key] !== null;
    return [key, source.success ? source.data : present ? "ai_extracted" : "unspecified"];
  }));
  const questions = Array.isArray(payload.openQuestions) ? payload.openQuestions : [];
  const openQuestions = questions.map((item, index) => {
    const question = asModelRecord(item);
    return requestQuestionSchema.safeParse({ ...question, id: modelText(question.id) ?? `ai-question-${index + 1}`,
      reason: modelText(question.reason) ?? "需要补充此项旅行偏好。", suggestedAnswer: modelText(question.suggestedAnswer) });
  }).flatMap((item) => item.success ? [item.data] : []).slice(0, 3);
  const assumptions = Array.isArray(payload.defaultAssumptions) ? payload.defaultAssumptions : [];
  const defaultAssumptions = assumptions.map((item) => {
    const assumption = asModelRecord(item);
    return defaultAssumptionSchema.safeParse({ ...assumption, reason: modelText(assumption.reason) ?? "根据当前需求暂作此项估算，可修改。" });
  }).flatMap((item) => item.success ? [item.data] : []).slice(0, 8);
  return aiRequirementOutputSchema.parse({ request: { ...snapshot, fieldSources }, openQuestions, defaultAssumptions });
}
