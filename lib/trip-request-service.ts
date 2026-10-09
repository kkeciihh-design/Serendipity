import { Prisma, PrismaClient } from "@prisma/client";
import { z, type ZodType } from "zod";
import { getDatabaseUrl } from "./data-directory";
import {
  DEFAULT_BASE_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "./prompt-defaults";
import {
  REQUEST_FIELD_KEYS,
  normalizeRequestSnapshot,
  remainingQuestions,
  requestSnapshotChanged,
  requestSnapshotSchema,
  validateRequestSnapshot,
  type DefaultAssumption,
  type RequestQuestion,
  type RequestSnapshot,
} from "./trip-request";
import { markCurrentPlanStale } from "./plan-service";

const MAX_REQUEST_LENGTH = 3000;
const countCodePoints = (text: string) => Array.from(text).length;

const originalRequestText = z
  .string()
  .refine((text) => text.trim().length > 0, {
    message: "旅行想法不能为空。",
  })
  .refine((text) => countCodePoints(text) <= MAX_REQUEST_LENGTH, {
    message: `旅行想法最长 ${MAX_REQUEST_LENGTH} 字。`,
  });

export const saveRequestDraftSchema = z.object({
  expectedRequestRevision: z.number().int().min(1),
  originalRequest: originalRequestText.optional(),
  request: requestSnapshotSchema.optional(),
});

export const confirmRequestSchema = z.object({
  expectedRequestRevision: z.number().int().min(1),
});

export type TripRequestRecord = {
  id: string;
  tripId: string;
  originalRequest: string;
  requestRevision: number;
  extractedRequest: RequestSnapshot | null;
  fieldSources: Record<string, string> | null;
  defaultAssumptions: DefaultAssumption[] | null;
  pendingQuestions: RequestQuestion[] | null;
  confirmedRequest: RequestSnapshot | null;
  confirmedRevision: number | null;
  confirmedAt: string | null;
  updatedAt: string;
};

type PrismaGlobal = typeof globalThis & {
  serendipityTripRequestPrisma?: PrismaClient;
};

const prismaGlobal = globalThis as PrismaGlobal;
const prisma =
  prismaGlobal.serendipityTripRequestPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.serendipityTripRequestPrisma = prisma;
}

export class TripRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TripRequestValidationError";
  }
}

export class TripRequestConflictError extends Error {
  constructor(message = "需求已经发生变化，请刷新后查看最新修订再保存。") {
    super(message);
    this.name = "TripRequestConflictError";
  }
}

function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new TripRequestValidationError(
      result.error.issues[0]?.message ?? "需求输入不合法。",
    );
  }
  return result.data;
}

function parseSnapshotJson(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = requestSnapshotSchema.parse(JSON.parse(value));
    return normalizeRequestSnapshot(parsed);
  } catch {
    throw new TripRequestValidationError("已保存的需求摘要无法读取，请重新理解需求。");
  }
}

