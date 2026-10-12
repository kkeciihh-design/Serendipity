import { describe, expect, it } from "vitest";
import { buildMapMarkers, formatVisitNumber, numberPlanEvents } from "../lib/map-link";
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
