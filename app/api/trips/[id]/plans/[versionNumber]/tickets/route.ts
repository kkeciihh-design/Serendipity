import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { z } from "zod";
import { appWriteAccessError } from "@/lib/access";
import { listEvidenceFacts } from "@/lib/evidence-service";
import { mapApiError } from "@/lib/map-api";
import { savePlanTicketEdit } from "@/lib/plan-service";
import { ticketActionSchema } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; versionNumber: string }> };

export const POST = businessRoute(async function POST(request: Request, context: Context) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;

  try {
    const { id, versionNumber } = await context.params;
    const version = Number(versionNumber);
    if (!Number.isSafeInteger(version) || version < 1) {
      return Response.json({ error: "计划版本不正确。" }, { status: 400 });
    }
    const action = ticketActionSchema.parse(await request.json());
    const plan = await savePlanTicketEdit({
      tripId: id,
      expectedPlanVersion: version,
      action,
    });
    const evidenceFacts = (await listEvidenceFacts(id)).filter(
      (fact) => fact.planVersionId === plan.id,
    );
    return Response.json({ plan: { ...plan, evidenceFacts } });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error;
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "票面确认格式不正确。" },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "请求格式不正确，票面没有保存。" },
        { status: 400 },
      );
    }
    return mapApiError(error);
  }
});
