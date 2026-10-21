import { describe, expect, it } from "vitest";
import { DAILY_FOCUS_MAX_DISTANCE_KM, FOCUSED_MAX_ZOOM, focusedMaxZoom, haversineKm, markerSpreadOffsets, remoteOriginLabel, splitDailyFocus } from "@/lib/daily-focus";
import type { MapMarker } from "@/lib/map-link";

function marker(name: string, latitude: number, longitude: number, title = name): MapMarker {
  return {
    placeId: name,
    name,
    city: "测试",
    address: "",
    precision: "poi",
    coordinateSystem: "WGS84",
    latitude,
    longitude,
    events: [{ id: name, visitNumber: 1, title, timeRange: "09:00–10:00" }],
  };
}

// The real Shenzhen North → Quanzhou day that produced the collapsed viewport.
const shenzhenNorth = marker("深圳北站", 22.6103, 114.0295, "深圳北站乘高铁至泉州站");
const quanzhouDay = [
  marker("泉州站出站口", 24.8736, 118.5852),
  marker("西街", 24.9155, 118.5811),
  marker("开元寺", 24.9173, 118.5811),
  marker("西街钟楼片区", 24.9130, 118.5830),
  marker("西街钟楼住宿片区", 24.9128, 118.5826),
  marker("肃清门广场", 24.9145, 118.5835),
];

describe("splitDailyFocus", () => {
  it("keeps a cross-province origin out of the camera but keeps it on the map", () => {
    const all = [shenzhenNorth, ...quanzhouDay];
    const { focus, remote, fellBack } = splitDailyFocus(all);
    expect(fellBack).toBe(false);
    expect(remote).toEqual([shenzhenNorth]);
    expect(focus).toEqual(quanzhouDay);
    // The camera span is the city block, not the province.
    const latitudes = focus.map((item) => item.latitude);
    expect(Math.max(...latitudes) - Math.min(...latitudes)).toBeLessThan(0.3);
  });

  it("does not drop anything when every node is already in one city", () => {
    const { focus, remote, fellBack } = splitDailyFocus(quanzhouDay);
    expect(remote).toEqual([]);
    expect(focus).toEqual(quanzhouDay);
    expect(fellBack).toBe(false);
  });

  it("falls back to fitting everything for a pure transit day", () => {
    const far = [marker("北京南站", 39.865, 116.378), marker("上海虹桥站", 31.194, 121.320), marker("广州南站", 22.989, 113.268)];
    const { focus, remote, fellBack } = splitDailyFocus(far);
    expect(fellBack).toBe(true);
    expect(focus).toEqual(far);
    expect(remote).toEqual([]);
  });

  it("never invents a filter for a single node", () => {
    expect(splitDailyFocus([shenzhenNorth])).toEqual({ focus: [shenzhenNorth], remote: [], fellBack: false });
    expect(splitDailyFocus([])).toEqual({ focus: [], remote: [], fellBack: false });
  });

  it("ignores an origin just inside the threshold", () => {
    // ~55 km from the Quanzhou cluster: still a same-trip transfer, not a far origin.
    const nearOrigin = marker("厦门北站", 24.6345, 118.0700);
    const { remote } = splitDailyFocus([nearOrigin, ...quanzhouDay]);
    expect(remote).toEqual([]);
  });

  it("measures real distances", () => {
    expect(Math.round(haversineKm(shenzhenNorth, quanzhouDay[1]))).toBeGreaterThan(500);
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(0);
  });

  it("names the excluded station for the arrival badge", () => {
    expect(remoteOriginLabel([shenzhenNorth])).toBe("由深圳北站抵达");
  });

  it("exposes the documented 80 km threshold", () => {
    expect(DAILY_FOCUS_MAX_DISTANCE_KM).toBe(80);
  });
});

describe("focusedMaxZoom", () => {
  const boundsOf = (latSpan: number, lonSpan: number) => ({
    getNorth: () => latSpan, getSouth: () => 0, getEast: () => lonSpan, getWest: () => 0,
  });

  it("zooms in when the whole day sits in one neighbourhood", () => {
    // The real Quanzhou old town spans ~0.09 degrees.
    expect(focusedMaxZoom(boundsOf(0.032, 0.033))).toBe(FOCUSED_MAX_ZOOM);
  });

  it("keeps the historic ceiling for a wide multi-city day", () => {
    expect(focusedMaxZoom(boundsOf(2.4, 4.5))).toBe(15);
  });

  it("keeps the historic ceiling for a degenerate span", () => {
    expect(focusedMaxZoom(boundsOf(0, 0))).toBe(15);
  });
});

describe("markerSpreadOffsets", () => {
  it("leaves well-separated pins untouched", () => {
    const offsets = markerSpreadOffsets([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }]);
    expect(offsets).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
  });

  it("pulls pins sharing one pixel apart", () => {
    const points = [{ x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }];
    const offsets = markerSpreadOffsets(points);
    const placed = points.map((point, index) => ({ x: point.x + offsets[index].x, y: point.y + offsets[index].y }));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y)).toBeGreaterThanOrEqual(26);
      }
    }
  });

  it("is deterministic", () => {
    const points = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
    expect(markerSpreadOffsets(points)).toEqual(markerSpreadOffsets(points));
  });
});
