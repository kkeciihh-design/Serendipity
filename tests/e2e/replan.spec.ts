import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
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
const evidence = verificationEvidenceDirectory("phase22-browser");
let server: http.Server, settings: typeof import("../../lib/settings");
let releaseExecutionModel: (() => void) | null = null;
test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()), prompt: string = body.messages.at(-1).content;
    if (prompt.includes("用户变化=执行并发演练")) await new Promise<void>((resolve) => { releaseExecutionModel = resolve; });
    const remove = prompt.includes("用户变化=不去"), late = prompt.includes("用户变化=晚起"), requirement = prompt.includes("用户变化=改去");
    const proposal = { requirementChange: requirement ? "目的地发生变化" : null, edits: requirement ? [] : [{ eventId: late ? "d2-breakfast" : "d2-activity", remove,
      fields: remove ? {} : late ? { startTime: "09:00", endTime: "09:30" } : { title: "室内展览", locationName: "室内展馆", costDraftCents: prompt.includes("用户变化=M1超预算") ? 200000 : 3000 } }] };
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposal) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No model server");
  settings = await import("../../lib/settings");
  const config = { provider: "openai-chat-completions", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "phase22-mock", apiKey: "isolated-test-only" };
  await settings.saveAIConfiguration(config, settings.createTestToken(config));
});
test.afterAll(async () => { await db.$disconnect(); await settings?.closeSettingsStore(); await new Promise<void>((resolve) => server?.close(() => resolve())); });
async function seed(request: APIRequestContext, constraint?: string) {
  const response = await request.post("/api/trips", { data: { originalRequest: "阶段22合成旅行，仅用于自动测试。" } }); expect(response.status()).toBe(201);
  const { trip } = await response.json(), snapshot = requestFixture();
  // Match the request form's saved list format; raw mixed-clause strings are
  // separately covered by the parser and service integration tests.
  if (constraint) { snapshot.constraints = constraint.split(/[、,，;]/).map((item) => item.trim()).filter(Boolean); snapshot.budgetAmountCents = 100000; }
  await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } });
  await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } });
  const content = preparePlanForStorage(planFixture(snapshot)), costs = derivePlanCosts(content.events);
  const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(content.events), costs: JSON.stringify(costs), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify(validatePlan(content, snapshot, costs)) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } }); return trip.id as string;
}
const panel = (page: Page) => page.getByRole("tabpanel", { name: "AI 重新规划", exact: true });
async function open(page: Page, id: string) { await page.goto(`/trips/${id}?view=replan`); await expect(panel(page).getByLabel("这次想怎么调整？")).toBeVisible(); }
async function preview(page: Page, reason: string) { await panel(page).getByLabel("这次想怎么调整？").fill(reason); await panel(page).getByRole("button", { name: "生成调整预览", exact: true }).click(); await expect(panel(page).getByTestId("replan-preview")).toBeVisible(); }

for (const constraint of ["总预算不超过1000元。最好少走路", "最好少走路，总预算控制在1000元以内"]) {
  test(`M1 hard budget blocks the 2216-yuan preview: ${constraint}`, async ({ page, request }) => {
    const id = await seed(request, constraint); await open(page, id);
    await panel(page).getByLabel("这次想怎么调整？").fill("M1超预算");
    await panel(page).getByRole("button", { name: "生成调整预览", exact: true }).click();
    await expect(panel(page).getByRole("status")).toContainText("明确预算上限");
    await expect(panel(page).getByTestId("replan-preview")).toHaveCount(0);
    expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1);
    expect(await db.replanCandidate.count({ where: { tripId: id } })).toBe(0);
  });
}

