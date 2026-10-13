import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { calculateBudgetSummary, derivePlanCosts, type PlanCostItem } from "../../lib/budget";
import type { RouteLeg } from "../../lib/routes";

process.env.SERENDIPITY_DATA_DIR = path.resolve("test-data/e2e");
const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
test.afterAll(async () => prisma.$disconnect());

const routeSteps = "步行至深圳站\n乘坐地铁 1 号线至会展中心\n换乘地铁 4 号线至深圳北站\n步行到达博物馆";
const routeHeading = "③早餐 → ④Example Museum";

async function seed(request: APIRequestContext, transportEvent = false, withThirdPlace = false, days = 1) {
  const response = await request.post("/api/trips", { data: { originalRequest: "人工公交浏览器测试：公共地标路线" } });
  expect(response.status()).toBe(201);
  const { trip } = await response.json();
  const snapshot = requestFixture(days, { destination: "深圳", travelerCount: 2 });
  const content = planFixture(snapshot);
  const breakfast = content.events.find((event) => event.id === "d1-breakfast")!;
  const activity = content.events.find((event) => event.id === "d1-activity")!;
  breakfast.placeId = "station";
  activity.placeId = "museum";
  for (let day = 2; day <= days; day++) {
    content.events.find((event) => event.id === `d${day}-breakfast`)!.placeId = "station";
    content.events.find((event) => event.id === `d${day}-activity`)!.placeId = "museum";
  }
  if (withThirdPlace) content.events.find((event) => event.id === "d1-lunch")!.placeId = "station";
  if (transportEvent) {
    activity.type = "local_transport";
    content.events.push({
      ...activity, id: "d1-extra-activity", type: "activity", startTime: "15:00", endTime: "16:00",
      title: "免费公共活动", placeId: undefined, suggestedDurationSeconds: 3600, costDraftCents: 0,
    });
  }
  const checkedAt = new Date(Date.now() - 60_000).toISOString();
  const places = [
    { id: "station", name: "深圳站 & 早餐", latitude: 22.534487, longitude: 114.112111, district: "罗湖区" },
    { id: "museum", name: "深圳北站 / 博物馆", latitude: 22.609, longitude: 114.023, district: "龙华区" },
  ].map((place) => ({
    ...place, provider: "osm", poiId: `node:${place.id}`, city: "深圳市", address: `深圳市${place.district}${place.name}`,
    adcode: "", category: "railway:station", coordinateSystem: "WGS84", precision: "poi",
    confirmation: "user_confirmed", confirmedAt: checkedAt, retrievedAt: checkedAt, source: "OpenStreetMap / Nominatim",
  }));
  const costs = derivePlanCosts(content.events);
  const row = await prisma.planVersion.create({ data: {
    tripId: trip.id, versionNumber: 1, requestRevision: 1, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(content.events), costs: JSON.stringify(costs), pendingItems: JSON.stringify(content.pendingItems),
    places: JSON.stringify(places), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }),
  } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  return { id: trip.id as string, snapshot, initialBudget: calculateBudgetSummary(costs, snapshot).totalMinCents };
}

async function openTransit(page: Page, tripId: string) {
  // Map tiles and the outbound destination are controlled locally; these tests
  // never claim to verify a live transit service or its timetable.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({
    contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
  }));
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  const card = page.locator("article").filter({ hasText: routeHeading });
  await card.getByRole("combobox", { name: /^交通方式/ }).selectOption("public_transit");
  return card;
}

async function fillReference(card: Locator, options: { duration?: string; fare?: string } = {}) {
  await card.getByRole("textbox", { name: /^线路、换乘与步骤/ }).fill(routeSteps);
  await card.getByLabel("总耗时（分钟，可留空）", { exact: true }).fill(options.duration ?? "45");
  await card.getByLabel("每人票价（元，可留空）", { exact: true }).fill(options.fare ?? "6");
  await card.getByLabel("来源名称", { exact: true }).fill("高德地图人工查阅（测试）");
  await card.getByLabel("来源链接（可选）", { exact: true }).fill("https://uri.amap.com/navigation?from=test&to=example");
  await card.getByRole("checkbox", { name: /我已在外部地图按/ }).check();
}

async function saveReference(page: Page, card: Locator, version: number) {
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/routes"));
  await card.getByRole("button", { name: /^(保存人工参考|重新确认并保存)$/ }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("heading", { name: new RegExp(`计划版本 ${version}`) })).toBeVisible();
}

