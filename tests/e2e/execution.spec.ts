import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { ticketFixture } from "../helpers/ticket-fixtures";
import { preparePlanForStorage, validatePlan } from "../../lib/plan";
import { derivePlanCosts } from "../../lib/budget";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
import type { ExecutionChange } from "../../lib/execution";
const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const evidence = verificationEvidenceDirectory("phase23-browser");
test.afterAll(async () => { await db.$disconnect(); });
async function seed(request: APIRequestContext, ticket = false) {
  const response = await request.post("/api/trips", { data: { originalRequest: "阶段23旅行执行模式：长沙两日合成演练，没有真实订单。" } }); expect(response.status()).toBe(201);
  const { trip } = await response.json(), snapshot = requestFixture();
  await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } });
  await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } });
  const content = preparePlanForStorage(planFixture(snapshot)), costs = derivePlanCosts(content.events);
  const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events), costs: JSON.stringify(costs), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify(validatePlan(content, snapshot, costs)) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  if (ticket) {
    const r = await request.post(`/api/trips/${trip.id}/plans/1/tickets`, { data: { action: "activate", acknowledged: true, ticket: ticketFixture(snapshot.endDate!, { eventId: "return", direction: "return", departureTime: "17:00", arrivalDate: snapshot.endDate!, arrivalTime: "18:30", accessMode: "walking", accessDurationMinutes: 55, bufferMinutes: 10 }) } });
    expect(r.status()).toBe(200);
  }
  return { id: trip.id as string, date: snapshot.startDate!, endDate: snapshot.endDate! };
}
async function write(request: APIRequestContext, id: string, change: ExecutionChange) {
  const { execution } = await (await request.get(`/api/trips/${id}/execution`)).json();
  const r = await request.post(`/api/trips/${id}/execution`, { data: { expectedRevision: execution.revision, expectedPlanVersion: execution.planVersion, change } });
  expect(r.status()).toBe(200); return r.json();
}
async function open(page: Page, id: string) { await page.goto(`/trips/${id}/execute`); await expect(page.getByRole("button", { name: "重新读取", exact: true })).toBeVisible(); await expect(page.getByText(/北京时间 · 使用本机服务器/)).toBeVisible(); }
test("T20: denied geolocation, manual arrival/completion, refresh/reopen and mobile navigation", async ({ page, request, context, browser }) => {
  const trip = await seed(request, true); await fs.mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 }); await context.grantPermissions([]);
  await open(page, trip.id); await expect(page.getByText("尚未开始旅行", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "获取本次定位", exact: true }).click();
  await expect(page.getByText(/定位未获授权或暂不可用/)).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "开始旅行", exact: true }).click();
  await expect(page.getByLabel("手动选择当前步骤")).toBeEnabled();
  await page.getByLabel("手动选择当前步骤").selectOption("d1-activity");
  await expect(page.getByRole("region", { name: "当前步骤" }).getByRole("heading", { name: "Example Museum" })).toBeVisible();
  await page.getByRole("button", { name: "我已到达", exact: true }).click(); await expect(page.getByText("已手动标记到达", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "当前位置来源" })).toContainText("手动记录：Example Museum");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `execution-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "完成这一步", exact: true }).click(); await expect(page.getByText(`已完成 1 /`, { exact: false })).toBeVisible();
  await page.reload(); await expect(page.getByText(/已完成 1 \//)).toBeVisible();
  const reopened = await browser.newPage(); await open(reopened, trip.id); await expect(reopened.getByText(/已完成 1 \//)).toBeVisible(); await reopened.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "旅行底部导航" }).getByRole("link", { name: "地图", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "地图", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "旅行底部导航" });
  for (const [label, name] of [["清单", "出发前清单"], ["预算", "预算"], ["更多", "更多"], ["行程", "每日时间轴"]]) {
    await nav.getByRole("button", { name: label, exact: true }).click(); await expect(page.getByRole("tabpanel", { name, exact: true })).toBeVisible();
  }
  const row = await db.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { request: true, currentPlanVersion: true } });
  await fs.writeFile(path.join(evidence, "synthetic-demo.json"), JSON.stringify(row, null, 2));
});
test("optional browser location stores only the last point, never advances progress, and manual input overrides it", async ({ page, request, context }) => {
  const trip = await seed(request); await context.grantPermissions(["geolocation"]); await context.setGeolocation({ latitude: 28.1, longitude: 113.1, accuracy: 30 });
  await open(page, trip.id); await page.getByRole("button", { name: "获取本次定位", exact: true }).click();
  await expect(page.getByText(/本次定位已保存/)).toBeVisible(); await expect(page.getByText("尚未开始旅行", { exact: true })).toBeVisible();
  await page.getByLabel("手动位置", { exact: true }).fill("公共地标出口"); await page.getByRole("button", { name: "保存手动位置" }).click();
  await expect(page.getByRole("region", { name: "当前位置来源" })).toContainText("手动记录：公共地标出口");
  expect((await db.executionState.findUniqueOrThrow({ where: { tripId: trip.id } })).payload).not.toContain("113.1");
});
test("offline and response failure retain progress, require reread, and do not duplicate completion", async ({ page, request, context }) => {
  const trip = await seed(request); await open(page, trip.id); await page.getByRole("button", { name: "开始旅行", exact: true }).click();
  await expect(page.getByRole("button", { name: "完成这一步", exact: true })).toBeEnabled();
  await context.setOffline(true); await page.getByRole("button", { name: "完成这一步", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("重新读取");
  expect(JSON.parse((await db.executionState.findUniqueOrThrow({ where: { tripId: trip.id } })).payload).items).toEqual([]);
  await context.setOffline(false); await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("button", { name: "完成这一步", exact: true })).toBeEnabled();
  await page.route(`**/api/trips/${trip.id}/execution`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch(); await route.fulfill({ status: 503, json: { error: "模拟响应在提交后丢失" } });
  });
  await page.getByRole("button", { name: "完成这一步", exact: true }).click(); await expect(page.getByRole("main").getByRole("alert")).toContainText("提交后丢失");
  await page.unroute(`**/api/trips/${trip.id}/execution`); await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByText(/已完成 1 \//)).toBeVisible();
});
test("foreground return and device clock skew show expired redlines without advancing manual state", async ({ page, request }) => {
  const trip = await seed(request, true); let serverTime = `${trip.endDate}T15:00:00+08:00`;
  await page.clock.install({ time: new Date(serverTime) });
  await page.route(`**/api/trips/${trip.id}/execution`, async (route) => { const response = await route.fetch(), body = await response.json(); await route.fulfill({ response, json: { ...body, serverNow: new Date(serverTime).toISOString() } }); });
  await page.goto(`/trips/${trip.id}/execute`); await expect(page.getByText(/北京时间 · 使用本机服务器/)).toBeVisible();
  await expect(page.getByRole("region", { name: "下一条红线" })).toContainText("距建议行动还有");
  serverTime = `${trip.endDate}T18:00:00+08:00`; await page.clock.setSystemTime(new Date(serverTime));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("region", { name: "下一条红线" })).toContainText("已到或已过建议行动时间");
  await expect(page.getByRole("region", { name: "下一条红线" })).toContainText("已无法衔接");
  await expect(page.getByText("尚未开始旅行", { exact: true })).toBeVisible();
  await page.clock.setSystemTime(new Date(`${trip.endDate}T19:00:00+08:00`)); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText(/设备与服务器时钟相差较大/)).toBeVisible();
  await page.screenshot({ path: path.join(evidence, "expired-clock.png"), fullPage: true });
});
test("all completed, already-ended schedule, stale API, denied origin and invalid payload", async ({ page, request }) => {
  const trip = await seed(request); const { plan } = await (await request.get(`/api/trips/${trip.id}/execution`)).json();
  await write(request, trip.id, { action: "start", eventId: plan.events[0].id });
  for (const event of plan.events) { await write(request, trip.id, { action: "select", eventId: event.id }); await write(request, trip.id, { action: "complete", eventId: event.id }); }
  await open(page, trip.id); await expect(page.getByRole("heading", { name: "这一程，已走完" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始旅行", exact: true })).toHaveCount(0);
  expect((await request.post(`/api/trips/${trip.id}/execution`, { data: { expectedRevision: 0, expectedPlanVersion: 1, change: { action: "start", eventId: plan.events[0].id } } })).status()).toBe(409);
  expect((await request.post(`/api/trips/${trip.id}/execution`, { headers: { Origin: "https://foreign.example" }, data: {} })).status()).toBe(403);
  expect((await request.post(`/api/trips/${trip.id}/execution`, { data: { completedAt: "fake" } })).status()).toBe(400);
  const empty = await seed(request); await page.clock.install({ time: new Date(`${empty.endDate}T23:59:00+08:00`) });
  await page.route(`**/api/trips/${empty.id}/execution`, async (route) => { const response = await route.fetch(); await route.fulfill({ response, json: { ...await response.json(), serverNow: `${empty.endDate}T23:59:00+08:00` } }); });
  await page.goto(`/trips/${empty.id}/execute`); await expect(page.getByText(/计划日期已结束，尚有步骤未记录完成/)).toBeVisible();
});
