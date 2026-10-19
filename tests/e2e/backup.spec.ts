import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { Page, APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { preparePlanForStorage, validatePlan } from "../../lib/plan";
import { derivePlanCosts } from "../../lib/budget";
import { readTravelBackup, previewRestore, restoreTravelBackup } from "../../scripts/restore-core.mjs";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
const database = path.resolve("test-data/e2e/data/serendipity.db");
const db = new PrismaClient({ datasources: { db: { url: `file:${database.replaceAll("\\", "/")}` } } });
const output = verificationEvidenceDirectory("phase28-browser");
const password = "phase28-isolated-password";
test.beforeAll(() => fs.mkdir(output, { recursive: true }));
test.afterAll(async () => {
  // This suite owns the isolated admin account; later settings tests exercise
  // first-time password setup. Never run against a non-test database.
  await db.appSettings.deleteMany();
  await db.$disconnect();
});
async function login(page: Page) {
  await page.goto("/settings");
  if (await page.getByLabel("确认个人密码").count()) {
    await page.getByLabel("个人密码", { exact: true }).fill(password); await page.getByLabel("确认个人密码").fill(password); await page.getByRole("button", { name: "设置密码", exact: true }).click();
  } else if (await page.getByRole("button", { name: "进入设置" }).count()) {
    await page.getByLabel("个人密码", { exact: true }).fill(password); await page.getByRole("button", { name: "进入设置" }).click();
  }
  await expect(page.getByRole("heading", { name: "留一份旅行备份" })).toBeVisible();
}
async function seed(request: APIRequestContext) {
  const response = await request.post("/api/trips", { data: { originalRequest: "阶段28长沙两天合成旅行" } }); expect(response.status()).toBe(201);
  const { trip } = await response.json(); const snapshot = requestFixture(), content = preparePlanForStorage(planFixture(snapshot));
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).ok()).toBe(true);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).ok()).toBe(true);
  const p = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events), costs: JSON.stringify(derivePlanCosts(content.events)), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify(validatePlan(content, snapshot)) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: p.id, status: "planned" } }); return trip.id as string;
}
test("backup endpoint requires admin session and CSRF; malformed files never establish a barrier", async ({ page, request }) => {
  expect((await request.get("/api/settings/backup")).status()).toBe(401);
  await login(page);
  expect((await page.request.post("/api/settings/backup", { data: { action: "resume" } })).status()).toBe(401);
  const before = await (await request.get("/api/data-management/status")).json();
  await page.getByLabel("选择旅行备份").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("broken") });
  await expect(page.locator("#data-management").getByRole("alert")).toContainText("不是有效");
  await page.getByLabel("选择旅行备份").setInputFiles({ name: "old.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "serendipity-travel", version: 0 })) });
  await expect(page.locator("#data-management").getByRole("alert")).toContainText("版本");
  expect((await (await request.get("/api/data-management/status")).json()).dataGeneration).toBe(before.dataGeneration);
  await page.locator("#data-management").screenshot({ path: path.join(output, "invalid-file.png") });
});
test("download, preview, explicit confirmation, restore, stale tab rejection and responsive layouts", async ({ page, request, browser }) => {
  const id = await seed(request); await login(page);
  const settingsBefore = await db.appSettings.findUniqueOrThrow({ where: { id: "singleton" } });
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "下载旅行备份" }).click();
  const download = await downloadEvent, file = path.join(output, "travel-backup.json"); await download.saveAs(file);
  const backupText = await fs.readFile(file, "utf8"); expect(backupText).not.toMatch(/passwordHash|apiKeyCiphertext|dataGeneration|activeRestoreId/);
  const stale = await browser.newPage(); await stale.goto(`/trips/${id}`); await stale.getByRole("button", { name: /^修改旅行标题/ }).click(); await stale.locator("#trip-title").fill("恢复前未提交标题");
  await request.patch(`/api/trips/${id}`, { data: { title: "恢复前的新标题" } });
  await page.getByLabel("选择旅行备份").setInputFiles(file);
  await expect(page.getByRole("heading", { name: "恢复摘要与影响范围" })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认恢复旅行" })).toBeDisabled();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 }); await page.locator("#data-management").scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.locator("#data-management").screenshot({ path: path.join(output, `preview-${width}.png`) });
  }
  await page.getByRole("checkbox", { name: "我已核对，确认用此备份替换当前全部旅行数据。" }).check();
  await page.getByRole("button", { name: "确认恢复旅行" }).click();
  await expect(page.locator("#data-management")).toContainText("恢复处理完成", { timeout: 20000 });
  await expect(stale.getByRole("alert").first()).toContainText("过期", { timeout: 8000 });
  const rejected = stale.waitForResponse((r) => r.url().endsWith(`/api/trips/${id}`) && r.request().method() === "PATCH");
  await stale.getByRole("button", { name: "保存标题" }).click(); expect((await rejected).status()).toBe(409);
  await expect(stale.locator("#trip-title")).toHaveValue("恢复前未提交标题");
  await stale.getByRole("button", { name: "重新载入页面", exact: true }).click();
  await stale.getByRole("button", { name: /^修改旅行标题/ }).click();
  await expect(stale.locator("#trip-title")).not.toHaveValue("恢复前未提交标题");
  await page.reload(); await expect(page.locator("#data-management")).toContainText("旅行恢复完成");
  expect(await db.appSettings.findUniqueOrThrow({ where: { id: "singleton" } })).toEqual(settingsBefore);
  await stale.screenshot({ path: path.join(output, "reloaded-trip.png"), fullPage: true }); await stale.close();
  await fs.writeFile(path.join(output, "roundtrip.json"), JSON.stringify({ tripId: id, settingsPreserved: true, staleWrite: 409, file: download.suggestedFilename(), restoredTripCount: await db.trip.count() }, null, 2));
});
test("all mutation routes reject missing/stale generations and show a live persistent barrier", async ({ page, request, playwright }) => {
  await login(page); const id = await seed(request), snapshot = readTravelBackup(database);
  const endpoints: [string, string][] = [["POST", "/api/trips"], ["PATCH", `/api/trips/${id}`], ["DELETE", `/api/trips/${id}`], ["PATCH", `/api/trips/${id}/request`], ["POST", `/api/trips/${id}/request/extract`], ["POST", `/api/trips/${id}/request/confirm`], ["POST", `/api/trips/${id}/plans/generate`], ["POST", `/api/trips/${id}/checklist`], ["POST", `/api/trips/${id}/execution`], ["POST", `/api/trips/${id}/advisories`], ["POST", `/api/trips/${id}/replan`], ["POST", `/api/trips/${id}/exports`], ["POST", "/api/ticket-import"],
    ...["tickets", "routes", "attractions", "restaurants", "accommodations", "evidence", "places"].map((part): [string, string] => ["POST", `/api/trips/${id}/plans/1/${part}`]), ["PATCH", `/api/trips/${id}/plans/1/routes`], ["PATCH", `/api/trips/${id}/plans/1/places`], ["PATCH", `/api/trips/${id}/plans/1`]];
  const raw = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100", extraHTTPHeaders: { Origin: "http://127.0.0.1:3100" } });
  try {
    for (const [method, url] of endpoints) {
      expect((await raw.fetch(url, { method, data: {} })).status(), url).toBe(409);
      expect((await raw.fetch(url, { method, data: {}, headers: { "x-data-generation": "stale" } })).status(), url).toBe(409);
    }
    await restoreTravelBackup(database, snapshot, previewRestore(database, snapshot), { afterBarrier: async () => {
      for (const [method, url] of endpoints) expect((await request.fetch(url, { method, data: {} })).status(), url).toBe(423);
      await expect(page.getByRole("alert").first()).toContainText("写入已暂停", { timeout: 8000 });
      await page.locator("#data-management").screenshot({ path: path.join(output, "active-barrier.png") });
    } });
    await fs.writeFile(path.join(output, "mutation-audit.json"), JSON.stringify({ endpoints, missingGeneration: 409, staleGeneration: 409, activeBarrier: 423 }, null, 2));
  } finally { await raw.dispose(); }
});
test("empty backup clearly previews deletion and restores to an empty travel list", async ({ page }) => {
  await login(page); const original = readTravelBackup(database);
  const empty = { ...original, tables: Object.fromEntries(Object.keys(original.tables).map((key) => [key, []])) };
  await page.getByLabel("选择旅行备份").setInputFiles({ name: "empty.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(empty)) });
  await expect(page.locator("#data-management")).toContainText("这是一份空备份");
  await page.getByRole("checkbox", { name: "我已核对，确认用此备份替换当前全部旅行数据。" }).check();
  await page.getByRole("button", { name: "确认恢复旅行" }).click();
  await expect(page.locator("#data-management")).toContainText("恢复处理完成");
  expect(await db.trip.count()).toBe(0);
  await page.goto("/trips"); await expect(page.getByRole("heading", { name: /旅行/ }).first()).toBeVisible();
});