async function savedVersion(tripId: string, versionNumber: number) {
  const row = await prisma.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId, versionNumber } } });
  return { row, routes: JSON.parse(row.routeLegs) as RouteLeg[], costs: JSON.parse(row.costs) as PlanCostItem[] };
}

function manualBody(overrides: Record<string, unknown> = {}) {
  return {
    fromEventId: "d1-breakfast", toEventId: "d1-activity", departureTime: "08:30",
    manualReference: {
      availability: "available", instructions: routeSteps, durationMinutes: 45, fareCents: 600,
      sourceName: "高德地图人工查阅（测试）", sourceUrl: "https://uri.amap.com/navigation?from=test&to=example",
      checkedAt: new Date(Date.now() - 60_000).toISOString(), acknowledged: true,
      ...overrides,
    },
  };
}

test("opens a safe public-transit link without a key or a plan write", async ({ page, request }) => {
  const trip = await seed(request);
  const card = await openTransit(page, trip.id);
  expect(await (await request.get("/api/map/config")).json()).toEqual({ provider: "osm" });
  const link = card.getByRole("link", { name: "在高德查看公交路线", exact: true });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  const url = new URL((await link.getAttribute("href"))!);
  expect(url.protocol).toBe("https:");
  expect(url.hostname).toBe("uri.amap.com");
  expect(url.pathname).toBe("/navigation");
  expect(url.username).toBe("");
  expect(url.password).toBe("");
  expect(url.searchParams.get("mode")).toBe("bus");
  expect(url.searchParams.get("from")).toMatch(/^\d+\.\d+,\d+\.\d+,深圳站 & 早餐$/);
  expect(url.searchParams.get("to")).toMatch(/^\d+\.\d+,\d+\.\d+,深圳北站 \/ 博物馆$/);
  expect(url.searchParams.has("key")).toBe(false);
  expect(url.searchParams.has("securityJsCode")).toBe(false);
  expect(url.searchParams.has("planVersion")).toBe(false);
  expect(url.searchParams.has("date")).toBe(false);
  expect(url.searchParams.has("time")).toBe(false);
  expect(url.href).not.toContain(trip.id);
  await expect(card.getByText(/链接只传入地点，不会自动设置日期和时刻/)).toBeVisible();
  await page.context().route("https://uri.amap.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>External route test</title>" }));
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toBe(url.href);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
});

test("persists transfers and per-person fare, replaces its budget item once, and keeps history read only", async ({ page, request }) => {
  const trip = await seed(request);
  const card = await openTransit(page, trip.id);
  await fillReference(card);
  const checkedAt = await card.getByLabel("查阅时间（北京时间）", { exact: true }).inputValue();
  await saveReference(page, card, 2);
  await expect(card.getByText(/45 分钟/).first()).toBeVisible();
  await card.getByText("查看人工记录", { exact: true }).click();
  await expect(card.locator("details").getByText(/换乘地铁 4 号线至深圳北站/)).toBeVisible();
  const first = await savedVersion(trip.id, 2);
  expect(first.routes).toHaveLength(1);
  expect(first.routes[0]).toMatchObject({
    status: "pending_confirmation", mode: "public_transit", durationSeconds: 2700, distanceMeters: null,
    departureTime: "08:30", arrivalTime: "09:15", futureQueryCapability: false, polyline: [],
    manualReference: { availability: "available", instructions: routeSteps, durationMinutes: 45, fareCents: 600, requiresReconfirmation: false },
  });
  expect(first.costs.filter((cost) => cost.id.startsWith("route-"))).toMatchObject([
    { category: "local_transport", unit: "per_person", unitAmountCents: 600, certainty: "pending_confirmation" },
  ]);
  expect(first.routes[0].manualReference?.checkedAt).toBe(new Date(`${checkedAt}:00+08:00`).toISOString());
  expect(first.routes[0].manualReference?.date).toBe(trip.snapshot.startDate);
  expect(calculateBudgetSummary(first.costs, trip.snapshot).totalMinCents).toBe(trip.initialBudget + 1200);

  await page.reload();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(card.getByRole("textbox", { name: /^线路、换乘与步骤/ })).toHaveValue(routeSteps);
  await expect(card.getByLabel("每人票价（元，可留空）", { exact: true })).toHaveValue("6.00");
  await fillReference(card, { duration: "50", fare: "7" });
  await saveReference(page, card, 3);
  const latest = await savedVersion(trip.id, 3);
  expect(latest.routes).toHaveLength(1);
  expect(latest.costs.filter((cost) => cost.id.startsWith("route-"))).toHaveLength(1);
  expect(calculateBudgetSummary(latest.costs, trip.snapshot).totalMinCents).toBe(trip.initialBudget + 1400);
  expect((await savedVersion(trip.id, 2)).row.routeLegs).toBe(first.row.routeLegs);

  await page.goto(`/trips/${trip.id}?planVersion=2`);
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(card.getByRole("combobox", { name: /^交通方式/ })).toBeDisabled();
  await expect(card.getByLabel("出发时刻", { exact: true })).toBeDisabled();
  await expect(card.getByRole("textbox", { name: /^线路、换乘与步骤/ })).toBeDisabled();
  await expect(card.getByRole("button", { name: "重新确认并保存", exact: true })).toBeDisabled();
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(3);
});

