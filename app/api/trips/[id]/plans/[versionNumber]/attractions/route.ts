import { z } from "zod";
import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import {
  applyAttractionReplacement,
  getPlanAttractions,
  keepPlanAttraction,
  previewAttractionReplacement,
} from "@/lib/attraction-service";
import { listEvidenceFacts } from "@/lib/evidence-service";
import { PlanConflictError, PlanNotFoundError, PlanValidationError } from "@/lib/plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; versionNumber: string }> };
const eventIdSchema = z.string().trim().min(1).max(80);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), eventId: eventIdSchema, candidateId: z.string().min(1).max(120) }).strict(),
  z.object({ action: z.literal("apply"), eventId: eventIdSchema, candidateId: z.string().min(1).max(120), previewToken: z.string().min(1).max(256) }).strict(),
  z.object({ action: z.literal("keep"), eventId: eventIdSchema, candidateId: z.string().min(1).max(120).optional() }).strict(),
]);
function json(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}
function apiError(error: unknown) {
  if (error instanceof PlanNotFoundError) return json({ error: error.message }, 404);
  if (error instanceof PlanConflictError) return json({ error: error.message }, 409);
  if (error instanceof PlanValidationError) return json({ error: error.message }, 400);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "景点请求格式不正确，请重新选择。" }, 400);
  return json({ error: "景点资料暂时不可用，当前计划没有被覆盖，请稍后重试。" }, 503);
}
async function parameters(context: Context) {
  const { id, versionNumber } = await context.params;
  const version = Number(versionNumber);
  if (!Number.isSafeInteger(version) || version < 1 || String(version) !== versionNumber) throw new PlanValidationError("计划版本号不正确。");
  return { id, version };
}
export async function GET(request: Request, context: Context) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try {
    const { id, version } = await parameters(context);
    const eventId = eventIdSchema.parse(new URL(request.url).searchParams.get("eventId"));
    return json({ recommendations: await getPlanAttractions(id, version, eventId) });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;
  try {
    const { id, version } = await parameters(context);
    const body = actionSchema.parse(await request.json());
    if (body.action === "preview") return json({ preview: await previewAttractionReplacement(id, version, body.eventId, body.candidateId, request.signal) });
    const plan = body.action === "apply"
      ? await applyAttractionReplacement(id, version, body.eventId, body.candidateId, body.previewToken, request.signal)
      : await keepPlanAttraction(id, version, body.eventId, body.candidateId, request.signal);
    const evidenceFacts = (await listEvidenceFacts(id)).filter((fact) => fact.planVersionId === plan.id);
    return json({ plan: { ...plan, evidenceFacts } });
  } catch (error) { return apiError(error); }
}
