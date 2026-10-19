import { describe, expect, it } from "vitest";
import { buildDailyRouteLinks, buildDailyRouteMarkers, destinationReferenceCoordinate } from "../lib/route-illustration";
import { mapMarkerSchema, mapRouteSchema } from "../lib/map-link";
import { toGcj02, type Place } from "../lib/places";
import type { PlanEvent } from "../lib/plan";
import type { RouteLeg } from "../lib/routes";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

function events(destination = "九寨沟") {
  return planFixture(requestFixture(2, { destination })).events.filter((event) => event.dayNumber === 1);
}

describe("generated daily route illustrations", () => {
  it("keeps both visit numbers visible when checking in and returning to the same suggested hotel", () => {
    const source = events().slice(0, 2).map((event) => ({ ...event, locationName: "湖滨酒店", latitude: 30.2555, longitude: 120.1616, coordinateSystem: "WGS84" as const }));
    const markers = buildDailyRouteMarkers(source, [], "杭州");
    expect(markers).toHaveLength(1);
    expect(markers[0].events.map((event) => event.visitNumber)).toEqual([1, 2]);
    expect(new Set(markers[0].events.map((event) => event.id))).toEqual(new Set(source.map((event) => event.id)));
  });
  it.each(["九寨沟", "霞浦", "杭州", "成都", "青岛"])("draws every %s event without requiring a confirmed Place", (destination) => {
    const source = events(destination);
    const markers = buildDailyRouteMarkers(source, [], destination);
    const links = buildDailyRouteLinks(source, markers);
    expect(markers.flatMap((marker) => marker.events)).toHaveLength(source.length);
    expect(links).toHaveLength(source.length - 1);
    expect(markers.every((marker) => marker.illustrative && marker.geographic)).toBe(true);
    const reference = destinationReferenceCoordinate(destination)!;
    expect(markers.every((marker) => Math.abs(marker.latitude - reference.latitude) < .1 && Math.abs(marker.longitude - reference.longitude) < .1)).toBe(true);
    expect(new Set(markers.map((marker) => `${marker.latitude},${marker.longitude}`)).size).toBe(source.length);
    expect(markers.every((marker) => mapMarkerSchema.safeParse(marker).success)).toBe(true);
    expect(links.every((link) => mapRouteSchema.safeParse(link).success && link.illustrative && link.status === "estimated")).toBe(true);
    expect(source.every((event) => !event.placeId)).toBe(true);
  });

  it("uses AI coordinates, converts GCJ-02 and lets a confirmed place override them", () => {
    const source = events().slice(0, 2);
    const wgs = { latitude: 33.220, longitude: 103.906 };
    const gcj = toGcj02(wgs, "WGS84");
    Object.assign(source[0], gcj, { coordinateSystem: "GCJ-02" });
    Object.assign(source[1], { ...wgs, placeId: "selected" });
    const place: Place = {
      id: "selected", provider: "osm", poiId: "node:123", name: "诺日朗服务中心", city: "九寨沟", district: "漳扎镇", address: "九寨沟景区", adcode: "", category: "amenity", coordinateSystem: "WGS84",
      latitude: 33.239, longitude: 103.917, precision: "poi", confirmation: "user_confirmed", confirmedAt: new Date().toISOString(), retrievedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim",
    };
    const markers = buildDailyRouteMarkers(source, [place], "九寨沟");
    const ai = markers.find((marker) => marker.events[0].id === source[0].id)!;
    expect(ai.latitude).toBeCloseTo(wgs.latitude, 5);
    expect(ai.longitude).toBeCloseTo(wgs.longitude, 5);
    expect(ai.illustrative).toBe(true);
    const selected = markers.find((marker) => marker.placeId === "selected")!;
    expect(selected.latitude).toBe(place.latitude);
    expect(selected.illustrative).toBeUndefined();
  });

  it("preserves searched navigation geometry and fills missing adjacent links as illustrations", () => {
    const source = events().slice(0, 3).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const markers = buildDailyRouteMarkers(source, [], "九寨沟");
    const route = {
      id: "navigation", fromEventId: source[0].id, toEventId: source[1].id,
      mode: "driving", status: "verified", coordinateSystem: "WGS84",
      polyline: [{ latitude: 33.22, longitude: 103.90 }, { latitude: 33.23, longitude: 103.91 }],
    } as RouteLeg;
    const links = buildDailyRouteLinks(source, markers, [route]);
    expect(links[0].id).toBe("navigation");
    expect(links[0].polyline).toEqual(route.polyline);
    expect(links[1].illustrative).toBe(true);
    expect(links[1].fromEventId).toBe(source[1].id);
    expect(links[1].toEventId).toBe(source[2].id);
  });

  it("marks a wholly unknown destination as diagram-only rather than placing it on a real map", () => {
    const source = events("某个未知目的地").map((event) => ({ ...event, latitude: null, longitude: null } as PlanEvent));
    const markers = buildDailyRouteMarkers(source, [], "某个未知目的地");
    expect(markers).toHaveLength(source.length);
    expect(markers.every((marker) => marker.geographic === false)).toBe(true);
    expect(buildDailyRouteLinks(source, markers)).toHaveLength(source.length - 1);
  });

  it("keeps detailed meal titles accepted by the plan schema in map messages", () => {
    const source = [{ ...events()[0], title: "午餐 · ".concat("藏式牦牛肉汤锅与青稞饼，人均约 70 元；".repeat(8)), locationName: null }];
    expect(source[0].title.length).toBeGreaterThan(120);
    expect(source[0].title.length).toBeLessThanOrEqual(240);
    const markers = buildDailyRouteMarkers(source, [], "九寨沟");
    expect(mapMarkerSchema.safeParse(markers[0]).success).toBe(true);
  });

  it("handles repeated confirmed visits, city filtering and overnight carry-over without losing sequence", () => {
    const source = events().slice(0, 3).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const carry = { ...source[0], routeCarryOver: true };
    const all = [carry, ...source.slice(1)];
    const markers = buildDailyRouteMarkers(all, [], "九寨沟");
    expect(markers[0].events[0].visitLabel).toBe("宿");
    expect(markers[1].events[0].visitNumber).toBe(1);
    expect(buildDailyRouteLinks(all, markers.slice(1))).toHaveLength(1);
  });
});
