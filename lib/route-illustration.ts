import { buildMapMarkers, buildMapRoutes, numberPlanEvents, type MapMarker, type MapRoute } from "./map-link";
import type { PlanEvent } from "./plan";
import { toWgs84, type Coordinate, type Place } from "./places";
import type { RouteLeg } from "./routes";

type ReferencePoint = Coordinate & { name: string; city: string; radius: number };

// Geographic reference points, not searched POIs or navigation/booking facts.
// Smaller radii keep schematic nodes within scenic areas rather than spreading
// them across the nearest prefecture. AI and confirmed coordinates take priority.
const referencePoints: ReferencePoint[] = [
  { name: "黄龙九寨站", city: "松潘", latitude: 32.952, longitude: 103.599, radius: .008 },
  { name: "九寨沟沟口|彭丰村|漳扎镇", city: "九寨沟", latitude: 33.277, longitude: 103.919, radius: .012 },
  { name: "五花海", city: "九寨沟", latitude: 33.220, longitude: 103.906, radius: .004 },
  { name: "珍珠滩", city: "九寨沟", latitude: 33.231, longitude: 103.909, radius: .004 },
  { name: "诺日朗", city: "九寨沟", latitude: 33.239, longitude: 103.917, radius: .005 },
  { name: "长海", city: "九寨沟", latitude: 33.043, longitude: 103.939, radius: .004 },
  { name: "九寨沟|九寨", city: "九寨沟", latitude: 33.246, longitude: 103.915, radius: .025 },
  { name: "黄龙景区|黄龙风景", city: "松潘", latitude: 32.745, longitude: 103.824, radius: .008 },
  { name: "霞浦|东壁村|三沙镇", city: "霞浦", latitude: 26.882, longitude: 120.005, radius: .024 },
  { name: "成都东站", city: "成都", latitude: 30.629, longitude: 104.140, radius: .004 },
  { name: "春熙路|太古里", city: "成都", latitude: 30.656, longitude: 104.079, radius: .008 },
  { name: "宽窄巷子", city: "成都", latitude: 30.670, longitude: 104.052, radius: .004 },
  { name: "大熊猫繁育研究基地|熊猫基地", city: "成都", latitude: 30.733, longitude: 104.144, radius: .008 },
  { name: "成都", city: "成都", latitude: 30.660, longitude: 104.065, radius: .035 },
  { name: "西湖|湖滨|断桥", city: "杭州", latitude: 30.246, longitude: 120.143, radius: .015 },
  { name: "灵隐寺|飞来峰", city: "杭州", latitude: 30.241, longitude: 120.095, radius: .005 },
  { name: "杭州", city: "杭州", latitude: 30.274, longitude: 120.155, radius: .025 },
  { name: "青岛|栈桥|八大关", city: "青岛", latitude: 36.064, longitude: 120.353, radius: .024 },
  { name: "深圳", city: "深圳", latitude: 22.543, longitude: 114.058, radius: .028 },
  { name: "广州", city: "广州", latitude: 23.129, longitude: 113.264, radius: .025 },
  { name: "长沙", city: "长沙", latitude: 28.194, longitude: 112.977, radius: .022 },
  { name: "北京", city: "北京", latitude: 39.904, longitude: 116.407, radius: .030 },
  { name: "上海", city: "上海", latitude: 31.230, longitude: 121.474, radius: .028 },
  { name: "重庆", city: "重庆", latitude: 29.563, longitude: 106.551, radius: .027 },
  { name: "南京", city: "南京", latitude: 32.060, longitude: 118.797, radius: .025 },
  { name: "苏州", city: "苏州", latitude: 31.299, longitude: 120.585, radius: .020 },
  { name: "西安", city: "西安", latitude: 34.265, longitude: 108.954, radius: .025 },
  { name: "武汉", city: "武汉", latitude: 30.593, longitude: 114.305, radius: .030 },
  { name: "厦门", city: "厦门", latitude: 24.479, longitude: 118.089, radius: .022 },
  { name: "福州", city: "福州", latitude: 26.074, longitude: 119.296, radius: .024 },
  { name: "泉州", city: "泉州", latitude: 24.908, longitude: 118.587, radius: .020 },
  { name: "桂林", city: "桂林", latitude: 25.274, longitude: 110.299, radius: .023 },
  { name: "阳朔", city: "阳朔", latitude: 24.779, longitude: 110.496, radius: .023 },
  { name: "丽江", city: "丽江", latitude: 26.872, longitude: 100.230, radius: .020 },
  { name: "大理", city: "大理", latitude: 25.695, longitude: 100.164, radius: .024 },
  { name: "昆明", city: "昆明", latitude: 25.038, longitude: 102.718, radius: .028 },
  { name: "三亚", city: "三亚", latitude: 18.252, longitude: 109.512, radius: .027 },
  { name: "海口", city: "海口", latitude: 20.045, longitude: 110.199, radius: .027 },
  { name: "张家界", city: "张家界", latitude: 29.327, longitude: 110.435, radius: .025 },
  { name: "黄山", city: "黄山", latitude: 30.134, longitude: 118.165, radius: .012 },
  { name: "庐山", city: "庐山", latitude: 29.551, longitude: 115.980, radius: .012 },
  { name: "峨眉山", city: "峨眉山", latitude: 29.525, longitude: 103.336, radius: .018 },
  { name: "乐山", city: "乐山", latitude: 29.545, longitude: 103.774, radius: .017 },
  { name: "济南", city: "济南", latitude: 36.651, longitude: 117.120, radius: .025 },
  { name: "大连", city: "大连", latitude: 38.914, longitude: 121.614, radius: .025 },
  { name: "哈尔滨", city: "哈尔滨", latitude: 45.758, longitude: 126.642, radius: .025 },
  { name: "天津", city: "天津", latitude: 39.084, longitude: 117.200, radius: .025 },
  { name: "郑州", city: "郑州", latitude: 34.747, longitude: 113.625, radius: .025 },
  { name: "洛阳", city: "洛阳", latitude: 34.619, longitude: 112.454, radius: .025 },
  { name: "拉萨", city: "拉萨", latitude: 29.653, longitude: 91.117, radius: .023 },
  { name: "西宁", city: "西宁", latitude: 36.617, longitude: 101.778, radius: .025 },
  { name: "兰州", city: "兰州", latitude: 36.061, longitude: 103.834, radius: .025 },
  { name: "乌鲁木齐", city: "乌鲁木齐", latitude: 43.825, longitude: 87.617, radius: .025 },
];

