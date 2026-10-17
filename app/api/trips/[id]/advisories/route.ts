import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { z } from "zod";
import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { AdvisoryError } from "@/lib/advisories";
import { getAdvisories, saveAdvisories } from "@/lib/advisory-service";
import { PlanNotFoundError, PlanValidationError } from "@/lib/plan-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof AdvisoryError) return json({ error: error.message }, error.status);
  if (error instanceof PlanNotFoundError) return json({ error: error.message }, 404);
  if (error instanceof PlanValidationError) return json({ error: error.message }, 400);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "提醒请求格式不正确。" }, 400);
  return json({ error: "提醒暂时无法读取或保存，请重新读取核对。原行程保持不变。" }, 503);
}
export const GET = businessRoute(async function GET(request: Request, context: Context) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try {
    const { id } = await context.params, raw = new URL(request.url).searchParams.get("planVersion"), version = Number(raw);
    if (!Number.isSafeInteger(version) || version < 1 || String(version) !== raw) throw new AdvisoryError("计划版本不正确。");
    return json({ advisories: await getAdvisories(id, version) });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return failure(error); }
});
export const POST = businessRoute(async function POST(request: Request, context: Context) {
  const denied = appWriteAccessError(request); if (denied) return denied;
  try {
    const { id } = await context.params, body = await request.text();
    if (body.length > 4000) throw new AdvisoryError("提醒请求过长。");
    return json({ advisories: await saveAdvisories(id, JSON.parse(body), request.signal) });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return failure(error); }
});
