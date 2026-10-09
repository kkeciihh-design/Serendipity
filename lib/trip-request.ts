import { z } from "zod";

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
  request: requestSnapshotSchema,
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

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextWeekend(now: Date) {
  const date = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const daysUntilSaturday = (6 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysUntilSaturday);
  return date;
}

function explicitDates(text: string, now: Date) {
  const fullDates = [
    ...text.matchAll(
      /(?<year>\d{4})年(?<month>\d{1,2})月(?<day>\d{1,2})日/g,
    ),
  ].map((match) => {
    const groups = match.groups as Record<string, string>;
    return new Date(
      Number(groups.year),
      Number(groups.month) - 1,
      Number(groups.day),
    );
  });

  const monthDayDates = [
    ...text.matchAll(/(?<!\d)(?<month>\d{1,2})月(?<day>\d{1,2})日/g),
  ].map((match) => {
    const groups = match.groups as Record<string, string>;
    const month = Number(groups.month);
    const day = Number(groups.day);
    let candidate = new Date(now.getFullYear(), month - 1, day);
    if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      candidate = new Date(now.getFullYear() + 1, month - 1, day);
    }
    return candidate;
  });

  return [...fullDates, ...monthDayDates];
}

export function resolveRelativeDates(
  originalRequest: string,
  snapshot: RequestSnapshot,
  now: Date,
): RequestSnapshot {
  if (snapshot.startDate || snapshot.endDate) {
    return snapshot;
  }

  const text = originalRequest;
  const dates = explicitDates(text, now);
  if (dates.length >= 2) {
    const sorted = [...dates].sort((left, right) => left.getTime() - right.getTime());
    return {
      ...snapshot,
      startDate: formatDate(sorted[0]),
      endDate: formatDate(sorted[1]),
      fieldSources: {
        ...snapshot.fieldSources,
        startDate: "program_derived",
        endDate: "program_derived",
      },
    };
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/明天|明日/.test(text)) {
    const start = new Date(today);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      ...snapshot,
      startDate: formatDate(start),
      endDate: formatDate(end),
      fieldSources: {
        ...snapshot.fieldSources,
        startDate: "program_derived",
        endDate: "program_derived",
      },
    };
  }

  if (/后天/.test(text)) {
    const start = new Date(today);
    start.setDate(start.getDate() + 2);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      ...snapshot,
      startDate: formatDate(start),
      endDate: formatDate(end),
      fieldSources: {
        ...snapshot.fieldSources,
        startDate: "program_derived",
        endDate: "program_derived",
      },
    };
  }

  if (/周末/.test(text)) {
    const start = nextWeekend(today);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      ...snapshot,
      startDate: formatDate(start),
      endDate: formatDate(end),
      fieldSources: {
        ...snapshot.fieldSources,
        startDate: "program_derived",
        endDate: "program_derived",
      },
    };
  }

  return snapshot;
}

function inclusiveDays(start: string, end: string) {
  const startTime = parseLocalDate(start).getTime();
  const endTime = parseLocalDate(end).getTime();
  return Math.round((endTime - startTime) / 86_400_000) + 1;
}

export function validateRequestSnapshot(
  snapshot: RequestSnapshot,
  now: Date,
  mode: "draft" | "confirmation",
): string[] {
  const errors: string[] = [];
  const today = formatDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  );

  if (mode === "confirmation" && !snapshot.destination) {
    errors.push("请先确认目的地。");
  }
  if (mode === "confirmation" && (!snapshot.startDate || !snapshot.endDate)) {
    errors.push("请先确认具体出发和返回日期。");
  }
  if (snapshot.startDate && snapshot.endDate) {
    if (snapshot.startDate < today) {
      errors.push("出发日期已经过去，请修改为未来日期。");
    }
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
  } else if (snapshot.startDate || snapshot.endDate) {
    errors.push("请同时填写出发和返回日期。");
  }

  if (snapshot.budgetAmountCents !== null && !snapshot.budgetScope) {
    errors.push("请确认预算口径：全程总预算或人均预算。");
  }
  if (snapshot.budgetAmountCents === null && snapshot.budgetScope) {
    errors.push("已选择预算口径，请填写预算金额。");
  }

  return errors;
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

export function parseAIRequirementOutput(raw: string) {
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

  return aiRequirementOutputSchema.parse(payload);
}
