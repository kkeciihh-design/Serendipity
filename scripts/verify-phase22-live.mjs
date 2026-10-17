import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { assertTestDataPath } from "./test-data-safety.mjs";
const mode = process.argv[2]; assert.ok(["configure", "run", "before", "after", "browse", "reopen"].includes(mode));
const base = "http://127.0.0.1:3132", root = assertTestDataPath(path.resolve("test-data/phase22-live"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase22-live")); await fs.mkdir(output, { recursive: true });
const dbPath = path.join(root, "data/serendipity.db");
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath.replaceAll("\\", "/")}` } } });
async function api(url, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + url, { method, headers: { Origin: base, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: globalThis.AbortSignal.timeout(115_000) });
  const data = await r.json(); assert.ok(r.ok, `${r.status}: ${JSON.stringify(data)}`); return data;
}
try {
  if (mode === "configure") {
    // Credentials stay in memory and encrypted local storage. Never copy the
    // formal password/session key or serialize configuration into evidence.
    const formalRoot = path.join(process.env.LOCALAPPDATA, "Serendipity/data");
    const formal = new DatabaseSync(path.join(formalRoot, "serendipity.db"), { readOnly: true });
    let row; try { row = formal.prepare("SELECT provider,baseUrl,model,apiKeyCiphertext,basePrompt,systemPrompt,connectionStatus FROM AppSettings WHERE id='singleton'").get(); } finally { formal.close(); }
    assert.equal(row.connectionStatus, "connected"); assert.ok(row.apiKeyCiphertext);
    const derive = (key) => Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from("serendipity/settings-encryption"), 32));
    const [iv, tag, data] = row.apiKeyCiphertext.split(".").map((s) => Buffer.from(s, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", derive(await fs.readFile(path.join(formalRoot, "../security.key"))), iv); decipher.setAuthTag(tag);
    const secret = Buffer.concat([decipher.update(data), decipher.final()]);
    const keyPath = path.join(root, "security.key"); let targetKey;
    try { targetKey = await fs.readFile(keyPath); } catch { targetKey = crypto.randomBytes(64); await fs.writeFile(keyPath, targetKey, { mode: 0o600 }); }
    const nextIv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", derive(targetKey), nextIv);
    const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]); secret.fill(0);
    const apiKeyCiphertext = [nextIv, cipher.getAuthTag(), encrypted].map((b) => b.toString("base64url")).join(".");
    const config = { provider: row.provider, baseUrl: row.baseUrl, model: row.model, apiKeyCiphertext, basePrompt: row.basePrompt, systemPrompt: row.systemPrompt, connectionStatus: "connected" };
    await db.appSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...config }, update: config });
    await fs.writeFile(path.join(output, "service.json"), JSON.stringify({ provider: row.provider, model: row.model, configuredAt: new Date().toISOString(), source: "user configured formal instance; re-encrypted for isolated verification" }, null, 2));
    console.log("Configured the isolated instance using the saved AI service. No credentials emitted.");
  } else if (mode === "run") {
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), date = (n) => new Date(Date.parse(today) + n * 86400_000).toISOString().slice(0, 10);
    const cases = [
      { name: "rain", reason: "下雨了，把剩余户外活动换为合适的室内活动，保留已经确定的事项和返程票。" },
      { name: "late", reason: "第二天晚起一小时，把早餐和上午未确定的安排推迟一小时，保留固定返程和必要的交通时间。" },
      { name: "remove", reason: "不去第二天下午的橘子洲了，删除这项景点安排，保留其他安排和返程票。" },
    ];
    const results = [];
    for (const scenario of cases) {
      const snapshot = { destination: "长沙", startDate: date(2), endDate: date(3), travelerCount: 2, budgetAmountCents: 300000, budgetScope: "total", pace: "balanced", interests: ["历史", "当地美食"], accommodation: "五一广场附近酒店", constraints: ["固定返程车票不变"], fieldSources: {} };
      for (const field of Object.keys(snapshot).filter((k) => k !== "fieldSources")) snapshot.fieldSources[field] = "user_confirmed";
      const { trip } = await api("/api/trips", { originalRequest: `阶段22真实AI-${scenario.name}：长沙两日合成演练，日期与票据仅用于验证，无实际订单。` });
      await api(`/api/trips/${trip.id}/request`, { expectedRequestRevision: 1, request: snapshot }, "PATCH");
      const confirmed = await api(`/api/trips/${trip.id}/request/confirm`, { expectedRequestRevision: 2 });
      const req = await db.tripRequest.findUniqueOrThrow({ where: { tripId: trip.id } }); void confirmed;
      const events = [];
      function add(day, id, type, startTime, endTime, title, cost = 0) {
        const eventDate = date(day + 1);
        events.push({ id, dayNumber: day, date: eventDate, endDate: eventDate, startTime, endTime, type, title, locationName: title,
          costDraftCents: cost, costStatus: "estimated", status: "suggested", locked: false, ticketManaged: false,
          suggestedDurationSeconds: (Date.parse(`${eventDate}T${endTime}:00+08:00`) - Date.parse(`${eventDate}T${startTime}:00+08:00`)) / 1000, note: null });
      }
      for (const day of [1, 2]) {
        add(day, `d${day}-prepare`, "preparation", "06:00", "06:15", "出行准备"); add(day, `d${day}-breakfast`, "meal", "08:00", "08:30", "酒店附近早餐", 4000);
        add(day, `d${day}-activity`, "activity", "10:00", "11:00", day === 1 ? "湖南博物院" : "长沙简牍博物馆", 0);
        add(day, `d${day}-lunch`, "meal", "12:30", "13:30", "五一广场附近午餐", 12000); add(day, `d${day}-rest`, "rest", "14:00", "14:30", "午后休息");
        add(day, `d${day}-outdoor`, "activity", "15:00", "16:00", day === 1 ? "湘江风光带散步" : "橘子洲", 0);
      }
      add(1, "departure", "departure_transport", "06:30", "07:30", "去程交通（合成）", 20000); add(1, "hotel", "accommodation", "20:00", "22:00", "五一广场附近酒店", 35000);
      add(2, "return", "return_transport", "17:30", "19:00", "返程交通（合成）", 20000);
      events.find((e) => e.id === "d1-activity").locked = true; events.find((e) => e.id === "d1-activity").status = "confirmed";
      events.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)); events.forEach((e, i) => e.order = i + 1);
      const pendingItems = [{ id: "verify", category: "route", title: "接驳和开放条件需核对", reason: "合成演练，没有真实购票、预约或实时路线保证", requiredBefore: date(2) }];
      const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: req.confirmedRequest,
        events: JSON.stringify(events), costs: "[]", pendingItems: JSON.stringify(pendingItems), validationResults: JSON.stringify({ status: "needs_review", errors: [], warnings: ["合成演练"] }) } });
      await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
      const ticket = { eventId: "return", direction: "return", mode: "train", serviceNumber: "G000演练", date: date(3), departureTime: "17:30", arrivalDate: date(3), arrivalTime: "19:00",
        fromName: "长沙南站", fromDetail: null, toName: "演示返家站", toDetail: null, chainOriginName: "返程出发公共地标", chainDestinationName: "返家公共地标",
        accessMode: "walking", accessDurationMinutes: 20, accessFareCents: 0, accessNote: "合成固定耗时，仅测试用", egressMode: "walking", egressDurationMinutes: 10, egressFareCents: 0, egressNote: "合成估算",
        baggageNote: "轻便背包", passengerCount: 2, fareCents: 20000, checkInCutoffMinutes: null, bagDropCutoffMinutes: null, boardingCutoffMinutes: 5, bufferMinutes: 10, note: "无实际订单" };
      const { plan: initial } = await api(`/api/trips/${trip.id}/plans/1/tickets`, { action: "activate", ticket, acknowledged: true });
      let { checklist } = await api(`/api/trips/${trip.id}/checklist?planVersion=${initial.versionNumber}`);
      ({ checklist } = await api(`/api/trips/${trip.id}/checklist`, { expectedPlanVersion: initial.versionNumber, expectedRevision: checklist.revision, expectedBasis: checklist.basis, change: { action: "complete", id: "essential:phone", completed: true } }));
      const preview = await api(`/api/trips/${trip.id}/replan`, { action: "preview", reason: scenario.reason, expectedPlanVersion: initial.versionNumber, expectedRequestRevision: 2 });
      assert.ok(preview.candidate.changes.length); assert.equal(preview.candidate.requestRevision, 2);
      await fs.writeFile(path.join(output, `${scenario.name}-preview.json`), JSON.stringify(preview, null, 2));
      let applied = await api(`/api/trips/${trip.id}/replan`, { action: "apply", candidateId: preview.candidate.id, expectedCandidateRevision: preview.candidate.revision });
      if (applied.outcome === "review_required") {
        await fs.writeFile(path.join(output, `${scenario.name}-recheck-preview.json`), JSON.stringify(applied, null, 2));
        applied = await api(`/api/trips/${trip.id}/replan`, { action: "apply", candidateId: applied.candidate.id, expectedCandidateRevision: applied.candidate.revision });
      }
      assert.equal(applied.outcome, "applied"); assert.equal(applied.plan.requestRevision, 2); assert.deepEqual(applied.plan.tickets, initial.tickets);
      assert.deepEqual(applied.plan.events.find((e) => e.id === "d1-activity"), initial.events.find((e) => e.id === "d1-activity"));
      const after = await api(`/api/trips/${trip.id}/checklist?planVersion=${applied.plan.versionNumber}`); assert.equal(after.checklist.items.find((i) => i.id === "essential:phone").completed, true);
      await fs.writeFile(path.join(output, `${scenario.name}-applied.json`), JSON.stringify({ ...applied, checklist: after.checklist }, null, 2));
      results.push({ scenario: scenario.name, reason: scenario.reason, tripId: trip.id, version: applied.plan.versionNumber, changes: preview.candidate.changes.length, url: `${base}/trips/${trip.id}?view=replan`, checkedAt: new Date().toISOString() });
      await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2)); console.log(`${scenario.name}: real model preview and apply passed, ${preview.candidate.changes.length} changes, V${applied.plan.versionNumber}.`);
    }
  } else if (mode === "before" || mode === "after") {
    const sqlite = new DatabaseSync(dbPath, { readOnly: true }); let tables;
    try { assert.equal(Object.values(sqlite.prepare("PRAGMA integrity_check").get())[0], "ok"); tables = ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "ChecklistState", "AdvisoryState", "ReplanCandidate", "AppSettings"].map((table) => { const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all().map((r) => JSON.stringify(r)).sort(); return { table, count: rows.length, hash: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex") }; }); } finally { sqlite.close(); }
    if (mode === "after") assert.deepEqual(tables, JSON.parse(await fs.readFile(path.join(output, "before.json"), "utf8")));
    await fs.writeFile(path.join(output, `${mode}.json`), JSON.stringify(tables, null, 2)); console.log(`${mode}: isolated database fingerprints checked.`);
  } else {
    const results = JSON.parse(await fs.readFile(path.join(output, "results.json"), "utf8"));
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage(); await page.goto(results[0].url);
      const panel = page.getByRole("tabpanel", { name: "AI 重新规划", exact: true }); await panel.getByRole("button", { name: "预览撤销上次调整", exact: true }).waitFor();
      if (mode !== "reopen") await panel.getByRole("button", { name: "预览撤销上次调整", exact: true }).click();
      await panel.getByTestId("replan-preview").waitFor();
      for (const width of [390, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); await panel.getByTestId("replan-preview").evaluate((e) => e.scrollIntoView({ block: "start" })); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)); await page.screenshot({ path: path.join(output, `live-${width}.png`) }); }
      await page.reload(); await panel.getByTestId("replan-preview").waitFor();
      await fs.writeFile(path.join(output, mode === "reopen" ? "reopened.json" : "browser.json"), JSON.stringify({ checkedAt: new Date().toISOString(), widths: [390, 768, 1440], url: results[0].url, refreshed: true, candidatePersisted: true }, null, 2));
      console.log("Real-data demo reopened in Edge, persisted preview and viewport checks passed.");
    } finally { await browser.close(); }
  }
} finally { await db.$disconnect(); }
