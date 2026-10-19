import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "./fixtures";
import { openRequirements, useUnavailableAI } from "./workspace-helpers";
import { emptyRequestSnapshot, type RequestSnapshot } from "../../lib/trip-request";
import { planFixture } from "../helpers/plan-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";

process.env.SERENDIPITY_DATA_DIR = assertTestDataPath(path.resolve("test-data/e2e"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
let modelServer: http.Server;
let settings: typeof import("../../lib/settings");
const evidence = verificationEvidenceDirectory("one-click-workspace");
test.use({ deviceScaleFactor: 2 });

test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
  modelServer = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const prompt: string = body.messages.at(-1).content;
    const snapshotLine = prompt.split("\n").find((line) => line.startsWith("已确认需求快照："));
    let result: unknown;
    if (snapshotLine) {
      const snapshot: RequestSnapshot = JSON.parse(snapshotLine.slice("已确认需求快照：".length));
      const plan = planFixture(snapshot);
      for (const event of plan.events) {
        if (event.type === "activity") {
          event.title = ["西湖湖畔漫步", "龙井村寻茶", "运河边的老街时光"][event.dayNumber - 1];
          event.locationName = event.title;
          event.note = "放慢脚步，沿途感受杭州的自然与日常。";
        }
        if (event.id === "departure") event.title = "出发，去杭州";
      }
      result = plan;
    } else {
      const snapshot = { ...emptyRequestSnapshot(), destination: "杭州", travelerCount: 2, budgetAmountCents: 300000, interests: ["自然风景", "老街"], constraints: ["行程轻松，注意休息"], pace: "relaxed" };
      result = { request: snapshot, openQuestions: [], defaultAssumptions: [] };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const address = modelServer.address();
  if (!address || typeof address === "string") throw new Error("Mock model unavailable");
  settings = await import("../../lib/settings");
  const config = { provider: "openai-chat-completions", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "one-click-test", apiKey: "isolated-test-key" };
  await settings.saveAIConfiguration(config, settings.createTestToken(config));
});

test.afterAll(async () => {
  await db.$disconnect();
  await settings?.closeSettingsStore();
  await new Promise<void>((resolve) => modelServer?.close(() => resolve()));
});

test("one click persists the confirmed revision and complete plan, with compact desktop and mobile views", async ({ page, request }) => {
  const calls: { path: string; data: Record<string, unknown> }[] = [];
  let releaseUnderstanding!: () => void;
  let releasePlanning!: () => void;
  const understandingGate = new Promise<void>((resolve) => { releaseUnderstanding = resolve; });
  const planningGate = new Promise<void>((resolve) => { releasePlanning = resolve; });
  await page.route("**/api/trips/*/request/extract", async (route) => { await understandingGate; await route.continue(); });
  await page.route("**/api/trips/*/plans/generate", async (route) => { await planningGate; await route.continue(); });
  page.on("request", (r) => {
    if (["POST", "PATCH"].includes(r.method()) && r.url().includes("/api/trips")) calls.push({ path: new URL(r.url()).pathname, data: r.postDataJSON() });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  const originalIdea = "我想在 11 月中旬去杭州玩三天，从上海出发。和伴侣同行，两个人预算3000元，喜欢自然风景和老街，慢慢逛。";
  await page.getByTestId("trip-request-input").fill(originalIdea);
  await page.getByTestId("create-trip-submit").click();
  try {
    await expect(page.getByTestId("trip-planning-progress")).toHaveAttribute("data-stage", "understanding");
    await expect(page.getByTestId("create-trip-submit")).toBeDisabled();
  } finally { releaseUnderstanding(); }
  try {
    await expect(page.getByTestId("trip-planning-progress")).toHaveAttribute("data-stage", "planning");
    await expect(page.getByTestId("trip-planning-progress")).toContainText("正在为你排布每日行程");
  } finally { releasePlanning(); }
  await expect(page).toHaveURL(/\/trips\/[^/?]+$/, { timeout: 30000 });
  await expect(page.getByTestId("plan-version-select")).toHaveText(/版本 V1/);
  await expect(page.getByRole("heading", { name: "杭州 · 三日轻松漫游", exact: true })).toBeVisible();
  await expect(page.getByTestId("compact-trip-header")).toContainText(originalIdea);
  await expect(page.getByTestId("compact-trip-header")).not.toContainText("需求有未保存修改");
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const row = await db.tripRequest.findUniqueOrThrow({ where: { tripId: id } });
  expect(row.requestRevision).toBe(3);
  expect(row.confirmedRevision).toBe(row.requestRevision);
  const confirmed: RequestSnapshot = JSON.parse(row.confirmedRequest!);
  expect((Date.parse(confirmed.endDate!) - Date.parse(confirmed.startDate!)) / 86400000).toBe(2);
  expect(confirmed.fieldSources.startDate).toBe("default_assumption");
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1);
  expect(calls.map((call) => call.path)).toEqual(["/api/trips", `/api/trips/${id}/request/extract`, `/api/trips/${id}/request`, `/api/trips/${id}/request/confirm`, `/api/trips/${id}/plans/generate`]);
  expect(calls.slice(1).map((call) => call.data.expectedRequestRevision)).toEqual([1, 2, 3, 3]);
  expect(calls.at(-1)!.data.expectedPlanVersion).toBeNull();

  await expect(page.locator("#trip-title")).not.toBeVisible();
  await expect(page.locator("#request-destination")).not.toBeVisible();
  await expect(page.getByText("暂无可用图片", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^第 \d+ 项：西湖湖畔漫步$/ })).toBeVisible();
  const timeline = page.getByRole("list", { name: "当日行程时间轴" });
  const companion = page.getByRole("complementary", { name: "当日伴随看板" });
  await expect(companion).toBeVisible();
  await expect(companion.getByRole("heading", { name: "今天，走过这些地方" })).toBeVisible();
  const timelineBounds = await timeline.boundingBox();
  const companionBounds = await companion.boundingBox();
  expect(companionBounds!.x).toBeGreaterThan(timelineBounds!.x + timelineBounds!.width);
  const compactBounds = await timeline.locator('li[data-timeline-level="briefing"] > div').first().boundingBox();
  const experienceBounds = await timeline.locator('li[data-timeline-level="experience"] > div').first().boundingBox();
  expect(compactBounds!.height).toBeLessThan(experienceBounds!.height * 0.6);
  await expect(timeline.getByText(/AI建议.*来源待确认/)).toHaveCount(0);
  await expect(page.getByText("暂无待处理红线", { exact: false })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(evidence, "trip-detail-desktop.png"), fullPage: true });
  const exportToggle = page.locator("summary").filter({ hasText: "导出随身资料" });
  const exportLink = page.getByRole("link", { name: "文字导出 · 复制与下载", exact: true });
  await expect(exportLink).not.toBeVisible();
  await exportToggle.click();
  for (const [name, suffix] of [["文字导出 · 复制与下载", "text"], ["手机一页版 · 离线保存", "mobile"], ["旅行长图 · 保存图片", "image"], ["PDF旅行手册 · 保存与打印", "pdf"]]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("href", `/trips/${id}/${suffix}`);
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await exportToggle.click();
  await openRequirements(page);
  await expect(page.getByRole("button", { name: "确认修订 3", exact: true })).toBeVisible();
  await page.locator("#request-destination").fill("尚未保存的杭州周边");
  await page.getByRole("button", { name: "修改需求 / 重新生成", exact: true }).click();
  await openRequirements(page);
  await expect(page.locator("#request-destination")).toHaveValue("尚未保存的杭州周边");
  await page.reload();
  await expect(page.getByTestId("plan-version-select")).toHaveText(/版本 V1/);
  await expect(page.locator("#request-destination")).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("compact-trip-header")).toBeVisible();
  await expect(page.getByRole("button", { name: /^第 \d+ 项：西湖湖畔漫步$/ })).toBeVisible();
  await expect(page.getByText("暂无可用图片")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(evidence, "trip-detail-mobile.png"), fullPage: true });
  await page.goto("/trips");
  const card = page.getByRole("article").filter({ hasText: "杭州" }).filter({ has: page.locator(`a[href="/trips/${id}"]`) });
  await expect(card).toContainText("3 天");
  await expect(card).toContainText(confirmed.startDate!.replaceAll("-", "."));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(evidence, "trips-desktop.png"), fullPage: true });
  expect((await request.get(`/api/trips/${id}/plans`)).ok()).toBe(true);
});

