import { z } from "zod";
import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { ReplanError, replanWriteSchema } from "@/lib/replan";
import { applyReplan, cancelReplan, getReplanState, previewReplan, previewUndo } from "@/lib/replan-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Context = { params: Promise<{ id: string }> };
const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof ReplanError) return json({ error: error.message, requirementChange: error.status === 422 }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "重新规划请求或候选格式不正确。" }, 400);
  return json({ error: "重新规划暂时无法读取或保存，请重新读取核对当前计划。" }, 503);
}
export async function GET(request: Request, context: Context) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try { return json(await getReplanState((await context.params).id)); } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  const denied = appWriteAccessError(request); if (denied) return denied;
  try {
    const { id: tripId } = await context.params, raw = await request.text();
    if (raw.length > 4000) return json({ error: "调整说明过长。" }, 400);
    const body = replanWriteSchema.parse(JSON.parse(raw));
    if (body.action === "preview") return json({ candidate: await previewReplan({ ...body, tripId, signal: request.signal }) });
    if (body.action === "undo") return json({ candidate: await previewUndo({ ...body, tripId, signal: request.signal }) });
    if (body.action === "cancel") { await cancelReplan(tripId, body.candidateId, body.expectedCandidateRevision); return json({ cancelled: true }); }
    return json(await applyReplan(tripId, body.candidateId, body.expectedCandidateRevision, request.signal));
  } catch (error) { return failure(error); }
}
