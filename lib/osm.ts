import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MapServiceError } from "./amap";
import { getDataDirectory } from "./data-directory";
import { placeCandidateSchema, type PlaceCandidate } from "./places";

const USER_AGENT = "Serendipity/0.1 (personal local travel planner; https://github.com/kkeciihh-design/Serendipity)";
const CACHE_TTL = 24 * 60 * 60 * 1000;
const state = globalThis as typeof globalThis & { serendipityOsmQueue?: Promise<unknown>; serendipityOsmLastRequest?: number };

export function parseOsmPlaces(payload: unknown, now = new Date().toISOString()): PlaceCandidate[] {
  if (!Array.isArray(payload)) throw new MapServiceError("免费地点服务返回格式异常，请重试。");
  const places: PlaceCandidate[] = [];
  for (const raw of payload.slice(0, 10)) {
    if (!raw || typeof raw !== "object") continue;
    const address = raw.address ?? {};
    // Some Chinese OSM records expose the urban district as address.city.
    // Prefer an explicit municipality in the provider's full address.
    const municipality = typeof raw.display_name === "string" ? raw.display_name.split(",").map((part: string) => part.trim()).find((part: string) => /^[^,]+市$/.test(part)) : undefined;
    const city = municipality || address.city || address.town || address.municipality || address.county || address.state;
    const name = raw.name || raw.display_name?.split(",")[0];
    const parsed = placeCandidateSchema.safeParse({
      provider: "osm", poiId: `${raw.osm_type}:${raw.osm_id}`, name,
      city, district: address.city_district || (municipality && address.city !== municipality ? address.city : "") || address.suburb || address.county || "",
      address: raw.display_name, adcode: "", category: `${raw.class ?? raw.category ?? ""}:${raw.type ?? ""}`,
      longitude: typeof raw.lon === "string" && raw.lon.trim() ? Number(raw.lon) : NaN,
      latitude: typeof raw.lat === "string" && raw.lat.trim() ? Number(raw.lat) : NaN,
      coordinateSystem: "WGS84", retrievedAt: now,
    });
    if (parsed.success && /^(node|way|relation):\d+$/.test(parsed.data.poiId)) places.push(parsed.data);
  }
  if (payload.length && !places.length) throw new MapServiceError("地点结果缺少城市或有效坐标，请补充城市和名称后重试。");
  return places;
}

export async function searchOsmPlaces(city: string, keywords: string, signal?: AbortSignal) {
  const query = `${city.trim()} ${keywords.trim()}`;
  const directory = path.join(getDataDirectory(), "map-search-cache");
  const cacheFile = path.join(directory, `${crypto.createHash("sha256").update(query).digest("hex")}.json`);
  const cached = async () => {
    try {
      const data = JSON.parse(await fs.readFile(cacheFile, "utf8"));
      if (data.expiresAt > Date.now()) return z.array(placeCandidateSchema).parse(data.places);
    } catch { /* A missing or invalid cache never prevents a query. */ }
    return null;
  };
  const existing = await cached();
  if (existing) return existing;
  // Public Nominatim requires a single thread and at most one request/second.
  // Searches are submitted by the user, never on typing, page load or in bulk.
  const previous = state.serendipityOsmQueue ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(async () => {
    const afterWait = await cached();
    if (afterWait) return afterWait;
    if (signal?.aborted) throw new MapServiceError("地点查询已取消。");
    const delay = Math.max(0, 1100 - (Date.now() - (state.serendipityOsmLastRequest ?? 0)));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (signal?.aborted) throw new MapServiceError("地点查询已取消。");
    state.serendipityOsmLastRequest = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ q: query, format: "jsonv2", addressdetails: "1", limit: "8", "accept-language": "zh-CN,en" }).toString();
    let response: Response;
    try {
      response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        redirect: "error", cache: "no-store", signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]),
      });
    } catch { throw new MapServiceError("免费地点服务连接失败或超时，请稍后重试；文字行程仍可使用。"); }
    if (!response.ok || !response.body) throw new MapServiceError(response.status === 429
      ? "免费地点服务请求较多，请稍后重试。" : "免费地点服务暂时不可用，请稍后重试。");
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 300_000) throw new MapServiceError("地点响应过大，请缩小搜索范围。");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new MapServiceError("免费地点服务返回格式异常。"); }
    const places = parseOsmPlaces(payload);
    try {
      await fs.mkdir(directory, { recursive: true });
      // Cap this application-owned cache; filenames are hashes, never input paths.
      const files = await fs.readdir(directory);
      if (files.length >= 500) {
        const oldest = await Promise.all(files.filter((file) => /^[a-f0-9]{64}\.json$/.test(file)).map(async (file) => ({ file, stat: await fs.stat(path.join(directory, file)) })));
        oldest.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
        for (const item of oldest.slice(0, 50)) await fs.unlink(path.join(directory, item.file));
      }
      await fs.writeFile(cacheFile, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL, places }), { mode: 0o600 });
    } catch { /* Read-only cache storage must not discard a successful search. */ }
    return places;
  });
  state.serendipityOsmQueue = task;
  return task;
}