export function destinationReferenceCoordinate(text: string | null | undefined): ReferencePoint | null {
  if (!text) return null;
  return referencePoints.find((point) => point.name.split("|").some((name) => text.includes(name))) ?? null;
}

function eventCoordinate(event: PlanEvent): Coordinate | null {
  const candidate = event as PlanEvent & { latitude?: number | null; longitude?: number | null; coordinateSystem?: "WGS84" | "GCJ-02" };
  if (typeof candidate.latitude !== "number" || !Number.isFinite(candidate.latitude) || Math.abs(candidate.latitude) > 90 ||
    typeof candidate.longitude !== "number" || !Number.isFinite(candidate.longitude) || Math.abs(candidate.longitude) > 180 ||
    (candidate.latitude === 0 && candidate.longitude === 0)) return null;
  return toWgs84({ latitude: candidate.latitude, longitude: candidate.longitude }, candidate.coordinateSystem ?? "WGS84");
}

export function buildDailyRouteMarkers(events: (PlanEvent & { routeCarryOver?: boolean })[], places: Place[], destination?: string | null): MapMarker[] {
  const confirmed = buildMapMarkers(events, places);
  const confirmedIds = new Set(confirmed.flatMap((marker) => marker.events.map((event) => event.id)));
  const numbered = numberPlanEvents(events);
  const supplied = events.map(eventCoordinate).find((point) => point !== null);
  const destinationPoint = destinationReferenceCoordinate(destination);
  const firstPlace = confirmed[0] ? toWgs84(confirmed[0], confirmed[0].coordinateSystem) : null;
  const base = destinationPoint ?? supplied ?? firstPlace;
  const markers: MapMarker[] = [...confirmed];
  for (const [index, item] of numbered.entries()) {
    if (confirmedIds.has(item.event.id)) continue;
    const eventPoint = eventCoordinate(item.event);
    const reference = destinationReferenceCoordinate(item.event.locationName) ?? destinationReferenceCoordinate(item.event.title);
    // Truly unknown destinations still get an explicitly non-geographic diagram;
    // its synthetic coordinates are only layout space, never persisted as POIs.
    const anchor = reference ?? base;
    const radius = reference?.radius ?? destinationPoint?.radius ?? .015;
    const angle = -Math.PI / 2 + index * 2.3999632297;
    const spread = radius * Math.sqrt((index + 1) / Math.max(1, numbered.length));
    const coordinate = eventPoint ?? {
      latitude: Math.max(-89.9, Math.min(89.9, (anchor?.latitude ?? 0) + Math.sin(angle) * spread)),
      longitude: Math.max(-179.9, Math.min(179.9, (anchor?.longitude ?? 0) + Math.cos(angle) * spread)),
    };
    markers.push({
      placeId: `illustration-${item.event.id}`,
      name: item.event.locationName || item.event.title,
      city: reference?.city ?? destinationPoint?.city ?? destination ?? "行程示意",
      address: eventPoint ? "AI 建议位置 · 每日动线参考" : anchor ? "目的地区域参考位置 · 每日动线示意" : "顺序示意位置 · 无地理定位",
      precision: "area_reference",
      coordinateSystem: "WGS84",
      illustrative: true,
      geographic: Boolean(eventPoint || anchor),
      ...coordinate,
      events: [{ id: item.event.id, visitNumber: item.visitNumber, ...(item.visitLabel === "宿" ? { visitLabel: "宿" as const } : {}), title: item.event.title, timeRange: `${item.event.startTime}–${item.event.endTime}` }],
    });
  }
  // Returning to the same suggested hotel is another visit to one location.
  // Show both numbers on one pin rather than letting identical pins hide each other.
  const sharedLocations = new Map<string, MapMarker>();
  const visibleMarkers = markers.filter((marker) => {
    if (!marker.illustrative || !marker.geographic) return true;
    const key = `${marker.name}|${marker.latitude},${marker.longitude}`;
    const existing = sharedLocations.get(key);
    if (!existing) { sharedLocations.set(key, marker); return true; }
    existing.events.push(...marker.events);
    return false;
  });
  return visibleMarkers.sort((a, b) => {
    const position = (marker: MapMarker) => Math.min(...marker.events.map((event) => numbered.findIndex((item) => item.event.id === event.id)));
    return position(a) - position(b);
  });
}

/** Direct ordered links are presentation data, never saved as verified routes. */
export function buildDailyRouteLinks(events: (PlanEvent & { routeCarryOver?: boolean })[], markers: MapMarker[], routes: RouteLeg[] = []): MapRoute[] {
  const numbered = numberPlanEvents(events);
  const actual = buildMapRoutes(routes, markers);
  const markerByEvent = new Map(markers.flatMap((marker) => marker.events.map((event) => [event.id, marker] as const)));
  const links: MapRoute[] = [];
  for (let index = 1; index < numbered.length; index++) {
    const fromId = numbered[index - 1].event.id;
    const toId = numbered[index].event.id;
    const from = markerByEvent.get(fromId); const to = markerByEvent.get(toId);
    if (!from || !to) continue;
    const existing = actual.find((route) => route.fromEventId === fromId && route.toEventId === toId);
    links.push(existing ?? {
      id: `illustration-${fromId}-${toId}`.slice(0, 180), fromEventId: fromId, toEventId: toId,
      mode: "walking", status: "estimated", coordinateSystem: "WGS84", illustrative: true,
      polyline: [toWgs84(from, from.coordinateSystem), toWgs84(to, to.coordinateSystem)],
    });
  }
  return links;
}
