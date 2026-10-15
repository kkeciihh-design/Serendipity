import path from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { ticketFixture } from "../helpers/ticket-fixtures";
import { preparePlanForStorage } from "../../lib/plan";
import { derivePlanCosts, type PlanCostItem } from "../../lib/budget";
import type { Ticket, TicketAction } from "../../lib/tickets";
import type { TicketImportSource } from "../../lib/ticket-import";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";

const directory = path.resolve("test-data/e2e");
assertTestDataPath(directory);
process.env.SERENDIPITY_DATA_DIR = directory;
const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, "data/serendipity.db").replaceAll("\\", "/")}` } } });
const ids: string[] = [];
const source: TicketImportSource = { engine: "tesseract-local", documentKind: "ticket", imageFingerprint: "a".repeat(64), cropFingerprint: "b".repeat(64), recognizedAt: "2026-10-15T08:00:00.000Z" };
test.afterAll(async () => { await prisma.trip.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); });

async function seed(request: APIRequestContext, paidGroup = false) {
  const response = await request.post("/api/trips", { data: { originalRequest: "审查修复合成票据：两人同行费用核对，无实际票务操作。" } });
  expect(response.status()).toBe(201);
  const { trip } = await response.json(); ids.push(trip.id);
  const snapshot = requestFixture(2, { startDate: "2026-10-29", endDate: "2026-10-30" });
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).status()).toBe(200);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).status()).toBe(200);
  const content = preparePlanForStorage(planFixture(snapshot));
  const costs = derivePlanCosts(content.events).map((cost) => paidGroup && cost.id === "cost-departure"
    ? { ...cost, unit: "per_ticket" as const, quantity: 2, unitAmountCents: 24300, certainty: "user_confirmed" as const, source: "user_confirmed" as const, paymentStatus: "paid" as const } : cost);
  const plan = await prisma.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(content.events), costs: JSON.stringify(costs), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }) } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id, status: "planned" } });
  return { id: trip.id as string, snapshot };
}

async function current(tripId: string) {
  const row = await prisma.planVersion.findFirstOrThrow({ where: { tripId }, orderBy: { versionNumber: "desc" } });
  return { row, tickets: JSON.parse(row.tickets) as Ticket[], costs: JSON.parse(row.costs) as PlanCostItem[] };
}
async function act(request: APIRequestContext, tripId: string, action: TicketAction) {
  const { row } = await current(tripId);
  const response = await request.post(`/api/trips/${tripId}/plans/${row.versionNumber}/tickets`, { data: action });
  expect(response.status(), await response.text()).toBe(200);
  return current(tripId);
}
async function open(page: Page, tripId: string) {
  await page.goto(`/trips/${tripId}`); await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
}
async function submit(page: Page, panel: Locator, label: string) {
  const response = page.waitForResponse((r) => r.url().endsWith("/tickets") && r.request().method() === "POST");
  await panel.getByRole("button", { name: label, exact: true }).click();
  const result = await response; expect(result.status(), await result.text()).toBe(200);
}

// OCR responses below deliberately simulate a category mistake. Real OCR
// accuracy is covered by the existing opt-in suite, not claimed by these tests.
async function importPreview(page: Page, seat: string, kind: "ticket" | "refund") {
  await page.route("**/api/ticket-import", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ draft: {
    ...source, documentKind: kind, segments: [{ fields: { serviceNumber: "G6012", date: "2026-10-29", departureTime: "06:30", arrivalDate: "2026-10-29", arrivalTime: "07:30", fromName: "深圳北", toName: "长沙南", seat, fareCents: 24300 }, notices: ["合成识别草稿，请核对。"] }],
  } }) }));
  const importer = page.getByRole("region", { name: "去程交通", exact: true }).getByRole("region", { name: "截图导入", exact: true });
  await importer.getByRole("button", { name: "导入高铁票截图", exact: true }).click();
  const buffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: "white" } }).png().toBuffer();
  await importer.locator('input[type="file"]').setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer });
  await expect(importer.getByRole("img", { name: "本机票图裁剪预览" })).toBeVisible();
  await importer.getByRole("button", { name: "识别选中区域" }).click();
  await expect(importer.getByText("识别完成 · 等待核对")).toBeVisible();
  return importer;
}

test("corrects a mistaken refund category and binds two imported tickets to the existing paid 486 yuan group cost", async ({ page, request }) => {
  const trip = await seed(request, true); await open(page, trip.id);
  let importer = await importPreview(page, "05车08A", "refund");
  await expect(importer.getByLabel("这张截图用于").locator('option[value="new"]')).toHaveCount(0);
  await importer.getByLabel("核对资料种类").selectOption("ticket");
  await importer.getByLabel("这张截图用于").selectOption("new");
  await importer.getByRole("button", { name: "修正并核对票面" }).click();
  let editor = page.getByRole("region", { name: "手工票面", exact: true });
  await expect(editor.getByLabel("这张票如何计费")).toHaveValue("pending");
  await editor.getByRole("checkbox", { name: "我已核对票面，确认这是已购有效票", exact: true }).check();
  await submit(page, editor, "确认票面并保存");
  let saved = await current(trip.id);
  expect(saved.tickets[0]).toMatchObject({ costAllocation: { kind: "pending" }, importSource: { documentKind: "refund", confirmedDocumentKind: "ticket" } });
  expect(saved.costs.find((cost) => cost.id === `ticket-${saved.tickets[0].id}`)?.unitAmountCents).toBeNull();
  await page.getByRole("button", { name: "核对票费归属", exact: true }).click();
  const binding = page.getByRole("region", { name: "票费归属确认", exact: true });
  await binding.getByLabel("这张票如何计费").selectOption("cost-departure");
  await binding.getByRole("checkbox", { name: "我已核对这张票与所选费用的归属", exact: true }).check();
  await submit(page, binding, "确认费用归属");
  await page.unroute("**/api/ticket-import");
  importer = await importPreview(page, "05车08B", "ticket");
  await importer.getByLabel("这张截图用于").selectOption("companion");
  await importer.getByRole("button", { name: "修正并核对票面" }).click();
  editor = page.getByRole("region", { name: "手工票面", exact: true });
  await editor.getByLabel("这张票如何计费").selectOption("cost-departure");
  await editor.getByRole("checkbox", { name: "我已核对票面，确认这是已购有效票", exact: true }).check();
  await submit(page, editor, "确认票面并保存");
  saved = await current(trip.id);
  expect(saved.tickets).toHaveLength(2);
  expect(saved.tickets.every((ticket) => ticket.costAllocation?.kind === "existing")).toBe(true);
  const costs = saved.costs.filter((cost) => cost.linkedEventId === "departure");
  expect(costs).toHaveLength(1); expect(costs[0]).toMatchObject({ id: "cost-departure", unitAmountCents: 24300, quantity: 2, paymentStatus: "paid" });
  await page.reload(); await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  await expect(page.getByText("票费已明确包含在既有主交通费用中，不另加一笔；退款仍须在预算中确认。", { exact: true })).toHaveCount(2);
});

test("a persisted duplicate OCR draft can be skipped or explicitly confirmed as a corrected companion", async ({ page, request }) => {
  const trip = await seed(request);
  const ticket = ticketFixture(trip.snapshot.startDate!, { seat: "05车08A", fareCents: 24300, accessMode: null, egressMode: null });
  let saved = await act(request, trip.id, { action: "create_draft", ticket, importSource: source, importResolution: "new" });
  const draftId = saved.tickets[0].id;
  saved = await act(request, trip.id, { action: "activate", ticket, acknowledged: true });
  await open(page, trip.id);
  const card = page.getByTestId(`ticket-${draftId}`);
  await card.getByRole("button", { name: "确认这张草稿" }).click();
  let confirmation = page.getByRole("region", { name: "草稿票面确认", exact: true });
  await expect(confirmation.getByRole("button", { name: "确认草稿生效" })).toBeDisabled();
  await confirmation.getByLabel("草稿与已有票的关系").selectOption("same");
  await confirmation.getByRole("button", { name: "跳过这张草稿" }).click();
  expect((await current(trip.id)).row.versionNumber).toBe(saved.row.versionNumber);
  await card.getByRole("button", { name: "编辑草稿" }).click();
  const editor = page.getByRole("region", { name: "手工票面", exact: true });
  await editor.getByLabel("座位 / 车厢", { exact: true }).fill("05车08B");
  await editor.getByRole("checkbox", { name: "我已核对并确认本次补充或修改的资料", exact: true }).check();
  await submit(page, editor, "保存草稿修改");
  await card.getByRole("button", { name: "确认这张草稿" }).click();
  confirmation = page.getByRole("region", { name: "草稿票面确认", exact: true });
  await confirmation.getByLabel("草稿与已有票的关系").selectOption("companion");
  await confirmation.getByRole("checkbox", { name: "我已核对这张草稿，确认是已购有效票", exact: true }).check();
  await submit(page, confirmation, "确认草稿生效");
  saved = await current(trip.id);
  expect(saved.tickets.filter((t) => t.status === "active")).toHaveLength(2);
  expect(saved.tickets.find((t) => t.id === draftId)?.seat).toBe("05车08B");
  expect(saved.costs.filter((cost) => cost.id.startsWith("ticket-")).reduce((sum, cost) => sum + (cost.unitAmountCents ?? 0), 0)).toBe(48600);
});
