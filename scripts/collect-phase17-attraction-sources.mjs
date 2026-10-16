// Explicit maintenance command for this finite, reviewed directory. It is never
// called by the application and accepts no external URLs or user input.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { URL, URLSearchParams } from "node:url";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const evidenceDirectory = path.join(root, "docs", "阶段验收", "证据", "阶段-17");
const imageDirectory = path.join(root, "public", "attractions");
const allowedHosts = new Set([
  "commons.wikimedia.org", "thumb.wikimedia.org", "upload.wikimedia.org",
  "www.hnmuseum.com", "ylsy.hnu.edu.cn", "nominatim.openstreetmap.org",
]);
const reads = [];

async function readBounded(raw, maxBytes, expectedType) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.port || url.username || url.password || !allowedHosts.has(url.hostname)) {
    throw new Error("Source is outside the reviewed HTTPS host list.");
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(20_000),
    headers: { "User-Agent": "Serendipity/0.1 finite-attraction-directory-review", Accept: expectedType },
  });
  const retrievedAt = new Date().toISOString();
  if (!response.ok || !response.body) throw new Error(`${url.hostname}: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(expectedType)) throw new Error(`Unexpected content type: ${contentType}`);
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Source exceeds byte limit.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Source exceeds byte limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks);
  const record = { url: url.href, httpStatus: response.status, contentType, retrievedAt, bytes: size, sha256: crypto.createHash("sha256").update(body).digest("hex") };
  reads.push(record);
  return { body, record };
}

const clean = (value) => value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const officialUrls = [
  "https://www.hnmuseum.com/zh-hans/",
  "https://www.hnmuseum.com/zh-hans/content/%E5%8F%82%E8%A7%82",
  "https://ylsy.hnu.edu.cn/sygk.htm",
  "https://ylsy.hnu.edu.cn/wbly/cgdn/kfsj.htm",
  "https://ylsy.hnu.edu.cn/wbly/cgdn/zxdp.htm",
  "https://ylsy.hnu.edu.cn/wbly/cgdn/ylxz.htm",
];

const definitions = [
  { id: "hunan-museum", entityName: "湖南博物院", title: "File:New building of Hunan Museum 20230403a.jpg", category: "Hunan Museum", query: "Hunan Museum Changsha", osmId: 269856520 },
  { id: "yuelu-academy", entityName: "岳麓书院", title: "File:Lecture Hall of Yuelu Academy 20251018.jpg", category: "Lecture Hall of Yuelu Academy", query: "Yuelu Academy Changsha", osmId: 272516791 },
  { id: "orange-isle", entityName: "橘子洲", title: "File:China (13964243839).jpg", category: "Orange Isle", query: "Orange Isle Changsha", osmId: 16734076 },
];

await fs.mkdir(evidenceDirectory, { recursive: true });
await fs.mkdir(imageDirectory, { recursive: true });
const official = await Promise.all(officialUrls.map(async (url) => {
  const result = await readBounded(url, 1024 * 1024, "text/html");
  return { ...result.record, extractedText: clean(result.body.toString("utf8")) };
}));
const images = [];
const locations = [];
for (const definition of definitions) {
  const params = new URLSearchParams({ action: "query", titles: definition.title, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "960", format: "json" });
  const metadataRead = await readBounded(`https://commons.wikimedia.org/w/api.php?${params}`, 1024 * 1024, "application/json");
  const pages = Object.values(JSON.parse(metadataRead.body.toString("utf8")).query.pages);
  if (pages.length !== 1 || pages[0].title !== definition.title) throw new Error("Image identity mismatch.");
  const info = pages[0].imageinfo?.[0];
  if (!info?.extmetadata.Categories.value.split("|").includes(definition.category)) throw new Error("Image entity category mismatch.");
  const metadata = info.extmetadata;
  if (!["CC BY 2.0", "CC BY 3.0", "CC BY-SA 4.0"].includes(metadata.LicenseShortName.value) || !metadata.Artist?.value || !metadata.LicenseUrl?.value || metadata.Restrictions?.value) {
    throw new Error("Unreviewed image license or restrictions.");
  }
  const photo = await readBounded(info.thumburl, 4 * 1024 * 1024, "image/jpeg");
  const inputMetadata = await sharp(photo.body, { limitInputPixels: 16_000_000, failOn: "warning" }).metadata();
  if (inputMetadata.format !== "jpeg" || (inputMetadata.pages ?? 1) > 1) throw new Error("Unexpected image content.");
  const converted = await sharp(photo.body, { limitInputPixels: 16_000_000, failOn: "warning" })
    .rotate().resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  if (converted.data.length > 400_000) throw new Error("Converted image exceeds the local asset size limit.");
  const fileName = `${definition.id}.webp`;
  await fs.writeFile(path.join(imageDirectory, fileName), converted.data);
  images.push({
    id: `${definition.id}-photo`, url: `/attractions/${fileName}`, sourceUrl: info.descriptionurl, originalUrl: info.url,
    author: clean(metadata.Artist.value), license: metadata.LicenseShortName.value, licenseUrl: metadata.LicenseUrl.value,
    entityName: definition.entityName, city: "长沙", entryId: definition.id, width: converted.info.width, height: converted.info.height,
    displayAllowed: true, exportAllowed: true, retrievedAt: photo.record.retrievedAt,
    modification: "实景资料图，非实时现场；仅缩小尺寸、转换为 WebP 并移除图片元数据，衍生图沿用原许可。",
    bytes: converted.data.length, sha256: crypto.createHash("sha256").update(converted.data).digest("hex"),
    metadataRead: metadataRead.record, metadata,
  });
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "5", q: definition.query })}`;
  const locationRead = await readBounded(nominatimUrl, 1024 * 1024, "application/json");
  const results = JSON.parse(locationRead.body.toString("utf8"));
  const location = results.find((item) => item.osm_id === definition.osmId && item.address?.region === "长沙市");
  if (!location) throw new Error("OSM place identity or city mismatch.");
  locations.push({ entryId: definition.id, ...locationRead.record, result: location });
  // Public Nominatim usage is limited to at most one request per second.
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

const result = { evidenceType: "real-network-read", generatedAt: new Date().toISOString(), official, images, locations, reads };
await fs.writeFile(path.join(evidenceDirectory, "real-attraction-sources.json"), `${JSON.stringify(result, null, 2)}\n`);
await fs.writeFile(path.join(root, "lib", "attraction-assets.json"), `${JSON.stringify({
  images: images.map((image) => Object.fromEntries(Object.entries(image).filter(([key]) => !["bytes", "sha256", "metadataRead", "metadata"].includes(key)))),
  locations: locations.map(({ entryId, retrievedAt, result: location }) => ({ entryId, candidate: {
    provider: "osm", poiId: `${location.osm_type}:${location.osm_id}`, name: location.name, city: "长沙市",
    district: location.address.district, address: location.display_name, adcode: "", category: `${location.category}:${location.type}`,
    longitude: Number(location.lon), latitude: Number(location.lat), coordinateSystem: "WGS84", retrievedAt,
  } })),
}, null, 2)}\n`);
console.log(JSON.stringify({ officialPages: official.length, images: images.map(({ entryId, width, height, bytes }) => ({ entryId, width, height, bytes })), locations: locations.map(({ entryId, result: item }) => ({ entryId, osmId: item.osm_id, name: item.name })) }, null, 2));
