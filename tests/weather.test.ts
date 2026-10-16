import { describe, expect, it } from "vitest";
import { effectiveWeatherStatus, fetchOpenMeteoDailyForecast, parseWeatherRecords, unknownWeatherRecord, weatherSummary } from "../lib/weather";
const now = new Date("2026-10-16T08:00:00Z");
const input = { locationName: "长沙", latitude: 28.2, longitude: 112.98, dates: ["2026-10-16"], now };
export const weatherPayload = (dates = ["2026-10-16"]) => ({ daily: { time: dates, temperature_2m_max: dates.map(() => 28), temperature_2m_min: dates.map(() => 18), precipitation_sum: dates.map(() => 12), precipitation_probability_max: dates.map(() => 80), weather_code: dates.map(() => 61), wind_speed_10m_max: dates.map(() => 10) } });
describe("天气范围、读取与降级", () => {
  it("uses actual requested dates, sorts duplicates and persists UTC windows", async () => {
    let url = "";
    const records = await fetchOpenMeteoDailyForecast({ ...input, dates: ["2026-10-17", "2026-10-16", "2026-10-17"], fetchImpl: async (value) => { url = value; return Response.json(weatherPayload(["2026-10-16", "2026-10-17"])); } });
    expect(url).toContain("start_date=2026-10-16"); expect(url).toContain("end_date=2026-10-17");
    expect(records).toHaveLength(2); expect(records[0]).toMatchObject({ status: "fresh", applicableFrom: "2026-10-15T16:00:00.000Z", applicableUntil: "2026-10-16T15:59:59.000Z" });
    expect(parseWeatherRecords(JSON.stringify(records))).toEqual(records);
  });
  it("does not query past or beyond day 16 and permits the last forecast day", async () => {
    let calls = 0;
    const records = await fetchOpenMeteoDailyForecast({ ...input, dates: ["2026-10-15", "2026-10-31", "2026-11-01"], fetchImpl: async () => { calls++; return Response.json(weatherPayload(["2026-10-31"])); } });
    expect(calls).toBe(1); expect(records.map((r) => r.status)).toEqual(["fresh", "out_of_range", "out_of_range"]);
    await fetchOpenMeteoDailyForecast({ ...input, dates: ["2026-11-01"], fetchImpl: async () => { throw new Error("must not call"); } });
  });
  it("expires at one hour and across the Shanghai date boundary, rejecting future retrieval timestamps", () => {
    const record = { status: "fresh" as const, date: "2026-10-16", retrievedAt: now.toISOString() };
    expect(effectiveWeatherStatus(record, new Date(+now + 3_599_999))).toBe("fresh");
    expect(effectiveWeatherStatus(record, new Date(+now + 3_600_000))).toBe("stale");
    expect(effectiveWeatherStatus(record, new Date("2026-10-16T16:00:00Z"))).toBe("out_of_range");
    expect(effectiveWeatherStatus(record, new Date(+now - 1))).toBe("stale");
  });
  it.each(["timeout", "http", "malformed", "missing", "duplicate", "oversize"])("downgrades %s without fabricating weather", async (mode) => {
    const records = await fetchOpenMeteoDailyForecast({ ...input, fetchImpl: async () => {
      if (mode === "timeout") throw new DOMException("timeout", "TimeoutError");
      if (mode === "http") return new Response("", { status: 429 });
      if (mode === "malformed") return new Response("not JSON");
      if (mode === "oversize") return new Response(" ".repeat(300_000));
      if (mode === "duplicate") return Response.json(weatherPayload(["2026-10-16", "2026-10-16"]));
      const data = weatherPayload(); data.daily.temperature_2m_max = []; return Response.json(data);
    } });
    expect(records[0].status).toBe("failed"); expect(records[0].temperatureMinC).toBeNull();
  });
  it("does not replace missing temperature with zero and validates dates/coordinates", async () => {
    expect(weatherSummary({ ...unknownWeatherRecord({ ...input, date: input.dates[0], status: "unknown" }), status: "fresh" })).toContain("气温未知");
    await expect(fetchOpenMeteoDailyForecast({ ...input, latitude: NaN })).rejects.toThrow();
    await expect(fetchOpenMeteoDailyForecast({ ...input, dates: ["2026-02-30"] })).rejects.toThrow();
  });
});
