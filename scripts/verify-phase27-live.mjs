import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import { assertTestDataPath } from "./test-data-safety.mjs";
const mode = process.argv[2];
assert.ok(["protect-before", "protect-after", "seed", "export", "restart-before", "restart-after", "reopen"].includes(mode));
const root = assertTestDataPath(path.resolve("test-data/phase27-live")), output = assertTestDataPath(path.resolve("test-data/verification-output/phase27-live"));
const sourceRoot = assertTestDataPath(path.resolve("test-data/verification-output/phase27-acceptance/phase27-browser"));
fs.mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:3137", databasePath = path.join(root, "data/serendipity.db");
const save = (name, data) => fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), ...data }, null, 2));
const read = (name) => JSON.parse(fs.readFileSync(path.join(output, `${name}.json`), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fingerprint(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const tables = ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "AppSettings", "ChecklistState", "AdvisoryState", "ReplanCandidate", "ExecutionState", "ExportFile"].map((name) => {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all().map((r) => JSON.stringify(r)).sort(); return { name, count: rows.length, hash: hash(JSON.stringify(rows)) };
    });
    return { databasePath: file, integrity: "ok", tables, migrations: db.prepare('SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').get().n };
  } finally { db.close(); }
}
if (mode.startsWith("protect-")) {
  const stores = {};
  for (const [name, file] of Object.entries({ formal: path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db"), phase26: assertTestDataPath(path.resolve("test-data/phase26-live/data/serendipity.db")) })) stores[name] = fingerprint(file);
  if (mode === "protect-after") assert.deepEqual(stores, read("protect-before").stores);
  save(mode, { stores }); console.log(`${mode}: original database fingerprints verified without exposing contents.`);
} else if (mode === "seed") {
  const db = new PrismaClient({ datasources: { db: { url: `file:${databasePath.replaceAll("\\", "/")}` } } });
  try {
    assert.equal(await db.trip.count(), 0, "Only seed an empty isolated database."); const trips = [];
    for (const days of [2, 4]) {
      const source = JSON.parse(fs.readFileSync(path.join(sourceRoot, `synthetic-${days}days.json`), "utf8"));
      await db.$transaction(async (tx) => {
        await tx.trip.create({ data: { id: source.id, title: source.title, originalRequest: source.originalRequest, status: source.status } });
        await tx.tripRequest.create({ data: source.request }); await tx.planVersion.create({ data: source.currentPlanVersion });
        await tx.trip.update({ where: { id: source.id }, data: { currentPlanVersionId: source.currentPlanVersion.id } });
      });
      trips.push({ days, id: source.id, url: `${origin}/trips/${source.id}/pdf` });
    }
    save("seed", { trips }); console.log("Two/four-day synthetic trips seeded in isolated phase27 directory.");
  } finally { await db.$disconnect(); }
} else if (mode === "export") {
  const files = [];
  for (const trip of read("seed").trips) {
    const response = await fetch(`${origin}/api/trips/${trip.id}/exports`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ expectedPlanVersion: 1, format: "pdf", options: {} }) });
    assert.equal(response.status, 201, await response.clone().text()); const { file } = await response.json();
    const download = await fetch(`${origin}/api/trips/${trip.id}/exports/${file.id}?download=1`), bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(download.headers.get("content-type"), "application/pdf"); assert.equal(hash(bytes), file.sha256);
    fs.writeFileSync(path.join(output, `${trip.days}days.pdf`), bytes);
    files.push({ tripId: trip.id, days: trip.days, ...file });
  }
  save("exports", { files }); console.log("Live PDF files downloaded and hashed.");
} else if (mode.startsWith("restart-")) {
  const state = fingerprint(databasePath), files = [];
  for (const f of read("exports").files) {
    const r = await fetch(`${origin}/api/trips/${f.tripId}/exports/${f.id}`); assert.equal(r.status, 200);
    const sha256 = hash(Buffer.from(await r.arrayBuffer())); assert.equal(sha256, f.sha256); files.push({ id: f.id, sha256 });
  }
  if (mode === "restart-after") { assert.deepEqual(state, read("restart-before").state); assert.deepEqual(files, read("restart-before").files); }
  save(mode, { state, files }); console.log(`${mode}: ten tables and PDF files verified.`);
} else {
  // Edge's native PDF surface is not painted in this environment's headless mode.
  // Keep screenshot inspection separate from the DOM/download assertions.
  const browser = await chromium.launch({ channel: "msedge", headless: false, args: ["--window-position=-1800,-1000"] });
  try {
    const context = await browser.newContext(), results = [];
    for (const trip of read("seed").trips) {
      for (const width of [390, 768, 1440]) {
        const screenContext = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await screenContext.newPage();
        await page.goto(trip.url); await page.getByRole("status").filter({ hasText: "已生成" }).waitFor();
        await page.locator('iframe[title="PDF旅行手册全部页面"]').waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth));
        await page.screenshot({ path: path.join(output, `${trip.days}days-ui-${width}.png`) });
        await page.locator("iframe").scrollIntoViewIfNeeded();
        await page.waitForTimeout(8_000);
        await page.screenshot({ path: path.join(output, `${trip.days}days-preview-${width}.png`) });
        await screenContext.close();
      }
      results.push({ days: trip.days, url: trip.url, previewBlobLoaded: true, headedScreenshotsRequireVisualReview: true });
    }
    await context.setOffline(true);
    const page = await context.newPage();
    // PDF extension viewer opens an actual local file, independent of the app.
    await page.goto(`file:///${path.join(output, "2days.pdf").replaceAll("\\", "/")}`);
    await page.locator('embed[type="application/pdf"]').waitFor();
    await page.waitForTimeout(8_000);
    await page.screenshot({ path: path.join(output, "offline-pdf.png") });
    await page.mouse.click(700, 450); await page.keyboard.press("Control+End");
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: path.join(output, "offline-pdf-last-page.png") });
    results.push({ offlineLocalPdfEmbedded: true, headedScreenshotsRequireVisualReview: true, browser: browser.version() }); save("reopen", { results });
    console.log("Fresh headed Edge previews and offline PDF captured; inspect screenshots for actual painting.");
  } finally { await browser.close(); }
}
