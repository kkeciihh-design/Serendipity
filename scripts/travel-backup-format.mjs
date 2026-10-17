import { z } from "zod";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const text = z.string().max(2_000_000);
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const integer = z.number().int().nonnegative().max(2_147_483_647);
// Prisma SQLite stores DateTime as epoch milliseconds (older tools may use ISO).
const date = z.union([z.number().int().min(0).max(8_640_000_000_000_000), z.iso.datetime()]);
const dates = { createdAt: date, updatedAt: date };
const json = text.superRefine((value, ctx) => {
  try { inspectJson(JSON.parse(value)); } catch { ctx.addIssue({ code: "custom", message: "JSON内容无效或包含禁止字段。" }); }
});
const nullableJson = json.nullable();
const boolean = z.union([z.literal(0), z.literal(1)]);
const rows = {
  Trip: z.object({ id, title: z.string().min(1).max(160), originalRequest: z.string().min(1).max(12000), status: z.enum(["draft", "requirement_pending", "requirement_confirmed", "planned", "plan_needs_review", "plan_needs_update"]), currentPlanVersionId: id.nullable(), ...dates }).strict(),
  TripRequest: z.object({ id, tripId: id, originalRequest: text, requestRevision: integer.min(1), extractedRequest: nullableJson, fieldSources: nullableJson, defaultAssumptions: nullableJson, pendingQuestions: nullableJson, confirmedRequest: nullableJson, confirmedRevision: integer.min(1).nullable(), confirmedAt: date.nullable(), ...dates }).strict(),
  PlanVersion: z.object({ id, tripId: id, versionNumber: integer.min(1), requestRevision: integer.min(1), requestSnapshot: json, events: json, costs: json, places: json, routeLegs: json, tickets: json, pendingItems: json, validationResults: json, requirementUpToDate: boolean, ...dates }).strict(),
  EvidenceFact: z.object({ id, tripId: id, planVersionId: id, targetType: text, targetId: z.string().min(1).max(200), field: text, status: text, evaluationVersion: integer, sourceTitle: text, sourceUrl: text, sourcePublisher: text, sourcePublishedAt: date.nullable(), sourceDateStatus: text.nullable(), extractedValue: text, searchProvider: text, searchQuery: text, retrievedAt: date, applicableFrom: date.nullable(), applicableUntil: date.nullable(), lastRefreshAt: date.nullable(), lastRefreshStatus: text.nullable(), lastRefreshError: text.nullable(), contentQuote: text, conflictReason: text.nullable(), ...dates }).strict(),
  ChecklistState: z.object({ tripId: id, revision: integer.min(1), planVersion: integer.min(1), items: json, updatedAt: date }).strict(),
  ExecutionState: z.object({ tripId: id, revision: integer.min(1), planVersion: integer.min(1), payload: json, updatedAt: date }).strict(),
  AdvisoryState: z.object({ tripId: id, revision: integer, planVersion: integer.min(1), items: json, weather: json, updatedAt: date }).strict(),
};
export const TRAVEL_TABLES = Object.keys(rows);
export const tableColumns = Object.fromEntries(Object.entries(rows).map(([table, schema]) => [table, Object.keys(schema.shape)]));
const schema = z.object({ format: z.literal("serendipity-travel"), version: z.literal(1), createdAt: z.iso.datetime(),
  tables: z.object(Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, z.array(row).max(100000)]))).strict(),
}).strict();

