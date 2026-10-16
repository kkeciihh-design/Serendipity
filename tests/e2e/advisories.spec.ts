import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";
import { derivePlanCosts } from "../../lib/budget";
import { preparePlanForStorage, validatePlan } from "../../lib/plan";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
import { attractionCatalog } from "../../lib/attraction-catalog";
import { unknownWeatherRecord } from "../../lib/weather";
process.env.SERENDIPITY_DATA_DIR = assertTestDataPath(path.resolve("test-data/e2e"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const evidence = verificationEvidenceDirectory("phase21-browser");
test.afterAll(async () => db.$disconnect());
async function seed(request: APIRequestContext, daysAhead = 2) {
  const response = await request.post("/api/trips", { data: { originalRequest: "阶段21提醒隔离演练：天气与闭馆来源为合成测试数据，未实际预订。" } }); expect(response.status()).toBe(201);
  const { trip } = await response.json();
  const startDate = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10), endDate = new Date(Date.parse(startDate) + 86_400_000).toISOString().slice(0, 10);
  const snapshot = requestFixture(2, { startDate, endDate });
  await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } });
  await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } });
  const content = preparePlanForStorage(planFixture(snapshot));
  content.events.find((e) => e.id === "d1-activity")!.title = content.events.find((e) => e.id === "d1-activity")!.locationName = "湖南博物院";
  content.events.find((e) => e.id === "d2-activity")!.title = content.events.find((e) => e.id === "d2-activity")!.locationName = "橘子洲";
  const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events), costs: JSON.stringify(derivePlanCosts(content.events)), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify(validatePlan(content, snapshot)) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  const place = attractionCatalog.find((c) => c.name === "橘子洲")!.location!;
  const weather = { ...unknownWeatherRecord({ locationName: place.name, latitude: Number(place.latitude.toFixed(2)), longitude: Number(place.longitude.toFixed(2)), date: endDate, status: "fresh" }), retrievedAt: new Date().toISOString(), temperatureMaxC: 28, temperatureMinC: 18, precipitationSumMm: 12, precipitationProbabilityMax: 80, weatherCode: 61, applicableFrom: new Date(`${endDate}T00:00:00+08:00`).toISOString(), applicableUntil: new Date(`${endDate}T23:59:59+08:00`).toISOString() };
  await db.advisoryState.create({ data: { tripId: trip.id, revision: 1, planVersion: 1, items: "[]", weather: JSON.stringify({ aiStatus: "not_configured", records: [weather] }) } });
  await db.evidenceFact.create({ data: { tripId: trip.id, planVersionId: row.id, targetType: "event", targetId: "d1-activity", field: "opening_hours", evaluationVersion: 1, status: "verified", sourceDateStatus: "applicable", sourceTitle: "合成测试闭馆来源", sourceUrl: "https://example.com/test-closure", sourcePublisher: "测试", extractedValue: "闭馆", contentQuote: "合成场景：本日闭馆", retrievedAt: new Date(), applicableFrom: new Date(`${startDate}T00:00:00+08:00`), applicableUntil: new Date(`${startDate}T23:59:59+08:00`), searchProvider: "test", searchQuery: "test" } });
  return trip.id as string;
}
const panel = (p: Page) => p.getByRole("tabpanel", { name: "行程提醒", exact: true });
const item = (p: Page, id: string) => panel(p).locator(`[data-advisory-id="${id}"]`);
async function open(p: Page, id: string) { await p.goto(`/trips/${id}?view=advisories`); await expect(item(p, "opening:d1-activity")).toBeVisible(); }
const saved = async (p: Page) => expect(panel(p).getByRole("status")).toContainText("提醒已保存");

