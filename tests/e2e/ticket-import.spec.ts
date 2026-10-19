import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";
import { preparePlanForStorage } from "../../lib/plan";
import { derivePlanCosts } from "../../lib/budget";
import type { Ticket } from "../../lib/tickets";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";

process.env.SERENDIPITY_DATA_DIR = path.resolve("test-data/e2e");
const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const ids: string[] = [];
const evidence = verificationEvidenceDirectory("phase16");
const samples = path.resolve("test-data/phase16-samples");
test.use({ actionTimeout: 10_000 });
test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
  try { await fs.access(path.join(samples, "normal.png")); }
  catch { execFileSync(process.execPath, ["scripts/create-phase16-samples.mjs"], { windowsHide: true }); }
});
test.afterAll(async () => { await prisma.trip.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); });

async function seed(request: APIRequestContext) {
  const response = await request.post("/api/trips", { data: { originalRequest: "阶段16匿名合成票图演练：深圳到长沙，两人同行，不是实际购票。" } });
  expect(response.status()).toBe(201);
  const { trip } = await response.json(); ids.push(trip.id);
  const snapshot = requestFixture(2, { startDate: "2026-10-29", endDate: "2026-10-30" });
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).status()).toBe(200);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).status()).toBe(200);
  const content = preparePlanForStorage(planFixture(snapshot));
  const plan = await prisma.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(content.events), costs: JSON.stringify(derivePlanCosts(content.events)), pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }) } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id, status: "planned" } });
  return trip.id as string;
}
async function current(id: string) { return prisma.planVersion.findFirstOrThrow({ where: { tripId: id }, orderBy: { versionNumber: "desc" } }); }
async function open(page: Page, id: string) { await page.goto(`/trips/${id}`); await page.getByRole("tab", { name: "门到门交通", exact: true }).click(); }
const panel = (page: Page) => page.getByRole("region", { name: "去程交通", exact: true }).getByRole("region", { name: "截图导入", exact: true });
async function choose(page: Page, name = "normal.png") {
  const importer = panel(page);
  if (await importer.getByRole("button", { name: "导入高铁票截图", exact: true }).count()) await importer.getByRole("button", { name: "导入高铁票截图", exact: true }).click();
  await importer.locator('input[type="file"]').setInputFiles(path.join(samples, name));
  await expect(importer.getByRole("img", { name: "本机票图裁剪预览" })).toBeVisible();
  return importer;
}
async function recognize(page: Page, name = "normal.png") {
  const importer = await choose(page, name);
  const pending = page.waitForResponse((r) => r.url().endsWith("/api/ticket-import"));
  await importer.getByRole("button", { name: "识别选中区域" }).click();
  const response = await pending; expect(response.status(), await response.text()).toBe(200);
  await expect(importer.getByText("识别完成 · 等待核对")).toBeVisible();
  return importer;
}
async function review(page: Page, mode = "new", id?: string) {
  await panel(page).getByLabel("这张截图用于").selectOption(mode);
  if (id) await panel(page).getByLabel("指定原票", { exact: true }).selectOption(id);
  await panel(page).getByRole("button", { name: "修正并核对票面" }).click();
  return page.getByRole("region", { name: "手工票面", exact: true });
}
async function confirm(page: Page, replacement = false) {
  const editor = page.getByRole("region", { name: "手工票面", exact: true });
  await editor.getByRole("checkbox", { name: replacement ? "我已办妥改签 / 换票，并核对指定原票和新票" : "我已核对票面，确认这是已购有效票", exact: true }).check();
  const pending = page.waitForResponse((r) => r.url().endsWith("/tickets") && r.request().method() === "POST");
  await editor.getByRole("button", { name: replacement ? "确认替换指定票" : "确认票面并保存", exact: true }).click();
  return pending;
}

