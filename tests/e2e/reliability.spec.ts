import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "./fixtures";
import { requestFixture, planFixture } from "../helpers/plan-fixtures";
import { derivePlanCosts, calculateBudgetSummary } from "../../lib/budget";
import { validatePlan } from "../../lib/plan";

const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const ownedTrips: string[] = [];

async function seed(days = 2) {
  const snapshot = requestFixture(days);
  const content = planFixture(snapshot);
  content.events.find((event) => event.id === "d1-activity")!.title = "审查景点";
  const trip = await prisma.trip.create({ data: { title: "可靠性浏览器合成旅行", originalRequest: "独立浏览器合成数据" } });
  ownedTrips.push(trip.id);
  await prisma.tripRequest.create({ data: {
    tripId: trip.id, originalRequest: trip.originalRequest, requestRevision: 1,
    extractedRequest: JSON.stringify(snapshot), confirmedRequest: JSON.stringify(snapshot),
    confirmedRevision: 1, confirmedAt: new Date(),
  } });
  const costs = derivePlanCosts(content.events);
  const plan = await prisma.planVersion.create({ data: {
    tripId: trip.id, versionNumber: 1, requestRevision: 1,
    requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events),
    costs: JSON.stringify(costs), places: "[]", routeLegs: "[]",
    pendingItems: JSON.stringify(content.pendingItems),
    validationResults: JSON.stringify(validatePlan(content, snapshot, costs)),
  } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id } });
  return { trip, plan, snapshot, content, costs };
}

test.afterAll(async () => {
  // Page fixtures have closed by this point, so a pending router refresh cannot
  // race deletion of its synthetic trip and produce a spurious server error.
  try {
    for (const id of ownedTrips.splice(0)) await prisma.trip.delete({ where: { id } });
  } finally {
    await prisma.$disconnect();
  }
});

