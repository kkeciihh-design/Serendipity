import { describe, expect, it } from "vitest";
import { advisoryItemSchema } from "../lib/advisories";
import { exportPrivacy } from "../lib/export-privacy";
import { mobileExportOptionsSchema, type ExportSnapshot, type MobileExportOptions } from "../lib/export-snapshot";
import { renderGeographicMap, renderLongImageHtml } from "../lib/long-image-html";
import { renderMobileHtml } from "../lib/mobile-export";
import { renderPdfHtml } from "../lib/pdf-html";
import { placeSchema } from "../lib/places";
import { restaurantCatalog } from "../lib/restaurant-catalog";
import { manualReferenceRoute } from "../lib/routes";
import { renderTextExport } from "../lib/text-export";
import { exportFixture } from "./helpers/export-fixtures";

const options = mobileExportOptionsSchema.parse({});
async function documents(snapshot: ExportSnapshot, choices: MobileExportOptions = options) {
  return [
    renderMobileHtml(snapshot, choices),
    renderTextExport(snapshot, choices, "plain-text"),
    renderTextExport(snapshot, choices, "markdown"),
    await renderLongImageHtml(snapshot, choices, { includeMap: false, includePhotos: false }),
    await renderPdfHtml(snapshot, choices, { mode: "simplified", includePhotos: false }),
  ];
}

function addPlace(snapshot: ExportSnapshot, eventId: string, name: string, address: string, longitude: number, latitude: number) {
  const place = placeSchema.parse({
    id: `place-${eventId}`, provider: "osm", poiId: `node:${snapshot.plan.places.length + 1}`, name, address,
    longitude, latitude, city: "长沙", district: "合成区", adcode: "", category: "test", coordinateSystem: "WGS84",
    retrievedAt: snapshot.generatedAt, precision: "poi", confirmation: "user_confirmed", confirmedAt: snapshot.generatedAt,
    source: "OpenStreetMap / Nominatim",
  });
  snapshot.plan.places.push(place);
  Object.assign(snapshot.plan.events.find((event) => event.id === eventId)!, { placeId: place.id, locationName: name });
  return place;
}

