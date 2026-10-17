import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";
import { longImageFixture } from "../helpers/long-image-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const output = verificationEvidenceDirectory("phase26-browser");
test.beforeAll(async () => { await fs.mkdir(output, { recursive: true }); });
test.afterAll(async () => { await db.$disconnect(); });
async function seed(request: APIRequestContext, days = 2) {
  const s = await longImageFixture(days), p = s.plan;
  const r = await request.post("/api/trips", { data: { originalRequest: `阶段26长图${days}日合成样例，无真实订单。` } }); expect(r.status()).toBe(201);
  const { trip } = await r.json();
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: p.requestSnapshot } })).ok()).toBe(true);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).ok()).toBe(true);
  const plan = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(p.requestSnapshot), events: JSON.stringify(p.events), costs: JSON.stringify(p.costs), places: JSON.stringify(p.places), tickets: JSON.stringify(p.tickets), pendingItems: JSON.stringify(p.pendingItems), validationResults: JSON.stringify(p.validationResults) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id, status: "planned" } });
  return { id: trip.id as string, p, planId: plan.id };
}
for (const days of [2, 4]) test(`${days} day images: full previews, exact PNG downloads, responsive layouts and reopen`, async ({ page, request, browser }) => {
  const trip = await seed(request, days), endpoint = `/api/trips/${trip.id}/exports`;
  await page.goto(`/trips/${trip.id}/image`);
  await page.getByRole("button", { name: "生成长图预览" }).click();
  await expect(page.getByRole("status")).toContainText("已生成", { timeout: 50_000 });
  const { files } = await (await request.get(`${endpoint}?kind=long-image`)).json(), file = files[0];
  // Saved advisories add content even to a two-day plan. Segment count is
  // content-dependent; every downloaded segment and event is checked below.
  expect(file.parts.length).toBeGreaterThan(0);
  if (days === 4) expect(file.parts.length).toBeGreaterThan(1);
  expect([...new Set(file.parts.flatMap((p: { eventIds: string[] }) => p.eventIds))].sort()).toEqual(trip.p.events.map((e) => e.id).sort());
  const images = page.getByRole("img", { name: /旅行长图第/ });
  expect(await images.count()).toBe(file.parts.length);
  for (const part of file.parts) {
    await expect(images.nth(part.index - 1)).toHaveJSProperty("naturalWidth", 1080);
    const promise = page.waitForEvent("download"); await page.getByRole("link", { name: `下载第 ${part.index} 张`, exact: true }).click();
    const download = await promise, target = path.join(output, `${days}days-${part.index}.png`); await download.saveAs(target);
    expect(createHash("sha256").update(await fs.readFile(target)).digest("hex")).toBe(part.sha256);
    const response = await request.get(`${endpoint}/${file.id}?part=${part.index}`); expect(response.headers()["content-type"]).toBe("image/png");
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, `${days}days-ui-${width}.png`) });
  }
  await page.getByLabel("包含票面座位").check(); await expect(page.getByText("选项已改变", { exact: false })).toBeVisible();
  expect((await (await request.get(`${endpoint}?kind=long-image`)).json()).files).toHaveLength(1);
  const reopened = await browser.newContext(); const p2 = await reopened.newPage(); await p2.goto(`/trips/${trip.id}/image`);
  await expect(p2.getByRole("status")).toContainText(`共 ${file.parts.length} 张`); await reopened.close();
  await page.reload(); await expect(page.getByRole("status")).toContainText(`共 ${file.parts.length} 张`);
  await fs.writeFile(path.join(output, `${days}days-file.json`), JSON.stringify(file, null, 2));
  const source = await db.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { request: true, currentPlanVersion: true } });
  await fs.writeFile(path.join(output, `synthetic-${days}days.json`), JSON.stringify(source));
});
test("map authorization failure retries explicitly; stale dates, cross-trip and failed image previews stay clear", async ({ page, request }) => {
  const trip = await seed(request), endpoint = `/api/trips/${trip.id}/exports`;
  trip.p.places[0].provider = "amap";
  await db.planVersion.update({ where: { id: trip.planId }, data: { places: JSON.stringify(trip.p.places) } });
  await page.goto(`/trips/${trip.id}/image`); await page.getByRole("button", { name: "生成长图预览" }).click();
  await expect(page.getByLabel("长图导出选项").getByRole("alert")).toContainText("许可");
  expect((await (await request.get(`${endpoint}?kind=long-image`)).json()).files).toHaveLength(0);
  await page.getByLabel("包含位置示意图").uncheck(); await page.getByRole("button", { name: "生成长图预览" }).click();
  await expect(page.getByRole("status")).toContainText("已生成", { timeout: 50_000 });
  const { files } = await (await request.get(`${endpoint}?kind=long-image`)).json();
  await page.route(`**/exports/${files[0].id}?part=*`, (route) => route.abort()); await page.reload();
  await expect(page.getByLabel("完整长图预览").getByRole("alert")).toContainText("预览加载失败"); await page.unroute(`**/exports/${files[0].id}?part=*`);
  await page.getByRole("button", { name: "重试图片加载" }).click(); await expect(page.getByRole("img").first()).toHaveJSProperty("naturalWidth", 1080);
  expect((await request.post(endpoint, { data: { expectedPlanVersion: 99, format: "long-image", options: {} } })).status()).toBe(409);
  expect((await request.post(endpoint, { data: { expectedPlanVersion: 1, format: "long-image", options: { dates: ["1999-01-01"] } } })).status()).toBe(400);
  expect((await request.get(`${endpoint}/${files[0].id}?part=999`)).status()).toBe(404);
  const other = await seed(request); expect((await request.get(`/api/trips/${other.id}/exports/${files[0].id}`)).status()).toBe(404);
  const noOrigin = await request.post(endpoint, { headers: { Origin: "https://example.invalid" }, data: { expectedPlanVersion: 1, format: "long-image", options: {} } }); expect(noOrigin.status()).toBe(403);
});
test("concurrent requests do not queue extra browsers; date selection creates a distinct immutable file", async ({ request, page }) => {
  const trip = await seed(request), endpoint = `/api/trips/${trip.id}/exports`;
  const body = { expectedPlanVersion: 1, format: "long-image", options: {} };
  const responses = await Promise.all([request.post(endpoint, { data: body }), request.post(endpoint, { data: body })]);
  expect(responses.map((r) => r.status()).sort()).toEqual([201, 429]);
  const old = (await (await request.get(`${endpoint}?kind=long-image`)).json()).files[0];
  const bytes = await (await request.get(`${endpoint}/${old.id}`)).body();
  await page.goto(`/trips/${trip.id}/image`); await page.getByLabel("导出日期").selectOption(trip.p.requestSnapshot.endDate!);
  await page.getByRole("button", { name: "生成长图预览" }).click(); await expect(page.getByRole("status")).toContainText("已生成", { timeout: 50_000 });
  const files = (await (await request.get(`${endpoint}?kind=long-image`)).json()).files;
  expect(files).toHaveLength(2); expect(files[0].options.dates).toEqual([trip.p.requestSnapshot.endDate]);
  expect(await (await request.get(`${endpoint}/${old.id}`)).body()).toEqual(bytes);
  expect((await (await request.get(`${endpoint}?kind=text`)).json()).files).toHaveLength(0);
  await request.delete(`/api/trips/${trip.id}`); expect((await request.get(`${endpoint}/${old.id}`)).status()).toBe(404);
});
