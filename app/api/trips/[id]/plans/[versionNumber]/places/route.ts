import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { appWriteAccessError } from "@/lib/access";
import { confirmPlanPlace, searchPlanPlaces } from "@/lib/map-service";
import { mapApiError } from "@/lib/map-api";
import { listEvidenceFacts } from "@/lib/evidence-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; versionNumber: string }> };
async function handle(request: Request, context: Context, search: boolean) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;
  try {
    const { id, versionNumber } = await context.params;
    const version = Number(versionNumber);
    if (!Number.isSafeInteger(version) || version < 1) return Response.json({ error: "计划版本不正确。" }, { status: 400 });
    const input = await request.json();
    if (search) return Response.json({ candidates: await searchPlanPlaces(id, version, input, request.signal) });
    const plan = await confirmPlanPlace(id, version, input, request.signal);
    const evidenceFacts = (await listEvidenceFacts(id)).filter((fact) => fact.planVersionId === plan.id);
    return Response.json({ plan: { ...plan, evidenceFacts } });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error; return mapApiError(error); }
}
export const POST = businessRoute(async function POST(request: Request, context: Context) { return handle(request, context, true); });
export const PATCH = businessRoute(async function PATCH(request: Request, context: Context) { return handle(request, context, false); });