function inspectJson(value, depth = 0) {
  if (depth > 40) throw new Error("嵌套太深");
  if (typeof value === "string" && /(?:javascript:|data:image\/|<\s*(?:script|iframe|object|embed)\b)/i.test(value)) throw new Error("不安全内容");
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    if (/^(?:__proto__|prototype|constructor|dataGeneration|activeRestoreId|apiKey|apiKeyCiphertext|passwordHash|passwordSalt|sessionToken|imageBase64|rawImage)$/i.test(key)) throw new Error("禁止字段");
    inspectJson(child, depth + 1);
  }
}
export function parseTravelBackup(raw) {
  if (typeof raw === "string" && Buffer.byteLength(raw) > MAX_BACKUP_BYTES) throw new Error("备份超过64 MiB上限。");
  let input;
  try { input = typeof raw === "string" ? JSON.parse(raw) : raw; inspectJson(input); } catch { throw new Error("备份不是有效的安全JSON文件。"); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error(`备份格式、版本或字段不支持（${parsed.error.issues[0]?.path.join(".") || "文件"}）。请使用本应用格式1的旅行备份。`);
  const backup = parsed.data, t = backup.tables;
  for (const name of TRAVEL_TABLES) t[name].sort((a, b) => {
    const left = a.id ?? a.tripId, right = b.id ?? b.tripId;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const name of TRAVEL_TABLES) {
    const keys = t[name].map((row) => row.id ?? row.tripId);
    if (new Set(keys).size !== keys.length) throw new Error(`备份${name}存在重复身份。`);
  }
  const trips = new Map(t.Trip.map((r) => [r.id, r]));
  const plans = new Map(t.PlanVersion.map((r) => [r.id, r]));
  const factKeys = t.EvidenceFact.map((r) => JSON.stringify([r.planVersionId, r.targetType, r.targetId, r.field]));
  if (new Set(factKeys).size !== factKeys.length) throw new Error("同一计划字段的来源记录重复。");
  const versions = new Set();
  const latestPlans = new Map();
  for (const plan of t.PlanVersion) {
    const key = `${plan.tripId}:${plan.versionNumber}`;
    if (versions.has(key)) throw new Error("计划版本重复。");
    versions.add(key);
    if (!latestPlans.has(plan.tripId) || latestPlans.get(plan.tripId).versionNumber < plan.versionNumber) latestPlans.set(plan.tripId, plan);
  }
  for (const name of TRAVEL_TABLES.filter((n) => n !== "Trip")) for (const row of t[name]) {
    if (!trips.has(row.tripId)) throw new Error("备份含不属于任何旅行的记录。");
    if (name === "EvidenceFact" && plans.get(row.planVersionId)?.tripId !== row.tripId) throw new Error("来源与计划归属不一致。");
    if (["ChecklistState", "ExecutionState", "AdvisoryState"].includes(name) && !versions.has(`${row.tripId}:${row.planVersion}`)) throw new Error("状态引用的计划不存在。");
  }
  for (const trip of t.Trip) {
    if (trip.currentPlanVersionId && plans.get(trip.currentPlanVersionId)?.tripId !== trip.id) throw new Error("当前计划指针不属于该旅行。");
    // New edits allocate current + 1; a historical or missing current pointer
    // would make an otherwise valid restore impossible to edit afterwards.
    if (trip.currentPlanVersionId !== (latestPlans.get(trip.id)?.id ?? null)) throw new Error("当前计划必须指向该旅行的最新版本；有历史计划时不能缺少当前计划。");
    const requests = t.TripRequest.filter((r) => r.tripId === trip.id);
    if (requests.length !== 1) throw new Error("每趟旅行必须有且只有一份需求。");
    const request = requests[0];
    if (request.confirmedRevision !== null && (request.confirmedRevision !== request.requestRevision || !request.confirmedRequest)) throw new Error("需求确认修订不一致。");
    if (request.originalRequest !== trip.originalRequest) throw new Error("旅行原话与需求不一致。");
    if (t.PlanVersion.some((p) => p.tripId === trip.id && p.requestRevision > request.requestRevision)) throw new Error("计划依据超出需求修订。");
  }
  return backup;
}
export const backupHash = (backup) => createHash("sha256").update(JSON.stringify(backup.tables)).digest("hex");
export const fileHash = (text) => createHash("sha256").update(text).digest("hex");
export function backupSummary(backup) {
  return { trips: backup.tables.Trip.length, plans: backup.tables.PlanVersion.length,
    events: backup.tables.PlanVersion.reduce((n, p) => n + JSON.parse(p.events).length, 0),
    titles: backup.tables.Trip.slice(0, 20).map((t) => t.title), createdAt: backup.createdAt };
}
