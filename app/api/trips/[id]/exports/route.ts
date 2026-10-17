import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { z } from "zod";
import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { ExportError } from "@/lib/export-snapshot";
import { createExport, getExportPanel } from "@/lib/export-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof ExportError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "导出选项格式不正确。" }, 400);
  return json({ error: "导出暂时失败，请重新读取记录后重试。已有文件仍可下载。" }, 503);
}
export const GET = businessRoute(async function GET(request: Request, context: Context) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try {
    const kind = z.enum(["mobile-html", "text", "long-image", "pdf"]).parse(new URL(request.url).searchParams.get("kind") ?? "mobile-html");
    return json(await getExportPanel((await context.params).id, kind));
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return failure(error); }
});
export const POST = businessRoute(async function POST(request: Request, context: Context) {
  const denied = appWriteAccessError(request); if (denied) return denied;
  try {
    const body = await request.text();
    if (body.length > 2000) throw new ExportError("导出选项过长。");
    return json({ file: await createExport((await context.params).id, JSON.parse(body), request.signal) }, 201);
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return failure(error); }
});
