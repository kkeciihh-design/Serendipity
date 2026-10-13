import { describe, expect, it } from "vitest";
import { buildMapMarkers, buildMapRoutes, formatVisitNumber, numberPlanEvents, routeArrowRotation } from "../lib/map-link";
import type { RouteLeg } from "../lib/routes";
import type { PlanEvent } from "../lib/plan";
import type { Place } from "../lib/places";

function event(id: string, startTime: string, placeId?: string): PlanEvent {
  return {
    id,
    dayNumber: 1,
    date: "2026-10-12",
    startTime,
    endTime: "23:00",
    type: "activity",
    title: id,
    locationName: id,
    placeId,
    order: null,
    status: "suggested",
    locked: false,
    suggestedDurationSeconds: 60,
    costDraftCents: 0,
    costStatus: "estimated",
    note: null,
  };
}

function place(id: string): Place {
  return {
    id,
    provider: "osm",
    poiId: `node:${id}`,
    name: id,
    city: "深圳市",
    district: "罗湖区",
    address: "深圳市罗湖区",
    adcode: "",
    category: "hotel",
    coordinateSystem: "WGS84",
    latitude: 22.5,
    longitude: 114.1,
    precision: "poi",
    confirmation: "user_confirmed",
    confirmedAt: "2026-10-11T08:00:00.000Z",
    retrievedAt: "2026-10-11T08:00:00.000Z",
    source: "OpenStreetMap / Nominatim",
  };
}

describe("map and timeline link numbering", () => {
  it("numbers events by actual daily visit order", () => {
    const numbered = numberPlanEvents([
      event("late", "14:00"),
      event("early", "08:00"),
    ]);
    expect(numbered.map((item) => [item.event.id, item.visitLabel])).toEqual([
      ["early", "①"],
      ["late", "②"],
    ]);
    expect(formatVisitNumber(21)).toBe("21");
  });

  it("keeps repeated visits as separate events while merging one map marker", () => {
    const hotel = place("hotel");
    const markers = buildMapMarkers(
      [event("morning", "08:00", "hotel"), event("evening", "20:00", "hotel")],
      [hotel],
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].events.map((item) => item.id)).toEqual(["morning", "evening"]);
    expect(markers[0].events.map((item) => item.visitNumber)).toEqual([1, 2]);
  });
});

describe("audit map routes and direction", () => {
  const route = (id: string, fromEventId: string, toEventId: string) => ({
    id, fromEventId, toEventId, mode: "walking", status: "verified", coordinateSystem: "WGS84",
    polyline: [{ longitude: 114, latitude: 22.5 }, { longitude: 114.01, latitude: 22.51 }],
  } as RouteLeg);

  it("only draws routes whose two endpoints belong to the selected day and city", () => {
    const day1 = [event("a", "08:00", "shenzhen-a"), event("b", "10:00", "shenzhen-b"), event("c", "12:00", "guangzhou")];
    const day2 = [event("d", "08:00", "shenzhen-a"), event("e", "10:00", "shenzhen-b")];
    const places = [place("shenzhen-a"), place("shenzhen-b"), { ...place("guangzhou"), city: "广州市" }];
    const routes = [route("day1-local", "a", "b"), route("day1-cross-city", "b", "c"), route("day2", "d", "e")];
    expect(buildMapRoutes(routes, buildMapMarkers(day1, places)).map((item) => item.id)).toEqual(["day1-local", "day1-cross-city"]);
    expect(buildMapRoutes(routes, buildMapMarkers(day2, places)).map((item) => item.id)).toEqual(["day2"]);
    expect(buildMapRoutes(routes, buildMapMarkers(day1, places.filter((item) => item.city === "深圳市"))).map((item) => item.id)).toEqual(["day1-local"]);
    expect(buildMapRoutes(routes, [])).toEqual([]);
  });

  it.each([
    ["north", { longitude: 0, latitude: 1 }, 270],
    ["east", { longitude: 1, latitude: 0 }, 0],
    ["south", { longitude: 0, latitude: -1 }, 90],
    ["west", { longitude: -1, latitude: 0 }, 180],
  ])("points the right-arrow glyph %s using CSS rotation", (_direction, end, rotation) => {
    expect(routeArrowRotation([{ longitude: 0, latitude: 0 }, end])).toBeCloseTo(rotation);
  });
});
