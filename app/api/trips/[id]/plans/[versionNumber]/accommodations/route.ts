import { z } from "zod";
import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { listEvidenceFacts } from "@/lib/evidence-service";
import { PlanConflictError, PlanNotFoundError, PlanValidationError } from "@/lib/plan-service";
import { applyAccommodation, getPlanAccommodations, previewAccommodation } from "@/lib/accommodation-service";
import { stayInputSchema } from "@/lib/accommodations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; versionNumber: string }> };
const idSchema = z.string().trim().min(1).max(80);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), eventId: idSchema, stay: stayInputSchema }).strict(),
  z.object({ action: z.literal("apply"), eventId: idSchema, previewToken: z.string().min(1).max(256) }).strict(),
]);
const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof PlanNotFoundError) return json({ error: error.message }, 404);
  if (error instanceof PlanConflictError) return json({ error: error.message }, 409);
  if (error instanceof PlanValidationError) return json({ error: error.message }, 400);
  if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message ?? "住宿资料格式不正确。" }, 400);
  if (error instanceof SyntaxError) return json({ error: "住宿请求格式不正确。" }, 400);
  return json({ error: "住宿资料暂时不可用，请重试；若保存未返回，请刷新核对当前计划。" }, 503);
}
async function parameters(context: Context) {
  const { id, versionNumber } = await context.params, version = Number(versionNumber);
  if (!Number.isSafeInteger(version) || version < 1 || String(version) !== versionNumber) throw new PlanValidationError("计划版本号不正确。");
  return { id, version };
}
export async function GET(request: Request, context: Context) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try { const { id, version } = await parameters(context); return json({ recommendations: await getPlanAccommodations(id, version, idSchema.parse(new URL(request.url).searchParams.get("eventId"))) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  const denied = appWriteAccessError(request); if (denied) return denied;
  try {
    const { id, version } = await parameters(context), body = actionSchema.parse(await request.json());
    if (body.action === "preview") return json({ preview: await previewAccommodation(id, version, body.eventId, body.stay, request.signal) });
    const plan = await applyAccommodation(id, version, body.eventId, body.previewToken, request.signal);
    return json({ plan: { ...plan, evidenceFacts: (await listEvidenceFacts(id)).filter((f) => f.planVersionId === plan.id) } });
  } catch (error) { return failure(error); }
}
