import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { assertTestDataPath } from "./test-data-safety.mjs";

const output = assertTestDataPath(path.resolve("test-data/verification-output/phase29"));
const configFile = path.join(output, "launcher.json");
function run(action) {
  const result = spawnSync(process.execPath, [path.resolve("scripts/desktop-control.mjs"), action, "--config", configFile], { encoding: "utf8", windowsHide: true });
  const value = JSON.parse(result.stdout); assert.equal(value.ok, true, result.stdout); return value;
}
const running = run("start");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(running.url);
  await page.getByRole("link", { name: "运行状态", exact: true }).click();
  await page.getByRole("heading", { name: "运行状态与数据" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "运行状态与数据" }).count(), 1);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${running.url}/runtime`);
    await page.getByRole("heading", { name: "应用运行正常" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    const content = await page.locator("main").innerText();
    assert.ok(content.includes(path.resolve("test-data/phase29-launcher")));
    assert.ok(content.includes("当前没有部署个人外网地址"));
    assert.ok(content.includes("由桌面启动入口管理"));
    await page.screenshot({ path: path.join(output, `runtime-${width}.png`), fullPage: true });
  }
  await page.getByRole("link", { name: "刷新状态", exact: true }).focus();
  await page.keyboard.press("Enter"); await page.waitForLoadState();
  await page.getByRole("link", { name: "备份与恢复旅行" }).click();
  await page.waitForURL("**/settings#data-management");
  assert.match(page.url(), /settings#data-management$/);
  await page.getByRole("link", { name: "运行状态与数据位置" }).click();
  await page.getByRole("heading", { name: "应用运行正常" }).waitFor();
  await page.goto(running.url);
  await page.locator("#trip-request").fill("阶段29浏览器保存与冷启动验收：上海两日漫步");
  await page.getByRole("button", { name: "保存旅行草稿" }).click(); await page.waitForURL("**/trips");
  await page.getByRole("article").filter({ hasText: "阶段29浏览器保存与冷启动验收：上海两日漫步" }).first().getByRole("link", { name: "打开继续" }).click();
  await page.locator("#trip-title").fill("阶段29 · 停止后继续");
  await page.getByRole("button", { name: "保存标题", exact: true }).click();
  await page.getByText("标题已保存；这不会改变需求修订或确认状态。").waitFor();
  const tripPath = new URL(page.url()).pathname;
  await page.reload(); assert.equal(await page.locator("#trip-title").inputValue(), "阶段29 · 停止后继续");
  await page.close();
  run("stop"); const restart = run("start");
  const context = await browser.newContext(); const fresh = await context.newPage();
  await fresh.goto(`${restart.url}${tripPath}`);
  assert.equal(await fresh.locator("#trip-title").inputValue(), "阶段29 · 停止后继续");
  assert.equal(await fresh.locator("#trip-request-original").inputValue(), "阶段29浏览器保存与冷启动验收：上海两日漫步");
  await fresh.screenshot({ path: path.join(output, "trip-reopened.png"), fullPage: true });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, "browser-results.json"), JSON.stringify({ checkedAt: new Date().toISOString(), widths: [390, 768, 1440], noOverflow: true, keyboardRefresh: true, navigation: true, browserSaveRefreshCloseAndServiceRestart: true, tripPath, consoleErrors: errors }, null, 2));
  console.log("PASS managed runtime page, 3 viewports, keyboard/navigation, browser save/refresh/close and real service restart");
} finally { await browser.close(); run("stop"); }
