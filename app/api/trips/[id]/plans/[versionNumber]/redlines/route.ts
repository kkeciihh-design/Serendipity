import { hasAppAccess } from "@/lib/access";
import { mapApiError } from "@/lib/map-api";
import { getPlanVersion } from "@/lib/plan-service";
import { buildPlanRedlines } from "@/lib/redline-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string; versionNumber: string }> }) {
  if (!hasAppAccess(request)) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const { id, versionNumber } = await context.params;
    const version = Number(versionNumber);
    if (!Number.isSafeInteger(version) || version < 1) return Response.json({ error: "计划版本不正确。" }, { status: 400 });
    const plan = await getPlanVersion(id, version);
    const serverNow = new Date().toISOString();
    const redlines = await buildPlanRedlines(plan, serverNow);
    return Response.json({ planId: plan.id, isCurrent: plan.isCurrent, serverNow, redlines }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mapApiError(error); }
}