function parseJsonList<T>(
  value: string | null | undefined,
  validate: (item: unknown) => T[],
): T[] | null {
  if (!value) {
    return null;
  }
  try {
    return validate(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseQuestions(value: string | null | undefined) {
  return parseJsonList<RequestQuestion>(value, (items) => {
    if (!Array.isArray(items)) {
      throw new Error("invalid");
    }
    return items.map((item) => {
      const question = item as RequestQuestion;
      if (
        typeof question.id !== "string" ||
        typeof question.field !== "string" ||
        typeof question.question !== "string" ||
        typeof question.reason !== "string"
      ) {
        throw new Error("invalid");
      }
      return question;
    });
  });
}

function parseAssumptions(value: string | null | undefined) {
  return parseJsonList<DefaultAssumption>(value, (items) => {
    if (!Array.isArray(items)) {
      throw new Error("invalid");
    }
    return items.map((item) => {
      const assumption = item as DefaultAssumption;
      if (
        typeof assumption.field !== "string" ||
        typeof assumption.value !== "string" ||
        typeof assumption.reason !== "string"
      ) {
        throw new Error("invalid");
      }
      return assumption;
    });
  });
}

function serializeSnapshot(snapshot: RequestSnapshot | null) {
  return snapshot ? JSON.stringify(snapshot) : null;
}

function generatedDefaultAssumptions(snapshot: RequestSnapshot) {
  const assumptions: DefaultAssumption[] = [];
  if (snapshot.fieldSources.travelerCount === "default_assumption") {
    assumptions.push({
      field: "travelerCount",
      value: "1 人",
      reason: "原话没有说明人数，先按 1 人整理，可修改后保存。",
    });
  }
  if (snapshot.fieldSources.budgetScope === "default_assumption") {
    assumptions.push({
      field: "budgetScope",
      value: "全程总预算",
      reason: "原话没有说明预算口径，先按全程总预算显示，可修改后保存。",
    });
  }
  if (snapshot.fieldSources.pace === "default_assumption") {
    assumptions.push({
      field: "pace",
      value: "均衡",
      reason: "原话没有说明节奏，先按每天均衡安排，可修改后保存。",
    });
  }
  return assumptions;
}

function serializeRecord(record: {
  id: string;
  tripId: string;
  originalRequest: string;
  requestRevision: number;
  extractedRequest: string | null;
  fieldSources: string | null;
  defaultAssumptions: string | null;
  pendingQuestions: string | null;
  confirmedRequest: string | null;
  confirmedRevision: number | null;
  confirmedAt: Date | null;
  updatedAt: Date;
}): TripRequestRecord {
  const extracted = parseSnapshotJson(record.extractedRequest);
  const confirmed = parseSnapshotJson(record.confirmedRequest);

  return {
    id: record.id,
    tripId: record.tripId,
    originalRequest: record.originalRequest,
    requestRevision: record.requestRevision,
    extractedRequest: extracted,
    fieldSources: extracted
      ? (Object.fromEntries(
          REQUEST_FIELD_KEYS.map((key) => [key, extracted.fieldSources[key]]),
        ) as Record<string, string>)
      : null,
    defaultAssumptions: parseAssumptions(record.defaultAssumptions),
    pendingQuestions: parseQuestions(record.pendingQuestions),
    confirmedRequest: confirmed,
    confirmedRevision: record.confirmedRevision,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function getTripRequestRecord(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { request: true },
  });
  if (!trip?.request) {
    throw new TripRequestConflictError("没有找到这趟旅行的需求记录。");
  }

  return serializeRecord(trip.request);
}

async function loadRequest(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { request: true },
  });
  if (!trip) {
    throw new TripRequestConflictError("没有找到这趟旅行。");
  }
  if (!trip.request) {
    throw new TripRequestConflictError("没有找到这趟旅行的需求记录。");
  }
  return { trip, request: trip.request };
}

function ensureExpectedRevision(
  requestRevision: number,
  expectedRequestRevision: number,
) {
  if (requestRevision !== expectedRequestRevision) {
    throw new TripRequestConflictError();
  }
}

export async function saveRequestDraft(tripId: string, input: unknown) {
  const parsed = parseOrThrow(saveRequestDraftSchema, input);
  const { request } = await loadRequest(tripId);
  ensureExpectedRevision(request.requestRevision, parsed.expectedRequestRevision);

  const currentSnapshot = parseSnapshotJson(request.extractedRequest);
  const nextSnapshot = parsed.request
    ? normalizeRequestSnapshot(parsed.request)
    : currentSnapshot;
  const originalChanged =
    parsed.originalRequest !== undefined &&
    parsed.originalRequest !== request.originalRequest;
  const snapshotChanged = requestSnapshotChanged(nextSnapshot, currentSnapshot);

  if (!originalChanged && !snapshotChanged) {
    return serializeRecord(request);
  }
  if (!nextSnapshot && originalChanged) {
    // A new original request invalidates the previous extraction draft.
  } else if (!nextSnapshot) {
    throw new TripRequestValidationError("请先让 AI 理解需求，再保存摘要。");
  }

  const validationErrors = nextSnapshot
    ? validateRequestSnapshot(nextSnapshot, new Date(), "draft")
    : [];
  if (validationErrors.length > 0) {
    throw new TripRequestValidationError(validationErrors[0]);
  }

  const currentQuestions = parseQuestions(request.pendingQuestions) ?? [];
  const nextQuestions = nextSnapshot
    ? remainingQuestions(currentQuestions, nextSnapshot)
    : null;
  const currentAssumptions = parseAssumptions(request.defaultAssumptions) ?? [];
  const retainedAssumptions = nextSnapshot
    ? currentAssumptions.filter(
        (assumption) =>
          nextSnapshot.fieldSources[assumption.field] !== "user_confirmed",
      )
    : null;
  const generatedAssumptions = nextSnapshot
    ? generatedDefaultAssumptions(nextSnapshot).filter(
        (assumption) =>
          !retainedAssumptions?.some(
            (existing) => existing.field === assumption.field,
          ),
      )
    : [];
  const nextAssumptions = [
    ...(retainedAssumptions ?? []),
    ...generatedAssumptions,
  ];

  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.tripRequest.updateMany({
      where: {
        tripId,
        requestRevision: parsed.expectedRequestRevision,
      },
      data: {
        ...(originalChanged
          ? {
              originalRequest: parsed.originalRequest,
              extractedRequest: null,
              fieldSources: null,
              defaultAssumptions: null,
              pendingQuestions: null,
            }
          : {}),
        ...(snapshotChanged && nextSnapshot
          ? {
              extractedRequest: serializeSnapshot(nextSnapshot),
              fieldSources: JSON.stringify(nextSnapshot.fieldSources),
              defaultAssumptions: JSON.stringify(nextAssumptions ?? []),
              pendingQuestions: JSON.stringify(nextQuestions ?? []),
            }
          : {}),
        requestRevision: { increment: 1 },
        confirmedRequest: null,
        confirmedRevision: null,
        confirmedAt: null,
      },
    });
    if (result.count === 0) {
      throw new TripRequestConflictError();
    }

    if (originalChanged && parsed.originalRequest) {
      await transaction.trip.update({
        where: { id: tripId },
        data: { originalRequest: parsed.originalRequest },
      });
    }
    await markCurrentPlanStale(transaction, tripId);

    return transaction.tripRequest.findUnique({
      where: { tripId },
    });
  });

  if (!updated) {
    throw new TripRequestConflictError();
  }
  return serializeRecord(updated);
}

