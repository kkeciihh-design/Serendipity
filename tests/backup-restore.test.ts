import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { DatabaseSync } from "node:sqlite";
import { isolatedDatabase } from "./helpers/test-database";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { ticketFixture } from "./helpers/ticket-fixtures";
import { validatePlan } from "../lib/plan";
import { calculateBudgetSummary } from "../lib/budget";
import { validateTravelBackup } from "../lib/backup-validation";
import { backupHash, parseTravelBackup, type TravelBackup } from "../scripts/travel-backup-format.mjs";
import { previewRestore, restoreTravelBackup, readInstanceState, readTravelBackup, resumeInterruptedRestore } from "../scripts/restore-core.mjs";
import { businessOperation, businessTransaction, withDataGeneration } from "../lib/business-guard";
import { verificationEvidenceDirectory } from "./helpers/evidence-directory";
import * as pdfRenderer from "../lib/pdf-renderer";

vi.mock("../lib/settings", () => ({ storedAIConfiguration: async () => ({ provider: "openai-chat-completions", baseUrl: "http://127.0.0.1:9999", model: "isolated", apiKey: "test-only", basePrompt: "", systemPrompt: "" }) }));
let database: ReturnType<typeof isolatedDatabase>, db: PrismaClient, filename: string;
let trips: typeof import("../lib/trips"), requests: typeof import("../lib/trip-request-service"), plans: typeof import("../lib/plan-service"), replan: typeof import("../lib/replan-service"), checklist: typeof import("../lib/checklist-service"), execution: typeof import("../lib/execution-service"), exports: typeof import("../lib/export-service");
beforeAll(async () => {
  database = isolatedDatabase("unit-backup-restore"); filename = path.join(database.directory, "data/serendipity.db");
  db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service"); plans = await import("../lib/plan-service");
  replan = await import("../lib/replan-service"); checklist = await import("../lib/checklist-service"); execution = await import("../lib/execution-service"); exports = await import("../lib/export-service");
  await db.appSettings.create({ data: { id: "singleton", basePrompt: "keep-base", systemPrompt: "keep-system", passwordHash: "private-hash", passwordSalt: "private-salt", apiKeyCiphertext: "private-secret", model: "keep-model" } });
});
beforeEach(async () => {
  vi.restoreAllMocks(); resumeInterruptedRestore(filename);
  await db.trip.updateMany({ data: { currentPlanVersionId: null } }); await db.trip.deleteMany();
});
afterAll(async () => { await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), replan?.closeReplanStore(), checklist?.closeChecklistStore(), execution?.closeExecutionStore(), exports?.closeExportStore(), db?.$disconnect()]); database?.cleanup(); });
function current() { return readInstanceState(filename); }
function snapshot() { return validateTravelBackup(readTravelBackup(filename)); }
function restore(backup: TravelBackup, hooks?: Parameters<typeof restoreTravelBackup>[3]) { return restoreTravelBackup(filename, backup, previewRestore(filename, backup), hooks); }
async function evidence(name: string, value: unknown) { const root = verificationEvidenceDirectory("phase28-core"); fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, `${name}.json`), JSON.stringify(value, null, 2)); }
async function fixture() {
  const trip = await trips.createTrip({ originalRequest: "长沙两天备份恢复隔离演练" });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture() });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision), content = planFixture(capture.requestSnapshot);
  return plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
}
const edit = (tripId: string, version: number, note = `edit-${version}`) => plans.savePlanEventEdit({ tripId, expectedPlanVersion: version, edit: { eventId: "d2-activity", timeEdit: "preserve", note, status: "suggested", locked: false, remove: false } });
const proposal = () => Promise.resolve({ ok: true as const, content: JSON.stringify({ requirementChange: null, edits: [{ eventId: "d2-activity", remove: false, fields: { note: "下雨改室内" } }] }) });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }

