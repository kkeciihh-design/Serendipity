import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { assertTestDataPath } from "./test-data-safety.mjs";
import { backupHash, parseTravelBackup } from "./travel-backup-format.mjs";
const mode = process.argv[2]; assert.ok(["restore", "reopen"].includes(mode));
const root = assertTestDataPath(path.resolve("test-data/phase28-live"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase28-live"));
const origin = "http://127.0.0.1:3138";
const browser = await chromium.launch({ channel: "msedge" });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: origin });
  const page = await context.newPage(); await page.goto("/settings");
  const password = "phase28-demo-password";
  if (await page.getByLabel("确认个人密码").count()) {
    await page.getByLabel("个人密码", { exact: true }).fill(password); await page.getByLabel("确认个人密码").fill(password);
    await page.getByRole("button", { name: "设置密码", exact: true }).click();
  } else if (await page.getByRole("button", { name: "进入设置" }).count()) {
    await page.getByLabel("个人密码", { exact: true }).fill(password); await page.getByRole("button", { name: "进入设置" }).click();
  }
  await page.getByRole("heading", { name: "留一份旅行备份" }).waitFor();
  if (mode === "restore") {
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载旅行备份" }).click();
    const file = path.join(output, "live-backup.json"); await (await download).saveAs(file);
    const backup = parseTravelBackup(fs.readFileSync(file, "utf8")), source = parseTravelBackup(fs.readFileSync(path.join(output, "sample-travel.json"), "utf8"));
    assert.equal(backupHash(backup), backupHash(source)); assert.equal(backup.tables.Trip.length, 2);
    await page.getByLabel("选择旅行备份").setInputFiles(file);
    await page.getByRole("heading", { name: "恢复摘要与影响范围" }).waitFor();
    await page.locator("#data-management").screenshot({ path: path.join(output, "two-trips-preview.png") });
    assert.equal(await page.getByRole("button", { name: "确认恢复旅行" }).isDisabled(), true);
    await page.getByRole("checkbox", { name: "我已核对，确认用此备份替换当前全部旅行数据。" }).check();
    await page.getByRole("button", { name: "确认恢复旅行" }).click();
    await page.getByText("恢复处理完成。请重新载入页面，读取恢复后的旅行数据。", { exact: true }).waitFor();
    await page.reload(); await page.getByRole("heading", { name: "留一份旅行备份" }).waitFor();
    const state = await (await context.request.get("/api/data-management/status")).json();
    const trip = backup.tables.Trip.find((t) => t.title.includes("2日"));
    assert.ok(trip);
    const exported = await context.request.post(`/api/trips/${trip.id}/exports`, { headers: { Origin: origin, "x-data-generation": state.dataGeneration }, data: { expectedPlanVersion: 1, format: "plain-text", options: {} } });
    assert.equal(exported.status(), 201, await exported.text());
    const { file: exportedFile } = await exported.json();
    const text = await (await context.request.get(`/api/trips/${trip.id}/exports/${exportedFile.id}`)).text();
    fs.writeFileSync(path.join(output, "restored-travel.txt"), text);
    fs.writeFileSync(path.join(output, "browser-restore.json"), JSON.stringify({ sourceHash: backupHash(source), downloadedHash: backupHash(backup), trips: 2, state, exportId: exportedFile.id, targetRoot: root }, null, 2));
  }
  await page.getByRole("heading", { name: "恢复记录", exact: true }).waitFor();
  await page.locator("#data-management").scrollIntoViewIfNeeded();
  await page.locator("#data-management").screenshot({ path: path.join(output, `settings-${mode}.png`) });
  const result = await (await context.request.get("/api/trips")).json(); assert.equal(result.trips.length, 2);
  await page.goto(`/trips/${result.trips[0].id}`); await page.getByRole("heading", { name: /计划版本 1/ }).waitFor();
  await page.getByRole("tab", { name: "预算", exact: true }).click();
  await page.screenshot({ path: path.join(output, `budget-${mode}.png`), fullPage: true });
  fs.writeFileSync(path.join(output, `browser-${mode}-result.json`), JSON.stringify({ status: "passed", trips: result.trips.map((t) => t.id), generation: (await (await context.request.get("/api/data-management/status")).json()).dataGeneration }, null, 2));
  console.log(`Live ${mode} verified: two trips, settings access, reopened budget and generation.`);
} finally { await browser.close(); }
