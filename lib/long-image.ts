import { z } from "zod";

export const imageContentSchema = z.object({ includeMap: z.boolean().default(true), includePhotos: z.boolean().default(true) }).strict();
export type ImageContentOptions = z.infer<typeof imageContentSchema>;
export const LONG_IMAGE_LIMITS = { width: 720, scale: 1.5, height: 10000, parts: 24, partBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, timeoutMs: 60_000 } as const;
export type ImagePart = { index: number; width: number; height: number; bytes: number; sha256: string; filename: string; dates: string[]; eventIds: string[] };
export type ImageManifest = { schemaVersion: 1; parts: (ImagePart & { base64: string })[] };