for (const constraint of ["总预算尽量不超过1000元", "总预算1000元左右"]) {
  test(`M1 soft budget warns and permits reviewed application: ${constraint}`, async ({ page, request }) => {
    const id = await seed(request, constraint); await open(page, id); await preview(page, "M1超预算");
    await expect(panel(page).getByTestId("replan-preview")).toContainText("预算");
    await panel(page).getByRole("button", { name: "确认应用这份方案", exact: true }).click();
    await expect(panel(page).getByRole("button", { name: "预览撤销上次调整", exact: true })).toBeVisible();
    expect(await db.planVersion.count({ where: { tripId: id } })).toBe(2);
  });
}
test("rain, late and removal each apply through one version and persist across browser reopen", async ({ page, request, browser }) => {
  await fs.mkdir(evidence, { recursive: true });
  for (const reason of ["下雨了", "晚起一小时", "不去这个景点"]) {
    const id = await seed(request); await open(page, id); await preview(page, reason);
    if (reason === "下雨了") for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 }); await panel(page).getByTestId("replan-preview").evaluate((e) => e.scrollIntoView({ block: "start" }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: path.join(evidence, `replan-${width}.png`) });
    }
    await page.reload(); await expect(panel(page).getByTestId("replan-preview")).toBeVisible();
    await panel(page).getByRole("button", { name: "确认应用这份方案", exact: true }).click();
    await expect(panel(page).getByRole("button", { name: "预览撤销上次调整", exact: true })).toBeVisible();
    const current = await db.trip.findUniqueOrThrow({ where: { id } }), p = await db.planVersion.findUniqueOrThrow({ where: { id: current.currentPlanVersionId! } });
    expect(p.versionNumber).toBe(2); expect(p.requestRevision).toBe(2);
    expect((await request.get(`/api/trips/${id}/checklist?planVersion=2`)).status()).toBe(200);
    expect((await request.get(`/api/trips/${id}/advisories?planVersion=2`)).status()).toBe(200);
    const reopened = await browser.newPage(); await open(reopened, id); await expect(panel(reopened).getByRole("button", { name: "预览撤销上次调整", exact: true })).toBeVisible(); await reopened.close();
    await panel(page).getByRole("button", { name: "预览撤销上次调整", exact: true }).click(); await expect(panel(page).getByTestId("replan-preview")).toContainText("撤销预览");
    await panel(page).getByRole("button", { name: "确认应用这份方案", exact: true }).click(); await expect(panel(page).getByTestId("replan-preview")).toHaveCount(0);
    expect(await db.planVersion.count({ where: { tripId: id } })).toBe(3);
  }
});
test("cancel, duplicate click, offline failure and input recovery do not lose the plan", async ({ page, request, context }) => {
  const id = await seed(request); await open(page, id); await preview(page, "下雨了");
  await panel(page).getByRole("button", { name: "取消这份候选", exact: true }).click(); await expect(panel(page).getByTestId("replan-preview")).toHaveCount(0);
  let posts = 0; await page.route(`**/api/trips/${id}/replan`, async (route) => { if (route.request().method() === "POST") posts++; await route.continue(); });
  await panel(page).getByRole("button", { name: "生成调整预览", exact: true }).evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
  await expect(panel(page).getByTestId("replan-preview")).toBeVisible(); expect(posts).toBe(1); await page.unroute(`**/api/trips/${id}/replan`);
  await context.setOffline(true); await panel(page).getByRole("button", { name: "确认应用这份方案", exact: true }).click(); await expect(panel(page).getByRole("status")).toBeVisible();
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1); await context.setOffline(false);
  await panel(page).getByRole("button", { name: "重新读取", exact: true }).click(); await expect(panel(page).getByTestId("replan-preview")).toBeVisible();
  await expect(panel(page).getByLabel("这次想怎么调整？")).toHaveValue("下雨了");
});
test("changed checklist reopens preview, changed request rejects it and requirement edits link to confirmation", async ({ page, request }) => {
  const id = await seed(request); await open(page, id); await preview(page, "下雨了");
  const { checklist } = await (await request.get(`/api/trips/${id}/checklist?planVersion=1`)).json();
  await request.post(`/api/trips/${id}/checklist`, { data: { expectedPlanVersion: 1, expectedRevision: checklist.revision, expectedBasis: checklist.basis, change: { action: "complete", id: "essential:phone", completed: true } } });
  await panel(page).getByRole("button", { name: "确认应用这份方案", exact: true }).click(); await expect(panel(page).getByRole("status")).toContainText("再次核对");
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1);
  const req = await db.tripRequest.findUniqueOrThrow({ where: { tripId: id } }); const snapshot = JSON.parse(req.confirmedRequest!); snapshot.travelerCount = 3;
  await request.patch(`/api/trips/${id}/request`, { data: { expectedRequestRevision: 2, request: snapshot } });
  await panel(page).getByRole("button", { name: "确认应用这份方案", exact: true }).click(); await expect(panel(page).getByRole("status")).toContainText("确认");
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1);
  const second = await seed(request); await open(page, second); await panel(page).getByLabel("这次想怎么调整？").fill("改去上海"); await panel(page).getByRole("button", { name: "生成调整预览", exact: true }).click();
  await expect(panel(page).getByRole("link", { name: "修改并确认旅行需求", exact: true })).toBeVisible();
});
test("API rejects foreign origins, client snapshots and forged revision updates", async ({ request }) => {
  const id = await seed(request);
  expect((await request.post(`/api/trips/${id}/replan`, { headers: { Origin: "https://outside.example" }, data: {} })).status()).toBe(403);
  expect((await request.post(`/api/trips/${id}/replan`, { data: { action: "preview", reason: "下雨了", expectedPlanVersion: 1, expectedRequestRevision: 2, requestSnapshot: {} } })).status()).toBe(400);
  const r = await request.post(`/api/trips/${id}/replan`, { data: { action: "preview", reason: "下雨了", expectedPlanVersion: 1, expectedRequestRevision: 2 } }); expect(r.status()).toBe(200); const { candidate } = await r.json();
  expect((await request.post(`/api/trips/${id}/replan`, { data: { action: "apply", candidateId: candidate.id, expectedCandidateRevision: candidate.revision, expectedPlanVersion: 2 } })).status()).toBe(400);
});
test("execution completion in another browser page invalidates a model response still in flight", async ({ page, request, context }) => {
  const id = await seed(request), executionPage = await context.newPage();
  await executionPage.goto(`/trips/${id}/execute`); await executionPage.getByRole("button", { name: "开始旅行", exact: true }).click();
  await expect(executionPage.getByRole("button", { name: "完成这一步", exact: true })).toBeEnabled();
  await open(page, id); await panel(page).getByLabel("这次想怎么调整？").fill("执行并发演练，下雨调整明天的活动");
  await panel(page).getByRole("button", { name: "生成调整预览", exact: true }).click();
  try {
    await expect.poll(() => Boolean(releaseExecutionModel)).toBe(true);
    await executionPage.getByRole("button", { name: "完成这一步", exact: true }).click();
    await expect(executionPage.getByText(/已完成 1 \//)).toBeVisible();
  } finally { releaseExecutionModel?.(); releaseExecutionModel = null; }
  await expect(panel(page).getByRole("status")).toContainText("执行进度");
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1);
  expect(await db.replanCandidate.count({ where: { tripId: id } })).toBe(0);
  await executionPage.close();
});