export async function saveExtractionResult(input: {
  tripId: string;
  expectedRequestRevision: number;
  expectedOriginalRequest: string;
  snapshot: RequestSnapshot;
  questions: RequestQuestion[];
  assumptions: DefaultAssumption[];
}) {
  const snapshot = normalizeRequestSnapshot(input.snapshot);
  const validationErrors = validateRequestSnapshot(snapshot, new Date(), "draft");
  if (validationErrors.length > 0) {
    throw new TripRequestValidationError(validationErrors[0]);
  }

  const questions = remainingQuestions(input.questions, snapshot).slice(0, 3);
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.tripRequest.updateMany({
      where: {
        tripId: input.tripId,
        requestRevision: input.expectedRequestRevision,
        originalRequest: input.expectedOriginalRequest,
      },
      data: {
        extractedRequest: serializeSnapshot(snapshot),
        fieldSources: JSON.stringify(snapshot.fieldSources),
        defaultAssumptions: JSON.stringify(input.assumptions),
        pendingQuestions: JSON.stringify(questions),
        requestRevision: { increment: 1 },
        confirmedRequest: null,
        confirmedRevision: null,
        confirmedAt: null,
      },
    });
    if (result.count === 0) {
      throw new TripRequestConflictError(
        "提取期间需求已修改，本次结果已失效，不会覆盖你的新输入。",
      );
    }

    await markCurrentPlanStale(transaction, input.tripId);
    return transaction.tripRequest.findUnique({
      where: { tripId: input.tripId },
    });
  });

  if (!updated) {
    throw new TripRequestConflictError();
  }
  return serializeRecord(updated);
}

export async function confirmRequest(tripId: string, input: unknown) {
  const parsed = parseOrThrow(confirmRequestSchema, input);
  const { request } = await loadRequest(tripId);
  if (request.requestRevision !== parsed.expectedRequestRevision) {
    throw new TripRequestConflictError(
      "需求已经修改，旧页面的确认请求不能确认新修订。",
    );
  }

  const snapshot = parseSnapshotJson(request.extractedRequest);
  if (!snapshot) {
    throw new TripRequestValidationError("请先保存可确认的需求摘要。");
  }

  const errors = validateRequestSnapshot(snapshot, new Date(), "confirmation");
  if (errors.length > 0) {
    throw new TripRequestValidationError(errors[0]);
  }

  const confirmedAt = new Date();
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.tripRequest.updateMany({
      where: {
        tripId,
        requestRevision: parsed.expectedRequestRevision,
      },
      data: {
        confirmedRequest: serializeSnapshot(snapshot),
        confirmedRevision: parsed.expectedRequestRevision,
        confirmedAt,
      },
    });
    if (result.count === 0) {
      throw new TripRequestConflictError(
        "需求已经修改，旧页面的确认请求不能确认新修订。",
      );
    }

    await transaction.trip.update({
      where: { id: tripId },
      data: { status: "requirement_confirmed" },
    });
    return transaction.tripRequest.findUnique({
      where: { tripId },
    });
  });

  if (!updated) {
    throw new TripRequestConflictError();
  }
  return serializeRecord(updated);
}

export async function closeTripRequestStore() {
  await prisma.$disconnect();
}

export function effectivePromptDefaults() {
  return {
    basePrompt: DEFAULT_BASE_PROMPT,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  };
}

export const TripRequestPrisma = Prisma;
