import { appWriteAccessError } from "@/lib/access";
import { mapApiError } from "@/lib/map-api";
import { searchAndSavePlanRoute, saveManualPlanRoute } from "@/lib/route-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; versionNumber: string }> };

export async function POST(request: Request, context: Context) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;
  try {
    const { id, versionNumber } = await context.params;
    const version = Number(versionNumber);
    if (!Number.isSafeInteger(version) || version < 1) return Response.json({ error: "计划版本不正确。" }, { status: 400 });
    const input = await request.json();
    const plan = await searchAndSavePlanRoute(id, version, input, request.signal);
    return Response.json({ plan });
  } catch (error) {
    return mapApiError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;
  try {
    const { id, versionNumber } = await context.params;
    const version = Number(versionNumber);
    if (!Number.isSafeInteger(version) || version < 1) return Response.json({ error: "计划版本不正确。" }, { status: 400 });
    const plan = await saveManualPlanRoute(id, version, await request.json(), request.signal);
    return Response.json({ plan });
  } catch (error) {
    return mapApiError(error);
  }
}