describe("阶段28：旅行备份、恢复屏障和持久换代", () => {
  it("round-trips rich travel data into an independent database, keeps settings, and can reopen/recalculate/export", async () => {
    let p = await fixture();
    p = await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: 1, action: { action: "activate", acknowledged: true, ticket: ticketFixture(p.requestSnapshot.startDate!) } });
    const cancelled = { ...p.tickets[0], id: "cancelled-history", status: "cancelled" as const, cancelledAt: new Date().toISOString() };
    await db.planVersion.update({ where: { id: p.id }, data: { tickets: JSON.stringify([...p.tickets, cancelled]) } });
    await db.evidenceFact.create({ data: { tripId: p.tripId, planVersionId: p.id, targetType: "event", targetId: "d1-activity", field: "opening_hours", status: "unverified", evaluationVersion: 1, sourceTitle: "合成来源", sourceUrl: "https://example.invalid/museum", sourcePublisher: "测试机构", extractedValue: "09:00–17:00", searchProvider: "synthetic", searchQuery: "开放时间", retrievedAt: new Date(), contentQuote: "备份应保留的来源摘录" } });
    const advisory = await import("../lib/advisory-service");
    const advisoryView = await advisory.getAdvisories(p.tripId, p.versionNumber);
    await db.advisoryState.create({ data: { tripId: p.tripId, planVersion: p.versionNumber, revision: 2, items: JSON.stringify(advisoryView.items), weather: JSON.stringify({ aiStatus: "not_configured", records: [] }) } });
    await advisory.closeAdvisoryStore();
    const view = await checklist.getChecklist(p.tripId, p.versionNumber);
    await checklist.saveChecklist(p.tripId, { expectedPlanVersion: p.versionNumber, expectedRevision: view.revision, expectedBasis: view.basis, change: { action: "complete", id: "essential:phone", completed: true } });
    await db.executionState.create({ data: { tripId: p.tripId, planVersion: p.versionNumber, revision: 3, payload: JSON.stringify({ startedAt: new Date().toISOString(), endedAt: null, currentEventId: "d1-activity", location: null, items: [] }) } });
    const backup = snapshot(), text = JSON.stringify(backup), budget = calculateBudgetSummary(p.costs, p.requestSnapshot);
    for (const excluded of ["private-secret", "private-hash", "private-salt", "dataGeneration", "activeRestoreId", "ReplanCandidate", "ExportFile", "AppSettings", "imageBase64"]) expect(text).not.toContain(excluded);
    const sourceDir = process.env.SERENDIPITY_DATA_DIR;
    const target = isolatedDatabase("independent-restore"); process.env.SERENDIPITY_DATA_DIR = sourceDir;
    const targetFile = path.join(target.directory, "data/serendipity.db");
    const targetDb = new DatabaseSync(targetFile);
    targetDb.prepare('INSERT INTO "AppSettings" (id, basePrompt, systemPrompt, model, updatedAt) VALUES (?, ?, ?, ?, ?)').run("singleton", "target-base", "target-system", "target-model", Date.now());
    const targetGeneration = readInstanceState(targetFile).dataGeneration;
    try {
      await restoreTravelBackup(targetFile, backup, previewRestore(targetFile, backup));
      expect(backupHash(readTravelBackup(targetFile))).toBe(backupHash(backup));
      expect(targetDb.prepare('SELECT model FROM "AppSettings"').get()!.model).toBe("target-model");
      expect(readInstanceState(targetFile).dataGeneration).not.toBe(targetGeneration);
      expect(Object.values(targetDb.prepare("PRAGMA integrity_check").get()!)[0]).toBe("ok");
      await evidence("independent-roundtrip", { sourceHash: backupHash(backup), targetHash: backupHash(readTravelBackup(targetFile)), tableCounts: Object.fromEntries(Object.entries(backup.tables).map(([name, rows]) => [name, rows.length])), ticketStates: ["active", "cancelled"], budget, configurationPreserved: true });
    } finally { targetDb.close(); target.cleanup(); }
    await restore(backup);
    const reopened = await plans.getPlanVersion(p.tripId, p.versionNumber);
    expect(calculateBudgetSummary(reopened.costs, reopened.requestSnapshot)).toEqual(budget);
    expect(reopened.tickets.map((t) => t.status)).toEqual(["active", "cancelled"]);
    expect(await db.evidenceFact.count()).toBe(1); expect(await db.advisoryState.count()).toBe(1);
    expect((await checklist.getChecklist(p.tripId, p.versionNumber)).items.some((i) => i.id === "essential:phone" && i.completed)).toBe(true);
    expect((await execution.getExecution(p.tripId)).execution.revision).toBe(3);
    expect(await exports.createExport(p.tripId, { expectedPlanVersion: p.versionNumber, format: "plain-text", options: {} })).toHaveProperty("id");
  // This integration case creates/restores two databases and exports after reopening.
  }, 30_000);
  it("T32: an in-flight V5/R5 generation cannot commit after restoring V4 and editing back to V5/R5", async () => {
    let p = await fixture();
    await db.tripRequest.update({ where: { tripId: p.tripId }, data: { requestRevision: 5, confirmedRevision: 5 } });
    for (let version = 1; version < 4; version++) p = await edit(p.tripId, version);
    const v4 = snapshot(); p = await edit(p.tripId, 4, "V5");
    const captured = await plans.getPlanGenerationContext(p.tripId, 5), oldGeneration = current().dataGeneration;
    const ready = deferred(), release = deferred();
    const old = businessOperation(async () => { ready.resolve(); await release.promise;
      return plans.savePlanVersion({ capture: captured, plan: planFixture(captured.requestSnapshot), validationResults: validatePlan(planFixture(captured.requestSnapshot), captured.requestSnapshot) });
    })();
    const rejected = expect(old).rejects.toMatchObject({ code: "DATA_CHANGED" }); await ready.promise;
    await restore(v4); p = await edit(p.tripId, 4, "V5-new");
    expect(p.versionNumber).toBe(captured.expectedPlanVersion);
    expect((await db.tripRequest.findUniqueOrThrow({ where: { tripId: p.tripId } })).requestRevision).toBe(5);
    release.resolve(); await rejected;
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(5);
    // A detached capture is also bound, even when called outside the old async scope.
    await expect(plans.savePlanVersion({ capture: captured, plan: planFixture(captured.requestSnapshot), validationResults: validatePlan(planFixture(captured.requestSnapshot), captured.requestSnapshot) })).rejects.toMatchObject({ code: "DATA_CHANGED" });
    await evidence("T32", { oldGeneration, newGeneration: current().dataGeneration, beforeV: 5, restoredV: 4, currentV: 5, requestRevision: 5, oldResult: "rejected by generation", versions: 5 });
  });
  it("rejects old pages, detached replan candidates and in-flight PDF registration", async () => {
    const p = await fixture(), backup = snapshot(), generation = current().dataGeneration;
    const candidate = await replan.previewReplan({ tripId: p.tripId, reason: "下雨", expectedPlanVersion: 1, expectedRequestRevision: p.requestRevision }, { completion: proposal });
    const candidateRow = await db.replanCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    const ready = deferred(), release = deferred();
    vi.spyOn(pdfRenderer, "printPdf").mockImplementation(async () => { ready.resolve(); await release.promise; return { schemaVersion: 1, pages: 1, bytes: 0, eventIds: [], base64: "" }; });
    const pending = exports.createExport(p.tripId, { expectedPlanVersion: 1, format: "pdf", options: {}, pdfContent: { mode: "simplified", includePhotos: false } });
    const rejected = expect(pending).rejects.toMatchObject({ code: "DATA_CHANGED" }); await ready.promise; await restore(backup); release.resolve(); await rejected;
    for (const write of [() => trips.createTrip({ originalRequest: "旧页面" }), () => trips.updateTrip(p.tripId, { title: "旧标题" }), () => trips.deleteTrip(p.tripId)]) await expect(withDataGeneration(generation, write)).rejects.toMatchObject({ code: "DATA_CHANGED" });
    expect(await db.exportFile.count()).toBe(0); expect(await db.replanCandidate.count()).toBe(0);
    // Simulate a retained candidate row to prove its own generation is checked.
    await db.replanCandidate.create({ data: candidateRow });
    await expect(replan.applyReplan(p.tripId, candidate.id, candidate.revision)).rejects.toMatchObject({ code: "DATA_CHANGED" });
  });
  it("checks the barrier inside commits that started earlier; safety copy precedes replacement", async () => {
    const p = await fixture(), backup = snapshot(), ready = deferred(), release = deferred();
    const old = businessOperation(async () => { ready.resolve(); await release.promise; return businessTransaction(db, (tx) => tx.trip.update({ where: { id: p.tripId }, data: { title: "迟到写入" } })); })();
    const rejected = expect(old).rejects.toMatchObject({ code: "RESTORE_ACTIVE" }); await ready.promise;
    const order: string[] = [];
    await restore(backup, { afterBarrier: async () => {
      order.push("persistent barrier"); expect(current().activeRestoreId).toBeTruthy();
      release.resolve(); await rejected;
      await expect(trips.createTrip({ originalRequest: "屏障期间" })).rejects.toMatchObject({ code: "RESTORE_ACTIVE" });
      expect(() => resumeInterruptedRestore(filename)).toThrow("仍在运行");
    }, afterSafety: () => {
      order.push("verified safety");
      const native = new DatabaseSync(filename); const op = native.prepare('SELECT * FROM "RestoreOperation" WHERE id = ?').get(current().activeRestoreId!)!; native.close();
      expect(backupHash(parseTravelBackup(fs.readFileSync(String(op.safetyPath), "utf8")))).toBe(backupHash(backup));
    }, afterReplace: () => { order.push("replacement + generation transaction"); } });
    expect(current().activeRestoreId).toBeNull(); await evidence("barrier-order", { order, priorCommit: "rejected", finalBarrier: null });
  });
  it.each(["safety-write", "disk-full", "replace"])("%s failure protects exact original and rotates before reopening", async (failure) => {
    await fixture(); const original = snapshot(), incoming = { ...original, tables: { ...original.tables, Trip: original.tables.Trip.map((t) => ({ ...t, title: "恢复目标" })) } };
    const generation = current().dataGeneration;
    const hooks = failure === "replace" ? { afterReplace: () => { throw new Error("injected replacement error"); } } : { beforeSafetyWrite: () => { throw Object.assign(new Error(failure), { code: failure === "disk-full" ? "ENOSPC" : "EACCES" }); } };
    await expect(restore(incoming, hooks)).rejects.toThrow("已保护或回退");
    expect(backupHash(snapshot())).toBe(backupHash(original)); expect(current().dataGeneration).not.toBe(generation); expect(current().activeRestoreId).toBeNull();
    expect(current().history[0].phase).toBe("rolled_back");
    await evidence(`failure-${failure}`, { originalHash: backupHash(original), afterHash: backupHash(snapshot()), generationChanged: true, reopened: true, faultInjection: failure });
  });
  it("retains the barrier if protection/generation cannot complete, then resumes and rotates", async () => {
    await fixture(); const original = snapshot(), generation = current().dataGeneration;
    await expect(restore(original, { beforeSafetyWrite: () => { throw new Error("ENOSPC"); }, beforeProtection: () => { throw new Error("protection unavailable"); } })).rejects.toThrow("写入继续暂停");
    expect(current().dataGeneration).toBe(generation); expect(current().activeRestoreId).toBeTruthy();
    await expect(trips.createTrip({ originalRequest: "禁止" })).rejects.toMatchObject({ code: "RESTORE_ACTIVE" });
    resumeInterruptedRestore(filename); expect(current().activeRestoreId).toBeNull(); expect(current().dataGeneration).not.toBe(generation);
    expect(backupHash(snapshot())).toBe(backupHash(original));
  });
  it("uses the verified safety copy for actual rollback and refuses a damaged copy until repaired", async () => {
    const p = await fixture(), original = snapshot(), generation = current().dataGeneration;
    await expect(restore(original, { afterSafety: () => { throw new Error("interrupted replacement"); }, beforeProtection: async () => {
      await db.trip.update({ where: { id: p.tripId }, data: { title: "损坏后的值" } }); throw new Error("defer recovery");
    } })).rejects.toThrow("写入继续暂停");
    const native = new DatabaseSync(filename); const op = native.prepare('SELECT safetyPath FROM "RestoreOperation" WHERE id = ?').get(current().activeRestoreId!)!; native.close();
    const target = String(op.safetyPath), content = fs.readFileSync(target, "utf8"); fs.writeFileSync(target, "damaged");
    expect(() => resumeInterruptedRestore(filename)).toThrow("安全副本校验失败"); expect(current().dataGeneration).toBe(generation); expect(current().activeRestoreId).toBeTruthy();
    fs.writeFileSync(target, content); resumeInterruptedRestore(filename);
    expect(backupHash(snapshot())).toBe(backupHash(original)); expect(current().dataGeneration).not.toBe(generation); expect(current().activeRestoreId).toBeNull();
    await evidence("actual-safety-rollback", { corruptedCopyKeptBarrier: true, repairedCopyRestoredOriginal: true, generationChanged: true });
  });
  it("a failed generation write rolls back replacement and cannot clear the barrier", async () => {
    await fixture(); const original = snapshot(), generation = current().dataGeneration;
    const native = new DatabaseSync(filename);
    native.exec(`CREATE TRIGGER fail_generation BEFORE UPDATE ON InstanceState WHEN NEW.dataGeneration != OLD.dataGeneration BEGIN SELECT RAISE(ABORT, 'generation failure'); END;`);
    try {
      await expect(restore(original)).rejects.toThrow("写入继续暂停");
      expect(current().activeRestoreId).toBeTruthy(); expect(current().dataGeneration).toBe(generation); expect(backupHash(snapshot())).toBe(backupHash(original));
    } finally { native.exec("DROP TRIGGER fail_generation"); native.close(); }
    resumeInterruptedRestore(filename); expect(current().dataGeneration).not.toBe(generation); expect(current().activeRestoreId).toBeNull();
  });
  it("real generation service rejects a delayed model result after V5→V4→V5", async () => {
    const generationService = await import("../lib/plan-generation");
    let p = await fixture(); for (let v = 1; v < 4; v++) p = await edit(p.tripId, v);
    const v4 = snapshot(); p = await edit(p.tripId, 4);
    const ready = deferred(), release = deferred();
    const old = generationService.generatePlanVersion({ tripId: p.tripId, expectedRequestRevision: p.requestRevision, expectedPlanVersion: 5,
      completion: async () => { ready.resolve(); await release.promise; return { ok: true, content: JSON.stringify(planFixture(p.requestSnapshot)) }; } });
    const rejected = expect(old).rejects.toMatchObject({ code: "DATA_CHANGED" }); await ready.promise;
    await restore(v4); p = await edit(p.tripId, 4, "当前有效V5"); release.resolve(); await rejected;
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(5);
  });
  it("SQLite technical backups restore only travel tables and never their instance or admin metadata", async () => {
    const p = await fixture(), original = snapshot(), technical = path.join(database.directory, "technical.db");
    const native = new DatabaseSync(filename); native.exec(`VACUUM INTO '${technical.replaceAll("'", "''")}'`); native.close();
    await trips.updateTrip(p.tripId, { title: "newer title" });
    await db.appSettings.update({ where: { id: "singleton" }, data: { model: "newer-config" } });
    const generation = current().dataGeneration;
    const run = (args: string[]) => spawnSync(process.execPath, ["scripts/technical-restore.mjs", database.directory, technical, ...args], { encoding: "utf8", windowsHide: true });
    const preview = run([]); expect(preview.status, preview.stderr).toBe(0);
    const result = run(["--confirm", JSON.parse(preview.stdout).confirmation]); expect(result.status, result.stderr).toBe(0);
    expect(backupHash(snapshot())).toBe(backupHash(original)); expect(current().dataGeneration).not.toBe(generation);
    expect((await db.appSettings.findUniqueOrThrow({ where: { id: "singleton" } })).model).toBe("newer-config");
  });
  it.each(["afterBarrier", "afterSafety", "afterReplace"])("real process interruption at %s preserves/rolls back then rotates on startup", async (point) => {
    await fixture(); const backup = snapshot(), generation = current().dataGeneration, source = path.join(database.directory, "crash-source.json");
    fs.writeFileSync(source, JSON.stringify(backup));
    const code = `import fs from 'node:fs'; import {previewRestore,restoreTravelBackup} from './scripts/restore-core.mjs'; const [db,file,point]=process.argv.slice(1); const b=JSON.parse(fs.readFileSync(file,'utf8')); await restoreTravelBackup(db,b,previewRestore(db,b),{[point]:()=>process.exit(86)});`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, filename, source, point], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
    expect(child.status, child.stderr).toBe(86); expect(current().activeRestoreId).toBeTruthy(); expect(current().dataGeneration).toBe(generation);
    const restart = spawnSync(process.execPath, ["scripts/ensure-database.mjs"], { env: { ...process.env, SERENDIPITY_DATA_DIR: database.directory }, encoding: "utf8", windowsHide: true });
    expect(restart.status, restart.stderr).toBe(0); expect(current().dataGeneration).not.toBe(generation); expect(current().activeRestoreId).toBeNull(); expect(backupHash(snapshot())).toBe(backupHash(backup));
    const restartedGeneration = current().dataGeneration; resumeInterruptedRestore(filename); expect(current().dataGeneration).toBe(restartedGeneration);
    await evidence(`interruption-${point}`, { childExit: child.status, startupExit: restart.status, originalGeneration: generation, recoveredGeneration: restartedGeneration, originalDataPreserved: true, ordinaryRestartPreserved: true });
  }, 30_000);
  it("validates corruption, unsupported version, malicious content, broken references and empty backups before setting a barrier", async () => {
    await fixture(); const original = snapshot(), generation = current().dataGeneration;
    const invalid = ["not json", { ...original, version: 0 }, { ...original, AppSettings: {} }, { ...original, dataGeneration: "forged" },
      { ...original, tables: { ...original.tables, Trip: [...original.tables.Trip, original.tables.Trip[0]] } },
      { ...original, tables: { ...original.tables, PlanVersion: original.tables.PlanVersion.map((p) => ({ ...p, events: '[{"note":"<script>bad</script>"}]' })) } },
      { ...original, tables: { ...original.tables, PlanVersion: original.tables.PlanVersion.map((p) => ({ ...p, events: '[{}]' })) } }];
    for (const value of invalid) expect(() => validateTravelBackup(value)).toThrow();
    expect(current().dataGeneration).toBe(generation); expect(current().activeRestoreId).toBeNull();
    const empty = validateTravelBackup({ format: "serendipity-travel", version: 1, createdAt: new Date().toISOString(), tables: Object.fromEntries(Object.keys(original.tables).map((t) => [t, []])) });
    expect(previewRestore(filename, empty).incoming.trips).toBe(0); await restore(empty); expect(await db.trip.count()).toBe(0);
    expect((await db.appSettings.findUniqueOrThrow({ where: { id: "singleton" } })).apiKeyCiphertext).toBe("private-secret");
  });
  it("rejects stale confirmation before the barrier, and technical restore/rollback uses the same protocol", async () => {
    const p = await fixture(), backup = snapshot(), preview = previewRestore(filename, backup), generation = current().dataGeneration;
    await trips.updateTrip(p.tripId, { title: "新编辑" });
    await expect(restoreTravelBackup(filename, backup, preview)).rejects.toThrow("重新预览"); expect(current().dataGeneration).toBe(generation);
    const source = path.join(database.directory, "technical.json"); fs.writeFileSync(source, JSON.stringify(backup));
    const run = (args: string[]) => spawnSync(process.execPath, ["scripts/technical-restore.mjs", database.directory, source, ...args], { encoding: "utf8", windowsHide: true });
    const first = run([]); expect(first.status, first.stderr).toBe(0); const confirmation = JSON.parse(first.stdout).confirmation;
    const commit = run(["--confirm", confirmation]); expect(commit.status, commit.stderr).toBe(0);
    expect(current().dataGeneration).not.toBe(generation); expect(current().history[0].source).toBe("technical"); expect(backupHash(snapshot())).toBe(backupHash(backup));
    const native = new DatabaseSync(filename); const safety = String(native.prepare('SELECT safetyPath FROM "RestoreOperation" WHERE id = ?').get(current().history[0].id)!.safetyPath); native.close();
    const rollbackPreview = spawnSync(process.execPath, ["scripts/technical-restore.mjs", database.directory, safety], { encoding: "utf8", windowsHide: true });
    const beforeRollback = current().dataGeneration;
    const rollback = spawnSync(process.execPath, ["scripts/technical-restore.mjs", database.directory, safety, "--confirm", JSON.parse(rollbackPreview.stdout).confirmation], { encoding: "utf8", windowsHide: true });
    expect(rollback.status, rollback.stderr).toBe(0); expect(current().dataGeneration).not.toBe(beforeRollback); expect((await trips.getTrip(p.tripId))!.title).toBe("新编辑");
  });
  it.each(["historical", "missing"])("R30-08 rejects a %s current pointer before preview or replacement and keeps valid restores editable", async (pointer) => {
    const first = await fixture();
    const latest = await edit(first.tripId, 1);
    const original = snapshot(), generation = current().dataGeneration;
    const confirmation = previewRestore(filename, original);
    const history = current().history;
    const malformed = structuredClone(original);
    malformed.tables.Trip[0].currentPlanVersionId = pointer === "historical" ? first.id : null;
    expect(() => validateTravelBackup(malformed)).toThrow("最新版本");
    expect(() => previewRestore(filename, malformed)).toThrow("最新版本");
    await expect(restoreTravelBackup(filename, malformed, confirmation)).rejects.toThrow("最新版本");
    expect(backupHash(snapshot())).toBe(backupHash(original));
    expect(current().dataGeneration).toBe(generation);
    expect(current().activeRestoreId).toBeNull();
    expect(current().history).toEqual(history);
    await restore(original);
    const third = await edit(first.tripId, latest.versionNumber, "恢复后首次编辑");
    const fourth = await edit(first.tripId, third.versionNumber, "恢复后继续编辑");
    expect([third.versionNumber, fourth.versionNumber]).toEqual([3, 4]);
    expect((await db.trip.findUniqueOrThrow({ where: { id: first.tripId } })).currentPlanVersionId).toBe(fourth.id);
  });
});