test("reminders show dated evidence, remain accessible at three widths and link to editing/checklist", async ({ page, request, browser }) => {
  const id = await seed(request); await fs.mkdir(evidence, { recursive: true }); await open(page, id);
  await expect(item(page, "rain:d2-activity")).toContainText("橘子洲");
  await item(page, "opening:d1-activity").getByText("展开依据与来源").click(); await expect(item(page, "opening:d1-activity")).toContainText("合成测试闭馆来源");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await panel(page).evaluate((e) => e.scrollIntoView({ block: "start" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: path.join(evidence, `advisories-${width}.png`) });
  }
  const known = item(page, "opening:d1-activity").getByRole("button", { name: "标记已知", exact: true }); await known.focus(); await known.press("Enter"); await saved(page);
  await expect(item(page, "opening:d1-activity")).toContainText("需处理"); await expect(item(page, "opening:d1-activity")).toContainText("已知事项");
  await page.reload(); await expect(item(page, "opening:d1-activity")).toContainText("已知事项");
  const reopened = await browser.newPage(); await open(reopened, id); await expect(item(reopened, "opening:d1-activity")).toContainText("已知事项"); await reopened.close();
  await item(page, "opening:d1-activity").getByRole("button", { name: "查看 / 编辑相关活动", exact: true }).click();
  await expect(page.getByRole("tab", { name: "每日时间轴", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#timeline-event-d1-activity")).toContainText("开放冲突 · 需调整");
  await page.getByRole("tab", { name: "行程提醒", exact: true }).click();
  await item(page, "reservation:d1-activity").getByRole("button", { name: "查看关联清单", exact: true }).click();
  await expect(page.getByRole("tab", { name: "出发前清单", exact: true })).toHaveAttribute("aria-selected", "true");
  const checklist = page.locator('[data-checklist-id="reservation:d1-activity"]'); await expect(checklist).toBeVisible();
  await checklist.getByRole("checkbox").click(); await expect(page.getByRole("tabpanel", { name: "出发前清单", exact: true }).getByRole("status")).toContainText("已保存到本机");
  await page.getByRole("tab", { name: "行程提醒", exact: true }).click(); await expect(item(page, "reservation:d1-activity")).toHaveCount(0);
});

test("double click, offline failure and two pages preserve acknowledged state and require rereading", async ({ page, request, browser, context }) => {
  const id = await seed(request); await open(page, id); let posts = 0;
  await page.route(`**/api/trips/${id}/advisories`, async (r) => { posts++; await new Promise((resolve) => setTimeout(resolve, 250)); await r.continue(); });
  await item(page, "opening:d1-activity").getByRole("button", { name: "标记已知", exact: true }).evaluate((e: HTMLButtonElement) => { e.click(); e.click(); }); await saved(page); expect(posts).toBe(1);
  await page.unroute(`**/api/trips/${id}/advisories`);
  const second = await browser.newPage(); await open(second, id);
  await context.setOffline(true); await item(page, "opening:d1-activity").getByRole("button", { name: "恢复提醒", exact: true }).click(); await expect(panel(page).getByRole("alert")).toBeVisible(); await expect(item(page, "opening:d1-activity")).toContainText("已知事项");
  await context.setOffline(false); await panel(page).getByRole("button", { name: "重新读取提醒", exact: true }).click(); await expect(panel(page).getByRole("status")).toContainText("已读取");
  await item(page, "opening:d1-activity").getByRole("button", { name: "恢复提醒", exact: true }).click(); await saved(page);
  await item(second, "opening:d1-activity").getByRole("button", { name: "恢复提醒", exact: true }).click(); await expect(panel(second).getByRole("alert")).toContainText("其他页面");
  await panel(second).getByRole("button", { name: "重新读取提醒", exact: true }).click(); await expect(item(second, "opening:d1-activity").getByRole("button", { name: "标记已知", exact: true })).toBeVisible(); await second.close();
});

test("expired/future/missing weather is honest and a failed refresh leaves the itinerary intact", async ({ page, request }) => {
  const id = await seed(request); const state = await db.advisoryState.findUniqueOrThrow({ where: { tripId: id } }), weather = JSON.parse(state.weather); weather.records[0].retrievedAt = new Date(Date.now() - 3_600_001).toISOString();
  await db.advisoryState.update({ where: { tripId: id }, data: { weather: JSON.stringify(weather) } });
  await open(page, id); await expect(panel(page)).toContainText("天气资料已过期"); await expect(item(page, "rain:d2-activity")).toHaveCount(0); await expect(panel(page)).toContainText("缺少位置，天气未知");
  const before = await db.planVersion.findMany({ where: { tripId: id } });
  await page.route(`**/api/trips/${id}/advisories`, (r) => r.fulfill({ status: 503, json: { error: "模拟刷新失败" } }));
  await panel(page).getByRole("button", { name: "刷新天气与提醒", exact: true }).click(); await expect(panel(page).getByRole("alert")).toContainText("模拟刷新失败");
  expect(await db.planVersion.findMany({ where: { tripId: id } })).toEqual(before);
  const future = await seed(request, 30); await open(page, future); await expect(panel(page).getByText("超出预报期限，暂无有效预报")).toHaveCount(2); await expect(item(page, "rain:d2-activity")).toHaveCount(0);
});

test("closed recommendations, history and write permissions stay protected", async ({ page, request }) => {
  const id = await seed(request); await open(page, id);
  const recommendations = await request.get(`/api/trips/${id}/plans/1/attractions?eventId=d1-activity`); expect(recommendations.status()).toBe(200);
  expect((await recommendations.json()).recommendations.current.eligibility).toBe("excluded");
  expect((await request.post(`/api/trips/${id}/advisories`, { headers: { Origin: "https://outside.example" }, data: {} })).status()).toBe(403);
  expect((await request.post(`/api/trips/${id}/advisories`, { data: { action: "refresh", expectedPlanVersion: 1, expectedRevision: 1, confirmedBooking: true } })).status()).toBe(400);
  expect((await request.get("/api/settings/weather")).status()).toBe(401);
  expect((await request.post("/api/settings/weather/test", { data: {} })).status()).toBe(401);
  const edit = await request.patch(`/api/trips/${id}/plans/1`, { data: { type: "event", eventId: "d1-rest", timeEdit: "preserve", note: "新版本", locked: false, status: "suggested", remove: false } }); expect(edit.status()).toBe(200);
  expect((await request.post(`/api/trips/${id}/advisories`, { data: { action: "refresh", expectedPlanVersion: 1, expectedRevision: 1 } })).status()).toBe(409);
  await page.goto(`/trips/${id}?planVersion=1&view=advisories`); await expect(panel(page)).toContainText("当前提醒不作为历史快照展示"); await expect(panel(page).locator("article")).toHaveCount(0);
});
