import { z } from "zod";

export const pdfContentSchema = z.object({ mode: z.enum(["complete", "simplified"]).default("complete"), includePhotos: z.boolean().default(true) }).strict();
export type PdfContentOptions = z.infer<typeof pdfContentSchema>;
export type PdfMetadata = { pages: number; bytes: number; eventIds: string[] };
export type PdfManifest = PdfMetadata & { schemaVersion: 1; base64: string };
export const PDF_LIMITS = { pages: 100, bytes: 32 * 1024 * 1024, htmlBytes: 40 * 1024 * 1024, timeoutMs: 60_000 } as const;
