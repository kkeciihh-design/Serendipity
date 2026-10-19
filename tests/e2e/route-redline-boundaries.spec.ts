import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";
import { derivePlanCosts } from "../../lib/budget";
import { preparePlanForStorage } from "../../lib/plan";
import { placeSchema } from "../../lib/places";
import { manualReferenceRoute } from "../../lib/routes";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { ticketFixture } from "../helpers/ticket-fixtures";

const directory = assertTestDataPath(path.resolve("test-data/e2e"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, "data/serendipity.db").replaceAll("\\", "/")}` } } });
const seeded: string[] = [];
test.afterAll(async () => { await db.trip.deleteMany({ where: { id: { in: seeded } } }); await db.$disconnect(); });

async function seed(request: APIRequestContext, lateDeparture: boolean) {
  const created = await request.post("/api/trips", { data: { originalRequest: "隔离修复回归：城际后段与准备事项红线" } });
  expect(created.status()).toBe(201);
  const { trip } = await created.json(); seeded.push(trip.id);
  const snapshot = requestFixture();
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).status()).toBe(200);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).status()).toBe(200);
  const content = planFixture(snapshot);
  for (const event of content.events) {
    if (event.id === "departure") { event.locationName = "深圳北站"; event.placeId = "departure-place"; }
    if (event.id === "d1-activity") { event.locationName = "长沙博物馆"; event.placeId = "arrival-activity"; }
    if (lateDeparture && event.id === "d1-activity") { event.startTime = "15:00"; event.endTime = "16:00"; }
    if (lateDeparture && event.id === "d1-breakfast") { event.startTime = "07:00"; event.endTime = "07:30"; }
    if (lateDeparture && event.id === "d1-preparation") { event.startTime = "08:00"; event.endTime = "08:30"; }
  }
  const places = [["departure-place", "深圳北站"], ["arrival-activity", "长沙博物馆"]].map(([id, name], index) => placeSchema.parse({
    id, name, provider: "osm", poiId: `node:${index}`, city: index ? "长沙" : "深圳", district: "", address: "合成地点", adcode: "", category: "",
    coordinateSystem: "WGS84", longitude: 113 + index, latitude: 23 + index, precision: "poi", confirmation: "user_confirmed",
    confirmedAt: new Date().toISOString(), retrievedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim",
  }));
  const normalized = preparePlanForStorage(content);
  const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(normalized.events), costs: JSON.stringify(derivePlanCosts(normalized.events)), places: JSON.stringify(places),
    pendingItems: JSON.stringify(normalized.pendingItems), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  const saved = await request.post(`/api/trips/${trip.id}/plans/1/tickets`, { data: { action: "activate", acknowledged: true,
    ticket: ticketFixture(snapshot.startDate!, { fromName: "深圳北站", accessMode: "walking", accessDurationMinutes: 55, bufferMinutes: 10,
      ...(lateDeparture ? { departureTime: "10:35", arrivalTime: "11:35" } : {}) }) } });
  expect(saved.status(), await saved.text()).toBe(200);
  return { id: trip.id as string, date: snapshot.startDate!, plan: (await saved.json()).plan };
}

test("preparation edits reveal redline conflicts after save and refresh while the old version keeps its earlier end", async ({ page, request }) => {
  const trip = await seed(request, true);
  await page.goto(`/trips/${trip.id}`);
  const redline = page.getByRole("region", { name: "时间红线", exact: true });
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  await expect(redline.getByText(/建议最晚 .*08:55/)).toBeVisible();
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await page.getByRole("button", { name: /^第 \d+ 项：出行准备$/ }).click();
  await page.getByLabel("时长（分钟）", { exact: true }).fill("70");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(redline.getByText(/上一项结束于 .*09:10.*晚于建议出发/)).toBeVisible();
  await page.reload();
  await expect(redline.getByText(/上一项结束于 .*09:10.*晚于建议出发/)).toBeVisible();
  await expect(redline.getByText("待确认建议", { exact: true })).toBeVisible();
  await page.goto(`/trips/${trip.id}?planVersion=2&view=transport`);
  await expect(redline.getByText(/建议最晚 .*08:55/)).toBeVisible();
  await expect(redline.getByText(/上一项结束于 .*09:10/)).toHaveCount(0);
});

test("wrong-station outgoing routes are unavailable in the UI and API, and old geometry stays hidden", async ({ page, request }) => {
  const trip = await seed(request, false);
  const manual = { fromEventId: "departure", toEventId: "d1-activity", departureTime: "07:30", manualReference: {
    availability: "available" as const, instructions: "旧版错站人工参考", durationMinutes: 20, fareCents: 600,
    sourceName: "合成输入", sourceUrl: null, checkedAt: new Date().toISOString(), acknowledged: true as const,
  } };
  const route = { ...manualReferenceRoute({ tripId: trip.id, date: trip.date, edit: manual }),
    mode: "walking", status: "verified", manualReference: undefined, polyline: [{ longitude: 113, latitude: 23 }, { longitude: 114, latitude: 24 }] };
  await db.planVersion.update({ where: { id: trip.plan.id }, data: { routeLegs: JSON.stringify([route]) } });
  await page.route("https://tile.openstreetmap.org/**", (request) => request.fulfill({ contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const cityRoutes = page.getByRole("region", { name: "城市路线", exact: true });
  await expect(cityRoutes.getByText(/主交通的地图地点是出发站/)).toBeVisible();
  await expect(cityRoutes.getByRole("button", { name: "查询并保存" })).toHaveCount(0);
  await expect(cityRoutes.getByRole("link", { name: "在高德查看公交路线" })).toHaveCount(0);
  const frame = page.frameLocator('iframe[title="行程地点地图"]');
  await expect.poll(() => frame.locator(".serendipity-map-pin").count()).toBeGreaterThan(2);
  await expect.poll(() => frame.locator("path.leaflet-interactive[stroke-dasharray]").count()).toBeGreaterThan(0);
  await expect(frame.locator("path.leaflet-interactive:not([stroke-dasharray])")).toHaveCount(0);
  for (const method of ["post", "patch"] as const) {
    const response = await request[method](`/api/trips/${trip.id}/plans/2/routes`, { data: method === "post" ? { ...manual, mode: "walking" } : manual });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("出发站");
  }
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
  await cityRoutes.getByRole("button", { name: "核对门到门后段接驳" }).click();
  await expect(page.getByRole("tab", { name: "门到门交通", exact: true })).toHaveAttribute("aria-selected", "true");
});
