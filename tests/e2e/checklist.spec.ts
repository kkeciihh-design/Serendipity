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
const evidence = verificationEvidenceDirectory("phase20-browser");
test.afterAll(async () => db.$disconnect());
async function seed(request: APIRequestContext) {
  const response = await request.post("/api/trips", { data: { originalRequest: "阶段20出发前清单隔离演练：合成旅行，未办理购票或预约。" } }); expect(response.status()).toBe(201);
  const { trip } = await response.json(), snapshot = requestFixture();
  await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } });
  await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } });
  const content = preparePlanForStorage(planFixture(snapshot));
  const museum = content.events.find((e) => e.id === "d1-activity")!; museum.title = museum.locationName = "湖南博物院";
  content.events.find((e) => e.id === "departure")!.title = "高铁去程";
  const costs = derivePlanCosts(content.events);
  const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events), costs: JSON.stringify(costs), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify(validatePlan(content, snapshot, costs)) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  return trip.id as string;
}
const panel = (page: Page) => page.getByRole("tabpanel", { name: "出发前清单", exact: true });
async function open(page: Page, id: string) { await page.goto(`/trips/${id}?view=checklist`); await expect(panel(page).getByRole("checkbox", { name: "手机、充电器与必要电量", exact: true })).toBeVisible(); }
const phone = (page: Page) => panel(page).getByRole("checkbox", { name: "手机、充电器与必要电量", exact: true });
async function saved(page: Page) { await expect(panel(page).getByRole("status")).toContainText("已保存到本机"); }

