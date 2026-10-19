import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";
import { derivePlanCosts } from "../../lib/budget";
import { preparePlanForStorage, validatePlan } from "../../lib/plan";
import { restaurantCatalog } from "../../lib/restaurant-catalog";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";

const directory = assertTestDataPath(path.resolve("test-data/e2e"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, "data/serendipity.db").replaceAll("\\", "/")}` } } });
const evidence = verificationEvidenceDirectory("phase18-browser");
test.afterAll(async () => { await db.$disconnect(); });
const endpoint = (id: string, version = 1) => `/api/trips/${id}/plans/${version}/restaurants`;
const pricing = { dinerCount: 3, minCents: 1850, maxCents: 2500 };
async function seed(request: APIRequestContext, options: { city?: string; shortWindow?: boolean; locked?: boolean; closed?: boolean; relocated?: boolean; branch?: string } = {}) {
  const response = await request.post("/api/trips", { data: { originalRequest: "餐厅卡隔离演练：两人去长沙，想品尝小吃，不自驾。费用与交通为测试样例。" } });
  expect(response.status()).toBe(201);
  const { trip } = await response.json();
  const snapshot = requestFixture(2, { destination: options.city ?? "长沙", interests: ["美食"], pace: "balanced" });
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).status()).toBe(200);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).status()).toBe(200);
  const content = planFixture(snapshot), meal = content.events.find((event) => event.id === "d1-lunch")!;
  meal.title = options.branch ?? restaurantCatalog[0].name; meal.locationName = meal.title; meal.locked = options.locked ?? false;
  if (options.shortWindow) { meal.startTime = "13:40"; meal.endTime = "13:50"; }
  const normalized = preparePlanForStorage(content), costs = derivePlanCosts(normalized.events), validation = validatePlan(normalized, snapshot, costs);
  expect(validation.errors).toEqual([]);
  const data = { versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(normalized.events), costs: JSON.stringify(costs), places: "[]", pendingItems: JSON.stringify(normalized.pendingItems), validationResults: JSON.stringify(validation) };
  const row = await db.planVersion.create({ data: { tripId: trip.id, ...data } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  if (options.closed || options.relocated) await db.evidenceFact.create({ data: { tripId: trip.id, planVersionId: row.id, targetType: "event", targetId: meal.id, field: options.relocated ? "location" : "opening_hours", status: "conflict", evaluationVersion: 1,
    sourceTitle: "营业冲突（隔离测试）", sourceUrl: "https://www.huogongdian.com/stores.html", sourcePublisher: "隔离测试", sourceDateStatus: "applicable", extractedValue: "关闭", searchProvider: "test", searchQuery: "test", retrievedAt: new Date(),
    applicableFrom: new Date(`${meal.date}T00:00:00+08:00`), applicableUntil: new Date(`${meal.date}T23:59:59+08:00`), contentQuote: "门店异常（合成条件）", lastRefreshStatus: "success", conflictReason: options.relocated ? "门店已搬迁，原地址不适用（隔离测试）" : "本次完整用餐时间超出营业时段（隔离测试）" } });
  return { id: trip.id as string, data };
}
async function openMeal(page: Page, id: string, title = restaurantCatalog[0].name) {
  await page.goto(`/trips/${id}`); await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await page.getByRole("button", { name: `查看餐厅详情：${title}`, exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("本餐人数", { exact: true })).toBeVisible();
}

test("real meal photograph, sources and one-person/multi-person budgets render at three widths and persist after reopening", async ({ page, request }) => {
  const trip = await seed(request); await fs.mkdir(evidence, { recursive: true }); await fs.writeFile(path.join(evidence, "demo-seed.json"), JSON.stringify(trip.data, null, 2));
  await openMeal(page, trip.id); const dialog = page.getByRole("dialog"), photo = dialog.locator('img[src^="/restaurants/"]').first();
  await photo.scrollIntoViewIfNeeded(); await expect.poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await photo.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `restaurant-${width}.png`) });
  }
  await dialog.locator("summary").filter({ hasText: "查看菜品来源" }).click();
  await expect(dialog.getByRole("link", { name: "火宫殿官网 · 美食文化" }).first()).toBeVisible();
  await dialog.getByText("排队信息", { exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByText(/^暂无可靠排队信息/)).toBeVisible();
  await page.screenshot({ path: path.join(evidence, "restaurant-facts.png") });
  await dialog.getByLabel("本餐人数", { exact: true }).fill("1"); await dialog.getByLabel("人均下限（元）", { exact: true }).fill("18.50"); await dialog.getByLabel("人均上限（元，可空）", { exact: true }).fill("25");
  await expect(dialog.getByText(/本餐预计合计/)).toContainText("18.50");
  await dialog.getByLabel("本餐人数", { exact: true }).fill("3"); await expect(dialog.getByText(/本餐预计合计/)).toContainText("55.50");
  await dialog.getByRole("button", { name: "预览本餐人数与预算", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "应用用餐调整", exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(evidence, "meal-pricing-preview.png") });
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  await dialog.getByRole("button", { name: "应用用餐调整", exact: true }).click(); await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
  const saved = await db.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId: trip.id, versionNumber: 2 } } });
  const cost = JSON.parse(saved.costs).find((item: { id: string }) => item.id === "cost-d1-lunch"); expect(cost).toMatchObject({ dinerCount: 3, unitAmountCents: 1850, unitAmountMaxCents: 2500 });
  await page.reload(); await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await expect(page.getByText(/3\s*人用餐 · 本餐合计/)).toContainText("55.50");
  await page.getByRole("tab", { name: "预算", exact: true }).click(); await expect(page.getByRole("tabpanel", { name: "预算", exact: true }).getByText(/3 人/).first()).toBeVisible();
  await page.goto(`/trips/${trip.id}?planVersion=1`); await page.getByRole("tab", { name: "每日时间轴", exact: true }).click(); await page.getByRole("button", { name: `查看餐厅详情：${restaurantCatalog[0].name}`, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/历史版本只读/).first()).toBeVisible();
  await fs.writeFile(path.join(evidence, "pricing-result.json"), JSON.stringify({ tripId: trip.id, version: saved.versionNumber, cost, requestSnapshot: JSON.parse(saved.requestSnapshot) }, null, 2));
});

test("replacement changes the map point and time in one version, with unavailable details clearly identified", async ({ page, request }) => {
  const trip = await seed(request); await openMeal(page, trip.id); const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /查看餐厅候选/ }).click(); await dialog.getByRole("button", { name: /^新玉楼东/ }).click();
  await expect(dialog.getByRole("heading", { name: /^新玉楼东/ })).toBeVisible();
  await expect(dialog.getByText("暂无可用图片", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("本餐人数", { exact: true }).fill("2"); await dialog.getByLabel("人均下限（元）", { exact: true }).fill("40");
  await dialog.getByRole("button", { name: "预览替换餐厅", exact: true }).click(); await expect(dialog.getByRole("button", { name: "应用用餐调整", exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(evidence, "restaurant-replacement.png") });
  await dialog.getByRole("button", { name: "应用用餐调整", exact: true }).click(); await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
  const row = await db.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId: trip.id, versionNumber: 2 } } });
  const meal = JSON.parse(row.events).find((event: { id: string }) => event.id === "d1-lunch"); expect(meal.placeId).toBe("osm:way:273730025:poi"); expect(JSON.parse(row.places)[0].name).toBe("新玉楼东");
  await page.getByRole("tab", { name: "地图", exact: true }).click(); await expect(page.getByRole("tabpanel", { name: "地图", exact: true }).getByText(/新玉楼东/).first()).toBeVisible();
  await fs.writeFile(path.join(evidence, "replacement-result.json"), JSON.stringify({ tripId: trip.id, version: row.versionNumber, events: JSON.parse(row.events), places: JSON.parse(row.places), costs: JSON.parse(row.costs) }, null, 2));
});

test("missing images, wrong branches and empty cities never borrow another venue's photograph", async ({ page, request }) => {
  const trip = await seed(request); await page.route("**/restaurants/*.webp", (route) => route.abort()); await openMeal(page, trip.id);
  const dialog = page.getByRole("dialog"); await expect(dialog.getByRole("img")).toHaveCount(0); await expect(dialog.getByText("暂无可用图片", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(evidence, "restaurant-missing-photo.png") }); await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  const wrongBranch = await seed(request, { branch: "火宫殿东塘店" }); await openMeal(page, wrongBranch.id, "火宫殿东塘店"); await expect(page.getByRole("dialog").getByText(/不会借用同品牌其他门店/)).toBeVisible();
  const other = await seed(request, { city: "杭州" }); const result = await request.get(`${endpoint(other.id)}?eventId=d1-lunch`); expect((await result.json()).recommendations).toMatchObject({ current: null, candidates: [] });
});

test("confirmed opening conflicts, overlong replacements and locked meals are visible and cannot save", async ({ page, request }) => {
  const closed = await seed(request, { closed: true }); await openMeal(page, closed.id); const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "预览本餐人数与预算", exact: true })).toBeDisabled();
  await dialog.getByText(/本次完整用餐时间超出营业时段/).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(evidence, "restaurant-opening-conflict.png") });
  const short = await seed(request, { shortWindow: true }); await openMeal(page, short.id);
  await page.getByRole("dialog").getByRole("button", { name: /查看餐厅候选/ }).click(); await page.getByRole("dialog").getByRole("button", { name: /^小二面店/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "预览替换餐厅", exact: true }).click(); await expect(page.getByRole("dialog").getByText("存在冲突，不能应用", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "应用用餐调整", exact: true })).toBeDisabled();
  const locked = await seed(request, { locked: true }); const result = await request.post(endpoint(locked.id), { data: { action: "preview", eventId: "d1-lunch", candidateId: null, pricing } }); expect(result.status()).toBe(409);
  expect(await db.planVersion.count({ where: { tripId: short.id } })).toBe(1);
});

test("read and save failures allow retry without losing draft pricing; untrusted writes are rejected", async ({ page, request }) => {
  const trip = await seed(request); let failRead = true, failSave = true;
  await page.route(`**${endpoint(trip.id)}*`, async (route) => {
    if (route.request().method() === "GET" && route.request().url().includes("eventId=d1-lunch") && failRead) { failRead = false; return route.fulfill({ status: 503, json: { error: "隔离测试：资料暂不可用" } }); }
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "apply" && failSave) { failSave = false; return route.fulfill({ status: 503, json: { error: "隔离测试：保存暂不可用" } }); }
    await route.continue();
  });
  await page.goto(`/trips/${trip.id}`); await page.getByRole("tab", { name: "每日时间轴", exact: true }).click(); await page.getByRole("button", { name: `查看餐厅详情：${restaurantCatalog[0].name}`, exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: "重试读取" }).click(); await expect(dialog.getByLabel("本餐人数", { exact: true })).toBeEnabled();
  await dialog.getByLabel("本餐人数", { exact: true }).fill("3"); await dialog.getByLabel("人均下限（元）", { exact: true }).fill("30"); await dialog.getByRole("button", { name: "预览本餐人数与预算", exact: true }).click();
  await dialog.getByRole("button", { name: "应用用餐调整", exact: true }).click(); await expect(dialog.getByText("隔离测试：保存暂不可用")).toBeVisible(); await expect(dialog.getByLabel("本餐人数", { exact: true })).toHaveValue("3");
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  const bad = await request.post(endpoint(trip.id), { headers: { Origin: "https://foreign.example" }, data: { action: "preview", eventId: "d1-lunch", candidateId: null, pricing } }); expect(bad.status()).toBe(403);
  const forged = await request.post(endpoint(trip.id), { data: { action: "apply", eventId: "d1-lunch", previewToken: "forged" } }); expect(forged.status()).toBe(409);
  await dialog.getByRole("button", { name: "应用用餐调整", exact: true }).click(); await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
});

test("closing a pending preview and an explicit preview timeout leave the current meal untouched", async ({ page, request }) => {
  const trip = await seed(request); let release: (() => void) | undefined;
  await page.route(`**${endpoint(trip.id)}`, async (route) => { await new Promise<void>((resolve) => { release = resolve; }); await route.fulfill({ status: 503, json: { error: "隔离迟到响应" } }).catch(() => undefined); });
  await openMeal(page, trip.id); await page.getByRole("dialog").getByRole("button", { name: "预览本餐人数与预算", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true); await page.keyboard.press("Escape"); (release as (() => void) | undefined)?.(); await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  await page.unroute(`**${endpoint(trip.id)}`);
  await page.getByRole("button", { name: `查看餐厅详情：${restaurantCatalog[0].name}`, exact: true }).click();
  await page.clock.install();
  await page.route(`**${endpoint(trip.id)}`, async (route) => { await new Promise<void>((resolve) => { release = resolve; }); await route.fulfill({ status: 503, json: { error: "隔离超时" } }).catch(() => undefined); });
  release = undefined; await page.getByRole("dialog").getByRole("button", { name: "预览本餐人数与预算", exact: true }).click(); await expect.poll(() => Boolean(release)).toBe(true); await page.clock.fastForward(61_000);
  await expect(page.getByRole("dialog").getByText(/用餐预览超时/)).toBeVisible(); await expect(page.getByRole("dialog").getByRole("button", { name: "预览本餐人数与预算", exact: true })).toBeEnabled(); (release as (() => void) | undefined)?.();
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
});

test("a sourced relocation stops retaining the old branch and still offers alternatives", async ({ page, request }) => {
  const trip = await seed(request, { relocated: true }); await openMeal(page, trip.id); const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "预览本餐人数与预算", exact: true })).toBeDisabled();
  await dialog.getByText(/门店位置来源冲突/).scrollIntoViewIfNeeded(); await expect(dialog.getByText(/门店已搬迁/).first()).toBeVisible();
  await page.screenshot({ path: path.join(evidence, "restaurant-relocated.png") });
  await dialog.getByRole("button", { name: /查看餐厅候选/ }).click(); await expect(dialog.getByRole("button", { name: /^小二面店/ })).toBeVisible();
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
});
