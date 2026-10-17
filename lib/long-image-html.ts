import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { renderMobileHtml, MOBILE_HTML_CSP } from "./mobile-export";
import { exportPrivacy } from "./export-privacy";
import { sortPlanEvents } from "./plan";
import { ExportError, type ExportSnapshot, type MobileExportOptions } from "./export-snapshot";
import type { ImageContentOptions } from "./long-image";
import attractions from "./attraction-assets.json";
import restaurants from "./restaurant-assets.json";

const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const assetImages = [...attractions.images, ...restaurants.images];
let fontCss: Promise<string> | undefined;
async function fonts() {
  // Locally bundled OFL fonts: no OS fallback or remote font race.
  fontCss ??= (async () => {
    const cssFile = path.join(process.cwd(), "node_modules/@fontsource/noto-sans-sc/400.css");
    const css = await fs.readFile(cssFile, "utf8");
    const urls = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]))];
    let result = css.replaceAll("font-display: swap", "font-display: block");
    for (const url of urls) {
      const data = await fs.readFile(path.resolve(path.dirname(cssFile), url.replaceAll(/['"]/g, "")));
      result = result.replaceAll(url, `data:font/woff2;base64,${data.toString("base64")}`);
    }
    return result;
  })().catch(() => { fontCss = undefined; throw new ExportError("中文字体无法加载，请修复本机字体依赖后重试。", 503); });
  return fontCss;
}

export function renderGeographicMap(snapshot: ExportSnapshot, options: MobileExportOptions, date: string, city?: string, readableClusters = false) {
  const { text: t, privateIds } = exportPrivacy(snapshot, options);
  const events = sortPlanEvents(snapshot.plan.events).filter((e) => e.date === date);
  // Never include private points, even when address text was opted in. No route
  // geometry or home-adjacent segment can reveal the hidden origin.
  const points = events.flatMap((e, i) => {
    if (privateIds.has(e.id) || !e.placeId) return [];
    const place = snapshot.plan.places.find((p) => p.id === e.placeId);
    if (!place) throw new ExportError("地图地点引用失效，请核对计划后重新生成。");
    if (city && place.city !== city) return [];
    if (place.provider !== "osm" || place.coordinateSystem !== "WGS84") throw new ExportError("此地图来源尚未核验图片导出许可。请取消“包含位置示意图”后生成，或使用已确认的 OSM 地点。");
    if (!Number.isFinite(place.longitude) || !Number.isFinite(place.latitude)) throw new ExportError("地图坐标不可用，请核对地点后重试。");
    return [{ place, label: `${e.dayNumber}.${i + 1}` }];
  });
  if (!points.length) return `<aside class="map"><h3>当日位置示意图</h3><p>尚无可绘制的已确认公开地点；保留完整文字行程，不以城市中心代替地点。</p></aside>`;
  const centerLat = points.reduce((s, p) => s + p.place.latitude, 0) / points.length;
  const xs = points.map((p) => p.place.longitude * Math.cos(centerLat * Math.PI / 180)), ys = points.map((p) => p.place.latitude);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(540 / Math.max(.002, maxX - minX), 290 / Math.max(.002, maxY - minY));
  const groups = points.map((p, i) => ({ x: 320 + (xs[i] - (minX + maxX) / 2) * scale, y: 180 - (ys[i] - (minY + maxY) / 2) * scale, indices: [i] }));
  if (readableClusters) {
    // Merge close markers until all printed labels are distinct. The legend
    // retains every original daily number, including repeat visits to one POI.
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) >= 50) continue;
        const size = a.indices.length + b.indices.length;
        a.x = (a.x * a.indices.length + b.x * b.indices.length) / size; a.y = (a.y * a.indices.length + b.y * b.indices.length) / size;
        a.indices.push(...b.indices); groups.splice(j, 1); merged = true; break outer;
      }
    }
  }
  const groupLabel = (i: number) => groups[i].indices.length > 1 ? `A${i + 1}` : points[groups[i].indices[0]].label;
  const markers = groups.map((g, i) => `<circle cx="${g.x}" cy="${g.y}" r="19" fill="#355b42"/><text x="${g.x}" y="${g.y + 5}" text-anchor="middle" fill="white" font-size="15">${groupLabel(i)}</text>`).join("");
  return `<aside class="map"><h3>当日位置示意图 · 北 ↑</h3><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="已确认公开地点的位置示意图"><rect width="640" height="360" rx="16" fill="#e9eee3"/><path d="M0 90H640M0 180H640M0 270H640M160 0V360M320 0V360M480 0V360" stroke="#d6ddcd"/>${markers}</svg><p class="muted">按已保存坐标绘制，无道路底图；${readableClusters ? "相邻点合并为A组标记，完整行程编号见下表" : "同地点编号可能重叠，完整对应见下表"}。用于位置概览，不用于导航。</p><ul>${points.map((p, index) => { const group = groups.findIndex((g) => g.indices.includes(index)); return `<li>${readableClusters && groups[group].indices.length > 1 ? `${groupLabel(group)} · ` : ""}${p.label} · ${t(p.place.name)}${p.place.precision === "area_reference" ? "（区域参考位置）" : ""}</li>`; }).join("")}</ul><p class="credit">地点数据 © OpenStreetMap contributors · ODbL 1.0<br>https://www.openstreetmap.org/copyright</p></aside>`;
}

