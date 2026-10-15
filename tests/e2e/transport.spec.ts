import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { calculateBudgetSummary, derivePlanCosts, type PlanCostItem } from "../../lib/budget";
import { nextPlanDate, preparePlanForStorage, type PlanEvent } from "../../lib/plan";
import type { Ticket, TicketAction, TicketCore } from "../../lib/tickets";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";

// Every setup write and cleanup uses the explicit isolated browser-test DB.
// These are invented journeys, fares and public landmarks, not live tickets.
const databaseDirectory = path.resolve("test-data", "e2e");
process.env.SERENDIPITY_DATA_DIR = databaseDirectory;
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${path.join(databaseDirectory, "data", "serendipity.db").replaceAll("\\", "/")}` } },
});
const seededTripIds: string[] = [];
const evidenceDirectory = verificationEvidenceDirectory("phase14");

test.afterAll(async () => {
  await prisma.trip.deleteMany({ where: { id: { in: seededTripIds } } });
  await prisma.$disconnect();
});

async function seed(request: APIRequestContext) {
  const response = await request.post("/api/trips", {
    data: { originalRequest: "阶段14合成演练：深圳公共地标到长沙住宿区域，两人去返程；不是实际票面。" },
  });
  expect(response.status()).toBe(201);
  const { trip } = await response.json();
  seededTripIds.push(trip.id);
  const snapshot = requestFixture(2, { destination: "长沙", travelerCount: 2 });
  const draft = await request.patch(`/api/trips/${trip.id}/request`, {
    data: { expectedRequestRevision: 1, request: snapshot },
  });
  expect(draft.status()).toBe(200);
  const confirmed = await request.post(`/api/trips/${trip.id}/request/confirm`, {
    data: { expectedRequestRevision: 2 },
  });
  expect(confirmed.status()).toBe(200);
  const content = preparePlanForStorage(planFixture(snapshot));
  const costs = derivePlanCosts(content.events);
  const plan = await prisma.planVersion.create({ data: {
    tripId: trip.id, versionNumber: 1, requestRevision: 2,
    requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events),
    costs: JSON.stringify(costs), pendingItems: JSON.stringify(content.pendingItems),
    validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }),
  } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id, status: "planned" } });
  return { id: trip.id as string, snapshot };
}

type SeededTrip = Awaited<ReturnType<typeof seed>>;

function ticketCore(trip: SeededTrip, overrides: Partial<TicketCore> = {}): TicketCore {
  return {
    eventId: "departure", direction: "departure", mode: "train", serviceNumber: "G6012",
    date: trip.snapshot.startDate, departureTime: "06:30",
    arrivalDate: trip.snapshot.startDate, arrivalTime: "07:30",
    fromName: "深圳北站", fromDetail: "东广场进站口", toName: "长沙南站", toDetail: "西出站口",
    chainOriginName: "深圳市民中心（合成起点）", chainDestinationName: "长沙五一广场住宿区域",
    accessMode: "public_transit", accessDurationMinutes: 30, accessFareCents: 600,
    accessNote: "演练参考：地铁含步行、候车及换乘；实际运营须另查。",
    egressMode: "public_transit", egressDurationMinutes: 35, egressFareCents: 700,
    egressNote: "演练参考：出站后地铁前往住宿区域。",
    baggageNote: "一件随身行李，安检办理条件待现场核对", passengerCount: 2, fareCents: 24300,
    checkInCutoffMinutes: null, bagDropCutoffMinutes: null, boardingCutoffMinutes: 10,
    bufferMinutes: 30, note: "合成测试票面，无真实余票或时刻表依据。",
    ...overrides,
  };
}

async function savedVersion(tripId: string, versionNumber?: number) {
  const row = versionNumber === undefined
    ? await prisma.planVersion.findFirstOrThrow({ where: { tripId }, orderBy: { versionNumber: "desc" } })
    : await prisma.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId, versionNumber } } });
  return {
    row,
    tickets: JSON.parse(row.tickets) as Ticket[],
    events: JSON.parse(row.events) as PlanEvent[],
    costs: JSON.parse(row.costs) as PlanCostItem[],
  };
}

async function ticketAction(request: APIRequestContext, tripId: string, version: number, action: TicketAction) {
  const response = await request.post(`/api/trips/${tripId}/plans/${version}/tickets`, { data: action });
  expect(response.status(), await response.text()).toBe(200);
  return savedVersion(tripId);
}

async function openTransport(page: Page, tripId: string, version?: number) {
  await page.goto(`/trips/${tripId}${version ? `?planVersion=${version}` : ""}`);
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
}

async function fillTicket(panel: Locator, core: TicketCore) {
  await panel.getByRole("combobox", { name: "交通方式", exact: true }).selectOption(core.mode);
  await panel.getByText("行李、办理截止与安全余量", { exact: true }).click();
  const fields: Array<[string, string | number | null]> = [
    ["车次 / 航班号", core.serviceNumber], ["出发日期", core.date], ["出发时刻", core.departureTime],
    ["到达日期", core.arrivalDate], ["到达时刻", core.arrivalTime],
    ["出发站点 / 机场", core.fromName], ["出发站 / 航站楼详情", core.fromDetail],
    ["到达站点 / 机场", core.toName], ["到达站 / 航站楼详情", core.toDetail],
    ["门到门起点", core.chainOriginName], ["门到门终点", core.chainDestinationName],
    ["票面人数", core.passengerCount], ["每人票价（元）", core.fareCents === null ? null : core.fareCents / 100],
    ["前段接驳总耗时（分钟）", core.accessDurationMinutes], ["前段接驳全段费用（元）", core.accessFareCents === null ? null : core.accessFareCents / 100],
    ["前段接驳说明 / 末班", core.accessNote], ["后段接驳总耗时（分钟）", core.egressDurationMinutes],
    ["后段接驳全段费用（元）", core.egressFareCents === null ? null : core.egressFareCents / 100], ["后段接驳说明 / 末班", core.egressNote],
    ["行李 / 托运要求", core.baggageNote], ["额外安全余量（分钟）", core.bufferMinutes],
    [core.mode === "flight" ? "登机截止（起飞前分钟）" : "检票截止（发车前分钟）", core.boardingCutoffMinutes],
  ];
  for (const [label, value] of fields) {
    await panel.getByLabel(label, { exact: true }).fill(value === null ? "" : String(value));
  }
  await panel.getByRole("combobox", { name: "前段接驳方式", exact: true }).selectOption(core.accessMode ?? "");
  await panel.getByRole("combobox", { name: "后段接驳方式", exact: true }).selectOption(core.egressMode ?? "");
  if (core.mode === "flight") {
    await panel.getByLabel("值机截止（起飞前分钟）", { exact: true }).fill(core.checkInCutoffMinutes === null ? "" : String(core.checkInCutoffMinutes));
    await panel.getByLabel("托运截止（起飞前分钟）", { exact: true }).fill(core.bagDropCutoffMinutes === null ? "" : String(core.bagDropCutoffMinutes));
  }
}

async function newTicketPanel(page: Page, direction: TicketCore["direction"]) {
  await page.getByRole("button", { name: direction === "departure" ? "去程" : "返程", exact: true }).click();
  await page.getByRole("button", { name: "录入票面", exact: true }).click();
  return page.getByRole("region", { name: "手工票面", exact: true });
}

async function saveTicketPanel(page: Page, panel: Locator, version: number, draft = false) {
  if (!draft) await panel.getByRole("checkbox", { name: "我已核对票面，确认这是已购有效票", exact: true }).check();
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/tickets"));
  await panel.getByRole("button", { name: draft ? "保存草稿" : "确认票面并保存", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole("heading", { name: new RegExp(`^计划版本 ${version}｜`) })).toBeVisible();
}

async function saveAction(page: Page, button: Locator, version: number) {
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/tickets"));
  await button.click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole("heading", { name: new RegExp(`^计划版本 ${version}｜`) })).toBeVisible();
}

async function exportDemo(tripId: string, name: "train" | "flight") {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, include: { request: true, currentPlanVersion: true } });
  const row = trip.currentPlanVersion!;
  const request = trip.request!;
  const parse = (value: string | null) => value ? JSON.parse(value) : null;
  await fs.mkdir(evidenceDirectory, { recursive: true });
  await fs.writeFile(path.join(evidenceDirectory, `${name}-demo.json`), JSON.stringify({
    provenance: "Synthetic browser-test journey; not a real ticket, fare or timetable.",
    trip: { title: `${name === "train" ? "高铁" : "国内航班"}门到门合成演练`, originalRequest: trip.originalRequest, status: trip.status },
    request: {
      originalRequest: request.originalRequest, requestRevision: request.requestRevision,
      extractedRequest: parse(request.extractedRequest), confirmedRequest: parse(request.confirmedRequest),
      fieldSources: parse(request.fieldSources), defaultAssumptions: parse(request.defaultAssumptions),
      pendingQuestions: parse(request.pendingQuestions), confirmedRevision: request.confirmedRevision,
      confirmedAt: request.confirmedAt?.toISOString() ?? null,
    },
    plan: {
      versionNumber: row.versionNumber, requestRevision: row.requestRevision, requirementUpToDate: row.requirementUpToDate,
      requestSnapshot: parse(row.requestSnapshot), events: parse(row.events), costs: parse(row.costs),
      places: parse(row.places), routeLegs: parse(row.routeLegs), tickets: parse(row.tickets),
      pendingItems: parse(row.pendingItems), validationResults: parse(row.validationResults),
    },
  }, null, 2), "utf8");
}

async function capture(page: Page, name: string, width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await fs.mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDirectory, name), fullPage: true });
}

test("high-speed rail drafts become stable active tickets and preserve both complete chains after refresh", async ({ page, request }) => {
  const trip = await seed(request);
  const initial = await savedVersion(trip.id);
  await openTransport(page, trip.id);
  await expect(page.getByRole("link", { name: /12306/ })).toHaveAttribute("href", "https://www.12306.cn/index/");
  const departure = ticketCore(trip);
  const panel = await newTicketPanel(page, "departure");
  await fillTicket(panel, departure);
  await expect(panel.getByRole("button", { name: "确认票面并保存", exact: true })).toBeDisabled();
  await capture(page, "train-form-desktop.png", 1440);
  await saveTicketPanel(page, panel, 2, true);
  const draft = await savedVersion(trip.id);
  expect(draft.tickets).toHaveLength(1);
  expect(draft.tickets[0]).toMatchObject({ status: "draft", confirmedAt: null });
  expect(draft.events).toEqual(initial.events);
  expect(draft.costs).toEqual(initial.costs);
  await page.reload();
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  const draftCard = page.getByTestId(`ticket-${draft.tickets[0].id}`);
  await draftCard.getByRole("button", { name: "确认这张草稿", exact: true }).click();
  await page.getByRole("checkbox", { name: /我已核对这张草稿/ }).check();
  await saveAction(page, page.getByRole("button", { name: "确认草稿生效", exact: true }), 3);
  const active = await savedVersion(trip.id);
  expect(active.tickets).toHaveLength(1);
  expect(active.tickets[0]).toMatchObject({ id: draft.tickets[0].id, status: "active" });
  expect(active.tickets[0].confirmedAt).toBeTruthy();
  expect(active.events.find((event) => event.id === "departure")).toMatchObject({ locked: true, status: "confirmed", startTime: "06:30", endTime: "07:30" });
  const chain = page.getByRole("region", { name: /^(去程|返程)交通$/ });
  await expect(chain.getByRole("list", { name: "去程完整交通链", exact: true }).getByRole("listitem")).toHaveCount(7);
  await expect(chain).toContainText(departure.chainOriginName!);
  await expect(chain).toContainText("深圳北站");
  await expect(chain).toContainText("长沙南站");
  await expect(chain).toContainText(departure.chainDestinationName!);
  await expect(chain).toContainText(/安检|检票/);

  const returning = ticketCore(trip, {
    eventId: "return", direction: "return", serviceNumber: "G6023", date: trip.snapshot.endDate, arrivalDate: trip.snapshot.endDate,
    departureTime: "17:00", arrivalTime: "18:30", fromName: "长沙南站", toName: "深圳北站",
    fromDetail: "西广场进站口", toDetail: "东出站口",
    chainOriginName: "长沙五一广场住宿区域", chainDestinationName: "深圳市民中心（合成返家点）",
  });
  const returnPanel = await newTicketPanel(page, "return");
  await fillTicket(returnPanel, returning);
  await saveTicketPanel(page, returnPanel, 4);
  await expect(chain.getByRole("list", { name: "返程完整交通链", exact: true }).getByRole("listitem")).toHaveCount(7);
  await expect(chain).toContainText(returning.chainOriginName!);
  await expect(chain).toContainText(returning.chainDestinationName!);
  await expect(chain).toContainText("G6023");
  const final = await savedVersion(trip.id);
  expect(final.tickets.filter((ticket) => ticket.status === "active")).toHaveLength(2);
  expect(final.costs.filter((cost) => cost.category === "transport" && cost.id.startsWith("ticket-"))).toMatchObject([
    { unitAmountCents: 24300, quantity: 2 }, { unitAmountCents: 24300, quantity: 2 },
  ]);
  await page.reload();
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  await page.getByRole("button", { name: "返程", exact: true }).click();
  await expect(chain).toContainText(returning.chainDestinationName!);
  expect((await savedVersion(trip.id)).row.tickets).toBe(final.row.tickets);
  await capture(page, "train-desktop.png", 1440);
  await exportDemo(trip.id, "train");

  await page.getByRole("tab", { name: "地图", exact: true }).click();
  await page.getByRole("tabpanel", { name: "地图", exact: true }).getByRole("listitem").filter({ hasText: "G6023" }).getByRole("button", { name: "查看交通票面", exact: true }).click();
  await expect(page.getByRole("tab", { name: "门到门交通", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "返程", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(chain).toContainText(returning.chainDestinationName!);
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await page.getByRole("tabpanel", { name: "每日时间轴", exact: true }).getByRole("button", { name: /^第 1 天｜/ }).click();
  await page.getByRole("tabpanel", { name: "每日时间轴", exact: true }).getByRole("button", { name: "查看交通票面", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "去程", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(chain).toContainText(departure.chainOriginName!);

  await openTransport(page, trip.id, 2);
  await expect(page.getByRole("tabpanel", { name: "门到门交通", exact: true }).getByText("历史版本只读，展示当时的票据与交通链。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "录入票面", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "确认这张草稿", exact: true })).toHaveCount(0);
  expect((await savedVersion(trip.id, 2)).row.tickets).toBe(draft.row.tickets);
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(4);
});

test("domestic flights retain terminals, overnight return and unknown handling conditions on mobile", async ({ page, request }) => {
  const trip = await seed(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await openTransport(page, trip.id);
  const departure = ticketCore(trip, {
    mode: "flight", serviceNumber: "CZ3001", fromName: "深圳宝安国际机场", fromDetail: "T3",
    toName: "长沙黄花国际机场", toDetail: "T2", departureTime: "06:30", arrivalTime: "07:30",
    fareCents: 68000, checkInCutoffMinutes: 45, bagDropCutoffMinutes: 45, boardingCutoffMinutes: 15,
    bufferMinutes: 90, accessMode: "driving", accessDurationMinutes: 40, accessFareCents: null,
    accessNote: "演练驾车参考；停车、路桥与燃油费用未核实。", baggageNote: "每人一件随身行李；是否托运待确认。",
  });
  const panel = await newTicketPanel(page, "departure");
  await fillTicket(panel, departure);
  await capture(page, "flight-form-mobile.png", 390);
  await capture(page, "flight-form-tablet.png", 768);
  await page.setViewportSize({ width: 390, height: 844 });
  await saveTicketPanel(page, panel, 2);
  const chain = page.getByRole("region", { name: /^(去程|返程)交通$/ });
  await expect(chain.getByRole("list", { name: "去程完整交通链", exact: true }).getByRole("listitem")).toHaveCount(7);
  await expect(chain).toContainText("深圳宝安国际机场");
  await expect(chain).toContainText("T3");
  await expect(chain).toContainText("长沙黄花国际机场");
  await expect(chain).toContainText("T2");
  await expect(chain).toContainText(/值机/);
  await expect(chain).toContainText(/托运/);
  await expect(chain).toContainText(/登机/);

  const returning = ticketCore(trip, {
    eventId: "return", direction: "return", mode: "flight", serviceNumber: "CZ3002",
    date: trip.snapshot.endDate, departureTime: "23:30", arrivalDate: nextPlanDate(trip.snapshot.endDate!), arrivalTime: "00:40",
    fromName: "长沙黄花国际机场", fromDetail: "T1", toName: "深圳宝安国际机场", toDetail: "T3",
    chainOriginName: "长沙五一广场住宿区域", chainDestinationName: "深圳市民中心（合成返家点）",
    fareCents: 70000, checkInCutoffMinutes: null, bagDropCutoffMinutes: null, boardingCutoffMinutes: null,
    egressMode: "public_transit", egressDurationMinutes: null, egressFareCents: null,
    egressNote: "夜间抵达，末班地铁可能已停运；尚未查到可衔接班次，须核对出租车。", bufferMinutes: 90,
  });
  const returnPanel = await newTicketPanel(page, "return");
  await fillTicket(returnPanel, returning);
  await saveTicketPanel(page, returnPanel, 3);
  await expect(chain.getByRole("list", { name: "返程完整交通链", exact: true }).getByRole("listitem")).toHaveCount(7);
  await expect(chain).toContainText(returning.chainDestinationName!);
  await expect(chain).toContainText("T1");
  await expect(chain).toContainText(/00:40/);
  await expect(chain).toContainText(/待确认|资料待补/);
  await expect(chain).toContainText(/末班|夜间/);
  const final = await savedVersion(trip.id);
  expect(final.tickets.find((ticket) => ticket.direction === "return")).toMatchObject({
    status: "active", arrivalDate: returning.arrivalDate, arrivalTime: "00:40",
    boardingCutoffMinutes: null, egressDurationMinutes: null, egressFareCents: null,
  });
  expect(final.events.find((event) => event.id === "return")).toMatchObject({
    locked: true, startTime: "23:30", endDate: returning.arrivalDate, endTime: "00:40",
  });
  expect(JSON.parse(final.row.validationResults).warnings.join(" ")).toMatch(/待|跨|日期|衔接|到达/);
  await page.reload();
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  await page.getByRole("button", { name: "返程", exact: true }).click();
  await expect(chain).toContainText("00:40");
  await capture(page, "flight-mobile.png", 390);
  await capture(page, "flight-tablet.png", 768);
  await exportDemo(trip.id, "flight");
});

test("specified replacement and cancellation preserve a companion ticket and separately confirmed paid costs", async ({ page, request }) => {
  const trip = await seed(request);
  const core = ticketCore(trip, { passengerCount: 1 });
  const first = await ticketAction(request, trip.id, 1, { action: "activate", ticket: core, acknowledged: true });
  const originalTicket = first.tickets[0];
  const second = await ticketAction(request, trip.id, 2, { action: "activate", ticket: core, acknowledged: true });
  const companion = second.tickets.find((ticket) => ticket.id !== originalTicket.id)!;
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  await page.getByRole("button", { name: /去程：G6012/ }).first().click();
  await page.getByLabel("已支付", { exact: true }).check();
  await page.getByRole("button", { name: "确认金额", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^计划版本 4｜/ })).toBeVisible();
  const paid = await savedVersion(trip.id);
  const paidCost = paid.costs.find((cost) => cost.id === `ticket-${originalTicket.id}`)!;
  expect(paidCost).toMatchObject({ unitAmountCents: 24300, paymentStatus: "paid" });

  const departureTotal = calculateBudgetSummary(paid.costs.filter((cost) => cost.linkedEventId === "departure"), trip.snapshot).totalMinCents;
  expect(departureTotal).toBe(49900); // Two 243-yuan tickets plus the shared 6 + 7 yuan transfers.
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await expect(page.getByRole("button", { name: /^第 \d+ 项：去程：G6012$/ })).toContainText("499 元");

  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  const originalCard = page.getByTestId(`ticket-${originalTicket.id}`);
  await originalCard.getByRole("button", { name: "替换这张票", exact: true }).click();
  const replacementPanel = page.getByRole("region", { name: "手工票面", exact: true });
  await fillTicket(replacementPanel, ticketCore(trip, { passengerCount: 1, serviceNumber: "G6014", departureTime: "06:45", arrivalTime: "07:45", fareCents: 26000 }));
  await expect(replacementPanel).toContainText("G6012");
  await expect(replacementPanel.getByRole("button", { name: "确认替换指定票", exact: true })).toBeDisabled();
  await replacementPanel.getByRole("checkbox", { name: "我已办妥改签 / 换票，并核对指定原票和新票", exact: true }).check();
  await saveAction(page, replacementPanel.getByRole("button", { name: "确认替换指定票", exact: true }), 5);
  const replaced = await savedVersion(trip.id);
  const old = replaced.tickets.find((ticket) => ticket.id === originalTicket.id)!;
  expect(old).toMatchObject({ status: "replaced", confirmedAt: originalTicket.confirmedAt });
  expect(old.replacedByTicketId).toBeTruthy();
  expect(replaced.tickets.find((ticket) => ticket.id === companion.id)).toEqual(companion);
  expect(replaced.tickets.find((ticket) => ticket.id === old.replacedByTicketId)).toMatchObject({ status: "active", serviceNumber: "G6014" });
  expect(replaced.events.find((event) => event.id === "departure")).toMatchObject({ locked: true, title: "去程：多班次冲突" });
  expect(replaced.costs.find((cost) => cost.id === paidCost.id)).toMatchObject({ unitAmountCents: 24300, paymentStatus: "paid" });
  await expect(page.getByText(/单线.*|班次.*不一致/).first()).toBeVisible();

  const replacementCard = page.getByTestId(`ticket-${old.replacedByTicketId}`);
  await replacementCard.getByRole("button", { name: "记录已退票", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认记录退票", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消操作", exact: true }).click();
  expect((await savedVersion(trip.id)).row.tickets).toBe(replaced.row.tickets);
  await replacementCard.getByRole("button", { name: "记录已退票", exact: true }).click();
  await page.getByRole("checkbox", { name: /我已在官方平台办妥这张票的退票/ }).check();
  await saveAction(page, page.getByRole("button", { name: "确认记录退票", exact: true }), 6);
  const cancelled = await savedVersion(trip.id);
  expect(cancelled.tickets.find((ticket) => ticket.id === old.replacedByTicketId)).toMatchObject({ status: "cancelled" });
  expect(cancelled.tickets.find((ticket) => ticket.id === companion.id)).toEqual(companion);
  expect(cancelled.events.find((event) => event.id === "departure")).toMatchObject({ locked: true, status: "confirmed", title: "去程：G6012", startTime: "06:30" });
  expect(cancelled.costs.find((cost) => cost.id === paidCost.id)).toMatchObject({ unitAmountCents: 24300, paymentStatus: "paid" });
  expect(calculateBudgetSummary(cancelled.costs, trip.snapshot).totalMinCents).toBe(calculateBudgetSummary(replaced.costs, trip.snapshot).totalMinCents);
  await page.reload();
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  await expect(page.getByTestId(`ticket-${originalTicket.id}`)).toContainText("已替换");
  await expect(page.getByTestId(`ticket-${old.replacedByTicketId}`)).toContainText("已退票");
  await expect(page.getByTestId(`ticket-${companion.id}`)).toContainText("当前有效");

  const stale = await request.post(`/api/trips/${trip.id}/plans/4/tickets`, {
    data: { action: "cancel", ticketId: companion.id, acknowledged: true },
  });
  expect(stale.status()).toBe(409);
  expect((await savedVersion(trip.id)).row.tickets).toBe(cancelled.row.tickets);

  // The user separately confirms the remaining 23 yuan after a synthetic
  // refund. A later ticket action must not restore the original 243 yuan.
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  await page.getByRole("button", { name: /去程：G6012/ }).first().click();
  await page.getByLabel("单价（元，留空表示未知）", { exact: true }).fill("23");
  await page.getByRole("button", { name: "确认金额", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^计划版本 7｜/ })).toBeVisible();
  const refundConfirmed = await savedVersion(trip.id);
  expect(refundConfirmed.costs.find((cost) => cost.id === paidCost.id)).toMatchObject({ unitAmountCents: 2300, paymentStatus: "paid" });
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  await page.getByTestId(`ticket-${companion.id}`).getByRole("button", { name: "记录已退票", exact: true }).click();
  await page.getByRole("checkbox", { name: /我已在官方平台办妥这张票的退票/ }).check();
  await saveAction(page, page.getByRole("button", { name: "确认记录退票", exact: true }), 8);
  const allCancelled = await savedVersion(trip.id);
  expect(allCancelled.events.find((event) => event.id === "departure")).toMatchObject({ locked: false, status: "suggested" });
  expect(allCancelled.tickets.filter((ticket) => ticket.status === "active")).toHaveLength(0);
  expect(allCancelled.costs.find((cost) => cost.id === paidCost.id)).toMatchObject({ unitAmountCents: 2300, paymentStatus: "paid" });
  await capture(page, "ticket-history-desktop.png", 1440);
});

test("unconfirmed changed requirements still allow incomplete real ticket facts and cancellation without adopting the new snapshot", async ({ page, request }) => {
  const trip = await seed(request);
  const original = await savedVersion(trip.id);
  const changed = await request.patch(`/api/trips/${trip.id}/request`, {
    data: { expectedRequestRevision: 2, request: { ...trip.snapshot, travelerCount: 4, destination: "长沙和株洲" } },
  });
  expect(changed.status()).toBe(200);
  await openTransport(page, trip.id);
  await expect(page.getByText("当前计划待更新", { exact: true })).toBeVisible();
  const panel = await newTicketPanel(page, "departure");
  await fillTicket(panel, ticketCore(trip, {
    chainOriginName: null, chainDestinationName: null, accessDurationMinutes: null, egressDurationMinutes: null,
    arrivalDate: null, arrivalTime: null,
  }));
  await saveTicketPanel(page, panel, 2);
  const active = await savedVersion(trip.id);
  expect(active.tickets[0]).toMatchObject({ status: "active", arrivalDate: null, arrivalTime: null });
  expect(active.row).toMatchObject({ requestRevision: 2, requestSnapshot: original.row.requestSnapshot, requirementUpToDate: false });
  await expect(page.getByText("当前计划待更新", { exact: true })).toBeVisible();
  const card = page.getByTestId(`ticket-${active.tickets[0].id}`);
  await card.getByRole("button", { name: "记录已退票", exact: true }).click();
  await page.getByRole("checkbox", { name: /我已在官方平台办妥这张票的退票/ }).check();
  await saveAction(page, page.getByRole("button", { name: "确认记录退票", exact: true }), 3);
  const cancelled = await savedVersion(trip.id);
  expect(cancelled.tickets[0]).toMatchObject({ status: "cancelled", confirmedAt: active.tickets[0].confirmedAt });
  expect(cancelled.row).toMatchObject({ requestRevision: 2, requestSnapshot: original.row.requestSnapshot, requirementUpToDate: false });
  expect(cancelled.events.find((event) => event.id === "departure")).toMatchObject({ locked: false, status: "suggested" });
  expect((await prisma.tripRequest.findUniqueOrThrow({ where: { tripId: trip.id } })).confirmedRevision).toBeNull();
  await page.reload();
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  await expect(page.getByText("当前计划待更新", { exact: true })).toBeVisible();
  await expect(page.getByTestId(`ticket-${active.tickets[0].id}`)).toContainText("已退票");
});

test("failed saving retains manual inputs and requires a fresh acknowledgement after edits", async ({ page, request }) => {
  const trip = await seed(request);
  const initial = await savedVersion(trip.id);
  await openTransport(page, trip.id);
  const panel = await newTicketPanel(page, "departure");
  await fillTicket(panel, ticketCore(trip));
  const acknowledgement = panel.getByRole("checkbox", { name: "我已核对票面，确认这是已购有效票", exact: true });
  await acknowledgement.check();
  await panel.getByLabel("车次 / 航班号", { exact: true }).fill("G6013");
  await expect(acknowledgement).not.toBeChecked();
  await expect(panel.getByRole("button", { name: "确认票面并保存", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "收起并保留输入", exact: true }).click();
  expect((await savedVersion(trip.id)).row.tickets).toBe(initial.row.tickets);
  await page.getByRole("button", { name: "录入票面", exact: true }).click();
  await expect(panel.getByLabel("车次 / 航班号", { exact: true })).toHaveValue("G6013");
  await expect(acknowledgement).not.toBeChecked();
  await acknowledgement.check();
  await page.route(`**/api/trips/${trip.id}/plans/1/tickets`, (route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "演练保存失败，请重试。" }),
  }));
  await panel.getByRole("button", { name: "确认票面并保存", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "门到门交通", exact: true }).getByRole("alert")).toContainText("输入已保留");
  await expect(panel.getByLabel("车次 / 航班号", { exact: true })).toHaveValue("G6013");
  expect((await savedVersion(trip.id)).row.tickets).toBe(initial.row.tickets);
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  await page.unroute(`**/api/trips/${trip.id}/plans/1/tickets`);
  await saveTicketPanel(page, panel, 2);
  expect((await savedVersion(trip.id)).tickets).toMatchObject([{ status: "active", serviceNumber: "G6013" }]);
});

test("editing a draft and filling missing active details keep the ticket ID while protecting confirmed fields", async ({ page, request }) => {
  const trip = await seed(request);
  const original = await savedVersion(trip.id);
  const draft = await ticketAction(request, trip.id, 1, {
    action: "create_draft", ticket: ticketCore(trip, {
      arrivalDate: null, arrivalTime: null, toDetail: null, chainOriginName: null,
    }),
  });
  const ticketId = draft.tickets[0].id;
  await openTransport(page, trip.id);
  const card = page.getByTestId(`ticket-${ticketId}`);
  await card.getByRole("button", { name: "编辑草稿", exact: true }).click();
  const panel = page.getByRole("region", { name: "手工票面", exact: true });
  const acknowledged = panel.getByRole("checkbox", { name: "我已核对并确认本次补充或修改的资料", exact: true });
  await expect(panel.getByLabel("车次 / 航班号", { exact: true })).toBeEnabled();
  await panel.getByLabel("车次 / 航班号", { exact: true }).fill("G6099");
  await acknowledged.check();
  await saveAction(page, panel.getByRole("button", { name: "保存草稿修改", exact: true }), 3);
  const editedDraft = await savedVersion(trip.id);
  expect(editedDraft.tickets).toHaveLength(1);
  expect(editedDraft.tickets[0]).toMatchObject({ id: ticketId, serviceNumber: "G6099", status: "draft", confirmedAt: null });
  expect(editedDraft.events).toEqual(original.events);
  expect(editedDraft.costs).toEqual(original.costs);
  await card.getByRole("button", { name: "确认这张草稿", exact: true }).click();
  await page.getByRole("checkbox", { name: /我已核对这张草稿/ }).check();
  await saveAction(page, page.getByRole("button", { name: "确认草稿生效", exact: true }), 4);
  const active = await savedVersion(trip.id);
  expect(active.events.find((event) => event.id === "departure")).toMatchObject({ locked: true, ticketTimingPending: true });

  await card.getByRole("button", { name: "补充资料", exact: true }).click();
  await expect(panel.getByRole("combobox", { name: "交通方式", exact: true })).toBeDisabled();
  for (const label of ["车次 / 航班号", "出发日期", "出发时刻", "出发站点 / 机场", "到达站点 / 机场", "票面人数", "每人票价（元）"]) {
    await expect(panel.getByLabel(label, { exact: true })).toBeDisabled();
  }
  await expect(panel.getByLabel("到达时刻", { exact: true })).toBeEnabled();
  await panel.getByLabel("到达日期", { exact: true }).fill(trip.snapshot.startDate!);
  await panel.getByLabel("到达时刻", { exact: true }).fill("07:40");
  await panel.getByLabel("到达站 / 航站楼详情", { exact: true }).fill("西出站口");
  await panel.getByLabel("门到门起点", { exact: true }).fill("深圳市民中心（补齐合成起点）");
  await acknowledged.check();
  await saveAction(page, panel.getByRole("button", { name: "保存补充资料", exact: true }), 5);
  const updated = await savedVersion(trip.id);
  expect(updated.tickets).toHaveLength(1);
  expect(updated.tickets[0]).toMatchObject({
    id: ticketId, status: "active", confirmedAt: active.tickets[0].confirmedAt,
    serviceNumber: "G6099", arrivalDate: trip.snapshot.startDate, arrivalTime: "07:40", toDetail: "西出站口",
  });
  expect(updated.events.find((event) => event.id === "departure")).toMatchObject({ locked: true, ticketTimingPending: false, endTime: "07:40" });
  expect(updated.costs.filter((cost) => cost.id === `ticket-${ticketId}`)).toEqual(active.costs.filter((cost) => cost.id === `ticket-${ticketId}`));
  await page.reload();
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  await expect(card).toContainText("深圳市民中心（补齐合成起点）");
  await expect(card).toContainText("07:40");
  await card.getByRole("button", { name: "补充资料", exact: true }).click();
  await expect(panel.getByLabel("到达时刻", { exact: true })).toBeDisabled();
});
