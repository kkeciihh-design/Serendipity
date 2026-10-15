import { Prisma, PrismaClient, type EvidenceFact } from "@prisma/client";
import { z } from "zod";
import { getDatabaseUrl } from "./data-directory";
import { derivePlanCosts, planCostItemSchema } from "./budget";
import {
  CURRENT_EVIDENCE_EVALUATION_VERSION,
  effectiveEvidenceStatus,
  evidenceFieldSchema,
  normalizeOfficialHost,
  isOfficialUrl,
  type EvidenceFactClient,
  type EvidenceField,
} from "./evidence";
import {
  collectEvidence,
  type EvidenceCandidate,
} from "./evidence-source";
import { evidenceTarget, evidenceTargetSignature, type EvidenceTarget } from "./evidence-evaluation";
import { validateExternalUrl } from "./source-http";
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
    evaluationVersion: row.evaluationVersion,
    effectiveStatus: "pending",
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    sourcePublisher: row.sourcePublisher,
    sourcePublishedAt: row.sourcePublishedAt?.toISOString() ?? null,
    sourceDateStatus: row.sourceDateStatus,
    extractedValue: row.extractedValue,
    searchProvider: row.searchProvider,
    searchQuery: row.searchQuery,
    retrievedAt: row.retrievedAt.toISOString(),
    applicableFrom: row.applicableFrom?.toISOString() ?? null,
    applicableUntil: row.applicableUntil?.toISOString() ?? null,
    lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
    lastRefreshStatus: row.lastRefreshStatus,
    lastRefreshError: row.lastRefreshError,
    contentQuote: row.contentQuote,
    conflictReason: row.field === "opening_hours" && row.status === "verified" &&
      row.evaluationVersion < CURRENT_EVIDENCE_EVALUATION_VERSION
      ? [row.conflictReason, "原有摘录不足以复核入场及离场限制，请重新读取完整来源。"].filter(Boolean).join(" ")
      : row.conflictReason,
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

function targetFromPlan(row: { events: string; costs: string }, eventId: string) {
  try {
    const events = z.array(planEventSchema).parse(JSON.parse(row.events));
    const event = events.find((item) => item.id === eventId);
    if (!event) throw new Error();
    const storedCosts = z.array(planCostItemSchema).parse(JSON.parse(row.costs));
    return evidenceTarget(event, storedCosts.length ? storedCosts : derivePlanCosts(events));
  } catch {
    throw new EvidenceValidationError("没有找到可读取的日程及对应费用。");
  }
}

function hasCompleteSupport(result: EvidenceCandidate, target: EvidenceTarget, officialHost: string) {
  try {
    const url = validateExternalUrl(result.sourceUrl);
    const start = new Date(`${target.event.date}T${target.event.startTime}:00+08:00`).getTime();
    const end = new Date(`${target.event.endDate ?? target.event.date}T${target.event.endTime}:00+08:00`).getTime();
    return result.readStatus === "read" && isOfficialUrl(url, officialHost) &&
      !!result.extractedValue.trim() && !!result.contentQuote.trim() &&
      result.sourceDateStatus === "applicable" &&
      result.applicableFrom instanceof Date && result.applicableUntil instanceof Date &&
      result.applicableFrom.getTime() <= start && result.applicableUntil.getTime() >= end;
  } catch { return false; }
}

