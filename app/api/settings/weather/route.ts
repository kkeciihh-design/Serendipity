import { hasSettingsSession, hasValidCsrf, unauthorizedResponse } from "@/lib/access";
import { getSafeWeatherSettings, saveWeatherConfiguration } from "@/lib/weather-settings";
import { mapApiError } from "@/lib/map-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasSettingsSession(request)) return unauthorizedResponse();
  try {
    return Response.json(await getSafeWeatherSettings(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapApiError(error);
  }
}

export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) return unauthorizedResponse();
  try {
    return Response.json(await saveWeatherConfiguration(await request.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return mapApiError(error);
  }
}
