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

export function osmSearchQuery(city: string, keywords: string) {
  const name = keywords.trim();
  if (/泉州|石狮/.test(city) && /洛[伽迦]寺/.test(name)) return "福建省 石狮市 洛伽寺";
  if (/泉州/.test(city) && /蟳埔/.test(name)) return "福建省 泉州市 蟳埔渔村";
  return `${city.trim()} ${name}`;
}

export function rankOsmPlaces(places: PlaceCandidate[], city: string, keywords: string) {
  const aliases = /洛[伽迦]寺/.test(keywords) ? ["洛伽寺", "洛迦寺"] : /蟳埔/.test(keywords) ? ["蟳埔村", "蟳埔渔村", "蟳埔"] : [keywords.trim()];
  const cityParts = city.split(/省|市|县|区|\s+/).filter((part) => part.length >= 2);
  const relevant = places.filter((place) => {
    // Specific landmark queries must not silently substitute an unrelated
    // college/restaurant merely because its address has similar characters.
    if (/洛[伽迦]寺|蟳埔/.test(keywords)) return aliases.some((name) => place.name.includes(name)) && !/college|university|school|restaurant/.test(place.category);
    return true;
  });
  const score = (place: PlaceCandidate) =>
    (aliases.some((name) => place.name === name) ? 100 : aliases.some((name) => place.name.includes(name)) ? 60 : 0) +
    cityParts.reduce((sum, part) => sum + (`${place.city} ${place.address}`.includes(part) ? 10 : 0), 0) -
    (/college|university|school/.test(place.category) && !/学院|大学|学校/.test(keywords) ? 50 : 0);
  return relevant.sort((a, b) => score(b) - score(a));
}

export function parseOsmPlaces(payload: unknown, now = new Date().toISOString()): PlaceCandidate[] {
  if (!Array.isArray(payload)) throw new MapServiceError("免费地点服务返回格式异常，请重试。");
  const places: PlaceCandidate[] = [];
  for (const raw of payload.slice(0, 10)) {
    if (!raw || typeof raw !== "object") continue;
    const address = raw.address ?? {};
    if (typeof address.country_code === "string" && address.country_code.toLowerCase() !== "cn") continue;
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
  if (payload.length && !places.length && payload.some((raw) => raw?.address?.country_code === undefined || raw?.address?.country_code === "cn")) throw new MapServiceError("地点结果缺少城市或有效坐标，请补充城市和名称后重试。");
  return places;
}

export async function searchOsmPlaces(city: string, keywords: string, signal?: AbortSignal) {
  const query = osmSearchQuery(city, keywords);
  const directory = path.join(getDataDirectory(), "map-search-cache");
  const cacheFile = path.join(directory, `${crypto.createHash("sha256").update(`cn-v2:${query}`).digest("hex")}.json`);
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
    url.search = new URLSearchParams({ q: query, countrycodes: "cn", format: "jsonv2", addressdetails: "1", limit: "8", "accept-language": "zh-CN,en" }).toString();
    if (/泉州|石狮|晋江/.test(city)) url.searchParams.set("viewbox", "117.35,26,119.1,24.35");
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
    const places = rankOsmPlaces(parseOsmPlaces(payload), city, keywords);
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
