import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";
import type { APIRequestContext, Page } from "@playwright/test";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { derivePlanCosts } from "../../lib/budget";

process.env.SERENDIPITY_DATA_DIR = path.resolve("test-data/e2e");
const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
test.afterAll(async () => prisma.$disconnect());

async function seed(request: APIRequestContext, linked = false) {
  const response = await request.post("/api/trips", { data: { originalRequest: "地图浏览器测试：深圳站和深圳北站" } });
  const { trip } = await response.json();
  const snapshot = requestFixture(2, { destination: "深圳" });
  const content = planFixture(snapshot);
  const places = linked ? [
    {
      id: "museum", provider: "osm", poiId: "node:museum", name: "Example Museum", city: "深圳市", district: "福田区",
      address: "深圳市福田区Example Museum", adcode: "", category: "museum", coordinateSystem: "WGS84", latitude: 22.54, longitude: 114.06,
      precision: "poi", confirmation: "user_confirmed", confirmedAt: new Date().toISOString(), retrievedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim",
    },
    {
      id: "hotel", provider: "osm", poiId: "node:hotel", name: "Example Hotel", city: "深圳市", district: "罗湖区",
    address: "深圳市罗湖区Example Hotel", adcode: "", category: "hotel", coordinateSystem: "WGS84", latitude: 22.53, longitude: 114.11,
    precision: "poi", confirmation: "user_confirmed", confirmedAt: new Date().toISOString(), retrievedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim",
  }] : [];
  if (linked) {
    const activity = content.events.find((item) => item.id === "d1-activity");
    if (activity) activity.placeId = "museum";
    for (const eventId of ["d1-breakfast", "d1-hotel", "d2-breakfast"]) {
      const event = content.events.find((item) => item.id === eventId);
      if (event) event.placeId = "hotel";
    }
    content.events.push({
      id: "d2-extra", type: "local_transport", dayNumber: 2, date: content.events.find((item) => item.id === "return")?.date ?? content.events.at(-1)!.date,
      startTime: "15:00", endTime: "15:45", title: "可选加项", locationName: "Example Hotel", placeId: "hotel",
      suggestedDurationSeconds: 2700, costDraftCents: 0, costStatus: "estimated", status: "suggested", locked: false, note: null,
    });
  }
  const row = await prisma.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 1, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events), costs: JSON.stringify(derivePlanCosts(content.events)), pendingItems: JSON.stringify(content.pendingItems), places: JSON.stringify(places), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }) } });
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
      return { ...candidate, selectionToken: createSignedPayload({ scope: "place-selection", dataGeneration: route.request().headers()["x-data-generation"], tripId, version, eventId, candidate, exp: Date.now() + 60000 }) };
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
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
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

