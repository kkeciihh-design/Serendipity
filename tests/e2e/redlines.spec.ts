import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { ticketFixture } from "../helpers/ticket-fixtures";
import { derivePlanCosts } from "../../lib/budget";
import { preparePlanForStorage } from "../../lib/plan";
import type { RedlineResult } from "../../lib/redlines";
import type { Ticket } from "../../lib/tickets";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";

const directory = path.resolve("test-data/e2e");
const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, "data/serendipity.db").replaceAll("\\", "/")}` } } });
const seeded: string[] = [];
const evidence = verificationEvidenceDirectory("phase15");
test.afterAll(async () => { await prisma.trip.deleteMany({ where: { id: { in: seeded } } }); await prisma.$disconnect(); });

async function seed(request: APIRequestContext, mode: "walking" | "public_transit" = "walking") {
  const response = await request.post("/api/trips", { data: { originalRequest: "阶段15时间红线合成演示，所有车次和截止均是假设。" } });
  expect(response.status()).toBe(201);
  const { trip } = await response.json(); seeded.push(trip.id);
  const snapshot = requestFixture();
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).status()).toBe(200);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).status()).toBe(200);
  const fixture = planFixture(snapshot);
  const activity = fixture.events.find((event) => event.id === "d1-activity")!;
  activity.startTime = "15:00"; activity.endTime = "16:00"; activity.suggestedDurationSeconds = 3600;
  const content = preparePlanForStorage(fixture);
  const row = await prisma.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(content.events), costs: JSON.stringify(derivePlanCosts(content.events)), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }) } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  const saved = await request.post(`/api/trips/${trip.id}/plans/1/tickets`, { data: { action: "activate", acknowledged: true,
    ticket: ticketFixture(snapshot.startDate!, { serviceNumber: "G演示15", departureTime: "10:35", arrivalTime: "11:35", accessMode: mode, accessDurationMinutes: 55,
      bufferMinutes: 10, accessNote: "合成固定耗时演示，非真实线路", chainOriginName: "合成公共地标", boardingCutoffMinutes: 5 }) } });
  expect(saved.status()).toBe(200);
  return { id: trip.id as string, date: snapshot.startDate!, plan: (await saved.json()).plan };
}
const panel = (page: Page) => page.getByRole("region", { name: "时间红线", exact: true });
async function open(page: Page, id: string) {
  await page.goto(`/trips/${id}`);
  await expect(panel(page).getByText(/建议最晚 .*08:55/)).toBeVisible();
  await panel(page).getByText("红线详情与计算依据", { exact: true }).click();
}

test("saves changed conditions, replaces calculation version, refreshes and retains historical read-only state", async ({ page, request }) => {
  const trip = await seed(request);
  const initial = await request.get(`/api/trips/${trip.id}/plans/2/redlines`);
  expect(initial.status()).toBe(200);
  const before: RedlineResult = (await initial.json()).redlines[0];
  expect(before.necessarySeconds).toBe(5100); expect(before.suggestedAt).toBe(`${trip.date}T00:55:00.000Z`);
  await open(page, trip.id);
  await expect(panel(page).getByRole("heading", { name: "从建议出发时刻正向复核" })).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "从真实当前时间正向检查" })).toBeVisible();
  await panel(page).getByLabel("额外机动缓冲（分钟）", { exact: true }).fill("20");
  await expect(panel(page).getByText("条件已改，旧红线失效", { exact: true })).toBeVisible();
  await expect(panel(page).getByText(/未保存的耗时估算：.*08:45/)).toBeVisible();
  await panel(page).getByRole("combobox", { name: "行李条件", exact: true }).selectOption("none");
  await panel(page).getByRole("button", { name: "保存条件并重算" }).click();
  await expect(panel(page).getByText(/建议最晚 .*08:45/)).toBeVisible();
  await page.reload();
  await expect(panel(page).getByText(/建议最晚 .*08:45/)).toBeVisible();
  await panel(page).getByText("红线详情与计算依据", { exact: true }).click();
  await expect(panel(page).getByRole("combobox", { name: "行李条件", exact: true })).toHaveValue("none");
  const after = await request.get(`/api/trips/${trip.id}/plans/3/redlines`);
  const result: RedlineResult = (await after.json()).redlines[0];
  expect(result.calculationVersion).not.toBe(before.calculationVersion);
  expect(result.bufferSeconds).toBe(1200);
  await page.goto(`/trips/${trip.id}?planVersion=2`);
  await expect(panel(page).getByText(/建议最晚 .*08:55/)).toBeVisible();
  await panel(page).getByText("红线详情与计算依据", { exact: true }).click();
  await expect(panel(page).getByLabel("额外机动缓冲（分钟）", { exact: true })).toBeDisabled();
  await expect(panel(page).getByRole("button", { name: "保存条件并重算" })).toHaveCount(0);
});

test("a failed save preserves edited values, retries, and a cancelled ticket removes its redline", async ({ page, request }) => {
  const trip = await seed(request); await open(page, trip.id);
  await page.route("**/tickets", (route) => route.fulfill({ status: 503, json: { error: "演示保存失败" } }));
  await panel(page).getByLabel("首次到访（加 5 分钟）").check();
  await panel(page).getByRole("button", { name: "保存条件并重算" }).click();
  await expect(panel(page).getByRole("alert")).toHaveText("演示保存失败");
  await expect(panel(page).getByLabel("首次到访（加 5 分钟）")).toBeChecked();
  await page.unroute("**/tickets");
  await panel(page).getByRole("button", { name: "保存条件并重算" }).click();
  await expect(panel(page).getByText(/建议最晚 .*08:50/)).toBeVisible();
  expect((await request.post(`/api/trips/${trip.id}/plans/3/tickets`, { data: { action: "cancel", ticketId: trip.plan.tickets[0].id, acknowledged: true } })).status()).toBe(200);
  await page.reload();
  await expect(panel(page).getByText(/暂无有效票据红线/)).toBeVisible();
});

test("clock resumes at foreground, exact zero is red, and 09:00/09:06 show distinct states", async ({ page, request }) => {
  const trip = await seed(request);
  // Controlled server-clock response for boundary UI tests; not an official
  // time service. The product still obtains real route data from the real API.
  await page.clock.install({ time: new Date(`${trip.date}T08:47:00+08:00`) });
  await page.route("**/redlines", async (route) => {
    const response = await route.fetch(); const body = await response.json();
    body.serverNow = new Date(await page.evaluate(() => Date.now())).toISOString();
    await route.fulfill({ response, json: body });
  });
  await open(page, trip.id);
  await expect(panel(page).locator("article")).toHaveAttribute("data-urgency", "orange");
  await page.clock.setSystemTime(new Date(`${trip.date}T08:55:00+08:00`));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panel(page).locator("article")).toHaveAttribute("data-urgency", "red");
  await page.clock.setSystemTime(new Date(`${trip.date}T09:00:00+08:00`));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(panel(page).getByText("已过建议出门时间，余量不足", { exact: true })).toBeVisible();
  await page.clock.setSystemTime(new Date(`${trip.date}T09:06:00+08:00`));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panel(page).getByText("按当前假定截止和预计耗时无法衔接，截止仍待核实", { exact: true })).toBeVisible();
});

test("manual timed routes remain pending; layout and server clock failures are visible", async ({ page, request }) => {
  const trip = await seed(request, "public_transit");
  await page.goto(`/trips/${trip.id}`);
  await expect(panel(page).getByText("待确认建议", { exact: true })).toBeVisible();
  await panel(page).getByText("红线详情与计算依据", { exact: true }).click();
  await expect(panel(page).getByText(/缺少未来时刻路线能力/)).toBeVisible();
  await fs.mkdir(evidence, { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel(page).screenshot({ path: path.join(evidence, `redline-${width}.png`) });
  }
  await page.route("**/redlines", (route) => route.fulfill({ status: 503, json: { error: "暂时离线" } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panel(page).getByText(/无法校时，时间仅供参考/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "重试计算" })).toBeVisible();
  await page.unroute("**/redlines");
  await panel(page).getByRole("button", { name: "重试计算" }).click();
  await expect(panel(page).getByText("待确认建议", { exact: true })).toBeVisible();
});

test("origin, route duration and replacement ticket recalculate without accepting stale versions", async ({ page, request }) => {
  const trip = await seed(request); await open(page, trip.id);
  const ticket: Ticket = trip.plan.tickets[0];
  const update = await request.post(`/api/trips/${trip.id}/plans/2/tickets`, { data: { action: "update_details", acknowledged: true, ticketId: ticket.id,
    ticket: { ...ticket, chainOriginName: "新的合成起点", accessDurationMinutes: 65 } } });
  expect(update.status()).toBe(200);
  await page.reload(); await expect(panel(page).getByText(/建议最晚 .*08:45/)).toBeVisible();
  await expect(panel(page).getByText(/新的合成起点 →/)).toBeVisible();
  const replacement = await request.post(`/api/trips/${trip.id}/plans/3/tickets`, { data: { action: "replace", acknowledged: true, ticketId: ticket.id,
    replacement: { ...ticket, serviceNumber: "G替换15", departureTime: "11:35", arrivalTime: "12:35" } } });
  expect(replacement.status()).toBe(200);
  await page.reload(); await expect(panel(page).getByText(/建议最晚 .*09:55/)).toBeVisible();
  await expect(panel(page).getByRole("article")).toHaveCount(1);
  const stale = await request.post(`/api/trips/${trip.id}/plans/2/tickets`, { data: { action: "cancel", ticketId: ticket.id, acknowledged: true } });
  expect(stale.status()).toBe(409);
  // Export only synthetic data for the separate persistent demonstration.
  const stored = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { request: true, currentPlanVersion: true } });
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, "synthetic-demo.json"), JSON.stringify(stored, null, 2));
});