export async function verifyEvidenceFact(
  input: unknown,
  options: { collectEvidence?: typeof collectEvidence } = {},
) {
  const parsed = verifyInputSchema.parse(input);
  let officialHost: string;
  try { officialHost = normalizeOfficialHost(parsed.officialHost); }
  catch { throw new EvidenceValidationError("官方域名格式不正确。"); }
  const search = await storedSearchConfiguration();
  try {
    // Commit the in-flight state before reading the network. New plan versions
    // can then inherit it conservatively, including the very first refresh.
    const capture = await prisma.$transaction(async (transaction) => {
      const row = await transaction.planVersion.findUnique({
        where: {
          tripId_versionNumber: {
            tripId: parsed.tripId,
            versionNumber: parsed.expectedPlanVersion,
          },
        },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row || row.trip.currentPlanVersionId !== row.id) {
        throw new EvidenceConflictError("历史版本只读，或计划版本已经变化，不能更新来源。");
      }
      const target = targetFromPlan(row, parsed.eventId);
      const key = { planVersionId: row.id, targetType: "event", targetId: parsed.eventId, field: parsed.field };
      const existing = await transaction.evidenceFact.findUnique({
        where: { planVersionId_targetType_targetId_field: key },
      });
      // Millisecond monotonic token also rejects an older refresh on this same
      // version/field when a newer request has already started or completed.
      const startedAt = new Date(Math.max(Date.now(), (existing?.lastRefreshAt?.getTime() ?? 0) + 1));
      const refresh = { lastRefreshAt: startedAt, lastRefreshStatus: "refreshing", lastRefreshError: null };
      const fact = await transaction.evidenceFact.upsert({
        where: { planVersionId_targetType_targetId_field: key },
        create: {
          ...key, tripId: parsed.tripId, status: "unverified", sourceTitle: "", sourceUrl: "",
          sourcePublisher: "", sourceDateStatus: "not_read", extractedValue: "", contentQuote: "",
          searchProvider: search.provider, searchQuery: parsed.query, retrievedAt: startedAt, ...refresh,
        },
        update: refresh,
      });
      return { planId: row.id, target, signature: evidenceTargetSignature(target, parsed.field), factId: fact.id, startedAt };
    });

    let result: EvidenceCandidate | null = null;
    let failure: string | null = null;
    try {
      result = await (options.collectEvidence ?? collectEvidence)({
        field: parsed.field, query: parsed.query, officialHost, eventDate: capture.target.event.date,
        target: capture.target, language: search.language,
      });
      if (result.readStatus === "failed") failure = result.conflictReason ?? "来源读取失败。";
    } catch (error) {
      failure = error instanceof Error ? error.message.slice(0, 500) : "来源读取失败。";
    }

    // Success and failure have exactly the same commit boundary. Never write
    // late results to a historical version, an edited target or a newer request.
    return await prisma.$transaction(async (transaction) => {
      const currentRow = await transaction.planVersion.findUnique({
        where: { id: capture.planId },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!currentRow || currentRow.tripId !== parsed.tripId ||
        currentRow.versionNumber !== parsed.expectedPlanVersion ||
        currentRow.trip.currentPlanVersionId !== capture.planId) throw new EvidenceConflictError();
      const currentTarget = targetFromPlan(currentRow, parsed.eventId);
      if (evidenceTargetSignature(currentTarget, parsed.field) !== capture.signature) {
        throw new EvidenceConflictError("日程或费用已经变化，本次来源结果不能提交。");
      }
      const existing = await transaction.evidenceFact.findUnique({ where: { id: capture.factId } });
      if (!existing || existing.planVersionId !== capture.planId || existing.targetId !== parsed.eventId ||
        existing.field !== parsed.field || existing.lastRefreshStatus !== "refreshing" ||
        existing.lastRefreshAt?.getTime() !== capture.startedAt.getTime()) {
        throw new EvidenceConflictError("来源已有更新的核验请求，本次旧结果不能提交。");
      }
      if (failure || !result) {
        return serializeFact(await transaction.evidenceFact.update({
          where: { id: existing.id },
          data: { lastRefreshStatus: "failed", lastRefreshError: failure ?? "来源读取失败。" },
        }));
      }

      let status: "verified" | "unverified" | "conflict" = result.status;
      let conflictReason = result.conflictReason;
      if (status === "verified" && !hasCompleteSupport(result, currentTarget, officialHost)) {
        status = "unverified";
        conflictReason = "读取结果缺少字段值、官方来源或本次日程适用日期，仍需确认。";
      }
      if (
        existing.status === "verified" &&
        status === "verified" &&
        existing.extractedValue &&
        result.extractedValue &&
        existing.extractedValue !== result.extractedValue
      ) {
        status = "conflict";
        conflictReason = `新读取内容与原核验结果不一致：原 ${existing.extractedValue}，新 ${result.extractedValue}。`;
      }
      const saved = await transaction.evidenceFact.update({
        where: { id: existing.id },
        data: {
          status,
          // Only the full source collection path can advance this marker.
          // Copying snapshots or rereading their quotes must preserve it.
          evaluationVersion: result.readStatus === "read" ? CURRENT_EVIDENCE_EVALUATION_VERSION : 0,
          sourceTitle: result.sourceTitle,
          sourceUrl: result.sourceUrl,
          sourcePublisher: result.sourcePublisher,
          sourcePublishedAt: result.sourcePublishedAt,
          sourceDateStatus: result.sourceDateStatus,
          extractedValue: result.extractedValue,
          searchProvider: search.provider,
          searchQuery: parsed.query,
          retrievedAt: new Date(),
          applicableFrom: result.applicableFrom,
          applicableUntil: result.applicableUntil,
          lastRefreshStatus: result.readStatus === "read" ? "success" : "not_read",
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
