import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { z } from "zod";
import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { listEvidenceFacts } from "@/lib/evidence-service";
import { PlanConflictError, PlanNotFoundError, PlanValidationError } from "@/lib/plan-service";
import { applyRestaurantEdit, getPlanRestaurants, previewRestaurantEdit } from "@/lib/restaurant-service";
import { mealPricingSchema } from "@/lib/restaurants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; versionNumber: string }> };
const eventIdSchema = z.string().trim().min(1).max(80);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), eventId: eventIdSchema, candidateId: z.string().min(1).max(120).nullable(), pricing: mealPricingSchema }).strict(),
  z.object({ action: z.literal("apply"), eventId: eventIdSchema, previewToken: z.string().min(1).max(256) }).strict(),
]);
const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
function apiError(error: unknown) {
  if (error instanceof PlanNotFoundError) return json({ error: error.message }, 404);
  if (error instanceof PlanConflictError) return json({ error: error.message }, 409);
  if (error instanceof PlanValidationError) return json({ error: error.message }, 400);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "餐厅请求格式不正确，请核对人数和人均区间。" }, 400);
  return json({ error: "餐厅资料暂时不可用，请稍后重试；若尚未收到保存结果，请刷新计划核对。" }, 503);
}
async function parameters(context: Context) {
  const { id, versionNumber } = await context.params;
  const version = Number(versionNumber);
  if (!Number.isSafeInteger(version) || version < 1 || String(version) !== versionNumber) throw new PlanValidationError("计划版本号不正确。");
  return { id, version };
}
export const GET = businessRoute(async function GET(request: Request, context: Context) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try {
    const { id, version } = await parameters(context);
    return json({ recommendations: await getPlanRestaurants(id, version, eventIdSchema.parse(new URL(request.url).searchParams.get("eventId"))) });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return apiError(error); }
});
export const POST = businessRoute(async function POST(request: Request, context: Context) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;
  try {
    const { id, version } = await parameters(context), body = actionSchema.parse(await request.json());
    if (body.action === "preview") return json({ preview: await previewRestaurantEdit(id, version, body.eventId, body.candidateId, body.pricing, request.signal) });
    const plan = await applyRestaurantEdit(id, version, body.eventId, body.previewToken, request.signal);
    const evidenceFacts = (await listEvidenceFacts(id)).filter((fact) => fact.planVersionId === plan.id);
    return json({ plan: { ...plan, evidenceFacts } });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return apiError(error); }
});