test("checklist supports responsive creation, edit, deletion, regeneration and reopen", async ({ page, request, browser }) => {
  const id = await seed(request); await fs.mkdir(evidence, { recursive: true }); await open(page, id);
  await expect(panel(page)).toContainText("不代表系统已购票、订房或完成预约");
  await phone(page).click(); await saved(page);
  await panel(page).getByRole("button", { name: "添加自建事项", exact: true }).click();
  await page.getByLabel("事项名称", { exact: true }).fill("带相机"); await page.getByLabel("关联活动", { exact: true }).selectOption("d1-activity"); await page.getByLabel("备注", { exact: true }).fill("备用电池");
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByRole("form", { name: "自建事项表单" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: path.join(evidence, "custom-form-390.png") });
  await page.getByRole("button", { name: "保存事项", exact: true }).click(); await saved(page);
  const custom = panel(page).getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: "带相机", exact: true }) });
  await custom.getByRole("button", { name: "编辑", exact: true }).click(); await page.getByLabel("事项名称", { exact: true }).fill("带相机和备用电池"); await page.getByRole("button", { name: "保存事项", exact: true }).click(); await saved(page);
  await panel(page).getByRole("checkbox", { name: "带相机和备用电池", exact: true }).click(); await saved(page);
  await panel(page).getByRole("button", { name: "按当前计划更新", exact: true }).click(); await expect(panel(page).getByRole("status")).toContainText("仍相关的勾选");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await panel(page).getByRole("heading", { name: "出发前清单", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `checklist-${width}.png`) });
  }
  await page.reload(); await expect(phone(page)).toBeChecked(); await expect(panel(page).getByRole("checkbox", { name: "带相机和备用电池", exact: true })).toBeChecked();
  const updated = panel(page).getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: "带相机和备用电池", exact: true }) });
  await updated.getByRole("button", { name: "移出", exact: true }).click(); await saved(page);
  await panel(page).getByRole("button", { name: "按当前计划更新", exact: true }).click(); await expect(panel(page).getByRole("status")).toContainText("仍相关的勾选");
  await panel(page).getByText(/已移出或关联已变化（1）/).click(); await panel(page).getByRole("button", { name: "恢复", exact: true }).click(); await saved(page);
  const fresh = await browser.newPage(); await open(fresh, id); await expect(phone(fresh)).toBeChecked(); await expect(panel(fresh).getByRole("checkbox", { name: "带相机和备用电池", exact: true })).toBeChecked(); await fresh.close();
  const row = await db.checklistState.findUniqueOrThrow({ where: { tripId: id } }); await fs.writeFile(path.join(evidence, "persisted.json"), JSON.stringify({ ...row, items: JSON.parse(row.items) }, null, 2));
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1);
});
test("rapid double click saves explicit completion once; offline failure keeps state and retries", async ({ page, request, context }) => {
  const id = await seed(request); await open(page, id); let posts = 0;
  await page.route(`**/api/trips/${id}/checklist`, async (route) => { posts++; await new Promise((resolve) => setTimeout(resolve, 250)); await route.continue(); });
  await phone(page).evaluate((el: HTMLInputElement) => { el.click(); el.click(); }); await saved(page); await expect(phone(page)).toBeChecked(); expect(posts).toBe(1);
  await page.unroute(`**/api/trips/${id}/checklist`);
  await context.setOffline(true); await phone(page).click(); await expect(panel(page).getByRole("alert")).toBeVisible(); await expect(phone(page)).toBeChecked();
  await page.screenshot({ path: path.join(evidence, "offline-save.png") });
  await context.setOffline(false); await panel(page).getByRole("button", { name: "重试刚才的保存", exact: true }).click(); await saved(page); await expect(phone(page)).not.toBeChecked();
  await page.reload(); await expect(phone(page)).not.toBeChecked();
  await phone(page).focus(); await phone(page).press("Space"); await saved(page); await expect(phone(page)).toBeChecked();
});
test("failed loading and form save preserve input; two-page conflicts require rereading", async ({ page, request, browser }) => {
  const id = await seed(request); let failedRead = false, failedSave = false;
  await page.route(`**/api/trips/${id}/checklist*`, async (route) => {
    if (route.request().method() === "GET" && !failedRead) { failedRead = true; return route.fulfill({ status: 503, json: { error: "测试读取失败" } }); }
    if (route.request().method() === "POST" && !failedSave) { failedSave = true; return route.fulfill({ status: 503, json: { error: "测试保存失败" } }); }
    return route.continue();
  });
  await page.goto(`/trips/${id}?view=checklist`); await expect(panel(page).getByRole("alert")).toContainText("测试读取失败"); await panel(page).getByRole("button", { name: "重试读取清单", exact: true }).click(); await expect(phone(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "添加自建事项", exact: true }).click(); await page.getByLabel("事项名称", { exact: true }).fill("自备眼镜"); await page.getByRole("button", { name: "保存事项", exact: true }).click(); await expect(panel(page).getByRole("alert")).toContainText("测试保存失败"); await expect(page.getByLabel("事项名称", { exact: true })).toHaveValue("自备眼镜");
  await panel(page).getByRole("button", { name: "重试刚才的保存", exact: true }).click(); await saved(page);
  const second = await browser.newPage(); await open(second, id); await phone(page).click(); await saved(page);
  await phone(second).click(); await expect(panel(second).getByRole("alert")).toContainText("其他页面"); await expect(phone(second)).not.toBeChecked();
  await panel(second).getByRole("button", { name: "重新读取清单", exact: true }).click(); await expect(phone(second)).toBeChecked(); await second.close();
});
test("links navigate to the correct event and ticket; history and cross-origin mutations are protected", async ({ page, request }) => {
  const id = await seed(request); await open(page, id);
  const reservation = panel(page).getByRole("region", { name: "预约清单", exact: true });
  await expect(reservation.getByRole("link", { name: "官方入口", exact: true })).toHaveAttribute("href", /^https:\/\/www.hnmuseum.com\//);
  await reservation.getByRole("button", { name: "相关活动", exact: true }).click(); await expect(page.getByRole("tab", { name: "每日时间轴", exact: true })).toHaveAttribute("aria-selected", "true"); await expect(page.locator("#timeline-event-d1-activity")).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 900 }); await page.getByRole("button", { name: "打开出发前清单", exact: true }).click();
  await panel(page).getByRole("button", { name: "关联票据", exact: true }).first().click(); await expect(page.getByRole("tab", { name: "门到门交通", exact: true })).toHaveAttribute("aria-selected", "true");
  const before = await request.get(`/api/trips/${id}/checklist?planVersion=1`); const view = (await before.json()).checklist;
  expect((await request.post(`/api/trips/${id}/checklist`, { headers: { Origin: "https://outside.example" }, data: {} })).status()).toBe(403);
  expect((await request.post(`/api/trips/${id}/checklist`, { data: { expectedPlanVersion: 1, expectedRevision: view.revision, expectedBasis: view.basis, change: { action: "complete", id: "essential:phone", completed: true, ticketStatus: "active" } } })).status()).toBe(400);
  const edited = await request.patch(`/api/trips/${id}/plans/1`, { data: { type: "event", eventId: "d1-rest", timeEdit: "preserve", note: "准备资料已变化", locked: false, status: "suggested", remove: false } }); expect(edited.status()).toBe(200);
  expect((await request.post(`/api/trips/${id}/checklist`, { data: { expectedPlanVersion: 1, expectedRevision: view.revision, expectedBasis: view.basis, change: { action: "sync" } } })).status()).toBe(409);
  await page.goto(`/trips/${id}?planVersion=1&view=checklist`); await expect(panel(page)).toContainText("当前准备进度不作为历史勾选展示"); await expect(panel(page).getByRole("checkbox")).toHaveCount(0);
});
