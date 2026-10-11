import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";
import type { APIRequestContext, Page } from "@playwright/test";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { derivePlanCosts } from "../../lib/budget";

process.env.SERENDIPITY_DATA_DIR = path.resolve("test-data/e2e");
const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
test.afterAll(async () => prisma.$disconnect());

async function seed(request: APIRequestContext) {
  const response = await request.post("/api/trips", { data: { originalRequest: "地图浏览器测试：深圳站和深圳北站" } });
  const { trip } = await response.json();
  const snapshot = requestFixture(2, { destination: "深圳" });
  const content = planFixture(snapshot);
  const row = await prisma.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 1, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events), costs: JSON.stringify(derivePlanCosts(content.events)), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }) } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  return trip as { id: string };
}
async function controlledMap(page: Page, tripId: string, empty = false) {
  const { createSignedPayload } = await import("../../lib/security");
  // Deterministic UI tests only; real tiles/search have a separate smoke check.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
  await page.route(`**/api/trips/${tripId}/plans/*/places`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const { eventId } = route.request().postDataJSON();
    const version = Number(new URL(route.request().url()).pathname.split("/").at(-2));
    const candidates = [
      { poiId: "way:174194694", name: "深圳站", latitude: 22.5344874, longitude: 114.1121107, district: "罗湖区" },
      { poiId: "node:9999", name: "深圳北站", latitude: 22.609, longitude: 114.023, district: "龙华区" },
    ].map((item) => {
      const candidate = { provider: "osm", ...item, city: "深圳市", address: `深圳市${item.district}${item.name}`, adcode: "", category: "railway:station", coordinateSystem: "WGS84", retrievedAt: new Date().toISOString() };
      return { ...candidate, selectionToken: createSignedPayload({ scope: "place-selection", tripId, version, eventId, candidate, exp: Date.now() + 60000 }) };
    });
    await route.fulfill({ json: { candidates: empty ? [] : candidates } });
  });
}

test("chooses a specific station, persists a new version and keeps history read only", async ({ page, request }) => {
  const trip = await seed(request); await controlledMap(page, trip.id);
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(page.getByText("当天还没有已确认的地点", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "定位：Example Museum", exact: true }).click();
  await page.getByLabel("地点名称或公共地标").fill("深圳站");
  await page.getByRole("button", { name: "搜索地点", exact: true }).click();
  await page.getByRole("radio", { name: /深圳北站/ }).check();
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/places"));
  await page.getByRole("button", { name: "确认地点并保存新版本" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("heading", { name: /计划版本 2/ })).toBeVisible();
  await expect(page.getByText("用户已确认地点", { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(page.getByText("深圳市龙华区深圳北站", { exact: false })).toBeVisible();
  await page.goto(`/trips/${trip.id}?planVersion=1`); await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(page.getByRole("button", { name: "定位：Example Museum", exact: true })).toBeDisabled();
  await expect(page.getByText("当天还没有已确认的地点", { exact: false })).toBeVisible();
});

test("mobile day selection, area references and empty results remain usable", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const trip = await seed(request); await controlledMap(page, trip.id, true);
  await page.goto(`/trips/${trip.id}`); await page.getByRole("tab", { name: "地图", exact: true }).click();
  await page.getByRole("button", { name: "定位：住宿区域", exact: true }).click();
  await page.getByLabel("地点名称或公共地标").fill("未知住宿区域");
  await page.getByRole("button", { name: "搜索地点", exact: true }).click();
  await expect(page.getByText("没有找到地点。", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认地点并保存新版本" })).toBeDisabled();
  await page.getByRole("button", { name: "保留原状并关闭" }).click();
  await page.getByLabel("地图日期", { exact: true }).selectOption("2");
  await expect(page.getByRole("button", { name: "定位：返程交通", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
});

test("untrusted writes and unauthenticated settings cannot change maps", async ({ request }) => {
  const trip = await seed(request);
  for (const method of ["post", "patch"] as const) {
    const response = await request[method](`/api/trips/${trip.id}/plans/1/places`, { headers: { Origin: "https://outside.example" }, data: {} });
    expect(response.status()).toBe(403);
  }
  expect((await request.get("/api/settings/map")).status()).toBe(401);
  expect((await request.post("/api/settings/map/test", { data: {} })).status()).toBe(401);
  expect((await request.get("/api/map/config")).status()).toBe(200);
  expect(await (await request.get("/api/map/config")).json()).toEqual({ provider: "osm" });
  expect((await request.get("/api/map/config?preview=1")).status()).toBe(401);
});

test("map network failure leaves the itinerary and retry controls usable", async ({ page, request }) => {
  const trip = await seed(request);
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort("internetdisconnected"));
  await page.goto(`/trips/${trip.id}`); await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试地图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "定位：Example Museum", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await expect(page.getByRole("button", { name: /Example Museum/ }).first()).toBeVisible();
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
});
