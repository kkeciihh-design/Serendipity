import { randomUUID, createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "./data-directory";
import { serializePlan } from "./plan-service";
import { parseChecklistItems } from "./checklist";
import { checklistBasis, projectChecklist } from "./checklist-store";
import { parseExecution } from "./execution";
import { effectiveEvidenceStatus, evidenceFieldSchema } from "./evidence";
import { buildPlanRedlines } from "./redline-service";
import { ExportError, mobileExportOptionsSchema, mobileExportWriteSchema, type ExportSnapshot, type ExportFileSummary } from "./export-snapshot";
import { renderMobileHtml } from "./mobile-export";

const shared = globalThis as typeof globalThis & { serendipityExportPrisma?: PrismaClient };
const prisma = shared.serendipityExportPrisma ?? new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
if (process.env.NODE_ENV !== "production") shared.serendipityExportPrisma = prisma;

// One SQLite transaction captures every mutable input. Renderers must only use
// this detached snapshot; never fetch live requests, routes or progress later.
export async function captureExportSnapshot(tx: Prisma.TransactionClient, tripId: string, expectedPlanVersion: number): Promise<ExportSnapshot> {
  const trip = await tx.trip.findUnique({ where: { id: tripId }, include: {
    currentPlanVersion: true, request: { select: { requestRevision: true, confirmedRevision: true } }, checklist: true, execution: true,
  } });
  if (!trip) throw new ExportError("没有找到这趟旅行。", 404);
  if (!trip.currentPlanVersion) throw new ExportError("请先保存旅行计划。");
  const plan = serializePlan({ ...trip.currentPlanVersion, trip: { currentPlanVersionId: trip.currentPlanVersionId } });
  if (plan.versionNumber !== expectedPlanVersion) throw new ExportError("计划已更新，请重新读取后选择导出日期。", 409);
  const generatedAt = new Date().toISOString();
  const items = await projectChecklist(tx, trip.checklist ? parseChecklistItems(trip.checklist.items) : [], plan);
  const facts = await tx.evidenceFact.findMany({ where: { planVersionId: plan.id } });
  const evidence: ExportSnapshot["evidence"] = facts.map((f) => {
    const field = evidenceFieldSchema.parse(f.field), applicableFrom = f.applicableFrom?.toISOString() ?? null, applicableUntil = f.applicableUntil?.toISOString() ?? null;
    const status = effectiveEvidenceStatus({ ...f, field, status: f.status === "verified" ? "verified" : f.status === "conflict" ? "conflict" : "unverified", applicableFrom, applicableUntil }, new Date(generatedAt));
    return { eventId: f.targetId, field, status, value: f.extractedValue, source: `${f.sourceTitle} · ${f.sourcePublisher}`, retrievedAt: f.retrievedAt.toISOString(), applicableFrom, applicableUntil };
  });
  return { schemaVersion: 1, id: randomUUID(), generatedAt, plan,
    latestRequestRevision: trip.request?.requestRevision ?? null,
    requirementUpToDate: plan.requirementUpToDate && trip.request?.requestRevision === plan.requestRevision && trip.request?.confirmedRevision === plan.requestRevision,
    checklist: { tripId, planVersion: plan.versionNumber, revision: trip.checklist?.revision ?? 0, updatedAt: trip.checklist?.updatedAt.toISOString() ?? null, items, basis: checklistBasis(items) },
    execution: { ...parseExecution(trip.execution?.payload), revision: trip.execution?.revision ?? 0, planVersion: plan.versionNumber, updatedAt: trip.execution?.updatedAt.toISOString() ?? null },
    evidence, redlines: await buildPlanRedlines(plan, generatedAt, { cache: false }),
  };
}
const summarySelect = { id: true, planVersion: true, requestRevision: true, checklistRevision: true, executionRevision: true,
  requirementUpToDate: true, generatedAt: true, options: true, filename: true, sha256: true } as const;
type SummaryRow = Prisma.ExportFileGetPayload<{ select: typeof summarySelect }>;
function summary(row: SummaryRow): ExportFileSummary {
  return { ...row, generatedAt: row.generatedAt.toISOString(), options: mobileExportOptionsSchema.parse(JSON.parse(row.options)) };
}
export async function getExportPanel(tripId: string) {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { currentPlanVersion: true } });
    if (!trip) throw new ExportError("没有找到这趟旅行。", 404);
    const plan = trip.currentPlanVersion && serializePlan({ ...trip.currentPlanVersion, trip: { currentPlanVersionId: trip.currentPlanVersionId } });
    const files = await tx.exportFile.findMany({ where: { tripId }, select: summarySelect, orderBy: [{ generatedAt: "desc" }, { id: "desc" }], take: 20 });
    return { plan: plan ? { versionNumber: plan.versionNumber, requestRevision: plan.requestRevision,
      dates: [...new Set(plan.events.map((e) => e.date))].sort() } : null, files: files.map(summary) };
  });
}
export async function createMobileExport(tripId: string, raw: unknown, signal?: AbortSignal) {
  const input = mobileExportWriteSchema.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      if (signal?.aborted) throw new ExportError("导出已取消，请重新读取记录。", 409);
      const snapshot = await captureExportSnapshot(tx, tripId, input.expectedPlanVersion);
      const html = renderMobileHtml(snapshot, input.options);
      // Safe filename deliberately avoids free-form trip titles and addresses.
      const filename = `Serendipity-${snapshot.plan.requestSnapshot.startDate ?? "trip"}-V${snapshot.plan.versionNumber}-${snapshot.id.slice(0, 8)}.html`;
      const row = await tx.exportFile.create({ data: { id: snapshot.id, tripId, planVersion: snapshot.plan.versionNumber,
        requestRevision: snapshot.plan.requestRevision, checklistRevision: snapshot.checklist.revision, executionRevision: snapshot.execution.revision,
        requirementUpToDate: snapshot.requirementUpToDate, generatedAt: new Date(snapshot.generatedAt), options: JSON.stringify(input.options),
        snapshot: JSON.stringify(snapshot), filename, html, sha256: createHash("sha256").update(html).digest("hex") }, select: summarySelect });
      if (signal?.aborted) throw new ExportError("导出已取消，请重新读取记录。", 409);
      return summary(row);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P1008"].includes(error.code)) throw new ExportError("旅行资料正在更新，请重新读取后再生成。", 409);
    throw error;
  }
}
export async function getExportFile(tripId: string, id: string) {
  const row = await prisma.exportFile.findFirst({ where: { id, tripId }, select: { html: true, filename: true, sha256: true } });
  if (!row) throw new ExportError("文件不存在或所属旅行已删除。", 404);
  return row;
}
export async function closeExportStore() { await prisma.$disconnect(); }
