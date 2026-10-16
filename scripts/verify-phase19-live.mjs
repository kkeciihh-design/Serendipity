/* global window */
// Real hotel POI and road requests, isolated synthetic travel dates and budget.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
import { assertTestDataPath } from "./test-data-safety.mjs";
const base = "http://127.0.0.1:3129", output = assertTestDataPath(path.resolve("test-data/verification-output/phase19-live"));
const db = await openVerifiedIsolatedDatabase(base, "test-data/phase19-live");
await fs.mkdir(output, { recursive: true });
const mode = process.argv[2] ?? "prepare";
async function post(url, data) {
  const response = await fetch(`${base}${url}`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(data), signal: globalThis.AbortSignal.timeout(110_000) });
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
}
try {
  if (mode === "prepare") {
    const seed = JSON.parse(await fs.readFile("test-data/verification-output/phase19-browser/demo-seed.json", "utf8"));
    const events = JSON.parse(seed.events), assets = JSON.parse(await fs.readFile("lib/attraction-assets.json", "utf8"));
    const places = assets.locations.filter((item) => ["hunan-museum", "yuelu-academy", "orange-isle"].includes(item.entryId)).map(({ candidate }) => ({ ...candidate, id: `osm:${candidate.poiId}:poi`, precision: "poi", confirmation: "user_confirmed", confirmedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim" }));
    for (const [id, index] of [["d1-activity", 0], ["d2-activity", 1], ["d3-activity", 2]]) Object.assign(events.find((e) => e.id === id), { locationName: places[index].name, title: places[index].name, placeId: places[index].id });
    const trip = await db.trip.create({ data: { title: "长沙 · 住哪一区（住宿演练）", originalRequest: "阶段19合成旅行；地图与酒店地点来自公开资料，预算和入住时间仅供演练，不代表预订。", status: "plan_needs_review" } });
    await db.tripRequest.create({ data: { tripId: trip.id, originalRequest: trip.originalRequest, requestRevision: 2, confirmedRevision: 2, extractedRequest: seed.requestSnapshot, confirmedRequest: seed.requestSnapshot, confirmedAt: new Date() } });
    const plan = await db.planVersion.create({ data: { tripId: trip.id, ...seed, events: JSON.stringify(events), places: JSON.stringify(places) } });
    await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id } });
    const manifest = { tripId: trip.id, url: `${base}/trips/${trip.id}`, createdAt: new Date().toISOString(), syntheticTravel: true };
    await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest));
  } else if (mode === "search-and-confirm") {
    const manifest = JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8"));
    let current = (await (await fetch(`${base}/api/trips/${manifest.tripId}/plans`)).json()).plans.find((p) => p.isCurrent);
    // Real return station search supplies the third area reference.
    const stationSearch = await post(`/api/trips/${manifest.tripId}/plans/${current.versionNumber}/places`, { eventId: "return", city: "长沙", keywords: "长沙南站" });
    const station = stationSearch.candidates.find((c) => /railway:station|building:train_station/.test(c.category) && /长沙南/.test(c.name));
    assert.ok(station, "No exact return station; retain unknown rather than a wrong POI.");
    const response = await fetch(`${base}/api/trips/${manifest.tripId}/plans/${current.versionNumber}/places`, { method: "PATCH", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ eventId: "return", selectionToken: station.selectionToken, precision: "poi" }) });
    const stationResult = await response.json(); assert.ok(response.ok, JSON.stringify(stationResult)); current = stationResult.plan;
    const queries = []; let hotel;
    for (const keywords of ["喜来登酒店", "君悦酒店", "酒店"]) {
      const result = await post(`/api/trips/${manifest.tripId}/plans/${current.versionNumber}/places`, { eventId: "d1-hotel", city: "长沙", keywords });
      queries.push({ keywords, candidates: result.candidates.map(({ selectionToken, ...candidate }) => { void selectionToken; return candidate; }) });
      hotel = result.candidates.find((c) => /hotel|hostel|guest_house/.test(c.category) && /长沙/.test(c.city)); if (hotel) break;
    }
    await fs.writeFile(path.join(output, "real-search.json"), JSON.stringify({ checkedAt: new Date().toISOString(), queries, station: { ...station, selectionToken: undefined } }, null, 2));
    assert.ok(hotel, "No real hotel POI returned; do not manufacture one.");
    const stay = { areaId: "today", kind: "hotel", hotelToken: hotel.selectionToken, routeMode: "driving", checkIn: current.requestSnapshot.startDate, checkOut: current.requestSnapshot.endDate,
      roomCount: 2, minCents: 20000, maxCents: 30000, morningDepartureTime: "07:00", checkInFrom: null, checkOutBy: null, luggageStorage: "unknown", conditionNote: "合成演练预算200–300元/房/晚，不是酒店报价；入住、退房和寄存尚未向酒店确认。", acknowledged: true };
    const endpoint = `/api/trips/${manifest.tripId}/plans/${current.versionNumber}/accommodations`;
    const { preview } = await post(endpoint, { action: "preview", eventId: "d1-hotel", stay });
    await fs.writeFile(path.join(output, "preview.json"), JSON.stringify(preview, null, 2)); assert.ok(preview.canApply, preview.conflicts.join("; "));
    assert.ok(preview.routes.filter((r) => r.durationSeconds > 0).length >= 4, "Expected real evening and morning roads on both nights.");
    const { plan } = await post(endpoint, { action: "apply", eventId: "d1-hotel", previewToken: preview.previewToken });
    assert.equal(plan.versionNumber, current.versionNumber + 1); assert.ok(plan.routeLegs.every((r) => r.durationSeconds > 0 && r.polyline.length > 1));
    await fs.writeFile(path.join(output, "real-result.json"), JSON.stringify({ checkedAt: new Date().toISOString(), url: manifest.url, version: plan.versionNumber, hotel: { ...hotel, selectionToken: undefined }, events: plan.events, costs: plan.costs, routeLegs: plan.routeLegs }, null, 2));
    console.log(JSON.stringify({ version: plan.versionNumber, hotel: hotel.name, routes: plan.routeLegs.map((r) => ({ date: r.date, meters: r.distanceMeters, seconds: r.durationSeconds, source: r.source })) }));
  } else if (mode === "browse") {
    const manifest = JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8"));
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.goto(manifest.url);
      await page.getByRole("tab", { name: "住宿推荐", exact: true }).click(); await page.getByLabel("房间数").waitFor();
      const rooms = await page.getByLabel("房间数").inputValue(); assert.equal(rooms, "2");
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 }); await page.getByRole("heading", { name: "这趟旅行，住在哪里" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.screenshot({ path: path.join(output, `live-${width}.png`) });
      }
      await page.getByRole("button", { name: "查看区域参考地图", exact: true }).click();
      const frame = page.frameLocator('iframe[title="行程地点地图"]'); await frame.locator(".leaflet-container").waitFor();
      await page.waitForTimeout(3500); await page.locator('iframe[title="行程地点地图"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, "area-map.png") });
      await page.getByLabel("房间数").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, "hotel-form.png") });
      await page.getByRole("tab", { name: "地图", exact: true }).click(); await page.getByLabel("地图日期", { exact: true }).selectOption("2");
      await page.waitForTimeout(2000); await page.locator('iframe[title="行程地点地图"]').last().scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, "hotel-morning-map.png") });
      await page.reload(); await page.getByRole("tab", { name: "住宿推荐", exact: true }).click(); assert.equal(await page.getByLabel("房间数").inputValue(), "2");
      assert.deepEqual(errors, []); await fs.writeFile(path.join(output, "browser.json"), JSON.stringify({ checkedAt: new Date().toISOString(), errors, rooms, reloaded: true }, null, 2));
    } finally { await browser.close(); }
  } else throw new Error("Expected prepare, search-and-confirm, or browse.");
} finally { await db.$disconnect(); }