test("real OCR crop, correction, retry, confirmation, cleanup and reopen persistence", async ({ page, request, context }) => {
  test.setTimeout(120_000);
  const id = await seed(request); await open(page, id);
  const importer = await choose(page);
  await importer.getByLabel("左边界（%）").fill("2"); await importer.getByLabel("右边界（%）").fill("98");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/ticket-import"));
  const done = page.waitForResponse((r) => r.url().endsWith("/api/ticket-import"));
  await importer.getByRole("button", { name: "识别选中区域" }).click();
  const body = (await sent).postDataJSON(); expect(Object.keys(body)).toEqual(["image"]);
  const transmitted = Buffer.from(body.image.split(",")[1], "base64");
  const originalMeta = await sharp(path.join(samples, "normal.png")).metadata(); const sentMeta = await sharp(transmitted).metadata();
  expect(sentMeta.width).toBe(Math.round(originalMeta.width! * 0.96)); expect(sentMeta.exif).toBeUndefined();
  expect((await done).status()).toBe(200); expect((await current(id)).versionNumber).toBe(1);
  const editor = await review(page);
  await expect(editor.getByLabel("出发站点 / 机场", { exact: true })).toHaveValue("深圳北");
  await expect(editor.getByLabel("到达日期", { exact: true })).toHaveValue("2026-10-29");
  await expect(editor.getByLabel("座位 / 车厢", { exact: true })).toHaveValue("05车08A");
  await editor.getByText("门到门接驳（可稍后补充）", { exact: true }).click();
  await editor.getByLabel("门到门起点", { exact: true }).fill("深圳公共地标（合成）");
  await editor.getByRole("combobox", { name: "前段接驳方式", exact: true }).selectOption("walking");
  await editor.getByLabel("前段接驳总耗时（分钟）", { exact: true }).fill("20");
  await expect(editor.getByRole("button", { name: "确认票面并保存" })).toBeDisabled();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `import-review-${width}.png`), fullPage: true });
    await importer.screenshot({ path: path.join(evidence, `crop-panel-${width}.png`) });
  }
  await page.route("**/tickets", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "合成提交失败" }) }));
  expect((await confirm(page)).status()).toBe(503);
  await expect(page.getByText(/合成提交失败.*输入已保留/)).toBeVisible(); expect((await current(id)).versionNumber).toBe(1);
  await page.unroute("**/tickets"); expect((await confirm(page)).status()).toBe(200);
  await expect(importer.getByRole("img")).toHaveCount(0);
  const saved = await current(id); const tickets = JSON.parse(saved.tickets) as Ticket[];
  expect(tickets).toHaveLength(1); expect(tickets[0]).toMatchObject({ status: "active", seat: "05车08A", importSource: { engine: "tesseract-local" } });
  expect(saved.tickets).not.toMatch(/data:image|base64|traineddata/);
  const manualId = await seed(request);
  expect((await request.post(`/api/trips/${manualId}/plans/1/tickets`, { data: { action: "activate", ticket: tickets[0], acknowledged: true } })).status()).toBe(200);
  const importedRedlines = await (await request.get(`/api/trips/${id}/plans/2/redlines`)).json();
  const manualRedlines = await (await request.get(`/api/trips/${manualId}/plans/2/redlines`)).json();
  expect(importedRedlines.redlines[0].suggestedAt).not.toBeNull();
  expect(importedRedlines.redlines[0].suggestedAt).toBe(manualRedlines.redlines[0].suggestedAt);
  expect(importedRedlines.redlines[0].precision).toBe(manualRedlines.redlines[0].precision);
  await fs.writeFile(path.join(evidence, "real-ocr-manual-redline.json"), JSON.stringify({ provenance: "Real local OCR of anonymous sample, then confirmed through the shared HTTP API; identical manual ticket comparison", fields: tickets[0], imported: importedRedlines.redlines[0], manual: manualRedlines.redlines[0] }, null, 2));
  await page.reload(); await page.getByRole("tab", { name: "门到门交通", exact: true }).click(); await expect(page.getByText("票据 1 · G6012", { exact: true })).toBeVisible();
  const other = await context.newPage(); await open(other, id); await expect(other.getByText("票据 1 · G6012", { exact: true })).toBeVisible(); await other.close();
  const snapshot = await prisma.trip.findUniqueOrThrow({ where: { id }, include: { request: true, currentPlanVersion: true } });
  await fs.writeFile(path.join(evidence, "synthetic-demo.json"), JSON.stringify(snapshot, null, 2));
  await fs.writeFile(path.join(evidence, "crop-and-persistence.json"), JSON.stringify({ originalSize: [originalMeta.width, originalMeta.height], sentSize: [sentMeta.width, sentMeta.height], planVersion: saved.versionNumber, imageStored: false, refreshAndReopen: "passed", provenance: "synthetic" }, null, 2));
});

