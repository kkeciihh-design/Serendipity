import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";
import { derivePlanCosts } from "../../lib/budget";
import { preparePlanForStorage, validatePlan } from "../../lib/plan";
import { getAttractionCatalogEntry } from "../../lib/attraction-catalog";
import { placeIdentity, placeSchema } from "../../lib/places";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";

const directory = assertTestDataPath(path.resolve("test-data/e2e"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, "data/serendipity.db").replaceAll("\\", "/")}` } } });
const evidence = verificationEvidenceDirectory("phase17-browser");
test.afterAll(async () => { await db.$disconnect(); });

async function seed(request: APIRequestContext, options: { city?: string; shortWindow?: boolean; locked?: boolean } = {}) {
  const response = await request.post("/api/trips", { data: { originalRequest: "景点卡隔离演练：两人去长沙，喜欢历史文化和博物馆，节奏舒缓，不自驾。" } });
  expect(response.status()).toBe(201);
  const { trip } = await response.json();
  const snapshot = requestFixture(2, { destination: options.city ?? "长沙", pace: "relaxed", interests: ["历史文化", "博物馆"] });
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).status()).toBe(200);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).status()).toBe(200);
  const content = planFixture(snapshot);
  const entry = getAttractionCatalogEntry("hunan-museum")!;
  const activity = content.events.find((event) => event.id === "d1-activity")!;
  activity.title = entry.name;
  activity.locationName = entry.name;
  activity.locked = options.locked ?? false;
  if (options.shortWindow) { activity.startTime = "11:45"; activity.endTime = "12:00"; }
  const place = !options.city && entry.location ? placeSchema.parse({ ...entry.location,
    id: placeIdentity(entry.location, "poi"), precision: "poi", confirmation: "user_confirmed",
    confirmedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim",
  }) : null;
  if (place) activity.placeId = place.id;
  const normalized = preparePlanForStorage(content);
  const costs = derivePlanCosts(normalized.events);
  const validation = validatePlan(normalized, snapshot, costs);
  expect(validation.errors).toEqual([]);
  const data = { versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(normalized.events), costs: JSON.stringify(costs), places: JSON.stringify(place ? [place] : []),
    pendingItems: JSON.stringify(normalized.pendingItems), validationResults: JSON.stringify(validation) };
  const row = await db.planVersion.create({ data: { tripId: trip.id, ...data } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  return { id: trip.id as string, planId: row.id, data };
}

async function timeline(page: Page, id: string) {
  await page.goto(`/trips/${id}`);
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
}
const endpoint = (id: string, version = 1) => `/api/trips/${id}/plans/${version}/attractions`;

test("real local photographs and trip reasons remain usable at three widths; a replacement persists one version and a new map place", async ({ page, request }) => {
  const trip = await seed(request);
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, "demo-seed.json"), JSON.stringify(trip.data, null, 2));
  await timeline(page, trip.id);
  await page.getByRole("button", { name: /景点详情.*湖南博物院/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "湖南博物院", exact: true })).toBeVisible();
  await expect(dialog.getByText(/博物馆/).first()).toBeVisible();
  const photo = dialog.locator('img[src^="/attractions/"]').first();
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `attraction-${width}.png`), fullPage: false });
  }
  await dialog.locator("summary").filter({ hasText: "查看门票来源" }).click();
  await dialog.locator("summary").filter({ hasText: "查看预约来源" }).click();
  await dialog.getByText("门票", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, "attraction-facts.png"), fullPage: false });
  await dialog.getByRole("button", { name: /查看其他候选/ }).click();
  await dialog.getByRole("button", { name: /^岳麓书院/ }).click();
  await dialog.getByRole("button", { name: "预览替换这项安排", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "应用这项替换", exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(evidence, "replacement-preview.png"), fullPage: false });
  await dialog.getByRole("button", { name: "应用这项替换", exact: true }).click();
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
  const saved = await db.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId: trip.id, versionNumber: 2 } } });
  const events = JSON.parse(saved.events);
  const changed = events.find((event: { id: string }) => event.id === "d1-activity");
  expect(changed.locationName).toContain("岳麓书院");
  expect(changed.placeId).not.toBe(JSON.parse(trip.data.events).find((event: { id: string }) => event.id === "d1-activity").placeId);
  expect(JSON.parse(saved.places).some((place: { id: string }) => place.id === changed.placeId)).toBe(true);
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
  await page.reload();
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await expect(page.getByRole("button", { name: /景点详情.*岳麓书院/ })).toBeVisible();
  await page.goto(`/trips/${trip.id}?planVersion=1`);
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await page.getByRole("button", { name: /景点详情.*湖南博物院/ }).click();
  await expect(page.getByRole("dialog").getByText(/历史版本/).first()).toBeVisible();
  await fs.writeFile(path.join(evidence, "replacement-result.json"), JSON.stringify({ tripId: trip.id, version: saved.versionNumber, event: changed, costs: JSON.parse(saved.costs), places: JSON.parse(saved.places) }, null, 2));
});

test("failed images degrade honestly and another city never borrows the Changsha photograph", async ({ page, request }) => {
  const trip = await seed(request);
  await page.route("**/attractions/*.webp", (route) => route.abort("failed"));
  await timeline(page, trip.id);
  await page.getByRole("button", { name: /景点详情.*湖南博物院/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img")).toHaveCount(0);
  await expect(dialog.getByText("暂无可用图片", { exact: false })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "湖南博物院", exact: true })).toBeVisible();
  await fs.mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, "missing-photo.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  const other = await seed(request, { city: "杭州" });
  const result = await request.get(`${endpoint(other.id)}?eventId=d1-activity`);
  expect(result.status()).toBe(200);
  expect((await result.json()).recommendations.current).toBeNull();
});

test("keep is persisted without inventing a reservation and stale or untrusted mutations cannot write", async ({ request }) => {
  const trip = await seed(request);
  const foreign = await request.post(endpoint(trip.id), { headers: { Origin: "https://foreign.example" }, data: { action: "keep", eventId: "d1-activity" } });
  expect(foreign.status()).toBe(403);
  const malformed = await request.post(endpoint(trip.id), { data: { action: "apply", eventId: "d1-activity", candidateId: "yuelu-academy", previewToken: "forged" } });
  expect([400, 409]).toContain(malformed.status());
  const kept = await request.post(endpoint(trip.id), { data: { action: "keep", eventId: "d1-activity", candidateId: "hunan-museum" } });
  expect(kept.status(), await kept.text()).toBe(200);
  const plan = (await kept.json()).plan;
  expect(plan.versionNumber).toBe(2);
  expect(plan.events.find((event: { id: string }) => event.id === "d1-activity").status).not.toBe("confirmed");
  const stale = await request.post(endpoint(trip.id), { data: { action: "keep", eventId: "d1-activity", candidateId: "hunan-museum" } });
  expect(stale.status()).toBe(409);
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
});

test("an overlong replacement and a locked event cannot silently overwrite the itinerary", async ({ request }) => {
  const trip = await seed(request, { shortWindow: true });
  const response = await request.post(endpoint(trip.id), { data: { action: "preview", eventId: "d1-activity", candidateId: "yuelu-academy" } });
  if (response.ok()) {
    const { preview } = await response.json();
    expect(preview.canApply).toBe(false);
    expect(preview.conflicts.length).toBeGreaterThan(0);
  } else expect([400, 409]).toContain(response.status());
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  const locked = await seed(request, { locked: true });
  const result = await request.get(`${endpoint(locked.id)}?eventId=d1-activity`);
  expect((await result.json()).recommendations.canReplace).toBe(false);
  expect((await request.post(endpoint(locked.id), { data: { action: "preview", eventId: "d1-activity", candidateId: "yuelu-academy" } })).status()).toBe(409);
});

test("read and save failures expose retry without losing the current choice", async ({ page, request }) => {
  const trip = await seed(request);
  let failRead = true, failSave = true;
  await page.route(`**${endpoint(trip.id)}*`, async (route) => {
    if (route.request().method() === "GET" && failRead) {
      failRead = false;
      return route.fulfill({ status: 503, json: { error: "隔离测试：资料暂不可用" } });
    }
    if (route.request().method() === "POST" && failSave) {
      failSave = false;
      return route.fulfill({ status: 503, json: { error: "隔离测试：保存暂不可用" } });
    }
    await route.continue();
  });
  await timeline(page, trip.id);
  await page.getByRole("button", { name: /景点详情.*湖南博物院/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "重试读取" }).click();
  const keep = dialog.getByRole("button", { name: "保留当前景点", exact: true });
  await expect(keep).toBeEnabled();
  await keep.click();
  await expect(dialog.getByRole("alert")).toContainText("保存暂不可用");
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  await keep.click();
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V2");
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
});

test("a stalled preview times out and a closed preview cannot apply a late response", async ({ page, request }) => {
  const trip = await seed(request);
  await timeline(page, trip.id);
  await page.getByRole("button", { name: /景点详情.*湖南博物院/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /查看其他候选/ }).click();
  await dialog.getByRole("button", { name: /^岳麓书院/ }).click();
  await page.clock.install();
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**${endpoint(trip.id)}`, async (route) => {
    await held;
    await route.fulfill({ status: 503, json: { error: "隔离测试：迟到响应" } }).catch(() => {});
  });
  await dialog.getByRole("button", { name: "预览替换这项安排", exact: true }).click();
  await page.clock.fastForward(61_000);
  await expect(dialog.getByRole("alert")).toContainText("替换预览超时");
  const preview = dialog.getByRole("button", { name: "预览替换这项安排", exact: true });
  await expect(preview).toBeEnabled();
  await preview.click();
  await dialog.getByRole("button", { name: "关闭景点详情", exact: true }).click();
  release!();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: /景点详情.*湖南博物院/ }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "保留当前景点", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog").getByRole("button", { name: "应用这项替换", exact: true })).toHaveCount(0);
  expect(await db.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
});
