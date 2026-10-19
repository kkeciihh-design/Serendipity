import { businessOperation, businessTransaction } from "./business-guard";
import { randomUUID, createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "./data-directory";
import { serializePlan } from "./plan-service";
import { parseChecklistItems } from "./checklist";
import { checklistBasis, projectChecklist } from "./checklist-store";
import { parseExecution } from "./execution";
import { effectiveEvidenceStatus, evidenceFieldSchema } from "./evidence";
import { buildPlanRedlines } from "./redline-service";
import { ExportError, exportFormatSchema, exportWriteSchema, mobileExportOptionsSchema, mobileExportWriteSchema, type ExportSnapshot, type ExportFileSummary } from "./export-snapshot";
import { renderMobileHtml } from "./mobile-export";
import { renderTextExport } from "./text-export";
import { imageContentSchema, type ImageManifest, type ImagePart } from "./long-image";
import { renderLongImageHtml } from "./long-image-html";
import { screenshotLongImage, withLongImageSlot } from "./long-image-renderer";
import { renderPdfHtml } from "./pdf-html";
import { printPdf } from "./pdf-renderer";
import { pdfContentSchema, type PdfManifest } from "./pdf";
import { parseAdvisoryItems, parseAdvisoryWeatherState } from "./advisories";
import { projectAdvisories } from "./advisory-rules";
import { serializeFact } from "./evidence-service";

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
  const advisory = await tx.advisoryState.findUnique({ where: { tripId } });
  const advisoryItems = projectAdvisories({ plan, checklist: items, facts: facts.map((f) => serializeFact(f, new Date(generatedAt))),
    weather: advisory ? parseAdvisoryWeatherState(advisory.weather).records : [],
    previous: advisory ? parseAdvisoryItems(advisory.items) : [], now: new Date(generatedAt) });
  const evidence: ExportSnapshot["evidence"] = facts.map((f) => {
    const field = evidenceFieldSchema.parse(f.field), applicableFrom = f.applicableFrom?.toISOString() ?? null, applicableUntil = f.applicableUntil?.toISOString() ?? null;
    const status = effectiveEvidenceStatus({ ...f, field, status: f.status === "verified" ? "verified" : f.status === "conflict" ? "conflict" : "unverified", applicableFrom, applicableUntil }, new Date(generatedAt));
    return { eventId: f.targetId, field, status, value: f.extractedValue, source: `${f.sourceTitle} · ${f.sourcePublisher}`, retrievedAt: f.retrievedAt.toISOString(), applicableFrom, applicableUntil };
  });
  return { schemaVersion: 1, id: randomUUID(), generatedAt, plan,
    weather: advisory ? parseAdvisoryWeatherState(advisory.weather).records : [],
    advisories: { revision: advisory?.revision ?? 0, items: advisoryItems },
    latestRequestRevision: trip.request?.requestRevision ?? null,
    requirementUpToDate: plan.requirementUpToDate && trip.request?.requestRevision === plan.requestRevision && trip.request?.confirmedRevision === plan.requestRevision,
    checklist: { tripId, planVersion: plan.versionNumber, revision: trip.checklist?.revision ?? 0, updatedAt: trip.checklist?.updatedAt.toISOString() ?? null, items, basis: checklistBasis(items) },
    execution: { ...parseExecution(trip.execution?.payload), revision: trip.execution?.revision ?? 0, planVersion: plan.versionNumber, updatedAt: trip.execution?.updatedAt.toISOString() ?? null },
    evidence, redlines: await buildPlanRedlines(plan, generatedAt, { cache: false }),
  };
}
const summarySelect = { id: true, format: true, planVersion: true, requestRevision: true, checklistRevision: true, executionRevision: true,
  requirementUpToDate: true, generatedAt: true, options: true, filename: true, sha256: true } as const;
