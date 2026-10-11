import { hasAppAccess, hasSettingsSession, unauthorizedResponse } from "@/lib/access";
import { getMapConfiguration, MAP_PREVIEW_COOKIE, readMapPreview } from "@/lib/map-settings";
import { getCookieValue } from "@/lib/request-security";
import { mapApiError } from "@/lib/map-api";
import { getSettingsRecord } from "@/lib/settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  if (!(preview ? hasSettingsSession(request) : hasAppAccess(request))) return unauthorizedResponse();
  try {
    if (!preview && (await getSettingsRecord()).mapProvider !== "amap") {
      return Response.json({ provider: "osm" }, { headers: { "Cache-Control": "no-store" } });
    }
    const configuration = preview ? readMapPreview(getCookieValue(request, MAP_PREVIEW_COOKIE)) : await getMapConfiguration();
    return Response.json({ provider: "amap", browserKey: configuration.browserKey, serviceHost: preview ? "/api/map/preview/_AMapService" : "/api/map/_AMapService" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mapApiError(error); }
}