test("same image skipped, companion kept and selected replacement/refund reuse shared fact panels", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = await seed(request); await open(page, id);
  await recognize(page); await review(page); expect((await confirm(page)).status()).toBe(200);
  const first = (JSON.parse((await current(id)).tickets) as Ticket[])[0];
  let importer = await recognize(page); await expect(importer.getByText(/相同图片/)).toBeVisible();
  await importer.getByLabel("这张截图用于").selectOption("same"); await importer.getByRole("button", { name: "跳过重复票" }).click(); expect((await current(id)).versionNumber).toBe(2);
  await recognize(page); const companionForm = await review(page, "companion");
  await companionForm.getByLabel("座位 / 车厢").fill("05车08B"); await companionForm.getByLabel("每人票价（元）").fill("");
  expect((await confirm(page)).status()).toBe(200);
  const before = await current(id); const companion = (JSON.parse(before.tickets) as Ticket[])[1];
  await recognize(page, "change.png"); await expect(panel(page).getByText(/检测到改签资料/)).toBeVisible();
  await review(page, "replacement", first.id);
  await expect(page.getByRole("region", { name: "手工票面", exact: true }).getByText("指定原票 · 将记为已替换")).toBeVisible();
  expect((await confirm(page, true)).status()).toBe(200);
  let row = await current(id); let tickets = JSON.parse(row.tickets) as Ticket[];
  expect(tickets.find((t) => t.id === companion.id)).toEqual(companion); expect(tickets.find((t) => t.id === first.id)?.status).toBe("replaced");
  const replacement = tickets.find((t) => t.id === tickets[0].replacedByTicketId)!;
  importer = await recognize(page, "refund.png"); await expect(importer.getByText(/检测到退票资料/)).toBeVisible();
  await importer.getByLabel("这张截图用于").selectOption("refund"); await importer.getByLabel("指定原票", { exact: true }).selectOption(replacement.id);
  await importer.getByRole("button", { name: "前往退票事实确认" }).click();
  const refund = page.getByRole("region", { name: "退票事实确认", exact: true });
  await refund.getByRole("button", { name: "取消操作" }).click(); expect((await current(id)).versionNumber).toBe(row.versionNumber);
  await importer.getByRole("button", { name: "前往退票事实确认" }).click();
  await refund.getByRole("checkbox", { name: "我已在官方平台办妥这张票的退票" }).check();
  await refund.getByRole("button", { name: "确认记录退票" }).click();
  await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V5");
  row = await current(id); tickets = JSON.parse(row.tickets);
  expect(tickets.find((t) => t.id === replacement.id)?.status).toBe("cancelled"); expect(tickets.find((t) => t.id === companion.id)).toEqual(companion);
  const redlines = await (await request.get(`/api/trips/${id}/plans/5/redlines`)).json(); expect(redlines.redlines).toHaveLength(1);
});

