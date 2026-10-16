import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";
import { assertTestDataPath, assertTestDataTree } from "./test-data-safety.mjs";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
/* global window */

const base = "http://127.0.0.1:3127";
const directory = assertTestDataTree(path.resolve("test-data/phase17-live"));
const evidence = assertTestDataPath(path.resolve("test-data/verification-output/phase17-demo"));
const manifestPath = path.join(evidence, "demo.json");
const mode = process.argv[2];
if (!["prepare", "before-restart", "after-restart", "browse"].includes(mode)) throw new Error("Choose prepare, before-restart, after-restart or browse.");
await fs.mkdir(evidence, { recursive: true });
const database = await openVerifiedIsolatedDatabase(base, directory);
try {
  if (mode === "prepare") {
    // This fixture was validated by the real browser test before being saved.
    const fixturePath = assertTestDataPath(path.resolve("test-data/verification-output/phase17-browser/demo-seed.json"));
    const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
    if (fixture.versionNumber !== 1 || fixture.requestRevision !== 2 || !Array.isArray(JSON.parse(fixture.events))) throw new Error("Unrecognized browser fixture.");
    const originalRequest = "阶段17隔离演练：两人去长沙，喜欢历史文化和博物馆，节奏舒缓，不自驾；交通与费用仅供功能演练。";
    const trip = await database.trip.create({ data: { title: "长沙 · 山水与人文（演练）", originalRequest, status: "plan_needs_review" } });
    await database.tripRequest.create({ data: { tripId: trip.id, originalRequest, requestRevision: 2, confirmedRevision: 2,
      confirmedRequest: fixture.requestSnapshot, extractedRequest: fixture.requestSnapshot, confirmedAt: new Date() } });
    const plan = await database.planVersion.create({ data: { tripId: trip.id, ...fixture } });
    await database.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id } });
    const manifest = { tripId: trip.id, url: `${base}/trips/${trip.id}`, createdAt: new Date().toISOString(), directory };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest));
  } else {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (mode === "browse") {
      const browser = await chromium.launch({ channel: "msedge", headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.goto(manifest.url);
        await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
        await page.getByRole("button", { name: /景点详情.*湖南博物院/ }).click();
        const dialog = page.getByRole("dialog");
        await dialog.locator('img[src^="/attractions/"]').first().waitFor({ state: "visible" });
        await dialog.getByRole("button", { name: "保留当前景点", exact: true }).click();
        await page.getByRole("heading", { name: /计划版本 2/ }).waitFor();
        await page.reload();
        await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
        await page.getByRole("button", { name: /景点详情.*湖南博物院/ }).click();
        const screenshotPaths = [];
        for (const width of [390, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          const image = page.getByRole("dialog").locator('img[src^="/attractions/"]').first();
          await image.waitFor({ state: "visible" });
          await page.waitForFunction(() => [...document.querySelectorAll('dialog img')].every((photo) => photo.complete && photo.naturalWidth > 0));
          if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("Horizontal overflow.");
          const file = path.join(evidence, `demo-${width}.png`);
          await page.screenshot({ path: file, fullPage: false });
          screenshotPaths.push(file);
        }
        await fs.writeFile(path.join(evidence, "browser.json"), JSON.stringify({ pageErrors, screenshotPaths, persistedAfterReload: true }, null, 2));
        if (pageErrors.length) throw new Error("Browser page errors occurred.");
      } finally { await browser.close(); }
    } else {
      const response = await fetch(`${base}/api/trips/${manifest.tripId}/plans`);
      if (!response.ok) throw new Error(`Plan read failed: ${response.status}`);
      const { plans } = await response.json();
      const plan = plans.find((item) => item.isCurrent);
      const data = { id: plan.id, versionNumber: plan.versionNumber, requestRevision: plan.requestRevision,
        requestSnapshot: plan.requestSnapshot, events: plan.events, costs: plan.costs, places: plan.places, routeLegs: plan.routeLegs, tickets: plan.tickets };
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
      const result = { checkedAt: new Date().toISOString(), fingerprint, data, integrity: await database.$queryRawUnsafe("PRAGMA integrity_check") };
      if (mode === "after-restart") {
        const before = JSON.parse(await fs.readFile(path.join(evidence, "before-restart.json"), "utf8"));
        if (before.fingerprint !== fingerprint) throw new Error("Persisted plan changed across restart.");
      }
      await fs.writeFile(path.join(evidence, `${mode}.json`), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ mode, fingerprint, version: plan.versionNumber, integrity: result.integrity }));
    }
  }
} finally { await database.$disconnect(); }
