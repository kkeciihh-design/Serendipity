import { Prisma, PrismaClient, type EvidenceFact } from "@prisma/client";
import { z } from "zod";
import { getDatabaseUrl } from "./data-directory";
import {
  effectiveEvidenceStatus,
  evidenceFieldSchema,
  normalizeOfficialHost,
  type EvidenceFactClient,
  type EvidenceField,
} from "./evidence";
import {
  collectEvidence,
} from "./evidence-source";
import { planEventSchema } from "./plan";
import { storedSearchConfiguration } from "./settings";

export class EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

export class EvidenceConflictError extends Error {
  constructor(message = "计划版本已经变化，来源核验结果不能提交。") {
    super(message);
    this.name = "EvidenceConflictError";
  }
}

export class EvidenceSourceError extends Error {
  constructor(message = "来源读取失败，没有产生假核验记录。") {
    super(message);
    this.name = "EvidenceSourceError";
  }
}

const verifyInputSchema = z.object({
  tripId: z.string().trim().min(1),
  expectedPlanVersion: z.number().int().min(1),
  eventId: z.string().trim().min(1).max(80),
  field: evidenceFieldSchema,
  query: z.string().trim().min(3).max(180),
  officialHost: z.string().trim().min(3).max(160),
});

export type VerifyEvidenceInput = z.infer<typeof verifyInputSchema>;

type PrismaGlobal = typeof globalThis & {
  serendipityEvidencePrisma?: PrismaClient;
};

