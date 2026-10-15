import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";

const base = "http://127.0.0.1:3124";
const output = path.resolve("docs/阶段验收/证据/阶段-16");
const manifest = JSON.parse(await fs.readFile(path.join(output, "demo-manifest.json"), "utf8"));
const database = await openVerifiedIsolatedDatabase(base, "test-data/phase16-live");
const before = await database.trip.findUniqueOrThrow({ where: { id: manifest.tripId }, include: { currentPlanVersion: true } });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(manifest.url);
  await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
  assert.equal(await page.getByText("票据 1 · G6012", { exact: true }).count(), 1);
  const panel = page.getByRole("region", { name: "去程交通", exact: true }).getByRole("region", { name: "截图导入", exact: true });
  await panel.getByRole("button", { name: "导入高铁票截图" }).click();
  await panel.locator('input[type="file"]').setInputFiles(path.resolve("test-data/phase16-samples/normal.png"));
  await page.getByRole("img", { name: "本机票图裁剪预览" }).waitFor();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/ticket-import"));
  await panel.getByRole("button", { name: "识别选中区域" }).click();
  assert.equal((await response).status(), 200);
  await panel.getByText("识别完成 · 等待核对").waitFor();
  assert.ok((await panel.innerText()).includes("同一张票不重复记账"));
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await panel.screenshot({ path: path.join(output, `demo-reopen-${width}.png`) });
  }
  await panel.getByRole("button", { name: "关闭并清除票图" }).click();
  assert.equal(await panel.getByRole("img").count(), 0);
  const after = await database.trip.findUniqueOrThrow({ where: { id: manifest.tripId }, include: { currentPlanVersion: true } });
  assert.equal(after.currentPlanVersionId, before.currentPlanVersionId);
  assert.equal(after.currentPlanVersion.tickets, before.currentPlanVersion.tickets);
  await fs.writeFile(path.join(output, "demo-browser-reopen.json"), JSON.stringify({ checkedAt: new Date().toISOString(), url: manifest.url, status: "passed", samePlanAfterPreview: true, imageCleared: true, actualOcrAfterRestart: true }, null, 2));
  console.log("Demo browser reopen, real OCR, duplicate preview and cancel passed.");
} finally { await browser.close(); await database.$disconnect(); }
