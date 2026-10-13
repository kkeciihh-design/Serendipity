import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { URL } from "node:url";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
import { chromium } from "@playwright/test";
import { requireExternalVerification } from "./verification-safety.mjs";
/* global window */

// Verify that the browser server reads this isolated demonstration database.
const base = "http://127.0.0.1:3121";
requireExternalVerification({ base, dataDirectories: ["test-data/phase13-live"] });
const output = path.resolve("docs/阶段验收/证据/阶段-13");
fs.mkdirSync(output, { recursive: true });
const database = await openVerifiedIsolatedDatabase(base, "test-data/phase13-live");
const result = {
  checkedAt: new Date().toISOString(),
  data: "test-data/phase13-live (isolated)",
  scope: "Real external map entry; manual entries below are demonstration data, not verified bus schedules.",
  status: "failed",
};
let browser;
try {
  let trip = await database.trip.findFirst({
    where: { title: "阶段13人工公交验收（演示数据）" }, include: { currentPlanVersion: true },
  });
  if (!trip) {
    const source = await database.trip.findUniqueOrThrow({
      where: { id: "e1a2762a-d162-4ce4-94b6-e88a6bda2ee4" }, include: { currentPlanVersion: true },
    });
    const original = source.currentPlanVersion;
    assert.ok(original);
    const created = await database.trip.create({ data: {
      title: "阶段13人工公交验收（演示数据）", originalRequest: "阶段13隔离演示：深圳站到深圳北，公交内容仅用于录入功能测试。", status: "planned",
    } });
    const plan = await database.planVersion.create({ data: {
      tripId: created.id, versionNumber: 1, requestRevision: original.requestRevision,
      requestSnapshot: original.requestSnapshot, events: original.events,
      places: original.places, costs: JSON.stringify(JSON.parse(original.costs).filter((cost) => !cost.id.startsWith("route-"))),
      routeLegs: "[]", pendingItems: original.pendingItems, validationResults: original.validationResults,
    } });
    trip = await database.trip.update({ where: { id: created.id }, data: { currentPlanVersionId: plan.id }, include: { currentPlanVersion: true } });
  }
  await database.tripRequest.upsert({
    where: { tripId: trip.id }, update: {},
    create: { tripId: trip.id, originalRequest: trip.originalRequest, requestRevision: trip.currentPlanVersion.requestRevision },
  });
  result.url = `${base}/trips/${trip.id}`;
  result.tripId = trip.id;
  const startingVersion = trip.currentPlanVersion.versionNumber;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(result.url);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const card = page.locator('section[aria-label="城市路线"] article').first();
  await card.getByRole("combobox", { name: "交通方式", exact: true }).selectOption("public_transit");
  const external = card.getByRole("link", { name: "在高德查看公交路线" });
  result.externalHref = await external.getAttribute("href");
  const link = new URL(result.externalHref);
  assert.equal(link.origin, "https://uri.amap.com");
  assert.equal(link.pathname, "/navigation");
  assert.equal(link.searchParams.get("mode"), "bus");
  assert.ok(link.searchParams.get("from").includes("深圳站"));
  assert.ok(link.searchParams.get("to").includes("深圳北"));
  const popupPromise = page.waitForEvent("popup");
  await external.click();
  const popup = await popupPromise;
  await popup.waitForURL(/https:\/\/(?:ditu|www)\.amap\.com\//, { timeout: 45_000 });
  await popup.waitForLoadState("domcontentloaded");
  const destination = new URL(popup.url());
  assert.equal(destination.pathname, "/dir");
  assert.equal(destination.searchParams.get("type"), "bus");
  assert.ok(destination.searchParams.get("from[name]").includes("深圳站"));
  assert.ok(destination.searchParams.get("to[name]").includes("深圳北"));
  await popup.locator("body").waitFor();
  result.externalOpened = { url: popup.url(), title: await popup.title(), text: (await popup.locator("body").innerText()).slice(0, 5000) };
  await popup.screenshot({ path: path.join(output, "manual-external-map.png"), fullPage: true });
  await popup.close();

  await card.getByLabel("出发时刻", { exact: true }).fill("12:00");
  await card.getByRole("combobox", { name: "查询结果", exact: true }).selectOption("available");
  await card.getByRole("textbox", { name: /^线路、换乘与步骤/ }).fill("演示数据：步行到示例上车站\n乘示例地铁，在示例换乘站换乘\n到示例下车站后步行至目的地（非真实班次）");
  await card.getByLabel("总耗时（分钟，可留空）", { exact: true }).fill("55");
  await card.getByLabel("每人票价（元，可留空）", { exact: true }).fill("6.50");
  await card.getByLabel("来源名称", { exact: true }).fill("功能验收演示数据（非真实公交方案）");
  await card.getByLabel("来源链接（可选）", { exact: true }).fill(result.externalHref);
  await card.getByRole("checkbox", { name: /我已在外部地图按/ }).check();
  const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/routes"));
  await card.getByRole("button", { name: /保存人工参考|重新确认并保存/ }).click();
  const response = await saveResponse;
  assert.equal(response.status(), 200, await response.text());
  await page.getByRole("heading", { name: new RegExp(`计划版本 ${startingVersion + 1}`) }).waitFor();
  const saved = await database.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { currentPlanVersion: true } });
  const route = JSON.parse(saved.currentPlanVersion.routeLegs).find((item) => item.manualReference);
  assert.equal(route.status, "pending_confirmation");
  assert.equal(route.futureQueryCapability, false);
  assert.equal(route.durationSeconds, 3300);
  assert.equal(route.arrivalTime, "12:55");
  assert.equal(route.cost.minCents, 650);
  assert.equal(route.polyline.length, 0);
  result.savedReference = route;
  result.version = saved.currentPlanVersion.versionNumber;
  const frame = page.frameLocator('iframe[title="行程地点地图"]');
  await frame.locator(".serendipity-map-pin").first().waitFor({ timeout: 30_000 });
  assert.equal(await frame.locator(".serendipity-map-route-arrow").count(), 0);
  assert.equal(await frame.locator("path.leaflet-interactive").count(), 0);
  await card.screenshot({ path: path.join(output, "manual-desktop.png") });

  await card.getByLabel("出发时刻", { exact: true }).fill("12:20");
  result.changedTimeText = await card.innerText();
  assert.match(result.changedTimeText, /重新|不适用/);
  assert.equal(await card.getByRole("checkbox", { name: /我已在外部地图按/ }).isChecked(), false);
  await card.screenshot({ path: path.join(output, "manual-time-change.png") });
  await page.reload();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await card.getByText(/人工参考/).first().waitFor();
  result.persistedAfterReload = true;
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await page.getByText(/人工参考/).first().waitFor();
  await page.screenshot({ path: path.join(output, "manual-timeline.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await card.scrollIntoViewIfNeeded();
  result.mobileHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(result.mobileHorizontalOverflow, false);
  await card.screenshot({ path: path.join(output, "manual-mobile.png") });
  result.pageErrors = pageErrors;
  assert.equal(pageErrors.length, 0);
  result.status = "passed";
  fs.writeFileSync(path.join(output, "manual-browser.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, url: result.url, version: result.version, externalUrl: result.externalOpened.url, mobileHorizontalOverflow: result.mobileHorizontalOverflow, pageErrors }, null, 2));
} catch (error) {
  result.error = error.message;
  fs.writeFileSync(path.join(output, "manual-browser.json"), JSON.stringify(result, null, 2));
  throw error;
} finally {
  await browser?.close();
  await database.$disconnect();
}
