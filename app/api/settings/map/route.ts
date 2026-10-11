import { hasSettingsSession, hasValidCsrf, unauthorizedResponse } from "@/lib/access";
import { getSafeMapSettings, MAP_PREVIEW_COOKIE, saveMapConfiguration, useFreeMapProvider } from "@/lib/map-settings";
import { getCookieValue } from "@/lib/request-security";
import { mapApiError } from "@/lib/map-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!hasSettingsSession(request)) return unauthorizedResponse();
  try { return Response.json(await getSafeMapSettings(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return mapApiError(error); }
}
export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) return unauthorizedResponse();
  try {
    const input = await request.json();
    return Response.json(input?.provider === "osm" ? await useFreeMapProvider() : await saveMapConfiguration(getCookieValue(request, MAP_PREVIEW_COOKIE), input));
  }
  catch (error) { return mapApiError(error); }
}
