import fs from "node:fs";
import path from "node:path";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { requireExternalVerification } from "./verification-safety.mjs";
/* global window */

const base = "http://127.0.0.1:3121";
requireExternalVerification({ base, dataDirectories: ["test-data/phase13-live"] });
const output = path.resolve("docs/阶段验收/证据/阶段-13");
fs.mkdirSync(output, { recursive: true });
const database = await openVerifiedIsolatedDatabase(base, "test-data/phase13-live");
const result = {
  checkedAt: new Date().toISOString(),
  data: "test-data/phase13-live (isolated)",
  provider: "OpenStreetMap / OSRM",
  status: "failed",
};
let browser;
try {
  const trip = await database.trip.findFirstOrThrow({
    where: { id: "e1a2762a-d162-4ce4-94b6-e88a6bda2ee4" },
    include: { currentPlanVersion: true },
  });
  const startingVersion = trip.currentPlanVersion.versionNumber;
  result.url = `${base}/trips/${trip.id}`;

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(result.url);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const routeCard = page.locator("section[aria-label=城市路线] article").first();
  await routeCard.getByLabel("交通方式").selectOption("walking");
  await routeCard.getByRole("button", { name: "查询并保存" }).click();
  await page.getByRole("heading", { name: new RegExp(`计划版本 ${startingVersion + 1}`) }).waitFor({ timeout: 60000 });
  await page.getByText("步行｜已核实", { exact: false }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(output, "real-browser-walking-route.png"), fullPage: true });

  await routeCard.getByLabel("交通方式").selectOption("driving");
  await routeCard.getByRole("button", { name: "查询并保存" }).click();
  await page.getByRole("heading", { name: new RegExp(`计划版本 ${startingVersion + 2}`) }).waitFor({ timeout: 60000 });
  await page.getByText("驾车/打车｜估算", { exact: false }).waitFor({ timeout: 10000 });
  const frame = page.frameLocator('iframe[title="行程地点地图"]');
  await frame.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 30000 });
  await frame.locator(".serendipity-map-route-arrow").first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="行程地点地图"]');
    return Boolean(frameElement?.contentDocument?.querySelector(".leaflet-tile-loaded") &&
      frameElement.contentDocument.querySelector(".serendipity-map-route-arrow") &&
      !frameElement.contentDocument.querySelector(".map-frame-message"));
  }, undefined, { timeout: 30000 });
  result.desktop = {
    tileCount: await frame.locator(".leaflet-tile-loaded").count(),
    markerCount: await frame.locator(".serendipity-map-pin").count(),
    routeArrowCount: await frame.locator(".serendipity-map-route-arrow").count(),
    routePathCount: await frame.locator("path").count(),
  };
  assert.ok(result.desktop.routeArrowCount > 0, "The route must show a direction arrow.");
  await page.screenshot({ path: path.join(output, "real-browser-driving-route.png"), fullPage: true });

  const savedTrip = await database.trip.findUniqueOrThrow({
    where: { id: trip.id },
    include: { currentPlanVersion: true },
  });
  const walkingVersion = await database.planVersion.findUniqueOrThrow({
    where: { tripId_versionNumber: { tripId: trip.id, versionNumber: startingVersion + 1 } },
  });
  const drivingVersion = await database.planVersion.findUniqueOrThrow({
    where: { tripId_versionNumber: { tripId: trip.id, versionNumber: startingVersion + 2 } },
  });
  const walking = JSON.parse(walkingVersion.routeLegs).find((route) => route.mode === "walking");
  const driving = JSON.parse(drivingVersion.routeLegs).find((route) => route.mode === "driving");
  assert.equal(walking.source, "OpenStreetMap / OSRM");
  assert.equal(driving.source, "OpenStreetMap / OSRM");
  assert.ok(walking.polyline.length > 1, "The walking route must contain a road polyline.");
  assert.ok(driving.polyline.length > 1, "The driving route must contain a road polyline.");
  assert.equal(walking.futureQueryCapability, false);
  assert.equal(driving.futureQueryCapability, false);
  result.planVersion = savedTrip.currentPlanVersion.versionNumber;
  result.routes = [walking, driving].map((route) => ({
    mode: route.mode,
    status: route.status,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    departureTime: route.departureTime,
    arrivalTime: route.arrivalTime,
    polylinePoints: route.polyline.length,
    stepCount: route.steps.length,
    costBasis: route.cost.basis,
    scheduleBasis: route.scheduleBasis,
  }));

  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await page.getByText("驾车/打车｜估算", { exact: false }).first().waitFor({ timeout: 10000 });
  result.timelineRouteVisible = true;
  await page.screenshot({ path: path.join(output, "real-browser-timeline-route.png"), fullPage: true });

  await page.reload();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await frame.locator(".serendipity-map-route-arrow").first().waitFor({ timeout: 30000 });
  result.persistedAfterReload = true;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await frame.locator(".serendipity-map-route-arrow").first().waitFor({ timeout: 30000 });
  result.mobileHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(result.mobileHorizontalOverflow, false);
  await page.screenshot({ path: path.join(output, "real-browser-mobile-route.png"), fullPage: true });

  for (const name of [
    "real-browser-walking-route.png",
    "real-browser-driving-route.png",
    "real-browser-timeline-route.png",
    "real-browser-mobile-route.png",
  ]) {
    const size = fs.statSync(path.join(output, name)).size;
    assert.ok(size > 20_000, `${name} is unexpectedly small.`);
    result[name] = { size };
  }
  result.pageErrors = pageErrors;
  assert.equal(pageErrors.length, 0);
  result.status = "passed";
  fs.writeFileSync(path.join(output, "real-browser.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.error = error.message;
  fs.writeFileSync(path.join(output, "real-browser.json"), JSON.stringify(result, null, 2));
  throw error;
} finally {
  await browser?.close();
  await database.$disconnect();
}
