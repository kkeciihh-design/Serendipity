import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { assertTestDataPath } from "./test-data-safety.mjs";

const mode = process.argv[2];
assert.ok(["seed", "export", "reopen", "permission-denied", "protect-before", "protect-after", "restart-before", "restart-after"].includes(mode));
const root = assertTestDataPath(path.resolve("test-data/phase25-live"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase25-live"));
const sourceRoot = assertTestDataPath(path.resolve("test-data/verification-output/phase25-acceptance/phase25-browser"));
fs.mkdirSync(output, { recursive: true });
const databasePath = path.join(root, "data/serendipity.db"), origin = "http://127.0.0.1:3135";
const save = (name, data) => fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), ...data }, null, 2));
const read = (name) => JSON.parse(fs.readFileSync(path.join(output, `${name}.json`), "utf8"));
function fingerprint(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const tables = ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "AppSettings", "ChecklistState", "AdvisoryState", "ReplanCandidate", "ExecutionState", "ExportFile"].map((name) => {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all().map((r) => JSON.stringify(r)).sort();
      return { name, count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
    });
    return { databasePath: file, integrity: "ok", tables, migrations: db.prepare('SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').get().n };
  } finally { db.close(); }
}
if (mode.startsWith("protect-")) {
  const stores = {};
  for (const [name, file] of Object.entries({ formal: path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db"), phase24: assertTestDataPath(path.resolve("test-data/phase24-live/data/serendipity.db")) })) stores[name] = fingerprint(file);
  if (mode === "protect-after") assert.deepEqual(stores, read("protect-before").stores);
  save(mode, { stores }); console.log(`${mode}: formal and previous demo unchanged; contents not emitted.`);
} else if (mode === "seed") {
  const db = new PrismaClient({ datasources: { db: { url: `file:${databasePath.replaceAll("\\", "/")}` } } });
  try {
    assert.equal(await db.trip.count(), 0, "Only seed an empty isolated database."); const trips = [];
    for (const days of [2, 4]) {
      const source = JSON.parse(fs.readFileSync(path.join(sourceRoot, `synthetic-${days}days.json`), "utf8"));
      const facts = JSON.parse(fs.readFileSync(path.join(sourceRoot, `synthetic-${days}days-facts.json`), "utf8"));
      await db.$transaction(async (tx) => {
        await tx.trip.create({ data: { id: source.id, title: source.title, originalRequest: source.originalRequest, status: source.status } });
        await tx.tripRequest.create({ data: source.request }); await tx.planVersion.create({ data: source.currentPlanVersion });
        if (source.checklist) await tx.checklistState.create({ data: source.checklist });
        if (source.execution) await tx.executionState.create({ data: source.execution });
        for (const fact of facts) await tx.evidenceFact.create({ data: fact });
        await tx.trip.update({ where: { id: source.id }, data: { currentPlanVersionId: source.currentPlanVersion.id } });
      });
      trips.push({ days, id: source.id, url: `${origin}/trips/${source.id}/text` });
    }
    save("seed", { trips }); console.log("Two/four-day synthetic trips seeded in isolated phase25 directory.");
  } finally { await db.$disconnect(); }
} else if (mode === "export") {
  const files = [];
  for (const trip of read("seed").trips) for (const format of ["plain-text", "markdown"]) {
    const response = await fetch(`${origin}/api/trips/${trip.id}/exports`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ expectedPlanVersion: 1, format, options: {} }) });
    assert.equal(response.status, 201); const { file } = await response.json();
    const download = await fetch(`${origin}/api/trips/${trip.id}/exports/${file.id}?download=1`), bytes = Buffer.from(await download.arrayBuffer());
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assert.ok(text.includes("22:55") && text.includes("合成场馆预约公告") && text.includes("1 项金额待确认"));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    const localFile = path.join(output, `${trip.days}days.${format === "markdown" ? "md" : "txt"}`); fs.writeFileSync(localFile, bytes);
    files.push({ tripId: trip.id, days: trip.days, localFile, contentType: download.headers.get("content-type"), ...file });
  }
  save("exports", { files }); console.log("Four live UTF-8 files downloaded, decoded and hashed.");
} else if (mode.startsWith("restart-")) {
  const state = fingerprint(databasePath), files = [];
  for (const f of read("exports").files) {
    const response = await fetch(`${origin}/api/trips/${f.tripId}/exports/${f.id}`); assert.equal(response.status, 200);
    const sha256 = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"); assert.equal(sha256, f.sha256); files.push({ id: f.id, sha256 });
  }
  if (mode === "restart-after") { const prior = read("restart-before"); assert.deepEqual(state, prior.state); assert.deepEqual(files, prior.files); }
  save(mode, { state, files }); console.log(`${mode}: all ten tables and four downloaded files verified.`);
} else {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    if (mode === "permission-denied") {
      await page.goto(read("seed").trips[0].url); await page.getByLabel("导出文字").waitFor();
      const session = await context.newCDPSession(page);
      const { targetInfo } = await session.send("Target.getTargetInfo");
      await session.send("Browser.setPermission", { permission: { name: "clipboard-write" }, setting: "denied", origin, browserContextId: targetInfo.browserContextId });
      const state = await page.evaluate(async () => (await globalThis.navigator.permissions.query({ name: "clipboard-write" })).state);
      assert.equal(state, "denied");
      await page.getByRole("button", { name: "复制全文", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "权限被拒绝" }).waitFor();
      const selection = await page.getByLabel("导出文字").evaluate((el) => ({ length: el.value.length, selected: el.selectionEnd - el.selectionStart }));
      assert.equal(selection.length, selection.selected);
      const downloadEvent = page.waitForEvent("download"); await page.getByRole("link", { name: "下载 .md", exact: true }).click();
      await (await downloadEvent).saveAs(path.join(output, "real-permission-denied.md"));
      await page.screenshot({ path: path.join(output, "real-permission-denied.png"), fullPage: true });
      save(mode, { browser: await browser.version(), actualBrowserPermission: state, clipboardApiUnmodified: true, selection, downloadSucceeded: true });
      console.log("Actual browser clipboard-write denial verified; full selection and file download succeeded.");
      await context.close();
    } else {
    for (const trip of read("seed").trips) {
      await page.goto(trip.url); await page.getByLabel("导出文字").waitFor();
      assert.ok((await page.getByLabel("导出文字").inputValue()).includes("22:55"));
      await page.getByRole("region", { name: "文字预览", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `reopen-${trip.days}days.png`), fullPage: true });
    }
    save(mode, { browser: await browser.version(), environment: "Windows Edge, touch emulation", reopenedAfterRestart: true });
    await context.close(); console.log("New browser session reopened persisted text files.");
    }
  } finally { await browser.close(); }
}