describe("shared export privacy and saved advisories", () => {
  it("R30-01 excludes an address-detected residence and every alias from maps and route details", async () => {
    const snapshot = await exportFixture();
    addPlace(snapshot, "d1-activity", "合成公共地标甲", "公共公园", 112.90, 28.20);
    addPlace(snapshot, "d1-lunch", "合成公共地标乙", "公共公园", 113.00, 28.30);
    const privatePlace = addPlace(snapshot, "d1-rest", "合成天鹅湾", "合成星河小区3栋1201室", 112.956, 28.243);
    Object.assign(snapshot.plan.events.find((event) => event.id === "d1-rest")!, { title: "午间休息" });
    Object.assign(snapshot.plan.events.find((event) => event.id === "d1-hotel")!, { placeId: privatePlace.id, locationName: "晚间休息别名" });
    const date = snapshot.plan.events[0].date;
    for (const [fromEventId, toEventId] of [["d1-lunch", "d1-rest"], ["d1-rest", "d1-hotel"]]) {
      snapshot.plan.routeLegs.push(manualReferenceRoute({ tripId: snapshot.plan.tripId, date, edit: {
        fromEventId, toEventId, departureTime: "13:30", manualReference: {
          availability: "available", durationMinutes: 20, fareCents: null, sourceName: "合成隐私接驳来源", sourceUrl: null,
          instructions: "在合成树旁穿过暗门，再沿合成支路直行到接送点", checkedAt: snapshot.generatedAt, acknowledged: true,
        },
      } }));
    }
    const original = JSON.stringify(snapshot), privacy = exportPrivacy(snapshot, options);
    expect(privacy.privateIds.has("d1-rest")).toBe(true);
    expect(privacy.privateIds.has("d1-hotel")).toBe(true);
    for (const includePrivateAddress of [false, true]) {
      const map = renderGeographicMap(snapshot, { ...options, includePrivateAddress }, date);
      expect(map.match(/class="route-stop"/g)).toHaveLength(4);
      expect(map).not.toContain(privatePlace.name);
      expect(map).not.toContain("晚间休息别名");
    }
    for (const html of [
      await renderLongImageHtml(snapshot, { ...options, dates: [date] }, { includeMap: true, includePhotos: false }),
      await renderPdfHtml(snapshot, { ...options, dates: [date] }, { mode: "complete", includePhotos: false }),
    ]) {
      expect(html.match(/class="route-stop"/g)).toHaveLength(4);
      expect(html).not.toContain(privatePlace.name);
    }
    for (const document of await documents(snapshot)) {
      for (const secret of [privatePlace.name, privatePlace.address, "晚间休息别名", "合成树旁穿过暗门", "合成隐私接驳来源", "112.956", "28.243"]) expect(document).not.toContain(secret);
      expect(document).toContain("20 分钟");
      expect(document).toContain("22:55");
    }
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it.each([
    "我家：北京市海淀区安宁庄东路一号二单元三零二室",
    "住址：合成星河小区三栋一二零一室",
    "我家在合成星河巷东边",
    "请到我家合成星河巷一号接人",
  ])("R30-01 hides residential free text in every format, including Chinese numerals: %s", async (address) => {
    const snapshot = await exportFixture();
    snapshot.plan.events.find((event) => event.id === "d1-activity")!.note = address;
    for (const document of await documents(snapshot)) {
      expect(document).not.toContain(address);
      expect(document).toContain("私人地址细节已隐藏");
      expect(document).toContain("本次行程结束，核对返家安排");
    }
    for (const document of await documents(snapshot, { ...options, includePrivateAddress: true })) expect(document).toContain(address);
  });

  it.each(["xiaoer-tongtai", "xinyuloudong-wanjiali"])("R30-06 preserves public restaurant %s with its street number and map marker", async (catalogId) => {
    const snapshot = await exportFixture(), entry = restaurantCatalog.find((restaurant) => restaurant.id === catalogId)!;
    const event = snapshot.plan.events.find((item) => item.id === "d1-lunch")!;
    event.title = entry.name;
    event.restaurantSelection = { catalogId, action: "replace", selectedAt: snapshot.generatedAt };
    addPlace(snapshot, event.id, entry.name, entry.name, 113.0256581, 28.1926535);
    expect(exportPrivacy(snapshot, options).privateIds.has(event.id)).toBe(false);
    for (const document of await documents(snapshot)) expect(document).toContain(entry.name);
    const map = renderGeographicMap(snapshot, options, event.date);
    expect(map).toContain(entry.name.replace(/[（(].*$/, ""));
    expect(map).not.toContain("<ul>");
    expect(map.match(/class="route-stop"/g)).toHaveLength(5);
  });

  it("known private journey endpoints still hide a matching street address under another place name", async () => {
    const snapshot = await exportFixture(), address = "合成梧桐路88号";
    snapshot.plan.tickets[0].chainOriginName = address;
    addPlace(snapshot, "d1-rest", "合成午休点", address, 112.956, 28.243);
    expect(exportPrivacy(snapshot, options).privateIds.has("d1-rest")).toBe(true);
    const map = renderGeographicMap(snapshot, options, snapshot.plan.events[0].date);
    expect(map).not.toContain(address);
    expect(map).not.toContain("合成午休点");
  });

  it.each(["我家酸菜鱼（五一广场店）", "我家酸菜鱼(五一广场店)", "我家酸菜鱼", "我家面馆", "我家便利店"])("M1 preserves the public brand '%s' in all five formats and maps", async (name) => {
    const snapshot = await exportFixture(), event = snapshot.plan.events.find((e) => e.id === "d1-lunch")!;
    event.title = name;
    addPlace(snapshot, event.id, name, `${name}，合成商业路88号`, 113, 28.3);
    const original = JSON.stringify(snapshot);
    expect(exportPrivacy(snapshot, options).privateIds.has(event.id)).toBe(false);
    for (const [index, document] of (await documents(snapshot)).entries()) {
      expect(document).toContain(index === 2 ? name.replace(/[()]/g, "\\$&") : name);
    }
    const map = renderGeographicMap(snapshot, options, event.date);
    expect(map).toContain(name.replace(/[（(].*$/, ""));
    expect(map.match(/class="route-stop"/g)).toHaveLength(5);
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it.each(["我家", "回我家", "从我家出发", "我家附近", "我家楼下", "我家附近餐厅", "我家楼下面馆", "我家附近（五一广场店）"])("M1 keeps the home reference '%s' private even with a restaurant category", async (name) => {
    const snapshot = await exportFixture(), event = snapshot.plan.events.find((e) => e.id === "d1-rest")!;
    event.title = name;
    addPlace(snapshot, event.id, name, "合成梧桐路88号", 113, 28.3).category = "amenity:restaurant";
    expect(exportPrivacy(snapshot, options).privateIds.has(event.id)).toBe(true);
    const map = renderGeographicMap(snapshot, options, event.date);
    expect(map).not.toContain(name);
    expect(map).not.toContain("合成梧桐路88号");
    for (const document of await documents(snapshot)) expect(document).not.toContain(name);
  });

  it.each(["residence", "endpoint-name", "endpoint-address", "declared-home"])("M1 commercial names cannot bypass %s or its aliases", async (kind) => {
    const snapshot = await exportFixture(), name = "我家酸菜鱼（五一广场店）";
    const event = snapshot.plan.events.find((e) => e.id === "d1-rest")!;
    event.title = name;
    const place = addPlace(snapshot, event.id, name, kind === "residence" ? "合成星河小区3栋1201室" : "合成梧桐路88号", 113, 28.3);
    place.category = "amenity:restaurant";
    if (kind === "endpoint-name") snapshot.plan.tickets[0].chainOriginName = name;
    if (kind === "endpoint-address") snapshot.plan.tickets[0].chainOriginName = place.address;
    if (kind === "declared-home") event.note = "本活动地点为我家。";
    Object.assign(snapshot.plan.events.find((e) => e.id === "d1-hotel")!, { placeId: place.id, locationName: "合成住宅别名" });
    const privacy = exportPrivacy(snapshot, options);
    expect(privacy.privateIds.has(event.id)).toBe(true);
    expect(privacy.privateIds.has("d1-hotel")).toBe(true);
    const map = renderGeographicMap(snapshot, options, event.date);
    expect(map).not.toContain(name);
    expect(map).not.toContain(place.address);
    expect(map).not.toContain("合成住宅别名");
    for (const document of await documents(snapshot)) {
      for (const secret of [name, place.address, "合成住宅别名"]) expect(document).not.toContain(secret);
    }
  });

  it("M1 a public brand cannot exempt a longer home reference elsewhere in the same snapshot", async () => {
    const snapshot = await exportFixture(), name = "我家酸菜鱼";
    addPlace(snapshot, "d1-lunch", name, "合成商业路88号", 113, 28.3);
    const homeName = `${name}附近的住处`;
    addPlace(snapshot, "d1-rest", homeName, "合成梧桐路88号", 112.95, 28.24);
    const privacy = exportPrivacy(snapshot, options), date = snapshot.plan.events[0].date;
    expect(privacy.privateIds.has("d1-lunch")).toBe(false);
    expect(privacy.privateIds.has("d1-rest")).toBe(true);
    expect(renderGeographicMap(snapshot, options, date).match(/class="route-stop"/g)).toHaveLength(5);
    for (const document of await documents(snapshot)) {
      expect(document).toContain(name);
      expect(document).not.toContain(homeName);
    }
  });

  it("R30-01 an explicit current-location home declaration hides its point, aliases and incoming route", async () => {
    const snapshot = await exportFixture(), date = snapshot.plan.events[0].date;
    addPlace(snapshot, "d1-activity", "合成公共地标甲", "公共公园", 112.90, 28.20);
    addPlace(snapshot, "d1-lunch", "合成公共地标乙", "公共公园", 113.00, 28.30);
    const home = addPlace(snapshot, "d1-rest", "合成天鹅湾", "合成梧桐路1号", 112.956, 28.243);
    const event = snapshot.plan.events.find((item) => item.id === "d1-rest")!;
    Object.assign(snapshot.plan.events.find((item) => item.id === "d1-hotel")!, { placeId: home.id, locationName: "晚间休息别名" });
    snapshot.plan.routeLegs.push(manualReferenceRoute({ tripId: snapshot.plan.tripId, date, edit: {
      fromEventId: "d1-lunch", toEventId: event.id, departureTime: "13:30", manualReference: {
        availability: "available", durationMinutes: 20, fareCents: null, sourceName: "合成住宅接驳来源", sourceUrl: null,
        instructions: "从合成侧门进入后沿石阶直达接送点", checkedAt: snapshot.generatedAt, acknowledged: true,
      },
    } }));
    for (const note of [
      "本活动地点为我家：合成梧桐路一号二单元三零二室。",
      "本次住宿地点：家中。",
      "先结束参观；本次休息地点是私人住宅（合成住处）。",
    ]) {
      event.note = note;
      const privacy = exportPrivacy(snapshot, options);
      expect(privacy.privateIds.has(event.id)).toBe(true);
      expect(privacy.privateIds.has("d1-hotel")).toBe(true);
      const map = renderGeographicMap(snapshot, options, date);
      expect(map.match(/class="route-stop"/g)).toHaveLength(4);
      expect(map).not.toContain(home.name);
    }
    for (const document of await documents(snapshot)) {
      for (const secret of [home.name, home.address, "晚间休息别名", "从合成侧门进入", "合成住宅接驳来源"]) expect(document).not.toContain(secret);
      expect(document).toContain("20 分钟");
    }
  });

  it("R30-01 unrelated home notes and public-location declarations keep public map points and routes", async () => {
    const snapshot = await exportFixture(), date = snapshot.plan.events[0].date;
    addPlace(snapshot, "d1-activity", "合成公开场馆", "合成场馆路1号", 112.90, 28.20);
    addPlace(snapshot, "d1-lunch", "合成公开餐厅", "合成商店路2号", 113.00, 28.30);
    const event = snapshot.plan.events.find((item) => item.id === "d1-activity")!;
    snapshot.plan.routeLegs.push(manualReferenceRoute({ tripId: snapshot.plan.tripId, date, edit: {
      fromEventId: event.id, toEventId: "d1-lunch", departureTime: "12:00", manualReference: {
        availability: "available", durationMinutes: 20, fareCents: null, sourceName: "合成公共路线来源", sourceUrl: null,
        instructions: "沿合成公共道路前往餐厅", checkedAt: snapshot.generatedAt, acknowledged: true,
      },
    } }));
    for (const note of [
      "我家：北京市海淀区安宁庄东路一号二单元三零二室",
      "本活动地点为合成公开场馆；我家：合成梧桐路一号二单元三零二室。",
      "本活动地点不是我家。",
      "本活动地点为我家酸菜鱼。",
    ]) {
      event.note = note;
      expect(exportPrivacy(snapshot, options).privateIds.has(event.id)).toBe(false);
      const map = renderGeographicMap(snapshot, options, date);
      expect(map.match(/class="route-stop"/g)).toHaveLength(5);
      expect(map).toContain("合成公开场馆");
    }
    event.note = "我家：北京市海淀区安宁庄东路一号二单元三零二室";
    for (const document of await documents(snapshot)) {
      expect(document).not.toContain(event.note);
      expect(document).toContain("合成公开场馆");
      expect(document).toContain("沿合成公共道路前往餐厅");
      expect(document).toContain("合成公共路线来源");
    }
  });

  it("R30-05 exports captured advice once, with dates, source, validity and acknowledgment in all formats", async () => {
    const snapshot = await exportFixture();
    const date = snapshot.plan.requestSnapshot.startDate!, nextDate = snapshot.plan.requestSnapshot.endDate!;
    const advisory = advisoryItemSchema.parse({
      id: "weather-first-day", category: "weather", severity: "action", status: "known", validity: "valid", date,
      title: "合成降水风险提醒", targetName: "合成户外活动", reason: "合成预报降水概率较高。", recommendation: "随身带伞并准备室内替代安排。",
      aiExplanation: null, eventId: "d1-activity", eventIds: ["d1-activity"], checklistItemId: null,
      sourceLabel: "合成天气来源快照", sourceUrl: "https://weather.test/never-export", retrievedAt: "2026-10-17T03:00:00.000Z",
      applicableFrom: "2026-10-31T00:00:00.000Z", applicableUntil: "2026-10-31T12:00:00.000Z", signature: "a".repeat(64),
      acknowledged: true, acknowledgedAt: "2026-10-17T03:30:00.000Z",
    });
    snapshot.advisories = { revision: 7, items: [advisory, { ...advisory, id: "second-day", date: nextDate, title: "第二天过期资料提醒", validity: "stale", acknowledged: false, acknowledgedAt: null }] };
    for (const document of await documents(snapshot)) {
      for (const text of [advisory.title, advisory.reason, advisory.recommendation, "已知", "第二天过期资料提醒"]) expect(document).toContain(text);
      expect(document.split(advisory.title)).toHaveLength(2);
      expect(document).not.toContain("weather.test");
    }
    for (const document of await documents(snapshot, { ...options, dates: [date] })) {
      expect(document).toContain(advisory.title);
      expect(document).not.toContain("第二天过期资料提醒");
    }
    advisory.recommendation = "我家：合成星河小区三栋一二零一室";
    snapshot.advisories.items[0] = advisory;
    for (const document of await documents(snapshot)) expect(document).not.toContain(advisory.recommendation);
  });
});