export async function renderLongImageHtml(snapshot: ExportSnapshot, options: MobileExportOptions, content: ImageContentOptions) {
  let html = renderMobileHtml(snapshot, options);
  const { privateIds } = exportPrivacy(snapshot, options);
  const events = sortPlanEvents(snapshot.plan.events), dates = [...new Set(events.map((e) => e.date))].filter((d) => !options.dates || options.dates.includes(d));
  for (const date of dates) {
    let visual = content.includeMap ? renderGeographicMap(snapshot, options, date) : "<p class=muted>本次未选择位置示意图。</p>";
    if (content.includePhotos) {
      const chosen = new Set<string>();
      for (const event of events.filter((e) => e.date === date && !privateIds.has(e.id))) {
        const image = assetImages.find((a) => a.entryId === (event.attractionSelection?.catalogId ?? event.restaurantSelection?.catalogId) || a.entityName === event.locationName && a.city === snapshot.plan.requestSnapshot.destination?.replace(/市$/, ""));
        if (!image || chosen.has(image.id)) continue;
        chosen.add(image.id);
        if (!image.exportAllowed || !image.displayAllowed) throw new ExportError("所选照片不允许导出，请取消照片选项后重试。");
        if (!/^\/(attractions|restaurants)\/[a-z0-9-]+\.webp$/.test(image.url)) throw new ExportError("图片资源不在许可目录中。");
        try {
          const buffer = await fs.readFile(path.join(process.cwd(), "public", image.url));
          if (buffer.length > 500_000) throw new Error("size");
          const clean = await sharp(buffer, { limitInputPixels: 2_000_000 }).webp().toBuffer();
          visual += `<figure><img alt="${escape(image.entityName)}资料照片" src="data:image/webp;base64,${clean.toString("base64")}"><figcaption class="credit">${escape(image.entityName)} · ${escape(image.author)} · ${escape(image.license)}<br>${escape(image.sourceUrl)}<br>${escape(image.licenseUrl)}<br>${escape(image.modification)} 版面等比缩小；照片按原许可使用。</figcaption></figure>`;
        } catch { throw new ExportError("许可照片加载失败，请重试，或取消照片选项生成文字与地图长图。", 503); }
      }
      if (!chosen.size) visual += "<p class=muted>该日暂无已核验可导出的照片。</p>";
    }
    html = html.replace(`<ol class="timeline">`, `<div class="visuals">${visual}</div><ol class="timeline" data-mapped="${date}">`);
  }
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, `<meta http-equiv="Content-Security-Policy" content="${escape(MOBILE_HTML_CSP)}; img-src data:; font-src data:">`).replace(/<nav[\s\S]*?<\/nav>/, "").replace(/<a class="back"[\s\S]*?<\/a>/g, "").replaceAll("<details>", "<details open>");
  html = html.replaceAll("随身一页", "旅行长图").replace("可向下滚动或按日期跳转", "请按图片编号顺序阅读").replace(/<footer>[\s\S]*?<\/footer>/, "<footer><p>行程结束 · 请核对返家安排与随身物品。</p><p>静态旅行资料，仅对应生成时的计划。需要新资料时请回到应用重新生成。</p></footer>");
  // Stable event identities are internal markup only; screenshots contain pixels.
  let index = 0;
  const selected = events.filter((e) => dates.includes(e.date));
  html = html.replace(/<li class="event">/g, () => `<li class="event" data-event="${escape(selected[index++].id)}">`);
  return html.replace("</style>", `\n${await fonts()}\n${LONG_CSS}\n.event{list-style:none}</style>`);
}

const LONG_CSS = `body{width:720px;font-family:"Noto Sans SC",sans-serif;font-size:18px;line-height:1.65}header,main,footer{max-width:none;padding:24px 30px}header{padding-top:36px}main{padding-top:0;padding-bottom:0}.muted,.credit{font-size:14px}h1{font-size:34px}h2{font-size:25px}h3{font-size:21px}.event{padding:18px;margin:12px 0}.event p{margin:6px 0}.credit{line-height:1.55;overflow-wrap:anywhere;color:#626b65}figure{margin:20px 0}figure img{display:block;width:100%;max-height:300px;object-fit:contain;background:#e9eee3}svg{display:block;width:100%}.map{margin:16px 0}.map ul{columns:2}.sheet{width:720px;padding:24px 30px;background:#f7f5ed;display:flow-root}.sheet>header,.sheet>footer{padding:12px 0}.sheet>section{margin-bottom:24px}.part-label{font-size:16px;color:#49624e;border-bottom:1px solid #d6ddcd;padding-bottom:12px;margin-bottom:20px}.part-end{font-size:15px;border-top:1px solid #d6ddcd;margin-top:20px;padding-top:12px}details summary{min-height:0}section{margin-bottom:24px}`;
