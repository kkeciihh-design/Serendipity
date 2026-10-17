import fs from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseTravelBackup, TRAVEL_TABLES, tableColumns, backupHash, fileHash, backupSummary } from "./travel-backup-format.mjs";

const active = globalThis.serendipityActiveRestores ??= new Set();

export class RestoreGuardError extends Error {
  constructor(code = "DATA_CHANGED") {
    super(code === "RESTORE_ACTIVE" ? "正在恢复旅行数据，写入已暂停。请等待恢复处理完成后重新载入页面。" : "旅行数据已恢复或页面已过期，请重新载入页面并核对最新数据后再操作。");
    this.name = "RestoreGuardError";
    this.code = code;
    this.status = code === "RESTORE_ACTIVE" ? 423 : 409;
  }
}
function connect(databasePath, readOnly = false) {
  const db = new DatabaseSync(databasePath, { readOnly });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
  return db;
}
function atomic(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = callback(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
function instance(db) {
  const row = db.prepare('SELECT * FROM "InstanceState" WHERE id = ?').get("singleton");
  if (!row) throw new Error("实例元数据缺失，请通过项目启动器完成迁移。");
  return row;
}
export function assertGeneration(state, expected) {
  if (state.activeRestoreId) throw new RestoreGuardError("RESTORE_ACTIVE");
  if (!expected || state.dataGeneration !== expected) throw new RestoreGuardError();
}
export function readInstanceState(databasePath) {
  const db = connect(databasePath, true);
  try {
    const state = instance(db);
    const latest = db.prepare('SELECT id, phase, source, message, startedAt, finishedAt FROM "RestoreOperation" ORDER BY startedAt DESC, rowid DESC LIMIT 10').all();
    return { ...state, history: latest };
  } finally { db.close(); }
}
function snapshot(db) {
  const tables = {};
  for (const name of TRAVEL_TABLES) tables[name] = db.prepare(`SELECT ${tableColumns[name].map((c) => `"${c}"`).join(",")} FROM "${name}" ORDER BY "${name === "Trip" || ["TripRequest", "PlanVersion", "EvidenceFact"].includes(name) ? "id" : "tripId"}"`).all();
  return parseTravelBackup({ format: "serendipity-travel", version: 1, createdAt: new Date().toISOString(), tables });
}
// A read transaction captures all travel tables from one SQLite snapshot.
export function readTravelBackup(databasePath) {
  const db = connect(databasePath, true);
  try {
    db.exec("BEGIN");
    try { const backup = snapshot(db); db.exec("COMMIT"); return backup; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
function verifyIntegrity(db) {
  if (Object.values(db.prepare("PRAGMA integrity_check").get())[0] !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("数据库完整性校验失败，写入保持暂停。");
}
function replaceTravel(db, backup) {
  db.exec('UPDATE "Trip" SET "currentPlanVersionId" = NULL; DELETE FROM "Trip";');
  // Cascades discard old preview candidates and regenerable export caches.
  for (const table of TRAVEL_TABLES) {
    const columns = tableColumns[table];
    const insert = db.prepare(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
    for (const row of backup.tables[table]) insert.run(...columns.map((column) => table === "Trip" && column === "currentPlanVersionId" ? null : row[column]));
  }
  const update = db.prepare('UPDATE "Trip" SET currentPlanVersionId = ? WHERE id = ?');
  for (const trip of backup.tables.Trip) update.run(trip.currentPlanVersionId, trip.id);
  verifyIntegrity(db);
  if (backupHash(snapshot(db)) !== backupHash(backup)) throw new Error("恢复后的关键数据与备份不一致。");
}
function finish(db, operationId, phase, message) {
  if (instance(db).activeRestoreId !== operationId) throw new Error("恢复记录归属已变化，保留屏障。");
  db.prepare('UPDATE "RestoreOperation" SET phase = ?, message = ?, finishedAt = ? WHERE id = ?').run(phase, message, new Date().toISOString(), operationId);
  db.prepare('UPDATE "InstanceState" SET dataGeneration = ?, activeRestoreId = NULL WHERE id = ?').run(randomUUID(), "singleton");
}
function safePath(databasePath, operationId) {
  return path.resolve(path.dirname(databasePath), "..", "backups", `before-restore-${operationId}.json`);
}
function verifiedSafety(databasePath, op) {
  // Never follow paths from imported files or arbitrary database values.
  if (!op.safetyPath || op.safetyPath !== safePath(databasePath, op.id)) throw new Error("安全副本路径无效，写入保持暂停。");
  const text = fs.readFileSync(op.safetyPath, "utf8");
  if (fileHash(text) !== op.safetyHash) throw new Error("安全副本校验失败，写入保持暂停。");
  const backup = parseTravelBackup(text);
  if (backupHash(backup) !== op.baselineHash) throw new Error("安全副本与恢复前数据不符，写入保持暂停。");
  return backup;
}
function protectOriginal(db, databasePath, operationId, message) {
  return atomic(db, () => {
    const op = db.prepare('SELECT * FROM "RestoreOperation" WHERE id = ?').get(operationId);
    if (!op) throw new Error("恢复记录缺失，写入保持暂停。");
    verifyIntegrity(db);
    // Replacement and generation commit together, so an unfinished operation
    // normally still has the intact original. Otherwise use its verified copy.
    let originalIntact = false;
    try { originalIntact = backupHash(snapshot(db)) === op.baselineHash; } catch { /* A verified safety copy can repair unreadable business fields. */ }
    if (!originalIntact) replaceTravel(db, verifiedSafety(databasePath, op));
    finish(db, operationId, "rolled_back", message);
    return instance(db);
  });
}
export function resumeInterruptedRestore(databasePath) {
  if (!fs.existsSync(databasePath)) return null;
  const db = connect(databasePath);
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='InstanceState'").get()) return null;
    const state = instance(db);
    if (!state.activeRestoreId) return state; // Ordinary restart preserves generation.
    const op = db.prepare('SELECT ownerPid FROM "RestoreOperation" WHERE id = ?').get(state.activeRestoreId);
    if (active.has(state.activeRestoreId)) throw new Error("恢复仍在运行，请等待完成后再查看。");
    if (op?.ownerPid && op.ownerPid !== process.pid) {
      let alive = true;
      try { process.kill(op.ownerPid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; }
      if (alive) throw new Error("另一个进程仍在处理恢复，写入继续暂停。");
    }
    return protectOriginal(db, databasePath, state.activeRestoreId, "检测到未完成恢复，原数据已保护或安全回退；已换代，请重新载入页面。");
  } finally { db.close(); }
}
export function previewRestore(databasePath, raw) {
  const backup = parseTravelBackup(raw), current = readTravelBackup(databasePath), state = readInstanceState(databasePath);
  assertGeneration(state, state.dataGeneration);
  return { incoming: backupSummary(backup), current: backupSummary(current), backupHash: backupHash(backup), currentHash: backupHash(current), dataGeneration: state.dataGeneration };
}
// Hooks are only supplied by isolated tests, never from HTTP/file/env inputs.
export async function restoreTravelBackup(databasePath, raw, confirmation, hooks = {}) {
  const backup = parseTravelBackup(raw);
  if (confirmation.backupHash !== backupHash(backup)) throw new Error("备份已变化，请重新预览。");
  const db = connect(databasePath), id = randomUUID();
  let barrierEstablished = false;
  try {
    atomic(db, () => {
      assertGeneration(instance(db), confirmation.dataGeneration);
      const baseline = snapshot(db);
      if (backupHash(baseline) !== confirmation.currentHash) throw new Error("当前旅行已变化，请重新预览影响范围。");
      verifyIntegrity(db);
      db.prepare('INSERT INTO "RestoreOperation" (id, phase, source, ownerPid, baselineHash, message, startedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, "preparing", confirmation.source === "technical" ? "technical" : "web", process.pid, backupHash(baseline), "写入暂停，正在制作恢复前安全副本。", new Date().toISOString());
      db.prepare('UPDATE "InstanceState" SET activeRestoreId = ? WHERE id = ?').run(id, "singleton");
    });
    barrierEstablished = true;
    active.add(id);
    await hooks.afterBarrier?.();
    const before = readTravelBackup(databasePath), target = safePath(databasePath, id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = JSON.stringify(before);
    const free = fs.statfsSync(path.dirname(target));
    const required = Buffer.byteLength(content) + Buffer.byteLength(JSON.stringify(backup)) * 3 + 8 * 1024 * 1024;
    if (free.bavail * free.bsize < required) throw new Error("磁盘空间不足");
    await hooks.beforeSafetyWrite?.();
    const fd = fs.openSync(target, "wx", 0o600);
    try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fileHash(fs.readFileSync(target)) !== fileHash(content) || backupHash(parseTravelBackup(fs.readFileSync(target, "utf8"))) !== backupHash(before)) throw new Error("安全副本写入校验失败。");
    atomic(db, () => {
      db.prepare('UPDATE "RestoreOperation" SET phase = ?, safetyPath = ?, safetyHash = ?, message = ? WHERE id = ?').run("ready", target, fileHash(content), "安全副本已验证，正在替换旅行数据。", id);
    });
    await hooks.afterSafety?.();
    atomic(db, () => {
      if (instance(db).activeRestoreId !== id) throw new Error("恢复屏障归属已变化。");
      verifiedSafety(databasePath, db.prepare('SELECT * FROM "RestoreOperation" WHERE id = ?').get(id));
      replaceTravel(db, backup);
      hooks.afterReplace?.();
      finish(db, id, "completed", "旅行恢复完成，已换代并重新开放操作。请重新载入页面。");
    });
    return { id, phase: "completed", ...backupSummary(backup) };
  } catch (error) {
    if (barrierEstablished && instance(db).activeRestoreId === id) {
      try { await hooks.beforeProtection?.(); protectOriginal(db, databasePath, id, "恢复未完成，原数据已保护或安全回退；已换代，请重新载入后重试。"); }
      catch { throw new Error("恢复处理尚未完成，写入继续暂停。请在数据管理中接续恢复，或重新启动应用；安全副本保留在本机。"); }
      throw new Error("恢复失败，原旅行已保护或回退。请重新载入页面后重试，并检查本机剩余空间。", { cause: error });
    }
    throw error;
  } finally { active.delete(id); db.close(); }
}
