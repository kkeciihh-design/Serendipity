import { hasAppAccess, hasSettingsSession, unauthorizedResponse } from "./access";
import { amapProxyUrl, fetchMapResource } from "./amap";
import { getMapConfiguration, MAP_PREVIEW_COOKIE, readMapPreview } from "./map-settings";
import { getCookieValue } from "./request-security";
import { mapApiError } from "./map-api";
export async function proxyMapRequest(request: Request, path: string[], preview = false) {
  if (!(preview ? hasSettingsSession(request) : hasAppAccess(request))) return unauthorizedResponse();
  try {
    const config = preview ? readMapPreview(getCookieValue(request, MAP_PREVIEW_COOKIE)) : await getMapConfiguration();
    const url = amapProxyUrl(path, new URL(request.url).searchParams, config.browserKey, config.securityCode);
    const result = await fetchMapResource(url, request.signal);
    // Never relay upstream headers, redirects, errors containing credentials or HTML.
    const content = result.bytes.toString("utf8");
    if (content.includes(config.securityCode) || content.includes(config.webServiceKey) || /<\s*(?:html|script|!doctype)/i.test(content)) {
      return Response.json({ error: "地图服务返回异常，请检查配置。" }, { status: 502 });
    }
    return new Response(content, { headers: { "Content-Type": new URL(request.url).searchParams.has("callback") ? "application/javascript; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return mapApiError(error); }
}
