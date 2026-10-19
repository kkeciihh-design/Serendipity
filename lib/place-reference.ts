import type { PlanEvent } from "./plan";
import type { Place } from "./places";

// A public landmark reference, not a navigation result or user confirmation.
// OSM node 7548511028: https://www.openstreetmap.org/node/7548511028
export const LUOJIA_REFERENCE = { latitude: 24.6762788, longitude: 118.7080767 };
// Nominatim read on 2026-10-19: railway:station, 北峰街道 / 泉州市.
// https://www.openstreetmap.org/node/1879551038 (not 泉州东站 / 泉州南站).
export const QUANZHOU_STATION_REFERENCE = { latitude: 24.9768893, longitude: 118.5631517 };
// Nominatim residential-area centroid, not a shop or village entrance.
// https://www.openstreetmap.org/way/538404620 (蟳埔渔村, 东海街道 / 泉州市).
export const XUNPU_VILLAGE_REFERENCE = { latitude: 24.8646012, longitude: 118.6477934 };
const quanzhou = /泉州|石狮|晋江|南安|惠安|安溪|永春|德化/;
const luojia = /洛[伽迦]寺/;

function locationText(event: PlanEvent) { return `${event.locationName ?? ""} ${event.title}`; }
function withReferenceNote(event: PlanEvent, note: string): PlanEvent {
  const previous = event.note?.trim() ?? "";
  const separator = previous && !/[。！？；.!?;]$/.test(previous) ? "；" : "";
  const combined = previous.includes(note) ? previous : `${previous}${separator}${note}`;
  return { ...event, note: combined.replace(/。\s*；/g, "。").slice(0, 6000) };
}

export function calibrateSuggestedCoordinates(events: PlanEvent[], destination: string | null | undefined): PlanEvent[] {
  return events.map((event) => {
    if (event.placeId || event.locked || event.status === "confirmed") return event;
    const text = locationText(event);
    if (!(quanzhou.test(destination ?? "") || /泉州|石狮/.test(text))) return event;
    // A transfer's endpoint is its locationName. Its note/title may mention an
    // attraction it is leaving, so never use those incidental mentions as POIs.
    const endpoint = event.locationName || event.title;
    const namedEndpoint = destinationName(endpoint);
    if (/泉州(?:高铁|火车)?站/.test(namedEndpoint) && !/泉州[东南西北]站/.test(namedEndpoint)) {
      return withReferenceNote({ ...event, ...QUANZHOU_STATION_REFERENCE, coordinateSystem: "WGS84" }, "泉州站标点按公共铁路站区基准校准（OSM 1879551038），仍为待核实建议标点，具体出入口请按票面及站内指引确认");
    }
    if (/[蟳浔]埔(?:渔)?村/.test(namedEndpoint)) {
      return withReferenceNote({ ...event, ...XUNPU_VILLAGE_REFERENCE, coordinateSystem: "WGS84" }, "蟳埔村使用蟳埔渔村区域参考点（OSM 538404620），仍为待核实建议标点，簪花店及具体入口需另行确认");
    }
    if (luojia.test(namedEndpoint)) {
      return withReferenceNote({ ...event, ...LUOJIA_REFERENCE, coordinateSystem: "WGS84" }, "洛伽寺标点按石狮海岸公共地标基准校准（OSM 7548511028），仍为待核实建议标点");
    }
    if (/黄金海岸/.test(namedEndpoint)) {
      return withReferenceNote({ ...event, ...LUOJIA_REFERENCE, coordinateSystem: "WGS84" }, "黄金海岸使用洛伽寺附近海岸区域参考点，具体入口待核实");
    }
    // Quanzhou includes distant county excursions. Only reject clearly
    // out-of-region local suggestions; intercity trips keep their own cities.
    if (["departure_transport", "return_transport"].includes(event.type) || /厦门|福州|深圳|漳州|莆田/.test(text)) return event;
    if (typeof event.latitude === "number" && typeof event.longitude === "number" &&
      (event.latitude < 24.35 || event.latitude > 26 || event.longitude < 117.35 || event.longitude > 119.1)) {
      return withReferenceNote({ ...event, latitude: null, longitude: null }, "建议坐标超出泉州及所辖区县范围，已移除异常点；请按具体地点重新定位");
    }
    return event;
  });
}

function canonicalName(name: string) {
  return name.replace(/洛迦寺/g, "洛伽寺").replace(/蟳埔渔村/g, "蟳埔村")
    .replace(/（[^）]*）|\([^)]*\)/g, "").replace(/\s+/g, "");
}
function destinationName(value: string) {
  return canonicalName(value).split(/→|->|—|–|至|前往|返回|回到/).at(-1) ?? "";
}

/** Confirm one location and reuse that identity for unconfirmed same-day stops. */
export function synchronizeConfirmedPlace(events: PlanEvent[], selected: PlanEvent, place: Place | null): PlanEvent[] {
  const names = [selected.locationName, place?.name].filter((name): name is string => Boolean(name)).map(canonicalName)
    .filter((name) => !/^(?:早餐|午餐|晚餐|午饭|晚饭|餐厅|用餐|住宿|住宿区域|酒店|休息|市区|市中心|车站|景点|活动|出行准备)$/.test(name));
  return events.map((event) => {
    const directlySelected = event.id === selected.id;
    const endpoint = destinationName(event.locationName || event.title);
    const sameDestination = names.some((name) => name.length >= 2 && (endpoint === name || endpoint.endsWith(name)));
    const related = place && event.date === selected.date && sameDestination &&
      !event.locked && event.status !== "confirmed" && !event.ticketManaged &&
      !event.accommodationSelection && (!event.placeId || event.placeId === selected.placeId);
    if (!directlySelected && !related) return event;
    return { ...event, placeId: place?.id ?? null,
      ...(place ? { latitude: place.latitude, longitude: place.longitude, coordinateSystem: place.coordinateSystem,
        locationName: `${place.name.slice(0, 150)}${place.precision === "area_reference" ? "（区域参考点）" : ""}` } : { latitude: null, longitude: null }) };
  });
}
