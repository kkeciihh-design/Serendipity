import fs from "node:fs";
import path from "node:path";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
import { requireExternalVerification } from "./verification-safety.mjs";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
/* global window */

const base = "http://127.0.0.1:3121";
requireExternalVerification({ base, dataDirectories: ["test-data/phase11-live"] });
const output = path.resolve("docs/阶段验收/证据/阶段-12");
fs.mkdirSync(output, { recursive: true });
const database = await openVerifiedIsolatedDatabase(base, "test-data/phase11-live");
const result = {
  checkedAt: new Date().toISOString(),
  provider: "OpenStreetMap standard tiles (browser-loaded)",
  data: "test-data/phase11-live (isolated)",
  status: "failed",
};
let browser;
try {
  const trip = await database.trip.findFirstOrThrow({
    where: { title: "阶段11免费地图验收（测试数据）" },
    include: { currentPlanVersion: true },
  });
  result.url = `${base}/trips/${trip.id}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(result.url);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const frame = page.frameLocator('iframe[title="行程地点地图"]');
  await frame.locator(".leaflet-marker-icon").first().waitFor({ timeout: 30000 });
  await frame.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="行程地点地图"]');
    return Boolean(
      frameElement?.contentDocument?.querySelector(".leaflet-tile-loaded") &&
        !frameElement.contentDocument.querySelector(".map-frame-message"),
    );
  }, undefined, { timeout: 30000 });
  result.desktopMarkerCount = await frame.locator(".serendipity-map-pin").count();
  const firstPinText = await frame.locator(".serendipity-map-pin").first().innerText();
  assert.match(firstPinText, /^[①-⑳0-9]+$/, "Map pins must show derived visit numbers");

  const confirmedCard = page.locator("li").filter({ hasText: "用户已确认地点" }).first();
  const eventTitle = (await confirmedCard.locator("h4").innerText()).trim();
  await confirmedCard.getByRole("button", { name: /查看日程：/ }).click();
  await expectVisible(page, `编辑：${eventTitle}`);
  result.mapToTimeline = { eventTitle };
  await page.screenshot({ path: path.join(output, "real-browser-timeline-selected.png"), fullPage: true });

  await page.getByRole("button", { name: new RegExp(`定位地图：.*${escapeRegExp(eventTitle)}$`) }).click();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await frame.locator(".serendipity-map-popup").waitFor({ timeout: 10000 });
  result.timelineToMap = { eventTitle, popupVisible: true };
  await page.screenshot({ path: path.join(output, "real-browser-map-focused.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(result.url);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const mobileCard = page.locator("li").filter({ hasText: "用户已确认地点" }).first();
  const mobileTitle = (await mobileCard.locator("h4").innerText()).trim();
  await mobileCard.getByRole("button", { name: /查看日程：/ }).click();
  await expectVisible(page, `编辑：${mobileTitle}`);
  result.mobileSummaryToTimeline = { eventTitle: mobileTitle };
  result.mobileHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(result.mobileHorizontalOverflow, false);
  await page.screenshot({ path: path.join(output, "real-browser-mobile-selected.png"), fullPage: true });

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

async function expectVisible(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor({ timeout: 10000 });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
