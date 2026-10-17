import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { assertTestDataPath } from "./test-data-safety.mjs";

const mode = process.argv[2];
assert.ok(["seed", "export", "reopen", "offline", "protect-before", "protect-after", "restart-before", "restart-after"].includes(mode));
const root = assertTestDataPath(path.resolve("test-data/phase24-live"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase24-live"));
fs.mkdirSync(output, { recursive: true });
const filePath = path.join(root, "data/serendipity.db"), origin = "http://127.0.0.1:3134";
const save = (name, data) => fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), ...data }, null, 2));
const read = (name) => JSON.parse(fs.readFileSync(path.join(output, `${name}.json`), "utf8"));
function fingerprint(databasePath, tableNames) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const tables = (tableNames ?? ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "AppSettings", "ChecklistState", "AdvisoryState", "ReplanCandidate", "ExecutionState", "ExportFile"].filter((name) => exists.includes(name))).map((name) => {
      assert.match(name, /^[A-Za-z]+$/);
      const rows = db.prepare(`SELECT * FROM "${name}"`).all().map((r) => JSON.stringify(r)).sort();
      return { name, count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
    });
    return { databasePath, integrity: "ok", tables, migrations: db.prepare('SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').get().n };
  } finally { db.close(); }
}
if (mode.startsWith("protect-")) {
  const before = mode === "protect-after" ? read("protect-before") : null, stores = {};
  for (const [name, dbPath] of Object.entries({ formal: path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db"), phase22: assertTestDataPath(path.resolve("test-data/phase22-live/data/serendipity.db")), phase23: assertTestDataPath(path.resolve("test-data/phase23-live/data/serendipity.db")) })) {
    stores[name] = fingerprint(dbPath, before?.stores[name].tables.map((t) => t.name));
    if (before) { assert.deepEqual(stores[name].tables, before.stores[name].tables); assert.equal(stores[name].migrations, before.stores[name].migrations + (name === "formal" ? 1 : 0)); }
  }
  save(mode, { stores }); console.log(`${mode}: existing data fingerprints and integrity verified; private contents not emitted.`);
} else if (mode === "seed") {
  const db = new PrismaClient({ datasources: { db: { url: `file:${filePath.replaceAll("\\", "/")}` } } });
  try {
    assert.equal(await db.trip.count(), 0, "Only seed an empty isolated database."); const trips = [];
    for (const days of [2, 4]) {
      const source = JSON.parse(fs.readFileSync(assertTestDataPath(path.resolve(`test-data/verification-output/phase24-browser/synthetic-${days}days.json`)), "utf8"));
      const { currentPlanVersion: plan, request, execution, checklist } = source;
      await db.$transaction(async (tx) => {
        await tx.trip.create({ data: { id: source.id, title: source.title, originalRequest: source.originalRequest, status: source.status } });
        await tx.tripRequest.create({ data: request }); await tx.planVersion.create({ data: plan });
        if (execution) await tx.executionState.create({ data: execution }); if (checklist) await tx.checklistState.create({ data: checklist });
        await tx.trip.update({ where: { id: source.id }, data: { currentPlanVersionId: plan.id } });
      });
      trips.push({ days, id: source.id, url: `${origin}/trips/${source.id}/mobile` });
    }
    save("seed", { trips }); console.log("Isolated two/four-day synthetic trips saved.");
  } finally { await db.$disconnect(); }
} else if (mode === "export") {
  const files = [];
  for (const trip of read("seed").trips) {
    const response = await fetch(`${origin}/api/trips/${trip.id}/exports`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ expectedPlanVersion: 1, options: {} }) });
    assert.equal(response.status, 201); const { file } = await response.json();
    const html = await (await fetch(`${origin}/api/trips/${trip.id}/exports/${file.id}?download=1`)).text();
    assert.equal(createHash("sha256").update(html).digest("hex"), file.sha256);
    const localFile = path.join(output, `${trip.days}days-mobile.html`); fs.writeFileSync(localFile, html);
    files.push({ tripId: trip.id, days: trip.days, localFile, ...file });
  }
  save("exports", { files }); console.log("Live API exported two exact, hashed HTML files.");
} else if (mode.startsWith("restart-")) {
  const state = fingerprint(filePath), files = [];
  for (const f of read("exports").files) {
    const response = await fetch(`${origin}/api/trips/${f.tripId}/exports/${f.id}`); assert.equal(response.status, 200);
    const sha256 = createHash("sha256").update(await response.text()).digest("hex"); assert.equal(sha256, f.sha256); files.push({ id: f.id, sha256 });
  }
  if (mode === "restart-after") { const prior = read("restart-before"); assert.deepEqual(state, prior.state); assert.deepEqual(files, prior.files); }
  save(mode, { state, files }); console.log(`${mode}: database and downloaded bytes verified.`);
} else {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, javaScriptEnabled: mode !== "offline" });
    const external = []; context.on("request", (r) => { if (/^https?:/.test(r.url())) external.push(r.url()); });
    if (mode === "offline") {
      let available = false; try { await fetch(`${origin}/api/trips`, { signal: globalThis.AbortSignal.timeout(2000) }); available = true; } catch { /* expected while stopped */ }
      assert.equal(available, false, "Stop only the isolated phase24 server before this check."); await context.setOffline(true);
    }
    const page = await context.newPage();
    for (const trip of read("seed").trips) {
      const file = read("exports").files.find((f) => f.tripId === trip.id);
      await page.goto(mode === "offline" ? pathToFileURL(file.localFile).href : trip.url);
      if (mode === "offline") {
        assert.equal(await page.locator("section.day").count(), trip.days); await page.getByRole("navigation").getByRole("link", { name: "红线", exact: true }).click();
        assert.ok((await page.locator("#redlines").textContent()).includes("22:55"));
      } else {
        await page.getByRole("link", { name: "下载此 HTML" }).waitFor(); await page.getByRole("region", { name: "手机一页预览" }).scrollIntoViewIfNeeded();
        await page.frameLocator("iframe").getByRole("heading", { level: 1 }).waitFor();
      }
      await page.screenshot({ path: path.join(output, `${mode}-${trip.days}days.png`), fullPage: mode !== "offline" });
    }
    if (mode === "offline") assert.deepEqual(external, []);
    save(mode, { browser: await browser.version(), environment: "Windows Edge, mobile touch emulation; physical phone not verified", javaScriptEnabled: mode !== "offline", serverStopped: mode === "offline", externalRequests: mode === "offline" ? external : undefined });
    await context.close(); console.log(`${mode}: browser checks and screenshots saved.`);
  } finally { await browser.close(); }
}