test("missing fields, rotation, cancel before recognition and late response do not change facts", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = await seed(request); await open(page, id);
  let importer = await recognize(page, "missing.png"); let editor = await review(page);
  await expect(editor.getByLabel("出发日期", { exact: true })).toHaveValue(""); await expect(editor.getByLabel("每人票价（元）")).toHaveValue("");
  await importer.getByRole("button", { name: "关闭并清除票图" }).click(); await expect(editor).toHaveCount(0); expect((await current(id)).versionNumber).toBe(1);
  importer = await choose(page, "rotated.png");
  for (let i = 0; i < 3; i++) await importer.getByRole("button", { name: "顺时针旋转 90°" }).click();
  await importer.getByRole("button", { name: "识别选中区域" }).click(); await expect(importer.getByText("识别完成 · 等待核对")).toBeVisible();
  editor = await review(page); await expect(editor.getByLabel("车次 / 航班号")).toHaveValue("G6012");
  await importer.getByRole("button", { name: "关闭并清除票图" }).click();
  await page.route("**/api/ticket-import", async (route) => { await new Promise((resolve) => setTimeout(resolve, 300)); await route.fulfill({ status: 503, body: "{}" }).catch(() => {}); });
  importer = await choose(page); await importer.getByRole("button", { name: "识别选中区域" }).click(); await importer.getByRole("button", { name: "取消识别" }).click();
  await expect(importer.getByText("识别已取消，计划没有改变。")).toBeVisible(); expect((await current(id)).tickets).toBe("[]");
  await page.unroute("**/api/ticket-import");
});

test("HTTP rejects untrusted, wrong MIME, broken and oversized images, serves real JPEG/WebP without caching", async ({ request, playwright }) => {
  test.setTimeout(120_000);
  const anonymous = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  expect((await anonymous.post("/api/ticket-import", { data: {} })).status()).toBe(403); await anonymous.dispose();
  for (const image of ["data:image/png;base64,PHN2Zy8+", "data:image/gif;base64,R0lG", "not an image"]) expect((await request.post("/api/ticket-import", { data: { image } })).status()).toBe(400);
  expect((await request.post("/api/ticket-import", { data: { image: `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}` } })).status()).toBe(413);
  for (const format of ["jpg", "webp"]) {
    const response = await request.post("/api/ticket-import", { data: { image: `data:image/${format === "jpg" ? "jpeg" : format};base64,${(await fs.readFile(path.join(samples, `normal.${format}`))).toString("base64")}` } });
    expect(response.status(), await response.text()).toBe(200); expect(response.headers()["cache-control"]).toBe("no-store");
    expect((await response.json()).draft.segments[0].fields.serviceNumber).toBe("G6012");
  }
});

test("temporary images expire with their review, and return imports use the return event", async ({ page, request }) => {
  const id = await seed(request); await open(page, id); await page.clock.install();
  const importer = await recognize(page); await review(page);
  await page.clock.fastForward(30 * 60_000 + 100);
  await expect(importer.getByRole("img")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "手工票面", exact: true })).toHaveCount(0);
  expect((await current(id)).versionNumber).toBe(1);
  await page.getByRole("button", { name: "返程", exact: true }).click();
  const returnPanel = page.getByRole("region", { name: "返程交通", exact: true }).getByRole("region", { name: "截图导入", exact: true });
  await returnPanel.getByRole("button", { name: "导入高铁票截图" }).click();
  await returnPanel.locator('input[type="file"]').setInputFiles(path.join(samples, "normal.png"));
  await expect(returnPanel.getByRole("img")).toBeVisible();
  await returnPanel.getByRole("button", { name: "识别选中区域" }).click();
  await expect(returnPanel.getByText("识别完成 · 等待核对")).toBeVisible();
  await returnPanel.getByLabel("这张截图用于").selectOption("new");
  await returnPanel.getByRole("button", { name: "修正并核对票面" }).click();
  expect((await confirm(page)).status()).toBe(200);
  expect((JSON.parse((await current(id)).tickets) as Ticket[])[0]).toMatchObject({ eventId: "return", direction: "return", date: "2026-10-29" });
});
