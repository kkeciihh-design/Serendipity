import { placeCandidateSchema, type PlaceCandidate } from "./places";

export class MapServiceError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
    this.name = "MapServiceError";
  }
}

// No arbitrary host, redirects, user cookies or caller-supplied authentication.
export async function fetchMapResource(url: URL, signal?: AbortSignal, maxBytes = 2_000_000) {
  if (url.protocol !== "https:" || !["restapi.amap.com", "webapi.amap.com"].includes(url.hostname) || url.port || url.username || url.password) {
    throw new MapServiceError("地图请求地址不受支持。", 400);
  }
  const timeout = AbortSignal.timeout(12_000);
  try {
    const response = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error", cache: "no-store",
    });
    if (!response.ok || !response.body) throw new MapServiceError("地图服务暂时不可用，请稍后重试。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new MapServiceError("地图响应过大，请缩小查询范围。");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return { bytes: Buffer.concat(chunks), contentType: response.headers.get("content-type") ?? "" };
  } catch (error) {
    if (error instanceof MapServiceError) throw error;
    throw new MapServiceError(timeout.aborted ? "地图请求超时，请重试。" : "地图连接失败，请检查网络和地图配置。");
  }
}

export async function searchAmapPlaces(webServiceKey: string, city: string, keywords: string, signal?: AbortSignal): Promise<PlaceCandidate[]> {
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.search = new URLSearchParams({ key: webServiceKey, city, citylimit: "true", keywords, offset: "10", page: "1", extensions: "base", output: "JSON" }).toString();
  const response = await fetchMapResource(url, signal, 300_000);
  let payload;
  try { payload = JSON.parse(response.bytes.toString("utf8")); }
  catch { throw new MapServiceError("地图返回格式异常，请重试。"); }
  if (payload.status !== "1") {
    const code = String(payload.infocode);
    throw new MapServiceError(["10001", "10002", "10005", "10006", "10007", "10009", "10012", "10013"].includes(code)
      ? "高德 Key、服务类型或权限不正确，请检查 Web 服务 Key 和账号配置。"
      : ["10003", "10004", "10010", "10019", "10020", "10021", "10044"].includes(code)
        ? "高德服务额度或频率受限，请稍后重试。" : "高德地点查询失败，请检查配置后重试。");
  }
  if (!Array.isArray(payload.pois)) throw new MapServiceError("地图地点结果格式异常。");
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const results: PlaceCandidate[] = [];
  for (const poi of payload.pois.slice(0, 10)) {
    if (!poi || typeof poi !== "object") continue;
    const location = text(poi.location).split(",");
    if (location.length !== 2 || location.some((part) => !part.trim())) continue;
    const parsed = placeCandidateSchema.safeParse({
      provider: "amap", poiId: poi.id, name: poi.name,
      city: text(poi.cityname) || text(poi.pname), district: text(poi.adname),
      address: text(poi.address), adcode: poi.adcode, category: text(poi.type),
      longitude: Number(location[0]), latitude: Number(location[1]),
      coordinateSystem: "GCJ-02", retrievedAt: new Date().toISOString(),
    });
    if (parsed.success && !results.some((item) => item.poiId === parsed.data.poiId)) results.push(parsed.data);
  }
  // A malformed nonempty response is not a successful empty search.
  if (payload.pois.length && !results.length) throw new MapServiceError("地图结果缺少有效坐标或城市，请换个关键词重试。");
  return results;
}

export async function probeStaticMap(webServiceKey: string, signal?: AbortSignal) {
  const url = new URL("https://restapi.amap.com/v3/staticmap");
  url.search = new URLSearchParams({ key: webServiceKey, location: "114.117,22.531", zoom: "13", size: "320*200", scale: "1" }).toString();
  const { bytes, contentType } = await fetchMapResource(url, signal);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(png || jpeg) || !contentType.startsWith("image/") || bytes.length < 100) {
    throw new MapServiceError("静态地图未返回有效图片，请检查 Web 服务权限；导出能力尚未通过。");
  }
  return { available: true as const, format: png ? "png" : "jpeg", bytes: bytes.length };
}

export function amapProxyUrl(path: string[], query: URLSearchParams, browserKey: string, securityCode: string) {
  const pathname = `/${path.join("/")}`;
  // Base map only. Search, route and other Web APIs are never exposed here.
  const hosts: Record<string, string> = {
    "/v4/map/styles": "webapi.amap.com",
    "/v4/map/styles/": "webapi.amap.com",
    "/v3/log/init": "restapi.amap.com",
  };
  const host = hosts[pathname];
  if (!host) throw new MapServiceError("不支持的地图代理请求。", 400);
  if (query.toString().length > 6000) throw new MapServiceError("地图请求过长。", 400);
  const url = new URL(`https://${host}${pathname}`);
  for (const [key, value] of query) {
    if (["key", "jscode", "callback"].includes(key.toLowerCase())) continue;
    if (/url|host|redirect|token|secret/i.test(key)) throw new MapServiceError("地图参数不受支持。", 400);
    url.searchParams.append(key, value);
  }
  const callback = query.get("callback");
  if (callback) {
    if (!/^[A-Za-z_$][\w$]{0,100}(?:\.[A-Za-z_$][\w$]{0,100})*$/.test(callback) || callback.length > 200) throw new MapServiceError("地图回调格式不正确。", 400);
    url.searchParams.set("callback", callback);
  }
  url.searchParams.set("key", browserKey);
  url.searchParams.set("jscode", securityCode);
  return url;
}
