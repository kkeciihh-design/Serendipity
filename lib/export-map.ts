import { exportPrivacy } from "./export-privacy";
import { ExportError, type ExportSnapshot, type MobileExportOptions } from "./export-snapshot";
import { sortPlanEvents } from "./plan";
import { toWgs84 } from "./places";

export function exportMapPoints(snapshot: ExportSnapshot, options: MobileExportOptions, date: string) {
  const { privateIds } = exportPrivacy(snapshot, options);
  return sortPlanEvents(snapshot.plan.events).filter((event) => event.date === date).flatMap((event, index) => {
    if (privateIds.has(event.id)) return [];
    const place = snapshot.plan.places.find((item) => item.id === event.placeId);
    if (place && place.provider !== "osm") throw new ExportError("此地图来源尚未核验图片导出许可。请使用已确认的 OSM 地点，或选择不含地图的导出。");
    const latitude = place?.latitude ?? event.latitude, longitude = place?.longitude ?? event.longitude;
    if (place && (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)) throw new ExportError("地图坐标不可用，请核对地点后重试。");
    if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    // Convert saved points only. No online basemap, geocoding or private route
    // geometry is fetched or embedded in an offline export.
    const coordinate = toWgs84({ latitude, longitude }, place?.coordinateSystem ?? event.coordinateSystem ?? "WGS84");
    return [{ ...coordinate, eventId: event.id, name: place?.name ?? event.locationName ?? event.title,
      label: `${event.dayNumber}.${index + 1}`, city: place?.city ?? snapshot.plan.requestSnapshot.destination ?? "目的地",
      suggested: !place, area: place?.precision === "area_reference", provider: place?.provider ?? "ai" }];
  });
}

