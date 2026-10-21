import { describe, expect, it } from "vitest";
import { LUOJIA_REFERENCE, QUANZHOU_STATION_REFERENCE, XUNPU_VILLAGE_REFERENCE, calibrateSuggestedCoordinates, synchronizeConfirmedPlace } from "../lib/place-reference";
import { osmSearchQuery, parseOsmPlaces, rankOsmPlaces } from "../lib/osm";
import type { Place } from "../lib/places";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { isRoutePair, routeWaypointEvents } from "../lib/route-day";

const activity = { ...planFixture(requestFixture()).events.find((event) => event.id === "d2-activity")!, title: "洛伽寺拍照", locationName: "洛伽寺", latitude: 24.8519, longitude: 118.6466 };
const place: Place = { provider: "osm", poiId: "node:7548511028", id: "osm:node:7548511028:poi", name: "洛伽寺", city: "石狮市", district: "永宁镇", address: "福建省泉州市石狮市", adcode: "", category: "amenity:place_of_worship", ...LUOJIA_REFERENCE,
  coordinateSystem: "WGS84", retrievedAt: "2026-10-19T00:00:00Z", confirmedAt: "2026-10-19T00:00:00Z", confirmation: "user_confirmed", precision: "poi", source: "OpenStreetMap / Nominatim" };

describe("Quanzhou landmark coordinates", () => {
  it("corrects Luojia's 20 km error without changing legitimate intercity and county travel", () => {
    const result = calibrateSuggestedCoordinates([activity,
      { ...activity, id: "home", type: "return_transport", title: "深圳北站", locationName: "深圳北站", latitude: 22.61, longitude: 114.03 },
      { ...activity, id: "county", title: "德化陶瓷", locationName: "德化", latitude: 25.49, longitude: 118.24 },
      { ...activity, id: "foreign", title: "西街", locationName: "泉州西街", latitude: 37.57, longitude: 126.98 }], "福建泉州");
    expect(result[0]).toMatchObject(LUOJIA_REFERENCE);
    expect(result[0].note).toBeNull();
    expect(result[1]).toMatchObject({ latitude: 22.61, longitude: 114.03 });
    expect(result[2]).toMatchObject({ latitude: 25.49, longitude: 118.24 });
    expect(result[3]).toMatchObject({ latitude: null, longitude: null });
  });
  it("corrects actual railway and village references without conflating railway branches or confirmed places", () => {
    const event = (id: string, locationName: string) => ({ ...activity, id, title: locationName, locationName, latitude: 24.8876, longitude: 118.5865 });
    const input = [event("station", "泉州站出站口"), event("return", "西街→泉州高铁站"), event("village", "蟳埔村簪花体验区"),
      event("east", "泉州东站"), event("south", "泉州南站"), event("outbound", "泉州站至深圳北站"),
      { ...event("confirmed", "泉州站"), placeId: "confirmed-station" }, { ...event("locked", "蟳埔村"), locked: true }];
    const result = calibrateSuggestedCoordinates(input, "福建泉州");
    expect(result[0]).toMatchObject(QUANZHOU_STATION_REFERENCE);
    expect(result[1]).toMatchObject(QUANZHOU_STATION_REFERENCE);
    expect(result[2]).toMatchObject(XUNPU_VILLAGE_REFERENCE);
    expect(result[0].note).toBeNull();
    expect(result[2].note).toBeNull();
    for (const index of [3, 4, 5, 6, 7]) expect(result[index]).toEqual(input[index]);
  });
  it("shares the confirmed endpoint with incoming transfers but not outgoing, locked or next-day visits", () => {
    const incoming = { ...activity, id: "incoming", type: "local_transport" as const, title: "打车前往洛伽寺", locationName: "蟳埔村→洛伽寺" };
    const outgoing = { ...incoming, id: "outgoing", title: "回西街", locationName: "洛伽寺→西街" };
    const nextDay = { ...activity, id: "next", dayNumber: 3, date: "2026-11-09" };
    const locked = { ...incoming, id: "locked", locked: true };
    const result = synchronizeConfirmedPlace([activity, incoming, outgoing, nextDay, locked], activity, place);
    expect(result[0].placeId).toBe(place.id); expect(result[1].placeId).toBe(place.id);
    expect(result[1]).toMatchObject(LUOJIA_REFERENCE);
    expect(result[2]).toEqual(outgoing); expect(result[3]).toEqual(nextDay); expect(result[4]).toEqual(locked);
  });
  it("queries the district and rejects foreign and unrelated college results", () => {
    expect(osmSearchQuery("福建泉州", "洛伽寺")).toBe("福建省 石狮市 洛伽寺");
    expect(osmSearchQuery("泉州", "蟳埔村")).toContain("蟳埔渔村");
    expect(parseOsmPlaces([{ name: "全州韓定食", address: { country_code: "kr" } }])).toEqual([]);
    const college = { ...place, name: "泉州海洋职业学院", category: "amenity:college" };
    const village = { ...place, name: "蟳埔渔村", category: "place:village" };
    expect(rankOsmPlaces([college, village], "泉州", "蟳埔村")).toEqual([village]);
  });
  it("keeps route adjacency across a synchronized transfer without skipping a real intervening visit", () => {
    const origin = { ...activity, id: "from", type: "meal" as const, placeId: "old-city", startTime: "12:00", endTime: "13:00" };
    const transfer = { ...activity, id: "access", type: "local_transport" as const, placeId: place.id, startTime: "13:00", endTime: "14:00" };
    const target = { ...activity, placeId: place.id, startTime: "14:00", endTime: "16:00" };
    expect(isRoutePair([origin, transfer, target], origin.id, target.id)).toBe(true);
    expect(routeWaypointEvents([origin, transfer, target]).map((event) => event.id)).toEqual([origin.id, target.id]);
    expect(isRoutePair([origin, { ...transfer, type: "activity" }, target], origin.id, target.id)).toBe(false);
    expect(isRoutePair([origin, { ...transfer, placeId: "other-city" }, target], origin.id, target.id)).toBe(false);
  });
});
