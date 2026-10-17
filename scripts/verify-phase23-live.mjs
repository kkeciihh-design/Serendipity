import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { chromium, expect } from "@playwright/test";
import { assertTestDataPath } from "./test-data-safety.mjs";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
const mode = process.argv[2]; assert.ok(["seed", "configure", "real", "browse", "reopen", "before", "after"].includes(mode));
const base = "http://127.0.0.1:3133", root = assertTestDataPath(path.resolve("test-data/phase23-live"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase23-live")); await fs.mkdir(output, { recursive: true });
const db = await openVerifiedIsolatedDatabase(base, root);
const json = async (name, data) => fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(data, null, 2));
async function api(url, body, method = body ? "POST" : "GET") {
  const response = await fetch(base + url, { method, headers: { Origin: base, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: globalThis.AbortSignal.timeout(115000) });
  const result = await response.json(); assert.ok(response.ok, `${response.status}: ${JSON.stringify(result)}`); return result;
}
try {
  if (mode === "seed") {
    assert.equal(await db.trip.count(), 0, "Existing demo is preserved; seed only an empty isolated database.");
    const source = JSON.parse(await fs.readFile(assertTestDataPath(path.resolve("test-data/verification-output/phase23-browser/synthetic-demo.json")), "utf8")), p = source.currentPlanVersion;
    const { trip } = await api("/api/trips", { originalRequest: "阶段23旅行执行演示：长沙两日合成旅行，允许提前手动演练；无真实订单。" });
    const snapshot = JSON.parse(p.requestSnapshot);
    await api(`/api/trips/${trip.id}/request`, { expectedRequestRevision: 1, request: snapshot }, "PATCH");
    await api(`/api/trips/${trip.id}/request/confirm`, { expectedRequestRevision: 2 });
    const events = JSON.parse(p.events).map((e) => e.id === "d1-activity" ? { ...e, title: "湖南博物院参观", locationName: "湖南博物院" } : e.id === "d2-activity" ? { ...e, title: "橘子洲散步", locationName: "橘子洲" } : e);
    const row = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: p.requestSnapshot, events: JSON.stringify(events), costs: p.costs, places: p.places, routeLegs: p.routeLegs, tickets: p.tickets, pendingItems: p.pendingItems, validationResults: p.validationResults } });
    await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
    await json("seed", { tripId: trip.id, url: `${base}/trips/${trip.id}/execute` }); console.log(`Demo: ${base}/trips/${trip.id}/execute`);
  } else if (mode === "configure") {
    // Re-encrypt the user's existing service config for this isolated demo.
    // Never copy the formal password/session material or output credentials.
    const formalRoot = path.join(process.env.LOCALAPPDATA, "Serendipity"), formal = new DatabaseSync(path.join(formalRoot, "data/serendipity.db"), { readOnly: true });
    let row; try { row = formal.prepare("SELECT provider,baseUrl,model,apiKeyCiphertext,basePrompt,systemPrompt,connectionStatus FROM AppSettings WHERE id='singleton'").get(); } finally { formal.close(); }
    assert.equal(row.connectionStatus, "connected"); assert.ok(row.apiKeyCiphertext);
    const derive = (key) => Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from("serendipity/settings-encryption"), 32));
    const [iv, tag, data] = row.apiKeyCiphertext.split(".").map((v) => Buffer.from(v, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", derive(await fs.readFile(path.join(formalRoot, "security.key"))), iv); decipher.setAuthTag(tag);
    const secret = Buffer.concat([decipher.update(data), decipher.final()]);
    const keyPath = path.join(root, "security.key"); let key; try { key = await fs.readFile(keyPath); } catch { key = crypto.randomBytes(64); await fs.writeFile(keyPath, key, { mode: 0o600 }); }
    const nextIv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", derive(key), nextIv), encrypted = Buffer.concat([cipher.update(secret), cipher.final()]); secret.fill(0);
    const config = { provider: row.provider, baseUrl: row.baseUrl, model: row.model, apiKeyCiphertext: [nextIv, cipher.getAuthTag(), encrypted].map((v) => v.toString("base64url")).join("."), basePrompt: row.basePrompt, systemPrompt: row.systemPrompt, connectionStatus: "connected" };
    await db.appSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...config }, update: config });
    await json("service", { provider: row.provider, model: row.model, configuredAt: new Date().toISOString() }); console.log("Saved encrypted isolated AI configuration; no credentials emitted.");
  } else {
    const seed = JSON.parse(await fs.readFile(path.join(output, "seed.json"), "utf8"));
    if (mode === "real") {
      const before = await api(`/api/trips/${seed.tripId}/execution`); assert.ok(before.execution.items.some((i) => i.completedAt));
      const { candidate } = await api(`/api/trips/${seed.tripId}/replan`, { action: "preview", reason: "下雨了，把第二天的橘子洲散步改为合适的室内参观活动。不要改变其他安排和返程。", expectedPlanVersion: before.plan.versionNumber, expectedRequestRevision: before.plan.requestRevision });
      assert.ok(candidate.changes.some((c) => c.eventId === "d2-activity"));
      assert.ok(!candidate.changes.some((c) => before.execution.items.some((i) => i.eventId === c.eventId && i.completedAt)));
      const applied = await api(`/api/trips/${seed.tripId}/replan`, { action: "apply", candidateId: candidate.id, expectedCandidateRevision: candidate.revision }); assert.equal(applied.outcome, "applied");
      const after = await api(`/api/trips/${seed.tripId}/execution`);
      assert.deepEqual(after.execution, { ...before.execution, planVersion: after.plan.versionNumber });
      assert.deepEqual(after.plan.tickets, before.plan.tickets);
      await json("real", { checkedAt: new Date().toISOString(), candidate, outcome: applied.outcome, executionBefore: before.execution, executionAfter: after.execution, ticketsUnchanged: true });
      console.log("Real AI preview and application preserved execution, current location and active tickets.");
    } else if (mode === "browse" || mode === "reopen") {
      const browser = await chromium.launch({ channel: "msedge", headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: [] }), page = await context.newPage();
        await page.goto(seed.url); await expect(page.getByText(/北京时间 · 使用本机服务器/)).toBeVisible();
        if (mode === "browse") {
          await page.getByRole("button", { name: "开始旅行", exact: true }).click();
          await page.getByLabel("手动选择当前步骤").selectOption("d1-activity");
          await page.getByRole("button", { name: "我已到达", exact: true }).click();
          await expect(page.getByText("已手动标记到达", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "完成这一步", exact: true }).click();
          await expect(page.getByText(/已完成 1 \//)).toBeVisible();
          await page.getByLabel("手动选择当前步骤").selectOption("d1-lunch");
          await expect(page.getByRole("region", { name: "当前步骤" })).toContainText("午餐");
        }
        await page.reload(); await expect(page.getByText(/已完成 1 \//)).toBeVisible();
        await expect(page.getByRole("region", { name: "当前位置来源" })).toContainText("手动记录：湖南博物院");
        for (const width of [390, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => globalThis.scrollTo(0, 0));
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth));
          await page.screenshot({ path: path.join(output, `${mode}-${width}.png`), fullPage: true });
          if (width === 390) await page.screenshot({ path: path.join(output, `${mode}-phone-viewport.png`) });
        }
        await json(mode, { url: seed.url, checkedAt: new Date().toISOString(), persistedCompletedCount: 1, manualLocation: "湖南博物院", refreshedAndReopened: true }); console.log(`${mode}: real browser progress and location verified, three widths captured.`);
      } finally { await browser.close(); }
    } else {
      const state = await api(`/api/trips/${seed.tripId}/execution`), sqlite = new DatabaseSync(path.join(root, "data/serendipity.db"), { readOnly: true });
      let tables; try {
        assert.equal(Object.values(sqlite.prepare("PRAGMA integrity_check").get())[0], "ok");
        tables = ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "ChecklistState", "AdvisoryState", "ReplanCandidate", "ExecutionState", "AppSettings"].map((table) => { const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all().map((r) => JSON.stringify(r)).sort(); return { table, count: rows.length, hash: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex") }; });
      } finally { sqlite.close(); }
      const result = { execution: state.execution, planId: state.plan.id, tables };
      if (mode === "after") assert.deepEqual(result, JSON.parse(await fs.readFile(path.join(output, "before.json"), "utf8")));
      await json(mode, result); console.log(`${mode}: execution and nine-table fingerprints verified.`);
    }
  }
} finally { await db.$disconnect(); }
