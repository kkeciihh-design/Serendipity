import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
/* global window */

const directory = path.resolve("docs/阶段验收/证据/阶段-15");
const manifest = JSON.parse(await fs.readFile(path.join(directory, "demo-manifest.json"), "utf8"));
const database = await openVerifiedIsolatedDatabase("http://127.0.0.1:3123", "test-data/phase15-live");
await database.$disconnect();
const mode = process.argv[2];
assert.ok(mode === "prepare" || mode === "reopen");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(manifest.url);
  const panel = page.getByRole("region", { name: "时间红线", exact: true });
  await panel.getByText(/建议最晚 .*09:(55|45)/).waitFor();
  await panel.getByText("红线详情与计算依据", { exact: true }).click();
  if (mode === "prepare") {
    await panel.getByLabel("行李条件", { exact: true }).selectOption("none");
    await panel.getByLabel("额外机动缓冲（分钟）", { exact: true }).fill("20");
    await panel.getByRole("button", { name: "保存条件并重算" }).click();
    await panel.getByText(/建议最晚 .*09:45/).waitFor();
    await page.reload();
    await panel.getByText("红线详情与计算依据", { exact: true }).click();
  }
  assert.equal(await panel.getByLabel("额外机动缓冲（分钟）", { exact: true }).inputValue(), "20");
  assert.equal(await panel.getByLabel("行李条件", { exact: true }).inputValue(), "none");
  assert.equal(await panel.getByText(/建议最晚 .*09:45/).count(), 1);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await panel.screenshot({ path: path.join(directory, `demo-${mode}-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(directory, `demo-browser-${mode}.json`), JSON.stringify({
    checkedAt: new Date().toISOString(), url: manifest.url, mode, savedBufferMinutes: 20,
    baggage: "none", expectedSuggestedTime: "09:45", actualSuggestedTime: await panel.locator("article > p").first().innerText(),
    viewportWidths: [390, 768, 1440], pageErrors: errors, status: "passed",
  }, null, 2));
  console.log(`Demo ${mode}: preferences, time, refresh and 390/768/1440 layouts passed.`);
} finally { await browser.close(); }
