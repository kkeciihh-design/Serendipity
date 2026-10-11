import { describe, expect, it, vi, afterEach } from "vitest";
import { amapProxyUrl, fetchMapResource, searchAmapPlaces, probeStaticMap } from "../lib/amap";
import { coordinateSchema, toGcj02, toWgs84 } from "../lib/places";
import { parseOsmPlaces } from "../lib/osm";

export const osmResult = [{ osm_type: "way", osm_id: 174194694, name: "深圳站", lon: "114.1121107", lat: "22.5344874", category: "building", type: "train_station", display_name: "深圳站, 罗湖区, 深圳市, 广东省, 中国", address: { city: "罗湖区", state: "广东省" } }];
afterEach(() => vi.restoreAllMocks());
describe("coordinates and provider boundaries", () => {
  it("converts WGS84 only once and reverses GCJ-02 without a visible offset", () => {
    const original = { longitude: 114.1121107, latitude: 22.5344874 };
    const converted = toGcj02(original, "WGS84");
    expect(converted.longitude).toBeCloseTo(114.11723, 3);
    expect(converted.latitude).toBeCloseTo(22.53178, 3);
    expect(toGcj02(converted, "GCJ-02")).toEqual(converted);
    expect(toWgs84(converted, "GCJ-02").longitude).toBeCloseTo(original.longitude, 6);
    expect(toWgs84(converted, "GCJ-02").latitude).toBeCloseTo(original.latitude, 6);
    expect(toGcj02({ longitude: 2.3, latitude: 48.8 }, "WGS84")).toEqual({ longitude: 2.3, latitude: 48.8 });
    expect(coordinateSchema.safeParse({ longitude: 22, latitude: 114 }).success).toBe(false);
  });
  it("preserves public POI identity and the actual municipality", () => {
    expect(parseOsmPlaces(osmResult)[0]).toMatchObject({ provider: "osm", poiId: "way:174194694", city: "深圳市", district: "罗湖区", longitude: 114.1121107, coordinateSystem: "WGS84" });
    expect(parseOsmPlaces([])).toEqual([]);
    expect(() => parseOsmPlaces([{ ...osmResult[0], lat: "114" }])).toThrow("坐标");
    expect(() => parseOsmPlaces({ error: "bad" })).toThrow();
  });
  it("limits the AMap proxy to base map endpoints and replaces caller credentials", () => {
    const url = amapProxyUrl(["v4", "map", "styles"], new URLSearchParams("key=wrong&jscode=wrong&callback=AMap.cb&style=normal"), "browser-only", "server-only");
    expect(url.hostname).toBe("webapi.amap.com");
    expect(url.searchParams.get("key")).toBe("browser-only");
    expect(url.searchParams.get("jscode")).toBe("server-only");
    expect(() => amapProxyUrl(["v3", "place", "text"], new URLSearchParams(), "b", "s")).toThrow();
    expect(() => amapProxyUrl(["v3", "log", "init"], new URLSearchParams("callback=alert(1)"), "b", "s")).toThrow();
    expect(() => amapProxyUrl(["v3", "log", "init"], new URLSearchParams("url=http://localhost"), "b", "s")).toThrow();
  });
  it("rejects unexpected hosts, oversized replies and redirects", async () => {
    await expect(fetchMapResource(new URL("http://localhost/private"))).rejects.toThrow();
    const mocked = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("too much"));
    await expect(fetchMapResource(new URL("https://restapi.amap.com/v3/place/text"), undefined, 2)).rejects.toThrow("过大");
    expect(mocked.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it("reports key and quota errors without echoing secrets", async () => {
    const mocked = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "0", infocode: "10001", info: "secret-key" }));
    await expect(searchAmapPlaces("secret-key", "深圳", "深圳站")).rejects.toThrow("Key");
    mocked.mockResolvedValue(Response.json({ status: "0", infocode: "10003" }));
    await expect(searchAmapPlaces("secret-key", "深圳", "深圳站")).rejects.toThrow("额度");
    mocked.mockResolvedValue(Response.json({ status: "1", pois: [] }));
    expect(await searchAmapPlaces("secret-key", "深圳", "不存在")).toEqual([]);
  });
  it("does not treat JSON errors as static map images", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "0" }));
    await expect(probeStaticMap("secret-key")).rejects.toThrow("静态地图");
  });
});
