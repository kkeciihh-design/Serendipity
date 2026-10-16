// Explicit maintenance command for this finite, reviewed directory. It is never
// called by the application and accepts no external URLs or user input.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { URL, URLSearchParams } from "node:url";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const evidenceDirectory = path.join(root, "docs", "阶段验收", "证据", "阶段-18");
const imageDirectory = path.join(root, "public", "restaurants");
const allowedHosts = new Set([
  "commons.wikimedia.org", "thumb.wikimedia.org", "upload.wikimedia.org",
  "www.huogongdian.com", "en.wikivoyage.org", "nominatim.openstreetmap.org",
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


await fs.mkdir(evidenceDirectory, { recursive: true });
await fs.mkdir(imageDirectory, { recursive: true });
const official=[];
for (const suffix of ["/stores.html", "/hunan.html"]) {
  const { body, record } = await readBounded("https://www.huogongdian.com" + suffix, 1024*1024, "text/html");
  official.push({ ...record, extractedText: clean(body.toString("utf8")) });
}
const voyageUrl = "https://en.wikivoyage.org/w/api.php?" + new URLSearchParams({ action:"parse",page:"Changsha",prop:"wikitext",format:"json" });
const voyage = await readBounded(voyageUrl, 1024*1024, "application/json");
const wikitext=JSON.parse(voyage.body.toString("utf8")).parse.wikitext["*"];
const section=wikitext.slice(wikitext.indexOf("| name=Xiao'er Noodles Restaurant"),wikitext.indexOf("===Restaurants==="));
const metadataUrl = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({action:"query",titles:"File:火宫殿.jpg",prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"960",format:"json"});
const metadataRead=await readBounded(metadataUrl,1024*1024,"application/json");
const page=Object.values(JSON.parse(metadataRead.body.toString("utf8")).query.pages)[0];
const info=page.imageinfo[0], meta=info.extmetadata;
if(page.title!=="File:火宫殿.jpg" || !meta.Categories.value.split("|").includes("Fire Palace, Changsha") || meta.LicenseShortName.value!=="CC BY-SA 4.0" || meta.Restrictions?.value) throw new Error("Unreviewed image identity/license");
const photo=await readBounded(info.thumburl,4*1024*1024,"image/jpeg");
const converted=await sharp(photo.body,{limitInputPixels:16_000_000,failOn:"warning"}).rotate().resize({width:960,height:960,fit:"inside",withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
if(converted.data.length>400_000)throw new Error("Image too large");
await fs.writeFile(path.join(imageDirectory,"huogongdian-pozi.webp"),converted.data);
const image={id:"huogongdian-pozi-photo",entryId:"huogongdian-pozi",entityName:"火宫殿坡子街总店",city:"长沙",url:"/restaurants/huogongdian-pozi.webp",sourceUrl:info.descriptionurl,originalUrl:info.url,author:clean(meta.Artist.value),license:meta.LicenseShortName.value,licenseUrl:meta.LicenseUrl.value,width:converted.info.width,height:converted.info.height,displayAllowed:true,exportAllowed:true,retrievedAt:photo.record.retrievedAt,modification:"2022年门店院落实景资料图，非当前现场或菜品图；仅缩小、转换WebP并移除元数据，衍生图沿用原许可。"};
const osm=await readBounded("https://nominatim.openstreetmap.org/lookup?"+new URLSearchParams({osm_ids:"W273730025",format:"jsonv2",addressdetails:"1",extratags:"1"}),1024*1024,"application/json");
const location=JSON.parse(osm.body.toString("utf8"))[0];
if(location.name!=="新玉楼东" || location.address.region!=="长沙市" || location.category!=="amenity" || location.type!=="restaurant") throw new Error("OSM identity mismatch");
const candidate={provider:"osm",poiId:"way:"+location.osm_id,name:location.name,city:"长沙市",district:"芙蓉区",address:location.display_name,adcode:"",category:"amenity:restaurant",longitude:Number(location.lon),latitude:Number(location.lat),coordinateSystem:"WGS84",retrievedAt:osm.record.retrievedAt};
await fs.writeFile(path.join(root,"lib","restaurant-assets.json"),JSON.stringify({images:[image],locations:[{entryId:"xinyuloudong-wanjiali",candidate}],sources:{official:official.map(({url,retrievedAt})=>({url,retrievedAt})),voyage:{url:"https://en.wikivoyage.org/wiki/Changsha#Eat",retrievedAt:voyage.record.retrievedAt}}},null,2)+"\n");
await fs.writeFile(path.join(evidenceDirectory,"real-restaurant-sources.json"),JSON.stringify({evidenceType:"real-network-read",official,voyage:{...voyage.record,section},image:{...image,metadata:meta,sha256:crypto.createHash("sha256").update(converted.data).digest("hex")},location:{...osm.record,result:location},reads},null,2)+"\n");
console.log(JSON.stringify({officialPages:official.length,communityMenu:section,image,candidate},null,2));
