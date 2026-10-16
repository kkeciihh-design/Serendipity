import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { assertTestDataPath } from "./test-data-safety.mjs";

const mode = process.argv[2]; assert.ok(["prepare", "before", "after", "browse"].includes(mode));
const base = "http://127.0.0.1:3130";
const root = assertTestDataPath(path.resolve("test-data/phase20-live"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase20-live")); await fs.mkdir(output, { recursive: true });
const dbPath = path.join(root, "data/serendipity.db"), seedFile = path.join(output, "seed.json");
async function api(url, body, method = body ? "POST" : "GET") {
  const response = await fetch(base + url, { method, headers: { Origin: base, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.ok(response.ok, `${response.status}: ${JSON.stringify(result)}`); return result;
}
if (mode === "prepare") {
  // Reuse the previous isolated demo's saved itinerary, never its settings or keys.
  const source = new DatabaseSync(assertTestDataPath(path.resolve("test-data/phase19-live/data/serendipity.db")), { readOnly: true });
  let p; try { p = source.prepare('SELECT p.* FROM PlanVersion p JOIN Trip t ON t.currentPlanVersionId = p.id LIMIT 1').get(); } finally { source.close(); }
  assert.ok(p); const snapshot = JSON.parse(p.requestSnapshot);
  const { trip } = await api("/api/trips", { originalRequest: "阶段20准备清单演示：隔离合成旅行，时刻、票据与预算均供演练；未实际购票、订房或预约。" });
  await api(`/api/trips/${trip.id}/request`, { expectedRequestRevision: 1, request: snapshot }, "PATCH");
  await api(`/api/trips/${trip.id}/request/confirm`, { expectedRequestRevision: 2 });
  const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath.replaceAll("\\", "/")}` } } });
  try {
    const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: p.requestSnapshot, events: p.events, places: p.places, costs: p.costs, routeLegs: p.routeLegs, tickets: "[]", pendingItems: p.pendingItems, validationResults: p.validationResults } });
    await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  } finally { await db.$disconnect(); }
  const departure = JSON.parse(p.events).find((e) => e.type === "departure_transport");
  const ticket = { eventId: departure.id, direction: "departure", mode: "train", serviceNumber: "G1200（合成演练）", seat: null,
    date: departure.date, departureTime: departure.startTime, arrivalDate: departure.endDate ?? departure.date, arrivalTime: departure.endTime,
    fromName: "深圳北站", fromDetail: null, toName: "长沙南站", toDetail: null,
    chainOriginName: null, chainDestinationName: null, accessMode: null, accessDurationMinutes: null, accessFareCents: null, accessNote: null,
    egressMode: null, egressDurationMinutes: null, egressFareCents: null, egressNote: null, baggageNote: null, passengerCount: 2, fareCents: null,
    checkInCutoffMinutes: null, bagDropCutoffMinutes: null, boardingCutoffMinutes: null, bufferMinutes: 30, note: "仅供阶段20关联验证，不是真实车票" };
  const { plan } = await api(`/api/trips/${trip.id}/plans/1/tickets`, { action: "activate", ticket, acknowledged: true });
  let { checklist } = await api(`/api/trips/${trip.id}/checklist?planVersion=${plan.versionNumber}`);
  async function change(change) { ({ checklist } = await api(`/api/trips/${trip.id}/checklist`, { expectedPlanVersion: plan.versionNumber, expectedRevision: checklist.revision, expectedBasis: checklist.basis, change })); }
  await change({ action: "complete", id: "essential:phone", completed: true });
  await change({ action: "add", id: randomUUID(), fields: { title: "带好相机和备用电池", group: "essentials", date: snapshot.startDate, eventId: null, note: "用户自建示例；可勾选、编辑、移出和恢复。" } });
  await fs.writeFile(seedFile, JSON.stringify({ tripId: trip.id, version: plan.versionNumber, url: `${base}/trips/${trip.id}?view=checklist` }, null, 2));
  console.log(`Prepared isolated checklist demo: ${base}/trips/${trip.id}?view=checklist`);
} else {
  const seed = JSON.parse(await fs.readFile(seedFile, "utf8"));
  if (mode === "before" || mode === "after") {
    const { checklist } = await api(`/api/trips/${seed.tripId}/checklist?planVersion=${seed.version}`);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    let tables;
    try { assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok"); tables = ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "ChecklistState", "AppSettings"].map((table) => { const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((r) => JSON.stringify(r)).sort(); return { table, count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") }; }); } finally { db.close(); }
    const result = { seed, checklist, tables };
    if (mode === "after") assert.deepEqual(result, JSON.parse(await fs.readFile(path.join(output, "before.json"), "utf8")));
    await fs.writeFile(path.join(output, `${mode}.json`), JSON.stringify(result, null, 2)); console.log(`${mode}: checklist and six table fingerprints ${mode === "after" ? "unchanged after restart" : "captured"}.`);
  } else {
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage(); await page.goto(seed.url);
      await page.getByRole("tabpanel", { name: "出发前清单", exact: true }).getByRole("checkbox", { name: "手机、充电器与必要电量", exact: true }).waitFor();
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 }); await page.locator("#plan-views").evaluate((el) => el.scrollIntoView({ block: "start" }));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth));
        await page.screenshot({ path: path.join(output, `live-${width}.png`), fullPage: false });
      }
      await page.reload(); const panel = page.getByRole("tabpanel", { name: "出发前清单", exact: true });
      assert.ok(await panel.getByRole("checkbox", { name: "手机、充电器与必要电量", exact: true }).isChecked());
      assert.ok(await panel.getByRole("checkbox", { name: "带好相机和备用电池", exact: true }).isVisible());
      await fs.writeFile(path.join(output, "browser.json"), JSON.stringify({ url: seed.url, checkedAt: new Date().toISOString(), widths: [390, 768, 1440], refreshedAndReopened: true }, null, 2));
      console.log("New Edge session and refresh retained progress; 390/768/1440 layouts captured.");
    } finally { await browser.close(); }
  }
}