const prismaGlobal = globalThis as PrismaGlobal;
const prisma =
  prismaGlobal.serendipityEvidencePrisma ??
  new PrismaClient({
    datasources: { db: { url: getDatabaseUrl() } },
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.serendipityEvidencePrisma = prisma;
}

function serializeFact(row: EvidenceFact, now = new Date()): EvidenceFactClient {
  const fact: EvidenceFactClient = {
    id: row.id,
    planVersionId: row.planVersionId,
    targetType: "event",
    targetId: row.targetId,
    field: row.field as EvidenceField,
    status: z.enum(["verified", "unverified", "conflict"]).parse(row.status),
    effectiveStatus: "pending",
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    sourcePublisher: row.sourcePublisher,
    sourcePublishedAt: row.sourcePublishedAt?.toISOString() ?? null,
    sourceDateStatus: row.sourceDateStatus,
    searchProvider: row.searchProvider,
    searchQuery: row.searchQuery,
    retrievedAt: row.retrievedAt.toISOString(),
    applicableFrom: row.applicableFrom?.toISOString() ?? null,
    applicableUntil: row.applicableUntil?.toISOString() ?? null,
    lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
    lastRefreshStatus: row.lastRefreshStatus,
    lastRefreshError: row.lastRefreshError,
    contentQuote: row.contentQuote,
    conflictReason: row.conflictReason,
  };
  fact.effectiveStatus = effectiveEvidenceStatus(fact, now);
  return fact;
}

export async function listEvidenceFacts(tripId: string) {
  const rows = await prisma.evidenceFact.findMany({
    where: { tripId },
    orderBy: [
      { planVersionId: "asc" },
      { targetType: "asc" },
      { targetId: "asc" },
      { field: "asc" },
    ],
  });
  return rows.map((row) => serializeFact(row));
}

function parseEventDate(eventDate: string) {
  const [year, month, day] = eventDate.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export async function verifyEvidenceFact(
  input: unknown,
  options: { collectEvidence?: typeof collectEvidence } = {},
) {
  const parsed = verifyInputSchema.parse(input);
  const officialHost = normalizeOfficialHost(parsed.officialHost);

  const planRow = await prisma.planVersion.findUnique({
    where: {
      tripId_versionNumber: {
        tripId: parsed.tripId,
        versionNumber: parsed.expectedPlanVersion,
      },
    },
    include: { trip: { select: { currentPlanVersionId: true } } },
  });
  if (!planRow) {
    throw new EvidenceConflictError("没有找到这个计划版本。");
  }
  if (planRow.trip.currentPlanVersionId !== planRow.id) {
    throw new EvidenceConflictError("历史版本只读，不能更新来源。");
  }

  const events = z.array(planEventSchema).safeParse(JSON.parse(planRow.events));
  if (!events.success) {
    throw new EvidenceValidationError("计划事件数据无法读取。");
  }
  const event = events.data.find((item) => item.id === parsed.eventId);
  if (!event) {
    throw new EvidenceValidationError("没有找到要核验的日程。");
  }

  const search = await storedSearchConfiguration();
  let result;
  try {
    result = await (options.collectEvidence ?? collectEvidence)({
      field: parsed.field,
      query: parsed.query,
      officialHost,
      eventDate: event.date,
      language: search.language,
    });
  } catch (error) {
    const existing = await prisma.evidenceFact.findUnique({
      where: {
        planVersionId_targetType_targetId_field: {
          planVersionId: planRow.id,
          targetType: "event",
          targetId: parsed.eventId,
          field: parsed.field,
        },
      },
    });
    if (existing) {
      const updated = await prisma.evidenceFact.update({
        where: { id: existing.id },
        data: {
          lastRefreshAt: new Date(),
          lastRefreshStatus: "failed",
          lastRefreshError:
            error instanceof Error ? error.message : "来源读取失败。",
        },
      });
      return serializeFact(updated);
    }
    throw new EvidenceSourceError(
      error instanceof Error ? error.message : "来源读取失败，没有产生假核验记录。",
    );
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const currentRow = await transaction.planVersion.findUnique({
        where: {
          tripId_versionNumber: {
            tripId: parsed.tripId,
            versionNumber: parsed.expectedPlanVersion,
          },
        },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (
        !currentRow ||
        currentRow.trip.currentPlanVersionId !== currentRow.id
      ) {
        throw new EvidenceConflictError();
      }
      const currentEvents = z
        .array(planEventSchema)
        .parse(JSON.parse(currentRow.events));
      if (!currentEvents.some((item) => item.id === parsed.eventId)) {
        throw new EvidenceConflictError("日程已经变化，本次核验结果不能提交。");
      }

      const existing = await transaction.evidenceFact.findUnique({
        where: {
          planVersionId_targetType_targetId_field: {
            planVersionId: currentRow.id,
            targetType: "event",
            targetId: parsed.eventId,
            field: parsed.field,
          },
        },
      });

      let status: "verified" | "unverified" | "conflict" = result.status;
      let conflictReason = result.conflictReason;
      if (
        existing?.status === "verified" &&
        result.status === "verified" &&
        existing.extractedValue &&
        result.extractedValue &&
        existing.extractedValue !== result.extractedValue
      ) {
        status = "conflict";
        conflictReason = `新读取内容与原核验结果不一致：原 ${existing.extractedValue}，新 ${result.extractedValue}。`;
      }

      const now = new Date();
      const applicableUntil = parseEventDate(event.date);
      applicableUntil.setDate(applicableUntil.getDate() - 1);

      const saved = await transaction.evidenceFact.upsert({
        where: {
          planVersionId_targetType_targetId_field: {
            planVersionId: currentRow.id,
            targetType: "event",
            targetId: parsed.eventId,
            field: parsed.field,
          },
        },
        create: {
          tripId: parsed.tripId,
          planVersionId: currentRow.id,
          targetType: "event",
          targetId: parsed.eventId,
          field: parsed.field,
          status,
          sourceTitle: result.sourceTitle,
          sourceUrl: result.sourceUrl,
          sourcePublisher: result.sourcePublisher,
          sourcePublishedAt: result.sourcePublishedAt,
          sourceDateStatus: result.sourceDateStatus,
          extractedValue: result.extractedValue,
          searchProvider: search.provider,
          searchQuery: parsed.query,
          retrievedAt: now,
          applicableFrom: now,
          applicableUntil,
          lastRefreshAt: now,
          lastRefreshStatus: "success",
          lastRefreshError: null,
          contentQuote: result.contentQuote,
          conflictReason,
        },
        update: {
          status,
          sourceTitle: result.sourceTitle,
          sourceUrl: result.sourceUrl,
          sourcePublisher: result.sourcePublisher,
          sourcePublishedAt: result.sourcePublishedAt,
          sourceDateStatus: result.sourceDateStatus,
          extractedValue: result.extractedValue,
          searchProvider: search.provider,
          searchQuery: parsed.query,
          retrievedAt: now,
          applicableFrom: now,
          applicableUntil,
          lastRefreshAt: now,
          lastRefreshStatus: "success",
          lastRefreshError: null,
          contentQuote: result.contentQuote,
          conflictReason,
        },
      });
      return serializeFact(saved);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new EvidenceConflictError();
    }
    throw error;
  }
}

export async function closeEvidenceStore() {
  await prisma.$disconnect();
}
