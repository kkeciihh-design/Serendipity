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
const root = assertTestDataPath(path.resolve("test-data/phase26-live")), output = assertTestDataPath(path.resolve("test-data/verification-output/phase26-live"));
const sourceRoot = assertTestDataPath(path.resolve("test-data/verification-output/phase26-acceptance/phase26-browser"));
fs.mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:3136", databasePath = path.join(root, "data/serendipity.db");
const save = (name, data) => fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), ...data }, null, 2));
const read = (name) => JSON.parse(fs.readFileSync(path.join(output, `${name}.json`), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fingerprint(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const tables = ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "AppSettings", "ChecklistState", "AdvisoryState", "ReplanCandidate", "ExecutionState", "ExportFile"].map((name) => {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all().map((r) => JSON.stringify(r)).sort();
      return { name, count: rows.length, hash: hash(JSON.stringify(rows)) };
    });
    return { databasePath: file, integrity: "ok", tables, migrations: db.prepare('SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').get().n };
  } finally { db.close(); }
}
if (mode.startsWith("protect-")) {
  const stores = {};
  for (const [name, file] of Object.entries({ formal: path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db"), phase25: assertTestDataPath(path.resolve("test-data/phase25-live/data/serendipity.db")) })) stores[name] = fingerprint(file);
  if (mode === "protect-after") assert.deepEqual(stores, read("protect-before").stores);
  save(mode, { stores }); console.log(`${mode}: formal and previous demo fingerprints recorded without contents.`);
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
      trips.push({ days, id: source.id, url: `${origin}/trips/${source.id}/image` });
    }
    save("seed", { trips }); console.log("Two/four-day synthetic trips seeded in isolated phase26 directory.");
  } finally { await db.$disconnect(); }
} else if (mode === "export") {
  const files = [];
  for (const trip of read("seed").trips) {
    const response = await fetch(`${origin}/api/trips/${trip.id}/exports`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ expectedPlanVersion: 1, format: "long-image", options: {} }) });
    assert.equal(response.status, 201, await response.clone().text()); const { file } = await response.json();
    for (const part of file.parts) {
      const download = await fetch(`${origin}/api/trips/${trip.id}/exports/${file.id}?part=${part.index}&download=1`), bytes = Buffer.from(await download.arrayBuffer());
      assert.equal(download.headers.get("content-type"), "image/png"); assert.equal(hash(bytes), part.sha256);
      fs.writeFileSync(path.join(output, `${trip.days}days-${part.index}.png`), bytes);
    }
    files.push({ tripId: trip.id, days: trip.days, ...file });
  }
  save("exports", { files }); console.log("Live PNG files downloaded and hashed.");
} else if (mode.startsWith("restart-")) {
  const state = fingerprint(databasePath), parts = [];
  for (const f of read("exports").files) for (const p of f.parts) {
    const r = await fetch(`${origin}/api/trips/${f.tripId}/exports/${f.id}?part=${p.index}`); assert.equal(r.status, 200);
    const sha256 = hash(Buffer.from(await r.arrayBuffer())); assert.equal(sha256, p.sha256); parts.push({ id: f.id, part: p.index, sha256 });
  }
  if (mode === "restart-after") { assert.deepEqual(state, read("restart-before").state); assert.deepEqual(parts, read("restart-before").parts); }
  save(mode, { state, parts }); console.log(`${mode}: all ten tables and PNG files verified.`);
} else {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), results = [];
    for (const trip of read("seed").trips) {
      await page.goto(trip.url); await page.getByRole("status").filter({ hasText: "已生成" }).waitFor();
      const images = page.getByRole("img", { name: /旅行长图第/ });
      for (let i = 0; i < await images.count(); i++) await images.nth(i).evaluate((img) => img.decode());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `${trip.days}days-reopen-${width}.png`) });
        await page.getByLabel("完整长图预览").evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: path.join(output, `${trip.days}days-preview-${width}.png`) });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      results.push({ days: trip.days, parts: await images.count(), url: trip.url });
    }
    await context.setOffline(true);
    const local = `file:///${path.join(output, "2days-1.png").replaceAll("\\", "/")}`;
    await page.goto(local); assert.equal(await page.locator("img").evaluate((img) => img.naturalWidth), 1080);
    results.push({ offlineLocalPng: true, browser: browser.version() }); save("reopen", { results }); console.log("Fresh mobile-size browser previews and offline local PNG verified.");
  } finally { await browser.close(); }
}
