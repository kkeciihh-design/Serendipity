import { describe, expect, it } from "vitest";
import { buildAmapTransitLink, chinaDateTimeInput, formatRouteFare, safeReferenceUrl } from "../lib/transit-reference";

describe("manual transit links and display", () => {
  const from = { name: "起点,&mode=car", longitude: 114.1, latitude: 22.5, coordinateSystem: "WGS84" as const };
  const to = { name: "终点 地铁站", longitude: 114.2, latitude: 22.6, coordinateSystem: "GCJ-02" as const };
  it("opens the official transit URI with correctly encoded names and converted coordinates", () => {
    const url = new URL(buildAmapTransitLink(from, to));
    expect(url.origin + url.pathname).toBe("https://uri.amap.com/navigation");
    expect(url.searchParams.get("mode")).toBe("bus");
    expect(url.searchParams.get("coordinate")).toBe("gaode");
    expect(url.searchParams.get("from")).toContain("起点，&mode=car");
    expect(url.searchParams.get("from")).not.toContain("114.100000,22.500000");
    expect(url.searchParams.get("to")).toBe("114.200000,22.600000,终点 地铁站");
    expect(url.searchParams.has("key")).toBe(false);
    expect(url.searchParams.has("date")).toBe(false);
  });
  it("rejects unsafe reference URLs and does not render link credentials", () => {
    expect(safeReferenceUrl("javascript:alert(1)")).toBeNull();
    expect(safeReferenceUrl("data:text/html,hello")).toBeNull();
    expect(safeReferenceUrl("https://user:secret@example.com")).toBeNull();
    expect(safeReferenceUrl("https://example.com/?q=公交")).toBe("https://example.com/?q=%E5%85%AC%E4%BA%A4");
  });
  it("preserves fractional yuan and formats read time in China timezone", () => {
    expect(formatRouteFare(250)).toBe("2.5 元");
    expect(formatRouteFare(205)).toBe("2.05 元");
    expect(formatRouteFare(20000)).toBe("200 元");
    expect(formatRouteFare(0)).toBe("0 元");
    expect(formatRouteFare(null)).toBe("费用待确认");
    expect(chinaDateTimeInput("2026-10-13T04:05:00.000Z")).toBe("2026-10-13T12:05");
  });
});
