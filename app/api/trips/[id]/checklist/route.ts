import { z } from "zod";
import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { ChecklistError } from "@/lib/checklist";
import { getChecklist, saveChecklist } from "@/lib/checklist-service";
import { PlanNotFoundError, PlanValidationError } from "@/lib/plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof ChecklistError) return json({ error: error.message }, error.status);
  if (error instanceof PlanNotFoundError) return json({ error: error.message }, 404);
  if (error instanceof PlanValidationError) return json({ error: error.message }, 400);
  if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message ?? "清单格式不正确。" }, 400);
  if (error instanceof SyntaxError) return json({ error: "请求格式不正确。" }, 400);
  return json({ error: "清单暂时无法保存或读取。请重新读取核对是否已保存，再重试；当前输入仍保留。" }, 503);
}
export async function GET(request: Request, context: Context) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try {
    const { id } = await context.params;
    const raw = new URL(request.url).searchParams.get("planVersion"), version = Number(raw);
    if (!Number.isSafeInteger(version) || version < 1 || String(version) !== raw) throw new ChecklistError("计划版本不正确。");
    return json({ checklist: await getChecklist(id, version) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  const denied = appWriteAccessError(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = await request.text();
    if (body.length > 8000) throw new ChecklistError("清单请求过长。");
    return json({ checklist: await saveChecklist(id, JSON.parse(body), request.signal) });
  } catch (error) { return failure(error); }
}
