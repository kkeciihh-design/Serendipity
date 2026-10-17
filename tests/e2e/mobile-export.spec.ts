import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";
import { exportFixture, PRIVATE_ADDRESS } from "../helpers/export-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const evidence = verificationEvidenceDirectory("phase24-browser");
test.afterAll(async () => { await db.$disconnect(); });
async function seed(request: APIRequestContext, days = 2) {
  const s = await exportFixture(days), p = s.plan;
  const response = await request.post("/api/trips", { data: { originalRequest: `阶段24手机一页版${days}日合成样例，无真实订单。` } }); expect(response.status()).toBe(201);
  const { trip } = await response.json();
  await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: p.requestSnapshot } });
  await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } });
  const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(p.requestSnapshot),
    events: JSON.stringify(p.events), costs: JSON.stringify(p.costs), tickets: JSON.stringify(p.tickets), pendingItems: JSON.stringify(p.pendingItems), validationResults: JSON.stringify(p.validationResults) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  return { id: trip.id as string, snapshot: p.requestSnapshot };
}
for (const days of [2, 4]) test(`T22/T26: ${days}-day actual download opens offline without JavaScript in a touch mobile context`, async ({ page, request, browser }) => {
  await fs.mkdir(evidence, { recursive: true }); const trip = await seed(request, days);
  // Save real preparation and execution state through their existing APIs.
  const checklist = await (await request.get(`/api/trips/${trip.id}/checklist?planVersion=1`)).json();
  const view = checklist.checklist ?? checklist;
  const saved = await request.post(`/api/trips/${trip.id}/checklist`, { data: { expectedPlanVersion: 1, expectedRevision: view.revision, expectedBasis: view.basis, change: { action: "complete", id: view.items[0].id, completed: true } } }); expect(saved.ok()).toBe(true);
  await request.post(`/api/trips/${trip.id}/execution`, { data: { expectedPlanVersion: 1, expectedRevision: 0, change: { action: "start", eventId: "d1-activity" } } });
  await request.post(`/api/trips/${trip.id}/execution`, { data: { expectedPlanVersion: 1, expectedRevision: 1, change: { action: "complete", eventId: "d1-activity" } } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/trips/${trip.id}/mobile`);
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  const preview = page.frameLocator('iframe[title="独立手机 HTML 预览"]');
  await expect(preview.getByRole("heading", { level: 1 })).toContainText("随身一页");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("region", { name: "手机一页预览" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `panel-${days}days-${width}.png`), fullPage: true });
  }
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("link", { name: "下载此 HTML" }).click(); const download = await downloadEvent;
  const filePath = path.join(evidence, `${days}days-offline.html`); await download.saveAs(filePath);
  const html = await fs.readFile(filePath, "utf8"); expect(html).not.toContain(PRIVATE_ADDRESS); expect(html).not.toContain("08车06A");
  expect(html).toContain("☑ 已确认"); expect(html).toContain("已手动完成"); expect(html).toContain("22:55"); expect(html).toContain("前一天");
  const panel = await (await request.get(`/api/trips/${trip.id}/exports`)).json(), metadata = panel.files[0];
  expect(createHash("sha256").update(html).digest("hex")).toBe(metadata.sha256);
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, javaScriptEnabled: false });
  const external: string[] = []; mobile.on("request", (r) => { if (/^https?:/.test(r.url())) external.push(r.url()); });
  await mobile.setOffline(true); const offline = await mobile.newPage(); await offline.goto(pathToFileURL(filePath).href);
  await expect(offline.locator("section.day")).toHaveCount(days);
  await expect(offline.getByText("☑ 已确认", { exact: false })).toBeVisible();
  const lastDay = trip.snapshot.endDate!, dayLink = offline.getByRole("navigation").getByRole("link", { name: `${lastDay.slice(5)} · 第${days}天` });
  await dayLink.click(); expect(offline.url()).toContain(`#day-${lastDay}`);
  expect(await offline.locator(`#day-${lastDay}`).evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(220);
  expect(await offline.locator(`#day-${lastDay}`).evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(await offline.getByRole("navigation").evaluate((el) => el.getBoundingClientRect().bottom));
  expect(await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await offline.screenshot({ path: path.join(evidence, `offline-${days}days-last-day.png`) });
  await offline.getByRole("link", { name: "回到顶部 ↑", exact: true }).click();
  await offline.screenshot({ path: path.join(evidence, `offline-${days}days-full.png`), fullPage: true });
  expect(external).toEqual([]); await offline.reload(); await expect(offline.getByRole("heading", { name: "关键时间红线" })).toBeVisible();
  await mobile.close(); await page.reload(); await expect(page.getByRole("link", { name: "下载此 HTML" })).toBeVisible();
  const reopened = await browser.newPage(); await reopened.goto(`/trips/${trip.id}/mobile`); await expect(reopened.getByRole("link", { name: "下载此 HTML" })).toBeVisible(); await reopened.close();
  const row = await db.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { currentPlanVersion: true, request: true, execution: true, checklist: true } });
  await fs.writeFile(path.join(evidence, `synthetic-${days}days.json`), JSON.stringify(row, null, 2));
  await fs.writeFile(path.join(evidence, `offline-${days}days-result.json`), JSON.stringify({ environment: "Windows Edge; mobile/touch viewport emulation, not a physical phone", javaScriptEnabled: false, offline: true, externalRequests: external, days, file: filePath, metadata }, null, 2));
});
test("T29: changed request never changes export basis; one-day options, privacy opt-in and retained old bytes", async ({ page, request }) => {
  const trip = await seed(request, 4);
  await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 2, request: { ...trip.snapshot, startDate: "2040-01-01", endDate: "2040-01-04", travelerCount: 20, budgetAmountCents: 900000 } } });
  await page.goto(`/trips/${trip.id}/mobile`); await page.getByLabel("导出日期").selectOption(trip.snapshot.startDate!);
  await page.getByRole("checkbox", { name: "包含私人起终点地址" }).check(); await page.getByRole("checkbox", { name: "包含票面座位" }).check();
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  const preview = page.frameLocator("iframe"); await expect(preview.getByText(/计划待更新：/)).toBeVisible();
  await expect(preview.locator("section.day")).toHaveCount(1); await expect(preview.getByText(/4 人/)).toBeVisible(); await expect(preview.getByText(/08车06A/)).toBeVisible();
  await expect(preview.getByText(/9000 元/)).toHaveCount(0);
  const { files } = await (await request.get(`/api/trips/${trip.id}/exports`)).json();
  const original = await (await request.get(`/api/trips/${trip.id}/exports/${files[0].id}`)).text();
  expect(original).toContain(PRIVATE_ADDRESS); expect(original).toContain("1500 元"); expect(original).not.toContain("2040-01-01");
  await page.getByRole("checkbox", { name: "包含私人起终点地址" }).uncheck(); await expect(page.getByRole("status")).toContainText("旧文件");
  expect(await (await request.get(`/api/trips/${trip.id}/exports/${files[0].id}`)).text()).toBe(original);
  await fs.writeFile(path.join(evidence, "stale-request-result.json"), JSON.stringify({ planVersion: files[0].planVersion, requestRevision: files[0].requestRevision, requirementUpToDate: files[0].requirementUpToDate, dates: files[0].options.dates }, null, 2));
});
test("generation failures recover; stale/foreign/invalid requests create no file; deletion leaves external download", async ({ page, request }) => {
  const trip = await seed(request), other = await seed(request);
  await page.goto(`/trips/${trip.id}/mobile`);
  await page.route(`**/api/trips/${trip.id}/exports`, (r) => r.request().method() === "POST" ? r.fulfill({ status: 503, json: { error: "模拟存储失败，请重试" } }) : r.continue());
  await page.getByRole("button", { name: "生成预览", exact: true }).click(); await expect(page.getByRole("main").getByRole("alert")).toContainText("模拟存储失败");
  expect(await db.exportFile.count({ where: { tripId: trip.id } })).toBe(0);
  await page.unroute(`**/api/trips/${trip.id}/exports`);
  for (const data of [{ expectedPlanVersion: 99, options: {} }, { expectedPlanVersion: 1, options: { dates: ["1999-01-01"] } }, { expectedPlanVersion: 1, options: { includePrivateAddress: "false" } }]) {
    expect((await request.post(`/api/trips/${trip.id}/exports`, { data })).status()).toBeGreaterThanOrEqual(400);
  }
  expect((await request.post(`/api/trips/${trip.id}/exports`, { headers: { Origin: "https://foreign.invalid" }, data: { expectedPlanVersion: 1, options: {} } })).status()).toBe(403);
  expect((await request.get(`/api/trips/${trip.id}/exports`, { headers: { Host: "untrusted.invalid" } })).status()).toBe(401);
  await page.getByRole("button", { name: "生成预览", exact: true }).click(); await expect(page.getByRole("link", { name: "下载此 HTML" })).toBeVisible();
  const { files } = await (await request.get(`/api/trips/${trip.id}/exports`)).json();
  expect((await request.get(`/api/trips/${other.id}/exports/${files[0].id}`)).status()).toBe(404);
  const output = await request.get(`/api/trips/${trip.id}/exports/${files[0].id}?download=1`);
  expect(output.headers()["content-disposition"]).toContain("attachment"); expect(output.headers()["cache-control"]).toBe("no-store"); expect(output.headers()["content-security-policy"]).toContain("sandbox");
  const filePath = path.join(evidence, "survives-trip-deletion.html"); await fs.writeFile(filePath, await output.text());
  expect((await request.delete(`/api/trips/${trip.id}`)).ok()).toBe(true);
  expect((await request.get(`/api/trips/${trip.id}/exports/${files[0].id}`)).status()).toBe(404); expect((await fs.stat(filePath)).size).toBeGreaterThan(1000);
});
