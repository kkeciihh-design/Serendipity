import { z } from "zod";
import { hasSettingsSession, hasValidCsrf, unauthorizedResponse } from "@/lib/access";
import { createSignedPayload, verifySignedPayload } from "@/lib/security";
import { getDatabasePath } from "@/lib/data-directory";
import { validateTravelBackup } from "@/lib/backup-validation";
import { MAX_BACKUP_BYTES } from "@/scripts/travel-backup-format.mjs";
import { previewRestore, readTravelBackup, restoreTravelBackup, resumeInterruptedRestore, readInstanceState, assertGeneration, RestoreGuardError } from "@/scripts/restore-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const confirmation = z.object({ scope: z.literal("restore-preview"), backupHash: z.string(), currentHash: z.string(), dataGeneration: z.string(), exp: z.number() });
async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BACKUP_BYTES + 10000) throw new Error("备份超过64 MiB上限。");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("没有读取到备份文件。");
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > MAX_BACKUP_BYTES + 10000) { await reader.cancel(); throw new Error("备份超过64 MiB上限。"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
export async function GET(request: Request) {
  if (!hasSettingsSession(request)) return unauthorizedResponse();
  try {
    const state = readInstanceState(getDatabasePath());
    assertGeneration(state, state.dataGeneration);
    const backup = validateTravelBackup(readTravelBackup(getDatabasePath()));
    const body = JSON.stringify(backup);
    if (Buffer.byteLength(body) > MAX_BACKUP_BYTES) throw new Error("旅行备份超过64 MiB上限，请联系维护者处理。");
    return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="Serendipity-backup-${new Date().toISOString().slice(0,10)}.json"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "恢复处理失败。", ...(error instanceof RestoreGuardError ? { code: error.code, reloadRequired: true } : {}) }, { status: error instanceof RestoreGuardError ? error.status : 400 });
}
export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) return unauthorizedResponse();
  try {
    const body = await readBody(request);
    if (body.action === "resume") {
      resumeInterruptedRestore(getDatabasePath());
      return Response.json({ resumed: true });
    }
    const parsed = z.object({ action: z.enum(["preview", "restore"]), backup: z.unknown(), previewToken: z.string().optional(), confirmed: z.boolean().optional() }).strict().parse(body);
    assertGeneration(readInstanceState(getDatabasePath()), request.headers.get("x-data-generation"));
    const backup = validateTravelBackup(parsed.backup);
    if (parsed.action === "preview") {
      const preview = previewRestore(getDatabasePath(), backup);
      const previewToken = createSignedPayload({ scope: "restore-preview", backupHash: preview.backupHash, currentHash: preview.currentHash, dataGeneration: preview.dataGeneration, exp: Date.now() + 10 * 60_000 });
      return Response.json({ ...preview, previewToken });
    }
    const token = confirmation.safeParse(parsed.previewToken ? verifySignedPayload(parsed.previewToken) : null);
    if (!parsed.confirmed || !token.success || token.data.exp < Date.now()) throw new Error("请先校验备份、核对影响范围并明确确认恢复。");
    return Response.json(await restoreTravelBackup(getDatabasePath(), backup, token.data));
  } catch (error) { return failure(error); }
}