test("map loading timeout keeps the itinerary readable", async ({ page, request }) => {
  const trip = await seed(request);
  await page.route("https://tile.openstreetmap.org/**", (route) => new Promise<void>(() => {
    void route;
  }));
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  // The timeline's companion also times out while its tab is hidden. Check the
  // active full-map panel, so its message cannot match the hidden companion.
  const mapPanel = page.getByRole("region", { name: "地图定位", exact: true });
  await expect(mapPanel.getByText("地图加载超时，文字地点仍可查看。请重试。", { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(mapPanel.getByRole("button", { name: "重试地图", exact: true })).toBeVisible();
  await expect(mapPanel.getByRole("button", { name: "定位：Example Museum", exact: true })).toBeVisible();
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
});

test("map numbers and timeline selections stay linked across edits and days", async ({ page, request }) => {
  const trip = await seed(request, true);
  await controlledMap(page, trip.id);
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const mapFrame = page.frameLocator('iframe[title="行程地点地图"]');
  const hotelPin = mapFrame.locator(".serendipity-map-pin").filter({ hasText: "③⑦" });
  await expect(hotelPin).toBeVisible();
  await page.locator('iframe[title="行程地点地图"]').scrollIntoViewIfNeeded();
  await hotelPin.click();
  const breakfastPopupButton = mapFrame.getByRole("button", { name: /3\. 08:00–08:30｜早餐/ });
  await expect(breakfastPopupButton).toBeVisible();
  await breakfastPopupButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^第 1 天｜/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timeline-event-d1-breakfast > div")).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("heading", { name: /编辑：早餐/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "第 3 项：早餐" })).toBeVisible();

  await page.getByRole("button", { name: "定位地图：④Example Museum" }).click();
  // Leaflet briefly retains the previous popup while its fade-out completes.
  await expect(mapFrame.locator(".serendipity-map-popup strong")).toHaveCount(1);
  await expect(mapFrame.locator(".serendipity-map-popup strong")).toHaveText("Example Museum");
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await page.getByLabel("开始时间").fill("14:30");
  await page.getByLabel("时长（分钟）").fill("120");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看日程：⑥Example Museum" })).toBeVisible();

  await page.getByLabel("地图日期", { exact: true }).selectOption("2");
  const crossDayPin = mapFrame.locator(".serendipity-map-pin").filter({ hasText: "②⑥" });
  await expect(crossDayPin).toBeVisible();
  await page.locator('iframe[title="行程地点地图"]').scrollIntoViewIfNeeded();
  await crossDayPin.click();
  const optionalPopupButton = mapFrame.getByRole("button", { name: /6\. 15:00–15:45｜可选加项/ });
  await expect(optionalPopupButton).toBeVisible();
  await optionalPopupButton.click();
  await expect(page.getByRole("button", { name: /^第 2 天｜/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timeline-event-d2-extra > div")).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("heading", { name: /编辑：可选加项/ })).toBeVisible();
  await page.getByRole("button", { name: "移除安排" }).click();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V3");
  await expect(page.getByRole("heading", { name: /编辑：可选加项/ })).toHaveCount(0);
  await expect(page.locator("#plan-event-edit-title")).toHaveCount(0);

  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await page.getByLabel("地图日期", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "查看日程：⑦住宿区域" }).click();
  await expect(page.getByRole("heading", { name: /编辑：住宿区域/ })).toBeVisible();
  await page.getByRole("button", { name: "定位地图：⑦住宿区域" }).click();
  await expect(page.getByRole("tab", { name: "地图", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "查看日程：⑦住宿区域" }).click();
  await expect(page.getByRole("heading", { name: /编辑：住宿区域/ })).toBeVisible();
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(3);
});

test("mobile map summary jumps to the matching day and event", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const trip = await seed(request, true);
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await page.getByRole("button", { name: "查看日程：③早餐" }).click();
  await expect(page.getByRole("button", { name: /^第 1 天｜/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timeline-event-d1-breakfast > div")).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("heading", { name: /编辑：早餐/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("unavailable public transit retains ordered illustrative links without claiming a verified road", async ({ page, request }) => {
  const trip = await seed(request, true);
  await controlledMap(page, trip.id);
  const response = await request.post(`/api/trips/${trip.id}/plans/1/routes`, { data: {
    fromEventId: "d1-breakfast", toEventId: "d1-activity", departureTime: "08:30", mode: "public_transit",
  } });
  expect(response.status()).toBe(200);
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const routeCard = page.locator("article").filter({ hasText: "③早餐 → ④Example Museum" });
  await expect(routeCard.getByText("暂无可用路线", { exact: false })).toBeVisible();
  await expect(routeCard.getByText("当前免费地图方案没有公共交通路线服务", { exact: false })).toBeVisible();
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
  const mapFrame = page.frameLocator('iframe[title="行程地点地图"]');
  await expect.poll(() => mapFrame.locator(".serendipity-map-route-arrow").count()).toBeGreaterThan(0);
  expect(await mapFrame.locator("path.leaflet-interactive[stroke-dasharray]").count()).toBeGreaterThan(0);
  await expect(mapFrame.locator("path.leaflet-interactive:not([stroke-dasharray])")).toHaveCount(0);
  await expect(page.getByText("虚线为动线示意", { exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(page.locator("article").filter({ hasText: "③早餐 → ④Example Museum" }).getByText("暂无可用路线", { exact: false })).toBeVisible();
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
});
