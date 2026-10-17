import { z } from "zod";
import type { PlanVersionRecord } from "./plan-service";
import type { ChecklistView } from "./checklist";
import type { ExecutionView } from "./execution";
import type { EvidenceEffectiveStatus, EvidenceField } from "./evidence";
import type { RedlineResult } from "./redlines";

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
export const exportFormatSchema = z.enum(["mobile-html", "plain-text", "markdown"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type TextExportFormat = Exclude<ExportFormat, "mobile-html">;
export const exportWriteSchema = mobileExportWriteSchema.extend({ format: exportFormatSchema.default("mobile-html") });
export const exportFormatLabels: Record<ExportFormat, string> = { "mobile-html": "手机 HTML", "plain-text": "纯文字", markdown: "Markdown" };
export type MobileExportOptions = z.infer<typeof mobileExportOptionsSchema>;
export type ExportSnapshot = {
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
  format: ExportFormat;
  id: string; planVersion: number; requestRevision: number; checklistRevision: number; executionRevision: number;
  requirementUpToDate: boolean; generatedAt: string; options: MobileExportOptions; filename: string; sha256: string;
};