test("missing AI configuration preserves the saved idea while keeping requirements folded", async ({ page }) => {
  await useUnavailableAI(page);
  await page.goto("/");
  await page.getByTestId("trip-request-input").fill("去杭州玩3天，保留我的旅行想法");
  await page.getByTestId("create-trip-submit").click();
  await expect(page).toHaveURL(/\/trips\/[^/?]+\?planningNotice=/);
  await expect(page).not.toHaveURL(/editRequirements/);
  await expect(page.locator("#trip-request-original")).not.toBeVisible();
  await expect(page.locator("#request-destination")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "一键重试生成行程", exact: true })).toBeVisible();
  await expect(page.getByText(/AI 服务尚未配置/)).toBeVisible();
  await openRequirements(page);
  await expect(page.locator("#trip-request-original")).toHaveValue("去杭州玩3天，保留我的旅行想法");
  await expect(page.getByRole("button", { name: "AI 理解需求", exact: true })).toBeVisible();
  await page.goto(`${new URL(page.url()).pathname}?editRequirements=1`);
  await expect(page.locator("#request-destination")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "修改需求 / 重新生成", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("retrying an unconfirmed saved idea synchronizes the new confirmed revision and editable fields", async ({ page }) => {
  await useUnavailableAI(page);
  const original = "我想去杭州玩三天，两个人预算3000元，看看自然风景和老街。";
  await page.goto("/");
  await page.getByTestId("trip-request-input").fill(original);
  await page.getByTestId("create-trip-submit").click();
  await expect(page).toHaveURL(/\/trips\/[^/?]+\?planningNotice=/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const before = await db.tripRequest.findUniqueOrThrow({ where: { tripId: id } });
  expect(before.requestRevision).toBe(1);
  expect(before.confirmedRevision).toBeNull();

  await page.unroute("**/api/trips/*/request/extract");
  await page.getByRole("button", { name: "一键重试生成行程", exact: true }).click();
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V1");
  await expect(page.locator("#request-destination")).not.toBeVisible();
  await openRequirements(page);
  await expect(page.getByRole("heading", { name: "修订 3｜已确认", exact: true })).toBeVisible();
  await expect(page.locator("#trip-request-original")).toHaveValue(original);
  await expect(page.locator("#request-destination")).toHaveValue("杭州");
  await expect(page.locator("#request-budget")).toHaveValue("3000");
  await expect(page.locator("#request-interests")).toHaveValue("自然风景、老街");
  await expect(page.getByRole("button", { name: "确认修订 3", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "保存需求修订", exact: true })).toBeDisabled();
  await expect(page.getByText("当前计划待更新", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/最新需求已经变化/)).toHaveCount(0);
});

test("a retry refresh advances the saved revision while retaining edits typed during generation", async ({ page }) => {
  await useUnavailableAI(page);
  await page.goto("/");
  await page.getByTestId("trip-request-input").fill("我想去杭州玩三天，两个人预算3000元，喜欢自然风景和老街。" );
  await page.getByTestId("create-trip-submit").click();
  await expect(page).toHaveURL(/\/trips\/[^/?]+\?planningNotice=/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.unroute("**/api/trips/*/request/extract");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/trips/*/plans/generate", async (route) => { await gate; await route.continue(); });
  const planning = page.waitForRequest((request) => request.url().endsWith("/plans/generate"));
  await page.getByRole("button", { name: "一键重试生成行程", exact: true }).click();
  try {
    await planning;
    await openRequirements(page);
    await page.locator("#request-destination").fill("杭州与周边，尚未保存");
    await page.locator("#request-interests").fill("茶园、古街");
    await page.locator("#request-budget").fill("3456");
  } finally { release(); }
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V1");
  await openRequirements(page);
  await expect(page.getByRole("heading", { name: "修订 3｜已确认", exact: true })).toBeVisible();
  await expect(page.locator("#request-destination")).toHaveValue("杭州与周边，尚未保存");
  await expect(page.locator("#request-interests")).toHaveValue("茶园、古街");
  await expect(page.locator("#request-budget")).toHaveValue("3456");
  await expect(page.locator("#request-workspace-feedback")).toContainText("等待期间输入的内容已保留，请核对后保存并重新确认");
  await expect(page.getByRole("button", { name: "保存需求修订", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "确认修订 3", exact: true })).toBeDisabled();
  const saved = await db.tripRequest.findUniqueOrThrow({ where: { tripId: id } });
  expect(saved.confirmedRevision).toBe(3);
  expect(JSON.parse(saved.confirmedRequest!).destination).toBe("杭州");
});

test("two generation timeouts retain confirmed requirements in a folded workspace and the retry card recovers", async ({ page }) => {
  let generationCalls = 0;
  await page.route("**/api/trips/*/plans/generate", (route) => {
    generationCalls += 1;
    return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ category: "timeout", error: "AI 服务暂时不可用，请稍后重试。" }) });
  });
  await page.goto("/");
  await page.getByTestId("trip-request-input").fill("杭州玩3天，两个人预算3000元");
  await page.getByTestId("create-trip-submit").click();
  await expect(page).toHaveURL(/\/trips\/[^/?]+\?planningNotice=/);
  await expect(page).not.toHaveURL(/editRequirements/);
  await expect(page.locator("#request-destination")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "一键重试生成行程", exact: true })).toBeEnabled();
  expect(generationCalls).toBe(2);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const row = await db.tripRequest.findUniqueOrThrow({ where: { tripId: id } });
  expect(row.confirmedRevision).toBe(row.requestRevision);
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(0);
  await page.unroute("**/api/trips/*/plans/generate");
  await page.screenshot({ path: path.join(evidence, "trip-detail-timeout-recovery.png"), fullPage: true });
  await page.getByRole("button", { name: "一键重试生成行程", exact: true }).click();
  await expect(page.getByTestId("plan-version-select")).toHaveText(/版本 V1/);
  await expect(page).not.toHaveURL(/editRequirements|planningNotice/);
  await expect(page.locator("#request-destination")).not.toBeVisible();
  await expect(page.getByText(/AI 服务暂时不可用/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("plan-version-select")).toHaveText(/版本 V1/);
  await expect(page.locator("#request-destination")).not.toBeVisible();
});

test("one transient network failure silently retries generation without displaying the requirements form", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/trips/*/plans/generate", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort("timedout");
    else await route.continue();
  });
  await page.goto("/");
  await page.getByTestId("trip-request-input").fill("我想去杭州玩三天，体验西湖和老街");
  await page.getByTestId("create-trip-submit").click();
  await expect(page.getByTestId("plan-version-select")).toHaveText(/版本 V1/, { timeout: 30000 });
  await expect(page).not.toHaveURL(/planningNotice|editRequirements/);
  await expect(page.locator("#request-destination")).not.toBeVisible();
  expect(attempts).toBe(2);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1);
});

test("a lost generation response reuses the committed plan instead of writing another version", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/trips/*/plans/generate", async (route) => {
    attempts += 1;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("connectionreset");
  });
  await page.goto("/");
  await page.getByTestId("trip-request-input").fill("我想和伴侣去杭州玩三天，沿着西湖轻松散步");
  await page.getByTestId("create-trip-submit").click();
  await expect(page.getByTestId("plan-version-select")).toHaveText(/版本 V1/, { timeout: 30000 });
  await expect(page).not.toHaveURL(/planningNotice|editRequirements/);
  await expect(page.locator("#request-destination")).not.toBeVisible();
  expect(attempts).toBe(1);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(await db.planVersion.count({ where: { tripId: id } })).toBe(1);
});
