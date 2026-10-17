import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { z } from "zod";
import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { ExecutionError } from "@/lib/execution";
import { getExecution, saveExecution } from "@/lib/execution-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof ExecutionError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "进度请求格式不正确。" }, 400);
  return json({ error: "进度暂时无法读取或保存，请重新读取确认结果后重试。" }, 503);
}
export const GET = businessRoute(async function GET(request: Request, context: Context) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try { return json(await getExecution((await context.params).id)); } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return failure(error); }
});
export const POST = businessRoute(async function POST(request: Request, context: Context) {
  const denied = appWriteAccessError(request); if (denied) return denied;
  try {
    const body = await request.text();
    if (body.length > 2000) throw new ExecutionError("进度请求过长。", 400);
    return json(await saveExecution((await context.params).id, JSON.parse(body), request.signal));
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return failure(error); }
});