/** Normalizes lodging/area wording so a return to the same place reads once. */
export function normalizeRouteStopKey(value: string) {
  return value
    .replace(/[（(][^（）()]*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/(?:住宿片区|住宿区域|住宿附近|住宿周边|住宿|片区|区域|附近|周边|一带)$/g, "")
    .toLowerCase();
}

/** Public saved/suggested points, drawn as an offline daily route diagram. */
export function renderGeographicMap(snapshot: ExportSnapshot, options: MobileExportOptions, date: string, city?: string, readableClusters = true) {
  void readableClusters;
  const { text: t, privateIds } = exportPrivacy(snapshot, options);
  const dayEvents = sortPlanEvents(snapshot.plan.events).filter((event) => event.date === date);
  type Stop = { label: string; name: string; shortName: string; latitude: number | null; longitude: number | null; suggested: boolean; area: boolean; provider: string };
  const points: Stop[] = [];
  const seenStops = new Set<string>();
  const shortName = (value: string) => value
    .replace(/\s+/g, " ")
    .replace(/[（(][^（）()]*[）)]/g, "")
    .split(/[·｜|，,。;；:：\-—–与或至/]/)[0]
    .replace(/^(?:前往|抵达|游览|参观|入住|打卡|漫步|慢逛|逛|走|看|吃|品尝|体验)+/, "")
    .replace(/(?:游览|参观|漫步|慢逛|打卡|一日游|半日游)+$/, "")
    .replace(/(?:住宿片区|住宿区域|住宿附近|住宿周边|住宿|附近|周边|片区|区域|一带)$/, "")
    .trim();
  for (const [index, event] of dayEvents.entries()) {
    if (privateIds.has(event.id)) continue;
    const place = snapshot.plan.places.find((item) => item.id === event.placeId);
    if (place && place.provider !== "osm") throw new ExportError("此地图来源尚未核验图片导出许可。请使用已确认的 OSM 地点，或选择不含地图的导出。");
    if (city && place && place.city !== city) continue;
    const name = place?.name ?? event.locationName ?? event.title;
    const stopKey = normalizeRouteStopKey(t(name));
    if (seenStops.has(stopKey)) continue;
    if (points.length >= 5) continue;
    seenStops.add(stopKey);
    let latitude: number | null = null, longitude: number | null = null;
    const rawLatitude = place?.latitude ?? event.latitude, rawLongitude = place?.longitude ?? event.longitude;
    if (place && (rawLatitude == null || rawLongitude == null || !Number.isFinite(rawLatitude) || !Number.isFinite(rawLongitude) || Math.abs(rawLatitude) > 90 || Math.abs(rawLongitude) > 180)) {
      throw new ExportError("地图坐标不可用，请核对地点后重试。");
    }
    if (rawLatitude != null && rawLongitude != null && Number.isFinite(rawLatitude) && Number.isFinite(rawLongitude) && Math.abs(rawLatitude) <= 90 && Math.abs(rawLongitude) <= 180) {
      const coordinate = toWgs84({ latitude: rawLatitude, longitude: rawLongitude }, place?.coordinateSystem ?? event.coordinateSystem ?? "WGS84");
      latitude = coordinate.latitude; longitude = coordinate.longitude;
    }
    points.push({ label: `${event.dayNumber}.${index + 1}`, name, shortName: shortName(t(name)) || t(name), latitude, longitude,
      suggested: !place, area: place?.precision === "area_reference", provider: place?.provider ?? "ai" });
  }
  if (!points.length) return `<aside class="map map-unavailable"><h3>当日动线示意图</h3><p>这一天尚无可用公开坐标；请按下方行程顺序阅读，补充定位后可重新导出地图。</p></aside>`;
  // Alternating heights give long Chinese labels their own horizontal band.
  const projected = points.map((_, index) => ({
    x: points.length === 1 ? 320 : 76 + index * (488 / (points.length - 1)),
    y: index % 2 === 0 ? 115 : 175,
  }));
  const height = 280;
  const contour = Array.from({ length: 4 }, (_, index) => {
    const y = 54 + index * 62;
    return `<path d="M-20 ${y} C110 ${y - 24} 205 ${y + 22} 320 ${y - 8} S540 ${y - 28} 660 ${y + 10}" fill="none" stroke="#dce5d2" stroke-width="1.4" stroke-opacity=".72"/>`;
  }).join("");
  const routePath = points.length > 1 ? projected.reduce((path, point, index) => {
    if (index === 0) return `M${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    const previous = projected[index - 1], dx = (point.x - previous.x) * 0.45;
    return `${path} C${(previous.x + dx).toFixed(2)} ${previous.y.toFixed(2)} ${(point.x - dx).toFixed(2)} ${point.y.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, "") : "";
  const edges = routePath ? `<path class="route-line" d="${routePath}" fill="none" stroke="#7f9b80" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="8 6"/>` : "";
  const markers = points.map((point, index) => {
    const { x, y } = projected[index];
    const marker = `<circle class="route-stop" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="17" fill="${point.suggested || point.area ? "#a9703f" : "#355b42"}"/><text x="${x.toFixed(2)}" y="${(y + 5).toFixed(2)}" text-anchor="middle" fill="#fffaf0" font-size="13" font-weight="700">${index + 1}</text>`;
    const anchor = x < 104 ? "start" : x > 536 ? "end" : "middle";
    const labelY = index % 2 === 0 ? y - 28 : y + 34;
    const sequenceMark = index < 20 ? String.fromCodePoint(0x2460 + index) : `${index + 1}.`;
    return `${marker}<text x="${x.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="${anchor}" fill="#2c3831" font-size="12" font-weight="650">${sequenceMark} ${point.shortName}</text>`;
  }).join("");
  const hasSuggestions = points.some((point) => point.suggested);
  const hasOsm = points.some((point) => point.provider === "osm");
  return `<aside class="map"><h3>当日动线示意图 · 北 ↑</h3><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 ${height}" role="img" aria-label="每日公开地点与行程顺序示意图"><rect width="640" height="${height}" rx="16" fill="#f4f6ec"/>${contour}<g fill="none" stroke="#a9b49b" stroke-opacity=".75"><circle cx="574" cy="38" r="17" stroke-width="1.3"/><path d="M574 49V27M574 27l-5 7M574 27l5 7" stroke-width="1.5"/><path d="M549 38h50" stroke-width=".8" stroke-opacity=".55"/></g><text x="574" y="21" text-anchor="middle" fill="#87977a" font-size="10">N</text>${edges}${markers}</svg><p class="muted map-legend">${hasSuggestions || points.some((point) => point.area) ? "棕色：建议地点或方位参考；" : ""}绿色：已确认地点。圆点按当日游览顺序编号，虚线仅表示顺序，不用于导航。</p><p class="credit">${hasOsm ? "已确认地点数据 © OpenStreetMap contributors · ODbL 1.0；" : ""}根据已保存公开地点绘制，建议地点出发前核实。</p></aside>`;
}