test("saving from the explicit current-version URL follows the new version and preserves history", async ({ page }) => {
  const { trip } = await seed();
  await page.goto(`/trips/${trip.id}?planVersion=1`);
  const timeline = page.getByRole("tabpanel", { name: "每日时间轴", exact: true });
  await timeline.getByRole("button", { name: /第 \d+ 项：审查景点/ }).click();
  await timeline.getByRole("textbox", { name: "备注" }).fill("新版本中的备注");
  await timeline.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator("#plan-overview-title")).toContainText("计划版本 2");
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`));
  await expect(timeline.getByRole("textbox", { name: "备注" })).toHaveValue("新版本中的备注");
  await page.reload();
  await expect(page.locator("#plan-overview-title")).toContainText("计划版本 2");
  await page.getByRole("link", { name: "V1", exact: true }).click();
  await timeline.getByRole("button", { name: /第 \d+ 项：审查景点/ }).click();
  await expect(timeline.getByRole("textbox", { name: "备注" })).toHaveValue("");
  await expect(timeline.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled();
});

test("unsaved timeline and cost drafts survive tab, event and day changes", async ({ page }) => {
  const { trip } = await seed();
  await page.goto(`/trips/${trip.id}`);
  const timeline = page.getByRole("tabpanel", { name: "每日时间轴", exact: true });
  await timeline.getByRole("button", { name: /第 \d+ 项：审查景点/ }).click();
  await timeline.getByRole("textbox", { name: "备注" }).fill("未保存的备注");
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  const budget = page.getByRole("tabpanel", { name: "预算", exact: true });
  await budget.getByRole("button", { name: /审查景点/ }).click();
  await budget.getByLabel("单价（元，留空表示未知）").fill("25");
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await expect(timeline.getByRole("textbox", { name: "备注" })).toHaveValue("未保存的备注");
  await timeline.getByRole("button", { name: /第 \d+ 项：出行准备/ }).click();
  await timeline.getByRole("button", { name: /第 \d+ 项：审查景点/ }).click();
  await expect(timeline.getByRole("textbox", { name: "备注" })).toHaveValue("未保存的备注");
  await timeline.getByRole("button", { name: /第 2 天｜/ }).click();
  await timeline.getByRole("button", { name: /第 1 天｜/ }).click();
  await timeline.getByRole("button", { name: /第 \d+ 项：审查景点/ }).click();
  await expect(timeline.getByRole("textbox", { name: "备注" })).toHaveValue("未保存的备注");
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  await expect(budget.getByLabel("单价（元，留空表示未知）")).toHaveValue("25");
  const stored = await prisma.planVersion.findFirstOrThrow({ where: { tripId: trip.id } });
  expect(stored.versionNumber).toBe(1);
  expect(JSON.parse(stored.events).find((event: { id: string }) => event.id === "d1-activity").note).toBeNull();
});

test("edits typed while saving or confirming a request stay as a new unsaved draft", async ({ page }) => {
  const { trip } = await seed();
  await page.goto(`/trips/${trip.id}`);
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route(`**/api/trips/${trip.id}/request`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await saveGate;
    await route.continue();
  });
  await page.locator("#request-destination").fill("已提交的长沙");
  await page.getByRole("button", { name: "保存需求修订", exact: true }).click();
  await page.locator("#request-destination").fill("等待时输入的杭州");
  releaseSave();
  await expect(page.locator("#request-workspace-feedback")).toContainText("等待时输入的新内容已保留");
  await expect(page.locator("#request-destination")).toHaveValue("等待时输入的杭州");
  await expect(page.getByRole("button", { name: "确认修订 2", exact: true })).toBeDisabled();
  const saved = await prisma.tripRequest.findUniqueOrThrow({ where: { tripId: trip.id } });
  expect(JSON.parse(saved.extractedRequest!).destination).toBe("已提交的长沙");
  await page.getByRole("button", { name: "保存需求修订", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认修订 3", exact: true })).toBeEnabled();
  let releaseConfirm!: () => void;
  const confirmGate = new Promise<void>((resolve) => { releaseConfirm = resolve; });
  await page.route(`**/api/trips/${trip.id}/request/confirm`, async (route) => { await confirmGate; await route.continue(); });
  await page.getByRole("button", { name: "确认修订 3", exact: true }).click();
  await page.locator("#request-destination").fill("确认期间的新输入");
  releaseConfirm();
  await expect(page.locator("#request-workspace-feedback")).toContainText("等待时输入的新内容已保留");
  await expect(page.locator("#request-destination")).toHaveValue("确认期间的新输入");
  await expect(page.getByRole("button", { name: "生成新计划版本 V2", exact: true })).toBeDisabled();
});

test("saving the other tab carries unchanged local drafts into the new plan version", async ({ page }) => {
  const { trip } = await seed();
  await page.goto(`/trips/${trip.id}`);
  const timeline = page.getByRole("tabpanel", { name: "每日时间轴", exact: true });
  const budget = page.getByRole("tabpanel", { name: "预算", exact: true });
  await timeline.getByRole("button", { name: /第 \d+ 项：审查景点/ }).click();
  await timeline.getByRole("textbox", { name: "备注" }).fill("预算保存后仍需保留");
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  await budget.getByRole("button", { name: /审查景点/ }).click();
  await budget.getByLabel("单价（元，留空表示未知）").fill("26");
  await budget.getByRole("button", { name: "确认金额", exact: true }).click();
  await expect(page.locator("#plan-overview-title")).toContainText("计划版本 2");
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await expect(timeline.getByRole("textbox", { name: "备注" })).toHaveValue("预算保存后仍需保留");
  await timeline.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator("#plan-overview-title")).toContainText("计划版本 3");
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  await budget.getByLabel("单价（元，留空表示未知）").fill("27");
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await timeline.getByRole("textbox", { name: "备注" }).fill("新的已保存备注");
  await timeline.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator("#plan-overview-title")).toContainText("计划版本 4");
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  await expect(budget.getByLabel("单价（元，留空表示未知）")).toHaveValue("27");
  await budget.getByRole("button", { name: "确认金额", exact: true }).click();
  await expect(page.locator("#plan-overview-title")).toContainText("计划版本 5");
  const stored = await prisma.planVersion.findFirstOrThrow({ where: { tripId: trip.id }, orderBy: { versionNumber: "desc" } });
  expect(JSON.parse(stored.costs).find((cost: { linkedEventId: string }) => cost.linkedEventId === "d1-activity").unitAmountCents).toBe(2700);
  expect(JSON.parse(stored.events).find((event: { id: string }) => event.id === "d1-activity").note).toBe("新的已保存备注");
});

test("confirmed costs and per-stay nights agree across budget and timeline without changing history", async ({ page }) => {
  const { trip, snapshot } = await seed(4);
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  const budget = page.getByRole("tabpanel", { name: "预算", exact: true });
  await budget.getByRole("button", { name: /审查景点/ }).click();
  await budget.getByRole("button", { name: "确认金额", exact: true }).click();
  await expect(page.locator("#plan-overview-title")).toContainText("计划版本 2");
  await expect(budget.getByRole("button", { name: /审查景点/ })).toContainText("已确认");
  await budget.getByLabel("单价（元，留空表示未知）").fill("10");
  await budget.getByRole("button", { name: "确认金额", exact: true }).click();
  await expect(page.locator("#plan-overview-title")).toContainText("计划版本 3");
  await page.getByRole("tab", { name: "每日时间轴", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "每日时间轴", exact: true }).getByRole("button", { name: /第 \d+ 项：审查景点/ })).toContainText("10 元｜已确认");
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  for (let night = 0; night < 3; night++) {
    await budget.getByRole("button", { name: /住宿区域/ }).nth(night).click();
    await budget.getByLabel("单价（元，留空表示未知）").fill("300");
    await budget.getByRole("combobox", { name: /^计价单位/ }).selectOption("per_room_per_night");
    await expect(budget.getByLabel("这笔住宿的计费晚数", { exact: false })).toHaveValue("1");
    await budget.getByLabel("已支付", { exact: true }).check();
    await budget.getByRole("button", { name: "确认金额", exact: true }).click();
    await expect(page.locator("#plan-overview-title")).toContainText(`计划版本 ${night + 4}`);
  }
  await expect(budget.getByText(/已支付 900 元｜/)).toBeVisible();
  const latest = await prisma.planVersion.findFirstOrThrow({ where: { tripId: trip.id }, orderBy: { versionNumber: "desc" } });
  const total = calculateBudgetSummary(JSON.parse(latest.costs), snapshot);
  expect(total.categories.find((category) => category.category === "accommodation")?.minTotalCents).toBe(90000);
  expect(total.paidMinCents).toBe(90000);
  const first = await prisma.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId: trip.id, versionNumber: 1 } } });
  expect(JSON.parse(first.costs).find((cost: { linkedEventId: string }) => cost.linkedEventId === "d1-hotel").unitAmountCents).toBe(1800);
});
