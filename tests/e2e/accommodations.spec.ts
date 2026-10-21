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

process.env.SERENDIPITY_DATA_DIR = assertTestDataPath(path.resolve("test-data/e2e"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const evidence = verificationEvidenceDirectory("phase19-browser");
test.afterAll(async () => db.$disconnect());
async function seed(request: APIRequestContext, days = 3) {
  const response = await request.post("/api/trips", { data: { originalRequest: "阶段19住宿隔离演练：长沙旅行，费用和时间为合成数据。" } }); expect(response.status()).toBe(201);
  const { trip } = await response.json(), snapshot = requestFixture(days);
  await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } });
  await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } });
  const content = preparePlanForStorage(planFixture(snapshot));
  content.events.find((e) => e.id === "d2-activity")!.locationName = "次日公园";
  const costs = derivePlanCosts(content.events);
  const data = { versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events), costs: JSON.stringify(costs), places: "[]", routeLegs: "[]", pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify(validatePlan(content, snapshot, costs)) };
  const row = await db.planVersion.create({ data: { tripId: trip.id, ...data } }); await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  return { id: trip.id as string, snapshot, data };
}
async function open(page: Page, id: string) { await page.goto(`/trips/${id}`); await page.getByRole("tab", { name: "住宿推荐", exact: true }).click(); await expect(page.getByLabel("房间数", { exact: true })).toBeVisible(); }
async function propose(page: Page) { await expect(page.getByRole("button", { name: "预览住宿选择", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "预览住宿选择", exact: true }).click(); await expect(page.getByLabel("住宿调整预览", { exact: true })).toBeVisible(); }
test("area comparison, two-night pricing and responsive layouts persist across refresh and history", async ({ page, request }) => {
  const trip = await seed(request); await fs.mkdir(evidence, { recursive: true }); await fs.writeFile(path.join(evidence, "demo-seed.json"), JSON.stringify(trip.data, null, 2));
  await open(page, trip.id); await expect(page.getByRole("radio", { name: /^选择/ })).toHaveCount(3);
  await page.getByLabel("房间数", { exact: true }).fill("3"); await page.getByLabel("离店日期", { exact: true }).fill(trip.snapshot.endDate!);
  await page.getByLabel("每房每晚下限（元）", { exact: true }).fill("180.50"); await page.getByLabel("每房每晚上限（元，可空）", { exact: true }).fill("220.50");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.getByRole("heading", { name: "这趟旅行，住在哪里" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.screenshot({ path: path.join(evidence, `areas-${width}.png`) });
  }
  await propose(page); await expect(page.getByLabel("住宿调整预览")).toContainText("共2晚、3房");
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  await page.getByRole("button", { name: "应用住宿选择", exact: true }).click(); await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
  const saved = await db.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId: trip.id, versionNumber: 2 } } });
  expect(JSON.parse(saved.costs).filter((c: { category: string }) => c.category === "accommodation")).toEqual(expect.arrayContaining([expect.objectContaining({ roomCount: 3, nightCount: 1, unitAmountCents: 18050 })]));
  await page.reload(); await page.getByRole("tab", { name: "住宿推荐", exact: true }).click(); await expect(page.getByLabel("房间数")).toHaveValue("3"); await expect(page.getByLabel("离店日期", { exact: true })).toHaveValue(trip.snapshot.endDate!);
  await page.getByRole("tab", { name: "预算", exact: true }).click(); await expect(page.getByRole("tabpanel", { name: "预算", exact: true }).getByText(/3 房 × 1 晚/).first()).toBeVisible();
  await page.goto(`/trips/${trip.id}?planVersion=1`); await page.getByRole("tab", { name: "住宿推荐", exact: true }).click(); await expect(page.getByText(/历史版本只读/).first()).toBeVisible(); await expect(page.getByLabel("房间数")).toBeDisabled();
  await fs.writeFile(path.join(evidence, "area-saved.json"), JSON.stringify({ tripId: trip.id, events: JSON.parse(saved.events), costs: JSON.parse(saved.costs) }, null, 2));
});
test("hotel search candidates remain distinct from availability and confirm with no invented routes", async ({ page, request }) => {
  const trip = await seed(request, 2); const { createSignedPayload } = await import("../../lib/security");
  await page.route(`**/api/trips/${trip.id}/plans/*/places`, async (route) => {
    const c = { provider: "osm", poiId: "node:888", name: "演练酒店", city: "长沙", district: "测试区域", address: "合成地址，仅供验证", adcode: "", category: "tourism:hotel", longitude: 112.97, latitude: 28.19, coordinateSystem: "WGS84", retrievedAt: new Date().toISOString() };
    await route.fulfill({ json: { candidates: [{ ...c, selectionToken: createSignedPayload({ scope: "place-selection", dataGeneration: route.request().headers()["x-data-generation"], tripId: trip.id, version: Number(new URL(route.request().url()).pathname.split("/").at(-2)), eventId: "d1-hotel", candidate: c, exp: Date.now() + 60000 }) }] } });
  });
  await open(page, trip.id); await propose(page); await page.getByRole("button", { name: "应用住宿选择", exact: true }).click(); await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
  await page.getByRole("radio", { name: "确认具体酒店", exact: true }).check(); await page.getByLabel("酒店完整名称").fill("演练酒店"); await page.getByRole("button", { name: "搜索酒店地点", exact: true }).click(); await page.getByRole("radio", { name: /演练酒店 · 长沙/ }).check();
  await page.getByText("入住时段、行李寄存与接驳（可选）", { exact: true }).click();
  await page.getByLabel("酒店可入住时间").fill("14:00"); await page.getByLabel("酒店退房截止").fill("12:00");
  await propose(page); await expect(page.getByLabel("住宿调整预览")).toContainText("确认实际酒店：演练酒店"); await expect(page.getByLabel("住宿调整预览")).toContainText("不表示已预订");
  await page.screenshot({ path: path.join(evidence, "hotel-preview.png") }); await page.getByRole("button", { name: "应用住宿选择", exact: true }).click(); await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V3");
  await page.reload(); await page.getByRole("tab", { name: "住宿推荐", exact: true }).click(); await expect(page.getByText(/已确认具体酒店地点 · 演练酒店/)).toBeVisible();
  const row = await db.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId: trip.id, versionNumber: 3 } } }); expect(JSON.parse(row.places)[0].precision).toBe("poi"); expect(JSON.parse(row.routeLegs)).toEqual([]);
});
test("load errors, save failures, cancelled previews and empty hotel searches keep the form usable", async ({ page, request }) => {
  const trip = await seed(request, 2), url = `**/api/trips/${trip.id}/plans/1/accommodations*`;
  let loadFailed = false, saveFailed = false;
  await page.route(url, async (route) => {
    if (route.request().method() === "GET" && !loadFailed) { loadFailed = true; return route.fulfill({ status: 503, json: { error: "住宿资料暂不可用（测试）" } }); }
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "apply" && !saveFailed) { saveFailed = true; return route.fulfill({ status: 503, json: { error: "保存失败（测试），可重试" } }); }
    return route.continue();
  });
  await page.goto(`/trips/${trip.id}`); await page.getByRole("tab", { name: "住宿推荐", exact: true }).click(); await page.getByRole("button", { name: "重试住宿资料" }).click(); await expect(page.getByLabel("房间数")).toBeVisible();
  await page.getByLabel("房间数").fill("2"); await propose(page); await page.getByRole("button", { name: "应用住宿选择", exact: true }).click(); await expect(page.getByRole("tabpanel", { name: "住宿推荐", exact: true }).getByRole("alert")).toContainText("保存失败"); await expect(page.getByLabel("房间数")).toHaveValue("2");
  await page.getByRole("button", { name: "返回修改", exact: true }).click(); await page.getByRole("radio", { name: "确认具体酒店", exact: true }).check();
  await page.route("**/places", (r) => r.fulfill({ json: { candidates: [] } })); await page.getByLabel("酒店完整名称").fill("不存在酒店"); await page.getByRole("button", { name: "搜索酒店地点", exact: true }).click(); await expect(page.getByText(/没有找到具体酒店资料/)).toBeVisible();
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  await page.getByRole("radio", { name: "先保存区域偏好", exact: true }).check();
  await page.route(url, async (r) => { if (r.request().method() === "POST") { await new Promise((resolve) => setTimeout(resolve, 1500)); return r.fulfill({ status: 503, json: { error: "迟到结果" } }).catch(() => undefined); } return r.continue(); });
  await page.getByRole("button", { name: "预览住宿选择", exact: true }).click(); await page.getByRole("button", { name: "取消本次查询", exact: true }).click(); await page.waitForTimeout(1700);
  await expect(page.getByLabel("住宿调整预览")).toHaveCount(0); await expect(page.getByRole("button", { name: "预览住宿选择", exact: true })).toBeEnabled();
});
test("invalid dates and cross-origin writes cannot create a new version", async ({ page, request }) => {
  const trip = await seed(request, 2); await open(page, trip.id); await page.getByLabel("离店日期", { exact: true }).fill(trip.snapshot.startDate!); await page.getByRole("button", { name: "预览住宿选择", exact: true }).click(); await expect(page.getByRole("tabpanel", { name: "住宿推荐", exact: true }).getByRole("alert")).toContainText("入住必须早于离店");
  expect((await request.post(`/api/trips/${trip.id}/plans/1/accommodations`, { headers: { Origin: "https://outside.example" }, data: {} })).status()).toBe(403);
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
});
