import { NextResponse } from "next/server";
import { hasSettingsSession, hasValidCsrf, unauthorizedResponse } from "@/lib/access";
import { MAP_PREVIEW_COOKIE, testMapConfiguration } from "@/lib/map-settings";
import { isSecureRequest } from "@/lib/request-security";
import { mapApiError } from "@/lib/map-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) return unauthorizedResponse();
  try {
    const { previewCookie, ...result } = await testMapConfiguration(await request.json(), request.signal);
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(MAP_PREVIEW_COOKIE, previewCookie, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:" && isSecureRequest(request), path: "/", maxAge: 600 });
    return response;
  } catch (error) { return mapApiError(error); }
}
