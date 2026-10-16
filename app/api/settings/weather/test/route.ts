import { hasSettingsSession, hasValidCsrf, unauthorizedResponse } from "@/lib/access";
import { testWeatherConfiguration } from "@/lib/weather-settings";
import { mapApiError } from "@/lib/map-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) return unauthorizedResponse();
  try {
    return Response.json(await testWeatherConfiguration(request.signal), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return mapApiError(error);
  }
}
