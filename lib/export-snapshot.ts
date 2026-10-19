import { z } from "zod";
import type { PlanVersionRecord } from "./plan-service";
import type { ChecklistView } from "./checklist";
import type { ExecutionView } from "./execution";
import type { EvidenceEffectiveStatus, EvidenceField } from "./evidence";
import type { RedlineResult } from "./redlines";
import { imageContentSchema, type ImageContentOptions, type ImagePart } from "./long-image";
import { pdfContentSchema, type PdfContentOptions, type PdfMetadata } from "./pdf";
import type { AdvisoryItem } from "./advisories";
import type { WeatherRecord } from "./weather";

export class ExportError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "ExportError"; }
}
export const mobileExportOptionsSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(4).nullable().default(null),
  includePrivateAddress: z.boolean().default(false),
  includeSeats: z.boolean().default(false),
  publicLandmark: z.string().trim().max(100).default(""),
}).strict();
export const mobileExportWriteSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
  options: mobileExportOptionsSchema,
}).strict();
export const exportFormatSchema = z.enum(["mobile-html", "plain-text", "markdown", "long-image", "pdf"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type TextExportFormat = "plain-text" | "markdown";
export const exportWriteSchema = mobileExportWriteSchema.extend({ format: exportFormatSchema.default("mobile-html"), imageContent: imageContentSchema.optional(), pdfContent: pdfContentSchema.optional() });
export const exportFormatLabels: Record<ExportFormat, string> = { "mobile-html": "手机 HTML", "plain-text": "纯文字", markdown: "Markdown", "long-image": "旅行长图", pdf: "PDF旅行手册" };
export type MobileExportOptions = z.infer<typeof mobileExportOptionsSchema>;
export type ExportSnapshot = {
  weather?: WeatherRecord[];
  advisories?: { revision: number; items: AdvisoryItem[] };
  schemaVersion: 1; id: string; generatedAt: string;
  plan: PlanVersionRecord;
  latestRequestRevision: number | null;
  requirementUpToDate: boolean;
  checklist: ChecklistView;
  execution: ExecutionView;
  evidence: { eventId: string; field: EvidenceField; status: EvidenceEffectiveStatus; value: string;
    source: string; retrievedAt: string; applicableFrom: string | null; applicableUntil: string | null }[];
  redlines: RedlineResult[];
};
export type ExportFileSummary = {
  pdfContent?: PdfContentOptions; pdf?: PdfMetadata;
  imageContent?: ImageContentOptions; parts?: ImagePart[];
  format: ExportFormat;
  id: string; planVersion: number; requestRevision: number; checklistRevision: number; executionRevision: number;
  requirementUpToDate: boolean; generatedAt: string; options: MobileExportOptions; filename: string; sha256: string;
};
