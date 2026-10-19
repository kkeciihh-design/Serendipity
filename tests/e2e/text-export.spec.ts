import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { exportFixture, PRIVATE_ADDRESS } from "../helpers/export-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
import { calculateBudgetSummary, formatMoneyRange } from "../../lib/budget";
const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const evidence = verificationEvidenceDirectory("phase25-browser");
test.beforeAll(async () => { await fs.mkdir(evidence, { recursive: true }); });
test.afterAll(async () => { await db.$disconnect(); });
async function seed(request: APIRequestContext, days = 2) {
  const s = await exportFixture(days), p = s.plan;
  p.events.find((e) => e.id === "d1-activity")!.note = '中文“旅行” & 特展 🧳 <img src=x onerror=alert(1)>';
  p.costs[0].unitAmountCents = null;
  const response = await request.post("/api/trips", { data: { originalRequest: `阶段25文字导出${days}日合成样例，无真实订单。` } }); expect(response.status()).toBe(201);
  const { trip } = await response.json();
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: p.requestSnapshot } })).ok()).toBe(true);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).ok()).toBe(true);
  const plan = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(p.requestSnapshot), events: JSON.stringify(p.events), costs: JSON.stringify(p.costs), tickets: JSON.stringify(p.tickets), pendingItems: JSON.stringify(p.pendingItems), validationResults: JSON.stringify(p.validationResults) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id, status: "planned" } });
  await db.evidenceFact.create({ data: { tripId: trip.id, planVersionId: plan.id, targetType: "event", targetId: "d1-activity", field: "reservation", status: "unverified", evaluationVersion: 1,
    sourceTitle: "合成场馆预约公告", sourcePublisher: "测试场馆", sourceUrl: "https://example.invalid/synthetic", extractedValue: "特展需预约，名额待确认", searchProvider: "synthetic", searchQuery: "合成测试", retrievedAt: new Date(s.generatedAt), applicableFrom: new Date(`${p.requestSnapshot.startDate}T00:00:00+08:00`), applicableUntil: new Date(`${p.requestSnapshot.endDate}T23:59:59+08:00`), contentQuote: "合成来源，不能作为实际出行依据" } });
  const checklist = await (await request.get(`/api/trips/${trip.id}/checklist?planVersion=1`)).json();
  const view = checklist.checklist ?? checklist;
  expect((await request.post(`/api/trips/${trip.id}/checklist`, { data: { expectedPlanVersion: 1, expectedRevision: view.revision, expectedBasis: view.basis, change: { action: "complete", id: view.items[0].id, completed: true } } })).ok()).toBe(true);
  const budget = calculateBudgetSummary(p.costs, p.requestSnapshot);
  return { id: trip.id as string, snapshot: p.requestSnapshot, money: formatMoneyRange(budget.totalMinCents, budget.totalMaxCents) };
}
async function generate(page: Page, id: string) {
  await page.goto(`/trips/${id}/text`);
  await page.getByRole("button", { name: "生成文字预览" }).click();
  await expect(page.getByLabel("导出文字")).toBeVisible();
  return page.getByLabel("导出文字").inputValue();
}
for (const days of [2, 4]) test(`${days} days: real clipboard paste, UTF-8 downloads, layouts and reopen match the saved snapshot`, async ({ page, request, context, browser }) => {
  const trip = await seed(request, days);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const text = await generate(page, trip.id);
  for (const value of ["22:55", "前一天", "4 人", "1500 元", trip.money, "1 项金额待确认", "已确认", '中文“旅行” & 特展 🧳', "停止检票", "车票待确认", "用户已确认票面", "合成场馆预约公告", "建议确认", "特展需预约"]) expect(text).toContain(value);
  expect(text).not.toContain(PRIVATE_ADDRESS); expect(text).not.toContain("08车06A");
  expect(await page.locator("main img").count()).toBe(0);
  await page.getByRole("button", { name: "复制全文", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已复制完整纯文字");
  // Windows clipboard uses CRLF; textarea and UTF-8 files use LF.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe(text);
  // A local test paste target receives the real keyboard paste; nothing is sent.
  await page.evaluate(() => { const target = document.createElement("textarea"); target.id = "paste-check"; document.body.append(target); });
  await page.locator("#paste-check").focus(); await page.keyboard.press("Control+V");
  await expect(page.locator("#paste-check")).toHaveValue(text);
  await fs.writeFile(path.join(evidence, `${days}days-pasted.txt`), await page.locator("#paste-check").inputValue(), "utf8");
  await page.locator("#paste-check").evaluate((el) => el.remove());
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("region", { name: "文字预览", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `${days}days-${width}.png`), fullPage: true });
  }
  const downloaded = page.waitForEvent("download"); await page.getByRole("link", { name: "下载 .txt", exact: true }).click();
  const download = await downloaded, output = path.join(evidence, `${days}days.txt`); await download.saveAs(output);
  expect(new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(output))).toBe(text);
  const { files } = await (await request.get(`/api/trips/${trip.id}/exports?kind=text`)).json(), file = files[0];
  const response = await request.get(`/api/trips/${trip.id}/exports/${file.id}`);
  expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8"); expect(response.headers()["content-security-policy"]).toContain("sandbox");
  expect(createHash("sha256").update(await fs.readFile(output)).digest("hex")).toBe(file.sha256);
  await page.reload(); await expect(page.getByLabel("导出文字")).toHaveValue(text);
  const reopened = await browser.newPage(); await reopened.goto(`/trips/${trip.id}/text`); await expect(reopened.getByLabel("导出文字")).toHaveValue(text); await reopened.close();
  await page.getByLabel("文字格式").selectOption("markdown");
  await expect(page.getByText(/选项与当前文件不同/)).toBeVisible(); await expect(page.getByRole("link", { name: "下载 .txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成文字预览" }).click(); await expect(page.getByRole("link", { name: "下载 .md", exact: true })).toBeVisible();
  const md = await page.getByLabel("导出文字").inputValue(); expect(md).toContain("## 关键时间红线"); expect(md).toContain("- [x] 已确认");
  await page.getByRole("button", { name: "复制全文", exact: true }).click(); await expect(page.getByRole("status")).toContainText("已复制完整Markdown"); expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe(md);
  const mdDownload = page.waitForEvent("download"); await page.getByRole("link", { name: "下载 .md", exact: true }).click(); await (await mdDownload).saveAs(path.join(evidence, `${days}days.md`));
  expect(await fs.readFile(path.join(evidence, `${days}days.md`), "utf8")).toBe(md);
  await fs.writeFile(path.join(evidence, `synthetic-${days}days.json`), JSON.stringify(await db.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { request: true, currentPlanVersion: true, checklist: true, execution: true } }), null, 2));
  await fs.writeFile(path.join(evidence, `synthetic-${days}days-facts.json`), JSON.stringify(await db.evidenceFact.findMany({ where: { tripId: trip.id } }), null, 2));
  await fs.writeFile(path.join(evidence, `${days}days-result.json`), JSON.stringify({ browser: await browser.version(), actualClipboardAndKeyboardPaste: true, format: ["plain-text", "markdown"], days, budget: trip.money, file, utf8Exact: true }, null, 2));
});
test("clipboard rejection and unavailable API preserve select-all and download; failed generation recovers", async ({ page, request }) => {
  const trip = await seed(request), text = await generate(page, trip.id);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")) }));
  await page.getByRole("button", { name: "复制全文", exact: true }).click(); await expect(page.getByRole("status")).toContainText("权限被拒绝");
  expect(await page.getByLabel("导出文字").evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBe(text.length);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
  await page.getByRole("button", { name: "复制全文", exact: true }).click(); await expect(page.getByRole("status")).toContainText("自动复制不可用");
  await page.getByRole("button", { name: "全选文字", exact: true }).click();
  expect(await page.getByLabel("导出文字").evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBe(text.length);
  const download = page.waitForEvent("download"); await page.getByRole("link", { name: "下载 .txt", exact: true }).click(); await (await download).saveAs(path.join(evidence, "clipboard-denied.txt"));
  expect(await fs.readFile(path.join(evidence, "clipboard-denied.txt"), "utf8")).toBe(text);
  await page.screenshot({ path: path.join(evidence, "clipboard-denied.png"), fullPage: true });
  await page.route(`**/api/trips/${trip.id}/exports`, (r) => r.request().method() === "POST" ? r.fulfill({ status: 503, json: { error: "模拟存储失败，请重试" } }) : r.continue());
  await page.getByRole("button", { name: "生成文字预览" }).click(); await expect(page.getByRole("main").getByRole("alert")).toContainText("模拟存储失败"); await expect(page.getByLabel("导出文字")).toHaveValue(text);
  expect(await db.exportFile.count({ where: { tripId: trip.id } })).toBe(1);
  await page.unroute(`**/api/trips/${trip.id}/exports`); await page.getByRole("button", { name: "生成文字预览" }).click();
  await expect(page.getByRole("region", { name: "文字导出记录" }).getByRole("button")).toHaveCount(2);
});
test("T29 stale requirements, single-day privacy opt-in, history selection and HTML isolation", async ({ page, request }) => {
  const trip = await seed(request, 4);
  await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 2, request: { ...trip.snapshot, startDate: "2040-01-01", endDate: "2040-01-04", travelerCount: 20, budgetAmountCents: 900000 } } });
  const old = await generate(page, trip.id); expect(old).toContain("计划待更新"); expect(old).toContain("4 人"); expect(old).not.toContain("2040");
  await page.getByLabel("导出日期").selectOption(trip.snapshot.startDate!); await page.getByLabel("包含私人起终点地址").check(); await page.getByLabel("包含票面座位").check();
  await page.getByRole("button", { name: "生成文字预览" }).click();
  await expect(page.getByLabel("导出文字")).toHaveValue(new RegExp(PRIVATE_ADDRESS));
  const opted = await page.getByLabel("导出文字").inputValue(); expect(opted).toContain("08车06A"); expect(opted).not.toContain("第 2 天"); expect(opted).toContain("不是所选日期小计"); expect(opted).toContain("22:55");
  await page.getByRole("region", { name: "文字导出记录" }).getByRole("button").last().click(); await expect(page.getByLabel("导出文字")).toHaveValue(old);
  const html = await request.post(`/api/trips/${trip.id}/exports`, { data: { expectedPlanVersion: 1, options: {} } }); expect(html.status()).toBe(201);
  const panel = await (await request.get(`/api/trips/${trip.id}/exports`)).json(); expect(panel.files).toHaveLength(1); expect(panel.files[0].format).toBe("mobile-html");
  await page.goto(`/trips/${trip.id}/mobile`); await expect(page.getByRole("link", { name: "下载此 HTML" })).toBeVisible();
  expect((await (await request.get(`/api/trips/${trip.id}/exports?kind=text`)).json()).files).toHaveLength(2);
  await fs.writeFile(path.join(evidence, "stale-request.txt"), opted, "utf8");
});
test("empty state, API validation, stale versions, access isolation and application-only deletion", async ({ page, request }) => {
  const empty = (await (await request.post("/api/trips", { data: { originalRequest: "没有计划的文字导出测试" } })).json()).trip;
  await page.goto(`/trips/${empty.id}/text`); await expect(page.getByText("还没有已保存的计划，请返回旅行先生成。")).toBeVisible(); await expect(page.getByRole("button", { name: "生成文字预览" })).toBeDisabled();
  const trip = await seed(request), url = `/api/trips/${trip.id}/exports`;
  for (const data of [{ format: "docx", expectedPlanVersion: 1, options: {} }, { format: "plain-text", expectedPlanVersion: 99, options: {} }, { format: "markdown", expectedPlanVersion: 1, options: { includeSeats: "false" } }, { format: "plain-text", expectedPlanVersion: 1, options: { dates: ["1999-01-01"] } }]) expect((await request.post(url, { data })).status()).toBeGreaterThanOrEqual(400);
  expect((await request.post(url, { headers: { Origin: "https://foreign.invalid" }, data: { format: "plain-text", expectedPlanVersion: 1, options: {} } })).status()).toBe(403);
  expect((await request.get(`${url}?kind=text`, { headers: { Host: "untrusted.invalid" } })).status()).toBe(401);
  expect(await db.exportFile.count({ where: { tripId: trip.id } })).toBe(0);
  const { file } = await (await request.post(url, { data: { format: "markdown", expectedPlanVersion: 1, options: {} } })).json();
  expect((await request.get(`/api/trips/${empty.id}/exports/${file.id}`)).status()).toBe(404);
  const output = await request.get(`${url}/${file.id}?download=1`); expect(output.headers()["content-type"]).toBe("text/markdown; charset=utf-8"); expect(output.headers()["content-disposition"]).toContain("attachment"); expect(output.headers()["x-content-type-options"]).toBe("nosniff");
  const filePath = path.join(evidence, "survives-deletion.md"); await fs.writeFile(filePath, await output.text());
  expect((await request.delete(`/api/trips/${trip.id}`)).ok()).toBe(true); expect((await request.get(`${url}/${file.id}`)).status()).toBe(404); expect((await fs.stat(filePath)).size).toBeGreaterThan(1000);
});
