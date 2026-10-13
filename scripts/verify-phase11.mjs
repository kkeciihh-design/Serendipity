import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { Buffer } from "node:buffer";
import { requireExternalVerification } from "./verification-safety.mjs";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
/* global window */

const base = "http://127.0.0.1:3111";
requireExternalVerification({ base, dataDirectories: ["test-data/e2e", "test-data/phase11-live", "test-data/phase11-evidence"] });
const output = path.resolve("test-data/phase11-evidence");
fs.mkdirSync(output, { recursive: true });
const db = (directory) => new PrismaClient({ datasources: { db: { url: `file:${path.resolve(directory, "data/serendipity.db").replaceAll("\\", "/")}` } } });
const source = db("test-data/e2e");
const target = await openVerifiedIsolatedDatabase(base, "test-data/phase11-live");
const results = { checkedAt: new Date().toISOString(), provider: "OpenStreetMap / Nominatim", queries: [], screens: [] };
let browser;
try {
  const template = await source.planVersion.findFirstOrThrow({ where: { versionNumber: 1, trip: { originalRequest: { contains: "地图浏览器测试" } } } });
  const old = await target.trip.findFirst({ where: { title: "阶段11免费地图验收（测试数据）" } });
  let trip = old;
  if (!trip) {
    trip = await target.trip.create({ data: { title: "阶段11免费地图验收（测试数据）", originalRequest: "隔离验收：深圳站、深圳北站、同名公园与住宿区域。" } });
    const events = JSON.parse(template.events).map((event) => ({ ...event, title: event.id === "d1-activity" ? "抵达深圳站" : event.id === "d1-lunch" ? "前往深圳北站" : event.title }));
    const plan = await target.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 1, requestSnapshot: template.requestSnapshot, events: JSON.stringify(events), costs: template.costs, pendingItems: template.pendingItems, validationResults: template.validationResults } });
    await target.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id, status: "planned" } });
  }
  await target.tripRequest.upsert({ where: { tripId: trip.id }, create: { tripId: trip.id, originalRequest: trip.originalRequest, requestRevision: 1, extractedRequest: template.requestSnapshot, confirmedRequest: template.requestSnapshot, confirmedRevision: 1, confirmedAt: new Date() }, update: {} });
  results.url = `${base}/trips/${trip.id}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(results.url);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const query = async (city, keywords, eventId = "d1-activity") => {
    const current = await target.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { currentPlanVersion: true } });
    const version = current.currentPlanVersion.versionNumber;
    const response = await page.request.post(`${base}/api/trips/${trip.id}/plans/${version}/places`, { headers: { Origin: base }, data: { eventId, city, keywords } });
    const data = await response.json();
    const record = { city, keywords, status: response.status(), candidates: (data.candidates ?? []).map(({ selectionToken, ...candidate }) => { void selectionToken; return candidate; }), error: data.error };
    results.queries.push(record);
    fs.writeFileSync(path.join(output, "real-service.json"), JSON.stringify(results, null, 2));
    assert.equal(response.status(), 200, data.error);
    return { candidates: data.candidates, version };
  };
  const south = await query("深圳", "深圳站");
  const north = await query("深圳", "深圳北站", "d1-lunch");
  assert(south.candidates.some((candidate) => candidate.name.includes("深圳")));
  assert(north.candidates.some((candidate) => candidate.name.includes("深圳北")));
  const a = south.candidates[0]; const b = north.candidates[0];
  assert(Math.abs(a.latitude - b.latitude) > 0.03, "Two stations must not share a coordinate");
  assert(a.city.includes("深圳") && b.city.includes("深圳"));
  const park1 = await query("深圳", "中山公园");
  const park2 = await query("上海", "中山公园");
  assert(park1.candidates.some((candidate) => candidate.city.includes("深圳")));
  assert(park2.candidates.some((candidate) => candidate.city.includes("上海")));
  assert.equal((await query("深圳", "不存在的测试地点zxqv90210")).candidates.length, 0);
  let current = await target.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { currentPlanVersion: true } });
  if (current.currentPlanVersion.versionNumber === 1) {
    const select = async (eventId, selectionToken, version) => {
      const response = await page.request.patch(`${base}/api/trips/${trip.id}/plans/${version}/places`, { headers: { Origin: base }, data: { eventId, selectionToken, precision: "poi" } });
      assert.equal(response.status(), 200, await response.text());
    };
    await select("d1-activity", a.selectionToken, 1);
    const newNorth = await query("深圳", "深圳北站", "d1-lunch");
    await select("d1-lunch", newNorth.candidates[0].selectionToken, newNorth.version);
  }
  current = await target.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { currentPlanVersion: true } });
  if (current.currentPlanVersion.versionNumber === 3) {
    const crossCity = await query("上海", "中山公园", "d1-rest");
    const response = await page.request.patch(`${base}/api/trips/${trip.id}/plans/${crossCity.version}/places`, { headers: { Origin: base }, data: { eventId: "d1-rest", selectionToken: crossCity.candidates[0].selectionToken, precision: "poi" } });
    assert.equal(response.status(), 200, await response.text());
  }
  await page.reload(); await page.getByRole("tab", { name: "地图", exact: true }).click();
  const region = page.getByRole("region", { name: "地图定位" });
  const frame = page.frameLocator('iframe[title="行程地点地图"]');
  await frame.locator(".leaflet-marker-icon").first().waitFor();
  await frame.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 25000 });
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="行程地点地图"]'); return f?.contentDocument?.querySelectorAll('.leaflet-tile-loaded').length > 0 && !f.contentDocument.querySelector('.map-frame-message'); }, { timeout: 25000 });
  results.crossCityMarkerCount = await frame.locator(".leaflet-marker-icon").count();
  assert.equal(results.crossCityMarkerCount, 3);
  await region.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, "cross-city-overview.png") });
  await page.getByLabel("地图范围", { exact: true }).selectOption("深圳市");
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="行程地点地图"]'); return f?.contentDocument?.querySelectorAll('.leaflet-marker-icon').length === 2 && !f.contentDocument.querySelector('.map-frame-message'); });
  results.markerCount = await frame.locator(".leaflet-marker-icon").count();
  assert.equal(results.markerCount, 2);
  await page.waitForTimeout(500);
  // Capture one actively viewed map as a static-resource feasibility sample.
  const staticImage = await region.locator("iframe").screenshot();
  const metadata = await sharp(staticImage).metadata();
  const footer = Buffer.from(`<svg width="${metadata.width}" height="30"><rect width="100%" height="100%" fill="white"/><text x="10" y="20" font-family="Arial" font-size="12" fill="#37463c">© OpenStreetMap contributors · https://www.openstreetmap.org/copyright</text></svg>`);
  await sharp(staticImage).extend({ bottom: 30, top: 0, left: 0, right: 0, background: "white" }).composite([{ input: footer, top: metadata.height, left: 0 }]).png().toFile(path.join(output, "static-map-source.png"));
  results.staticSource = { file: "static-map-source.png", usage: "current visible map only; no offline tile prefetch", attribution: "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright", licence: "https://osmfoundation.org/wiki/Licence/Attribution_Guidelines#Static_images" };
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await region.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(700);
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="行程地点地图"]'); return f?.contentDocument?.querySelectorAll('.leaflet-tile-loaded').length > 0 && !f.contentDocument.querySelector('.map-frame-message'); }, { timeout: 25000 });
    await page.waitForTimeout(400);
    const file = `map-${width}px.png`;
    await page.screenshot({ path: path.join(output, file) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    results.screens.push({ width, file, overflow });
  }
  await region.locator("iframe").scrollIntoViewIfNeeded();
  await frame.getByRole("button", { name: "Zoom in" }).tap();
  await page.waitForTimeout(1800);
  results.zoomOperable = await frame.locator(".leaflet-tile-loaded").count() > 0;
  results.pageErrors = pageErrors;
  assert.equal(pageErrors.length, 0);
  current = await target.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { currentPlanVersion: true } });
  results.persistedVersion = current.currentPlanVersion.versionNumber;
  results.places = JSON.parse(current.currentPlanVersion.places);
  results.status = "passed";
  fs.writeFileSync(path.join(output, "real-service.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ status: results.status, url: results.url, queries: results.queries.map((q) => ({ city: q.city, keywords: q.keywords, count: q.candidates.length })), screens: results.screens, markerCount: results.markerCount }, null, 2));
} catch (error) {
  results.status = "failed"; results.error = error.message;
  fs.writeFileSync(path.join(output, "real-service.json"), JSON.stringify(results, null, 2));
  throw error;
} finally { await browser?.close(); await source.$disconnect(); await target.$disconnect(); }
