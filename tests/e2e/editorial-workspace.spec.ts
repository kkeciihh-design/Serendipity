import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";
import { controlledBasemap, expectCompanionBasemap } from "./basemap-helpers";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";
import { derivePlanCosts, planCostItemSchema } from "../../lib/budget";
import { preparePlanForStorage, validatePlan } from "../../lib/plan";
import { placeSchema } from "../../lib/places";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";

const directory = assertTestDataPath(path.resolve("test-data/e2e"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, "data/serendipity.db").replaceAll("\\", "/")}` } } });
test.afterAll(async () => db.$disconnect());

async function seedEditorialTrip(request: APIRequestContext) {
  const created = await request.post("/api/trips", { data: { originalRequest: "我想在 11 月中旬去杭州玩两天，从上海出发，沿着西湖慢慢走，逛老街、尝杭帮菜。" } });
  expect(created.status()).toBe(201);
  const { trip } = await created.json();
  const snapshot = requestFixture(2, { destination: "杭州", pace: "relaxed", interests: ["自然风景", "老街"], budgetAmountCents: 300000 });
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).status()).toBe(200);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).status()).toBe(200);
  const content = planFixture(snapshot);
  const westLake = content.events.find((event) => event.id === "d1-activity")!;
  Object.assign(westLake, { title: "西湖湖畔漫步", locationName: "柳浪闻莺", placeId: "editorial:westlake", note: "从柳浪闻莺出发，沿湖慢行，留一点时间看水色与远山。", costDraftCents: 0 });
  const teaVillage = content.events.find((event) => event.id === "d2-activity")!;
  Object.assign(teaVillage, { title: "龙井村寻茶", locationName: "龙井村", placeId: "editorial:longjing", note: "在茶园和村落间散步，午后回城。", costDraftCents: 5000 });
  Object.assign(content.events.find((event) => event.id === "d1-lunch")!, { title: "湖畔杭帮菜午餐", note: "尝尝本地时令菜，饭后不急着赶路。", costDraftCents: 18000 });
  Object.assign(content.events.find((event) => event.id === "d1-hotel")!, { title: "入住西湖东侧酒店", costDraftCents: 52000 });
  content.events.push(
    { ...westLake, id: "d1-oldstreet", startTime: "15:00", endTime: "17:00", title: "河坊街的老城时光", locationName: "河坊街", placeId: "editorial:hefang", note: "逛小店、找一杯茶，在巷弄里感受杭州的日常。", suggestedDurationSeconds: 7200 },
    { ...content.events.find((event) => event.id === "d1-lunch")!, id: "d1-dinner", startTime: "17:30", endTime: "18:30", title: "老城风味晚餐", note: "留一顿从容的晚餐，为今天收尾。", costDraftCents: 22000 },
  );
  const now = new Date().toISOString();
  // Stored POIs exercise the real marker pipeline. Only map tiles are replaced
  // for deterministic offline rendering; no map component or message is mocked.
  const places = [
    { id: "editorial:westlake", poiId: "node:editorialWestLake", name: "柳浪闻莺", latitude: 30.2387, longitude: 120.1546 },
    { id: "editorial:hefang", poiId: "node:editorialHefang", name: "河坊街", latitude: 30.2330, longitude: 120.1684 },
    { id: "editorial:longjing", poiId: "node:editorialLongjing", name: "龙井村", latitude: 30.2188, longitude: 120.1020 },
  ].map((item) => placeSchema.parse({ ...item, provider: "osm", city: "杭州市", district: "", address: `杭州市${item.name}`, adcode: "", category: "tourism", coordinateSystem: "WGS84", precision: "poi", confirmation: "user_confirmed", confirmedAt: now, retrievedAt: now, source: "OpenStreetMap / Nominatim" }));
  const plan = preparePlanForStorage(content);
  const costs = derivePlanCosts(plan.events);
  const validation = validatePlan(plan, snapshot, costs);
  expect(validation.errors).toEqual([]);
  const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(plan.events), costs: JSON.stringify(costs), pendingItems: JSON.stringify(plan.pendingItems), places: JSON.stringify(places), validationResults: JSON.stringify(validation) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  return trip.id as string;
}

test("the sticky companion draws daily pins and routes on its basemap and selection returns to the timeline", async ({ page, request }) => {
  const tripId = await seedEditorialTrip(request);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await controlledBasemap(page);
  await page.goto(`/trips/${tripId}`);
  await page.evaluate(() => document.fonts.ready);
  const companion = page.getByRole("complementary", { name: "当日伴随看板" });
  const map = await expectCompanionBasemap(companion);
  await expect(map.locator('.serendipity-map-pin[title="柳浪闻莺"]')).toBeVisible();
  await expect(map.locator('.serendipity-map-pin[title="河坊街"]')).toBeVisible();
  await expect(map.locator('.serendipity-map-pin[title="龙井村"]')).toHaveCount(0);
  await expect(map.locator(".serendipity-map-pin").first()).toContainText("①");
  await expect(map.locator(".serendipity-map-route-arrow").first()).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "计划视图" });
  await expect(tabs.getByRole("tab")).toHaveCount(8);
  for (const name of ["每日时间轴", "地图", "预算", "门到门交通", "住宿推荐", "出发前清单", "行程提醒", "AI 重新规划"]) {
    await expect(tabs.getByRole("tab", { name, exact: true })).toBeVisible();
  }
  await expect(companion).toHaveCSS("position", "sticky");
  const originalTop = await companion.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((top) => window.scrollTo(0, top + 40), originalTop);
  await expect.poll(() => companion.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBeGreaterThanOrEqual(0);
  await expect.poll(() => companion.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBeLessThan(30);
  const pinnedTop = await companion.evaluate((element) => element.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollBy(0, 80));
  await expect.poll(() => companion.evaluate((element, top) => Math.abs(element.getBoundingClientRect().top - top), pinnedTop)).toBeLessThan(2);

  await page.getByRole("button", { name: /^第 2 天｜/ }).click();
  await expect(companion).toContainText("THE DAILY ROUTE · 02");
  await expectCompanionBasemap(companion);
  await expect(map.locator('.serendipity-map-pin[title="柳浪闻莺"]')).toHaveCount(0);
  const villagePin = map.locator('.serendipity-map-pin[title="龙井村"]');
  await expect(villagePin).toBeVisible();
  await villagePin.click();
  await expect(tabs.getByRole("tab", { name: "每日时间轴", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#timeline-event-d2-activity > div")).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("heading", { name: "编辑：龙井村寻茶" })).toBeVisible();
  expect(await db.planVersion.count({ where: { tripId } })).toBe(1);
});

test("tablet and mobile retain both companion and chapters without horizontal page overflow", async ({ page, request }) => {
  const tripId = await seedEditorialTrip(request);
  await controlledBasemap(page);
  await page.goto(`/trips/${tripId}`);
  const companion = page.getByRole("complementary", { name: "当日伴随看板" });
  const timeline = page.getByRole("list", { name: "当日行程时间轴" });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(companion).toBeVisible();
    await expect(companion).toHaveCSS("position", "static");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const timelineBounds = await timeline.boundingBox();
    const companionBounds = await companion.boundingBox();
    expect(companionBounds!.y).toBeGreaterThan(timelineBounds!.y + timelineBounds!.height);
  }
  await page.getByRole("button", { name: /^第 2 天｜/ }).click();
  await expect(page.getByRole("button", { name: /^第 2 天｜/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^第 \d+ 项：龙井村寻茶$/ })).toBeVisible();
  await expect(companion).toContainText("THE DAILY ROUTE · 02");
  const map = await expectCompanionBasemap(companion);
  await expect(map.locator('.serendipity-map-pin[title="龙井村"]')).toBeVisible();
  expect(await db.planVersion.count({ where: { tripId } })).toBe(1);
});

test("companion falls back only when tiles fail and retry restores its basemap, pins and route", async ({ page, request }) => {
  const tripId = await seedEditorialTrip(request);
  const network = await controlledBasemap(page, false);
  await page.goto(`/trips/${tripId}`);
  const companion = page.getByRole("complementary", { name: "当日伴随看板" });
  const fallback = companion.getByTestId("daily-route-diagram");
  await expect(fallback).toBeVisible();
  await expect(fallback.getByRole("button", { name: /柳浪闻莺/ })).toBeVisible();
  await expect(fallback.getByTestId("daily-route-line").first()).toBeAttached();
  await expect(companion.getByLabel("当日动线站点")).toContainText("柳浪闻莺");
  const retry = companion.getByRole("button", { name: "重试地图", exact: true });
  await expect(retry).toBeVisible();

  network.restore();
  await retry.click();
  const map = await expectCompanionBasemap(companion);
  await expect(map.locator('.serendipity-map-pin[title="柳浪闻莺"]')).toBeVisible();
  await expect(fallback).toHaveCount(0);
  expect(await db.planVersion.count({ where: { tripId } })).toBe(1);
});

test("companion budget distinguishes unknown amounts from free items and charts only known costs", async ({ page, request }) => {
  const tripId = await seedEditorialTrip(request);
  const plan = await db.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId, versionNumber: 1 } } });
  const costs = planCostItemSchema.array().parse(JSON.parse(plan.costs));
  const unknown = costs.map((cost) => ({ ...cost, unitAmountCents: null, unitAmountMaxCents: null }));
  await db.planVersion.update({ where: { id: plan.id }, data: { costs: JSON.stringify(unknown) } });
  await controlledBasemap(page);
  await page.goto(`/trips/${tripId}`);
  const budget = page.getByRole("complementary", { name: "当日伴随看板" }).getByRole("region", { name: "全程预估总花费" });
  await expect(budget.getByText("尚无报价", { exact: true })).toBeVisible();
  await expect(budget.getByText("0 元", { exact: true })).toHaveCount(0);
  await expect(budget.getByTestId("companion-budget-bar")).toHaveCount(0);

  const free = costs.map((cost) => ({ ...cost, unitAmountCents: 0, unitAmountMaxCents: 0 }));
  await db.planVersion.update({ where: { id: plan.id }, data: { costs: JSON.stringify(free) } });
  await page.reload();
  await expect(budget.getByText("尚无报价", { exact: true })).toHaveCount(0);
  await expect(budget.getByText("0 元", { exact: true }).first()).toBeVisible();
  await expect(budget.getByTestId("companion-budget-bar")).toHaveCount(0);

  const mixed = unknown.map((cost) => cost.category === "accommodation" ? { ...cost, unitAmountCents: 26000, unitAmountMaxCents: 26000 } : cost);
  await db.planVersion.update({ where: { id: plan.id }, data: { costs: JSON.stringify(mixed) } });
  await page.reload();
  await expect(budget.getByText("尚无报价", { exact: true })).toHaveCount(0);
  await expect(budget.getByTestId("companion-budget-bar").locator("span")).toHaveCount(1);
  await expect(budget.getByTestId("companion-budget-bar").locator("span")).toHaveAttribute("data-category", "accommodation");
  await expect(budget).toContainText("项未报价费用未计入");
});