test("leaves blank fare and duration unknown on a 390px screen", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const trip = await seed(request);
  const card = await openTransit(page, trip.id);
  await fillReference(card, { duration: "", fare: "" });
  await saveReference(page, card, 2);
  const saved = await savedVersion(trip.id, 2);
  expect(saved.routes[0]).toMatchObject({
    durationSeconds: null, distanceMeters: null, arrivalDate: null, arrivalTime: null,
    cost: { minCents: null, maxCents: null }, polyline: [],
    manualReference: { durationMinutes: null, fareCents: null },
  });
  expect(saved.costs.filter((cost) => cost.id.startsWith("route-"))).toMatchObject([
    { unit: "per_person", unitAmountCents: null, certainty: "pending_confirmation" },
  ]);
  expect(calculateBudgetSummary(saved.costs, trip.snapshot)).toMatchObject({ totalMinCents: trip.initialBudget, unknownItemCount: 1 });
  await expect(card.getByText(/每人票价：费用待确认/).first()).toBeVisible();
  await expect(card.getByText(/(?:^|｜)1 分钟(?:｜|$)/)).toHaveCount(0);
  const mapFrame = page.frameLocator('iframe[title="行程地点地图"]');
  await expect(mapFrame.locator("path.leaflet-interactive")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(card.getByLabel("每人票价（元，可留空）", { exact: true })).toHaveValue("");
  await expect(card.getByLabel("总耗时（分钟，可留空）", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("requires a fresh acknowledgement after departure changes and invalidates edited event references", async ({ page, request }) => {
  const trip = await seed(request);
  const card = await openTransit(page, trip.id);
  await fillReference(card);
  await saveReference(page, card, 2);
  const acknowledgement = card.getByRole("checkbox", { name: /我已在外部地图按/ });
  await card.getByLabel("总耗时（分钟，可留空）", { exact: true }).fill("50");
  await card.getByLabel("每人票价（元，可留空）", { exact: true }).fill("6.50");
  await acknowledgement.check();
  await card.getByLabel("出发时刻", { exact: true }).fill("09:00");
  await expect(acknowledgement).not.toBeChecked();
  await expect(card.getByRole("textbox", { name: /^线路、换乘与步骤/ })).toHaveValue(routeSteps);
  await expect(card.getByLabel("总耗时（分钟，可留空）", { exact: true })).toHaveValue("50");
  await expect(card.getByLabel("每人票价（元，可留空）", { exact: true })).toHaveValue("6.50");
  await expect(card.getByRole("button", { name: "重新确认并保存", exact: true })).toBeDisabled();
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
  await expect(card.getByText("当前选择已变化，下面保留的是原记录，不适用于当前选择。请按新时刻重新核实并保存。", { exact: true })).toBeVisible();
  expect((await savedVersion(trip.id, 2)).routes[0].departureTime).toBe("08:30");
  await acknowledgement.check();
  await saveReference(page, card, 3);
  expect((await savedVersion(trip.id, 3)).routes[0]).toMatchObject({ departureTime: "09:00", manualReference: { departureTime: "09:00", durationMinutes: 50, fareCents: 650, requiresReconfirmation: false } });

  const edited = await request.patch(`/api/trips/${trip.id}/plans/3`, { data: {
    type: "event", eventId: "d1-breakfast", startTime: "08:15", durationMinutes: 30, timeEdit: "start_duration",
    note: null, locked: false, status: "suggested", remove: false,
  } });
  expect(edited.status()).toBe(200);
  const changed = await savedVersion(trip.id, 4);
  expect(changed.routes[0]).toMatchObject({
    status: "pending_confirmation", durationSeconds: null, arrivalDate: null, arrivalTime: null,
    manualReference: { instructions: routeSteps, durationMinutes: 50, requiresReconfirmation: true },
  });
  expect(changed.costs.filter((cost) => cost.id.startsWith("route-"))).toMatchObject([
    { unitAmountCents: null, certainty: "pending_confirmation" },
  ]);
  await page.reload();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(card.getByText(/重新核实/).first()).toBeVisible();
  await expect(card.getByRole("textbox", { name: /^线路、换乘与步骤/ })).toHaveValue(routeSteps);
  await expect(card.getByRole("checkbox", { name: /我已在外部地图按/ })).not.toBeChecked();
});

test("clears acknowledgement across map dates and never applies another day's reference", async ({ page, request }) => {
  const trip = await seed(request, false, false, 2);
  const firstDay = await openTransit(page, trip.id);
  await fillReference(firstDay);
  await saveReference(page, firstDay, 2);
  const original = await savedVersion(trip.id, 2);
  const firstAcknowledgement = firstDay.getByRole("checkbox", { name: /我已在外部地图按/ });
  await firstAcknowledgement.check();
  await expect(firstAcknowledgement).toBeChecked();

  await page.getByRole("combobox", { name: "地图日期", exact: true }).selectOption("2");
  const secondDay = page.locator("article").filter({ hasText: "②早餐 → ③Example Museum" });
  await secondDay.getByRole("combobox", { name: /^交通方式/ }).selectOption("public_transit");
  await expect(secondDay.getByRole("checkbox", { name: /我已在外部地图按/ })).not.toBeChecked();
  await expect(secondDay.getByText(/适用日期与时刻/)).toContainText(`${trip.snapshot.endDate} 08:30`);
  await expect(secondDay.getByRole("textbox", { name: /^线路、换乘与步骤/ })).toHaveValue("");
  await expect(secondDay.getByText(/地铁\/公交｜人工参考/)).toHaveCount(0);
  await expect(secondDay.getByText(new RegExp(trip.snapshot.startDate!))).toHaveCount(0);
  await expect(secondDay.getByRole("button", { name: "保存人工参考", exact: true })).toBeDisabled();
  await fillReference(secondDay, { duration: "60", fare: "8" });
  await expect(secondDay.getByRole("checkbox", { name: /我已在外部地图按/ })).toBeChecked();

  await page.getByRole("combobox", { name: "地图日期", exact: true }).selectOption("1");
  await expect(firstAcknowledgement).not.toBeChecked();
  await expect(firstDay.getByText(/^适用：/)).toContainText(`${trip.snapshot.startDate} 08:30`);
  await expect(firstDay.getByRole("textbox", { name: /^线路、换乘与步骤/ })).toHaveValue(routeSteps);
  await expect(firstDay.getByLabel("总耗时（分钟，可留空）", { exact: true })).toHaveValue("45");
  await expect(firstDay.getByRole("button", { name: "重新确认并保存", exact: true })).toBeDisabled();
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
  expect((await savedVersion(trip.id, 2)).row.routeLegs).toBe(original.row.routeLegs);
});

test("records no service at night without an invented duration, arrival, fare, or map line", async ({ page, request }) => {
  const trip = await seed(request);
  const card = await openTransit(page, trip.id);
  await card.getByLabel("出发时刻", { exact: true }).fill("23:30");
  await card.getByRole("combobox", { name: /^查询结果/ }).selectOption("no_service");
  await card.getByRole("textbox", { name: /^无路线或停运说明/ }).fill("按本次日期 23:30 查阅，地铁已停运，没有公共交通方案。");
  await card.getByRole("checkbox", { name: /我已在外部地图按/ }).check();
  await saveReference(page, card, 2);
  const saved = await savedVersion(trip.id, 2);
  expect(saved.routes[0]).toMatchObject({
    status: "unavailable", departureTime: "23:30", durationSeconds: null, distanceMeters: null,
    arrivalDate: null, arrivalTime: null, polyline: [], conflict: null, futureQueryCapability: false,
    cost: { minCents: null, maxCents: null }, manualReference: { availability: "no_service", durationMinutes: null, fareCents: null },
  });
  expect(saved.costs.some((cost) => cost.id.startsWith("route-"))).toBe(false);
  await expect(card.getByText(/人工记录：无路线／停运/).first()).toBeVisible();
  await expect(card.getByText(/(?:^|｜)1 分钟(?:｜|$)/)).toHaveCount(0);
  const mapFrame = page.frameLocator('iframe[title="行程地点地图"]');
  await expect(mapFrame.locator(".serendipity-map-route-arrow")).toHaveCount(0);
  await expect(mapFrame.locator("path.leaflet-interactive")).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await expect(card.getByRole("combobox", { name: /^查询结果/ })).toHaveValue("no_service");
});

test("rejects malformed references, cross-origin writes, and stale plan versions atomically", async ({ request }) => {
  const trip = await seed(request);
  const endpoint = `/api/trips/${trip.id}/plans/1/routes`;
  for (const override of [
    { acknowledged: false }, { instructions: " " }, { sourceName: " " },
    { durationMinutes: -1 }, { durationMinutes: 0 }, { durationMinutes: 1.5 }, { durationMinutes: 1441 },
    { fareCents: -1 }, { fareCents: 1.5 },
    { sourceUrl: "javascript:alert(1)" }, { sourceUrl: "https://user:password@example.com/path" },
    { checkedAt: "not-a-date" }, { checkedAt: new Date(Date.now() + 3_600_000).toISOString() },
    { availability: "no_service", durationMinutes: 45, fareCents: 600 },
  ]) {
    const response = await request.patch(endpoint, { data: manualBody(override) });
    expect(response.status(), JSON.stringify(override)).toBe(400);
  }
  for (const replacement of [
    { departureTime: "24:00" }, { departureTime: "08:00" },
    { fromEventId: "missing" }, { toEventId: "d1-breakfast" },
  ]) {
    expect((await request.patch(endpoint, { data: { ...manualBody(), ...replacement } })).status()).toBe(400);
  }
  expect((await request.patch(endpoint, { headers: { Origin: "https://outside.example" }, data: manualBody() })).status()).toBe(403);
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  expect((await request.patch(endpoint, { data: manualBody() })).status()).toBe(200);
  expect((await request.patch(endpoint, { data: manualBody({ fareCents: 900 }) })).status()).toBe(409);
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
  expect((await savedVersion(trip.id, 2)).routes[0].cost.minCents).toBe(600);
});

test("replaces an unconfirmed transport estimate with the whole route fare once", async ({ request }) => {
  const trip = await seed(request, true);
  const response = await request.patch(`/api/trips/${trip.id}/plans/1/routes`, { data: manualBody() });
  expect(response.status(), await response.text()).toBe(200);
  const saved = await savedVersion(trip.id, 2);
  expect(saved.routes[0].cost.minCents).toBe(600);
  expect(saved.costs.filter((cost) => cost.id.startsWith("route-"))).toHaveLength(1);
  expect(saved.costs.some((cost) => cost.linkedEventId === "d1-activity" && !cost.id.startsWith("route-"))).toBe(false);
  expect(calculateBudgetSummary(saved.costs, trip.snapshot).totalMinCents).toBe(trip.initialBudget - 1800 + 1200);
});

test("can save the new adjacent route after event reordering without an obsolete fare", async ({ request }) => {
  const trip = await seed(request, false, true);
  expect((await request.patch(`/api/trips/${trip.id}/plans/1/routes`, { data: manualBody() })).status()).toBe(200);
  const edited = await request.patch(`/api/trips/${trip.id}/plans/2`, { data: {
    type: "event", eventId: "d1-activity", startTime: "15:00", durationMinutes: 60, timeEdit: "start_duration",
    note: null, locked: false, status: "suggested", remove: false,
  } });
  expect(edited.status()).toBe(200);
  const newPair = await request.patch(`/api/trips/${trip.id}/plans/3/routes`, { data: {
    ...manualBody({ fareCents: 700 }), fromEventId: "d1-lunch", departureTime: "13:30",
  } });
  expect(newPair.status()).toBe(200);
  const saved = await savedVersion(trip.id, 4);
  expect(saved.costs.filter((cost) => cost.id.startsWith("route-"))).toMatchObject([
    { linkedEventId: "d1-activity", unitAmountCents: 700, unit: "per_person" },
  ]);
  expect(calculateBudgetSummary(saved.costs, trip.snapshot).totalMinCents).toBe(trip.initialBudget + 1400);
});
