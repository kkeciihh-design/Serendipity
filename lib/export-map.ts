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

/** Public saved/suggested points, drawn as an offline daily route diagram. */
export function renderGeographicMap(snapshot: ExportSnapshot, options: MobileExportOptions, date: string, city?: string, readableClusters = true) {
  const { text: t } = exportPrivacy(snapshot, options);
  const allPoints = exportMapPoints(snapshot, options, date).filter((point) => !city || point.city === city);
  // A distant train origin must not compress an entire old town into one dot.
  // Draw the largest local group and retain intercity endpoints in the legend.
  const nearby = (a: typeof allPoints[number], b: typeof allPoints[number]) =>
    Math.hypot((a.longitude - b.longitude) * Math.cos((a.latitude + b.latitude) * Math.PI / 360), a.latitude - b.latitude) < 1.5;
  const localGroup = allPoints.map((center) => allPoints.filter((point) => nearby(center, point))).sort((a, b) => b.length - a.length)[0] ?? [];
  const points = allPoints.length >= 3 && localGroup.length >= 2 ? localGroup : allPoints;
  const remote = allPoints.filter((point) => !points.includes(point));
  if (!points.length) return `<aside class="map map-unavailable"><h3>当日动线示意图</h3><p>这一天尚无可用公开坐标；请按下方行程顺序阅读，补充定位后可重新导出地图。</p></aside>`;
  const centerLat = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const xs = points.map((point) => point.longitude * Math.cos(centerLat * Math.PI / 180)), ys = points.map((point) => point.latitude);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(540 / Math.max(.002, maxX - minX), 240 / Math.max(.002, maxY - minY));
  const projected = points.map((_, index) => ({ x: 320 + (xs[index] - (minX + maxX) / 2) * scale, y: 150 - (ys[index] - (minY + maxY) / 2) * scale }));
  const groups = projected.map((point, index) => ({ ...point, indices: [index] }));
  if (readableClusters) {
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) >= 45) continue;
        const count = a.indices.length + b.indices.length;
        a.x = (a.x * a.indices.length + b.x * b.indices.length) / count;
        a.y = (a.y * a.indices.length + b.y * b.indices.length) / count;
        a.indices.push(...b.indices); groups.splice(j, 1); merged = true; break outer;
      }
    }
  }
  const groupLabel = (index: number) => groups[index].indices.length > 1 ? `A${index + 1}` : points[groups[index].indices[0]].label;
  const edges = groups.length > 1 ? `<polyline class="route-line" points="${projected.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}" fill="none" stroke="#7f9b80" stroke-width="4" stroke-linejoin="round" stroke-dasharray="8 5"/>` : "";
  const markers = groups.map((group, index) => `<circle cx="${group.x.toFixed(2)}" cy="${group.y.toFixed(2)}" r="18" fill="${group.indices.some((i) => points[i].suggested) ? "#9b633d" : "#355b42"}"/><text x="${group.x.toFixed(2)}" y="${(group.y + 5).toFixed(2)}" text-anchor="middle" fill="white" font-size="14">${groupLabel(index)}</text>`).join("");
  const hasSuggestions = points.some((point) => point.suggested);
  const hasOsm = points.some((point) => point.provider === "osm");
  return `<aside class="map"><h3>当日动线示意图 · 北 ↑</h3>${remote.length ? `<p class="muted">跨城交通：${remote.map((point) => `${point.label} ${t(point.name)}`).join(" / ")}；下图放大当地行程。</p>` : ""}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300" role="img" aria-label="每日公开地点与行程顺序示意图"><rect width="640" height="300" rx="16" fill="#e9eee3"/><path d="M0 75H640M0 150H640M0 225H640M160 0V300M320 0V300M480 0V300" stroke="#d6ddcd"/>${edges}${markers}</svg><p class="muted map-legend">${hasSuggestions ? "棕色：含待核实建议标点；" : ""}绿色：已确认地点。虚线表示行程顺序，无道路底图，不用于导航。相邻点合并为 A 组，编号对应时间轴。</p><ul>${points.map((point, index) => { const group = groups.findIndex((item) => item.indices.includes(index)); return `<li>${groups[group].indices.length > 1 ? `${groupLabel(group)} · ` : ""}${point.label} · ${t(point.name)}${point.suggested ? "（AI 建议）" : point.area ? "（区域参考）" : ""}</li>`; }).join("")}</ul><p class="credit">${hasOsm ? "已确认地点数据 © OpenStreetMap contributors · ODbL 1.0；" : ""}根据已保存公开坐标绘制，建议地点出发前核实。</p></aside>`;
}