type SummaryRow = Prisma.ExportFileGetPayload<{ select: typeof summarySelect }>;
function summary(row: SummaryRow): ExportFileSummary {
  const { imageContent, parts, pdfContent, pdf, ...options } = JSON.parse(row.options);
  return { ...row, format: exportFormatSchema.parse(row.format), generatedAt: row.generatedAt.toISOString(), options: mobileExportOptionsSchema.parse(options),
    ...(row.format === "long-image" ? { imageContent: imageContentSchema.parse(imageContent), parts: parts as ImagePart[] } : {}),
    ...(row.format === "pdf" ? { pdfContent: pdfContentSchema.parse(pdfContent), pdf } : {}) };
}
export const getExportPanel = businessOperation(async function getExportPanel(tripId: string, kind: "mobile-html" | "text" | "long-image" | "pdf" = "mobile-html") {
  return businessTransaction(prisma, async (tx) => {
    const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { currentPlanVersion: true } });
    if (!trip) throw new ExportError("没有找到这趟旅行。", 404);
    const plan = trip.currentPlanVersion && serializePlan({ ...trip.currentPlanVersion, trip: { currentPlanVersionId: trip.currentPlanVersionId } });
    const files = await tx.exportFile.findMany({ where: { tripId, format: kind === "text" ? { in: ["plain-text", "markdown"] } : kind }, select: summarySelect, orderBy: [{ generatedAt: "desc" }, { id: "desc" }], take: 20 });
    return { plan: plan ? { versionNumber: plan.versionNumber, requestRevision: plan.requestRevision,
      dates: [...new Set(plan.events.map((e) => e.date))].sort() } : null, files: files.map(summary) };
  });
});
export const createMobileExport = businessOperation(async function createMobileExport(tripId: string, raw: unknown, signal?: AbortSignal) {
  return createExport(tripId, mobileExportWriteSchema.parse(raw), signal);
});
export const createExport = businessOperation(async function createExport(tripId: string, raw: unknown, signal?: AbortSignal) {
  const input = exportWriteSchema.parse(raw);
  try {
    if (input.format === "pdf") return await withLongImageSlot(async () => {
      if (signal?.aborted) throw new ExportError("PDF生成已取消。", 409);
      const snapshot = await businessTransaction(prisma, (tx) => captureExportSnapshot(tx, tripId, input.expectedPlanVersion));
      const pdfContent = pdfContentSchema.parse(input.pdfContent ?? {});
      const manifest = await printPdf(await renderPdfHtml(snapshot, input.options, pdfContent), signal);
      const { base64, schemaVersion, ...pdf } = manifest; void schemaVersion;
      const filename = `Serendipity-${snapshot.plan.requestSnapshot.startDate ?? "trip"}-V${snapshot.plan.versionNumber}-${snapshot.id.slice(0, 8)}.pdf`;
      return businessTransaction(prisma, async (tx) => {
        if (signal?.aborted) throw new ExportError("PDF生成已取消。", 409);
        const row = await tx.exportFile.create({ data: { id: snapshot.id, tripId, format: "pdf", planVersion: snapshot.plan.versionNumber,
          requestRevision: snapshot.plan.requestRevision, checklistRevision: snapshot.checklist.revision, executionRevision: snapshot.execution.revision,
          requirementUpToDate: snapshot.requirementUpToDate, generatedAt: new Date(snapshot.generatedAt), options: JSON.stringify({ ...input.options, pdfContent, pdf }),
          snapshot: JSON.stringify(snapshot), filename, html: JSON.stringify(manifest), sha256: createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex") }, select: summarySelect });
        if (signal?.aborted) throw new ExportError("PDF生成已取消。", 409);
        return summary(row);
      });
    });
    if (input.format === "long-image") return await withLongImageSlot(async () => {
      if (signal?.aborted) throw new ExportError("导出已取消。", 409);
      const snapshot = await businessTransaction(prisma, (tx) => captureExportSnapshot(tx, tripId, input.expectedPlanVersion));
      const imageContent = imageContentSchema.parse(input.imageContent ?? {});
      const prefix = `Serendipity-${snapshot.plan.requestSnapshot.startDate ?? "trip"}-V${snapshot.plan.versionNumber}-${snapshot.id.slice(0, 8)}`;
      // Browser IO is outside the read transaction. Every rendered part uses the
      // same captured state even if the plan or checklist changes meanwhile.
      const manifest = await screenshotLongImage(await renderLongImageHtml(snapshot, input.options, imageContent), prefix, signal);
      const html = JSON.stringify(manifest);
      const parts = manifest.parts.map(({ base64, ...part }) => { void base64; return part; });
      return businessTransaction(prisma, async (tx) => {
        if (signal?.aborted) throw new ExportError("导出已取消。", 409);
        const row = await tx.exportFile.create({ data: { id: snapshot.id, tripId, format: "long-image", planVersion: snapshot.plan.versionNumber,
          requestRevision: snapshot.plan.requestRevision, checklistRevision: snapshot.checklist.revision, executionRevision: snapshot.execution.revision,
          requirementUpToDate: snapshot.requirementUpToDate, generatedAt: new Date(snapshot.generatedAt), options: JSON.stringify({ ...input.options, imageContent, parts }),
          snapshot: JSON.stringify(snapshot), filename: `${prefix}.png`, html, sha256: createHash("sha256").update(html).digest("hex") }, select: summarySelect });
        if (signal?.aborted) throw new ExportError("导出已取消。", 409);
        return summary(row);
      });
    });
    const format = input.format;
    return await businessTransaction(prisma, async (tx) => {
      if (signal?.aborted) throw new ExportError("导出已取消，请重新读取记录。", 409);
      const snapshot = await captureExportSnapshot(tx, tripId, input.expectedPlanVersion);
      // The existing `html` storage column holds immutable UTF-8 content for all
      // formats. Keep the column for backwards compatibility; format controls MIME.
      const html = format === "mobile-html" ? renderMobileHtml(snapshot, input.options) : renderTextExport(snapshot, input.options, format);
      // Safe filename deliberately avoids free-form trip titles and addresses.
      const extension = input.format === "mobile-html" ? "html" : input.format === "markdown" ? "md" : "txt";
      const filename = `Serendipity-${snapshot.plan.requestSnapshot.startDate ?? "trip"}-V${snapshot.plan.versionNumber}-${snapshot.id.slice(0, 8)}.${extension}`;
      const row = await tx.exportFile.create({ data: { id: snapshot.id, tripId, format: input.format, planVersion: snapshot.plan.versionNumber,
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
});
export const getExportFile = businessOperation(async function getExportFile(tripId: string, id: string) {
  const row = await prisma.exportFile.findFirst({ where: { id, tripId }, select: { html: true, format: true, filename: true, sha256: true } });
  if (!row) throw new ExportError("文件不存在或所属旅行已删除。", 404);
  return row;
});
export async function closeExportStore() { await prisma.$disconnect(); }

export function getExportPdfBytes(row: Awaited<ReturnType<typeof getExportFile>>) {
  if (row.format !== "pdf") throw new ExportError("PDF文件不存在。", 404);
  const manifest = JSON.parse(row.html) as PdfManifest;
  const bytes = Buffer.from(manifest.base64, "base64");
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new ExportError("PDF文件校验失败，请重新生成。", 503);
  return bytes;
}

export function getExportImagePart(row: Awaited<ReturnType<typeof getExportFile>>, index: number) {
  if (row.format !== "long-image" || !Number.isInteger(index) || index < 1) throw new ExportError("图片不存在。", 404);
  const part = (JSON.parse(row.html) as ImageManifest).parts[index - 1];
  if (!part) throw new ExportError("图片不存在。", 404);
  return { bytes: Buffer.from(part.base64, "base64"), filename: part.filename, sha256: part.sha256 };
}
