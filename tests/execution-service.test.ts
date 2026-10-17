import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { isolatedDatabase } from "./helpers/test-database";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { validatePlan } from "../lib/plan";
import type { ExecutionChange } from "../lib/execution";
import type { PlanVersionRecord } from "../lib/plan-service";
import { ticketFixture } from "./helpers/ticket-fixtures";
vi.mock("../lib/settings", () => ({ storedAIConfiguration: async () => ({ provider: "openai-chat-completions", baseUrl: "http://127.0.0.1:9999", model: "isolated-test", apiKey: "test-only", basePrompt: "", systemPrompt: "" }) }));
let database: ReturnType<typeof isolatedDatabase>, db: PrismaClient;
let trips: typeof import("../lib/trips"), requests: typeof import("../lib/trip-request-service"), plans: typeof import("../lib/plan-service"), replan: typeof import("../lib/replan-service"), execution: typeof import("../lib/execution-service");
beforeAll(async () => {
  database = isolatedDatabase("unit-execution"); db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service"); plans = await import("../lib/plan-service"); replan = await import("../lib/replan-service"); execution = await import("../lib/execution-service");
});
afterAll(async () => { await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), replan?.closeReplanStore(), execution?.closeExecutionStore(), db?.$disconnect()]); database?.cleanup(); });
async function fixture() {
  const trip = await trips.createTrip({ originalRequest: "阶段23隔离执行演练" }), request = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture() });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: request.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, request.requestRevision), plan = planFixture(capture.requestSnapshot);
  return plans.savePlanVersion({ capture, plan, validationResults: validatePlan(plan, capture.requestSnapshot) });
}
async function write(p: PlanVersionRecord, change: ExecutionChange) {
  const { execution: state, plan } = await execution.getExecution(p.tripId);
  return execution.saveExecution(p.tripId, { expectedRevision: state.revision, expectedPlanVersion: plan.versionNumber, change });
}
const input = (p: PlanVersionRecord) => ({ tripId: p.tripId, reason: "下雨了", expectedPlanVersion: p.versionNumber, expectedRequestRevision: p.requestRevision });
const completion = async () => ({ ok: true as const, content: JSON.stringify({ requirementChange: null, edits: [{ eventId: "d2-activity", remove: false, fields: { note: "雨天改在室内" } }] }) });
describe("ExecutionState persistence and concurrent replan", () => {
  it("saves arrival/completion with server time and survives reconnect without adding PlanVersions", async () => {
    const p = await fixture(); await write(p, { action: "start", eventId: "d1-activity" });
    await write(p, { action: "arrive", eventId: "d1-activity" });
    const saved = await write(p, { action: "complete", eventId: "d1-activity" });
    expect(saved.execution.items[0].completedAt).toBeTruthy(); expect(saved.execution.items[0].arrivedAt).toBeTruthy();
    await execution.closeExecutionStore(); expect((await execution.getExecution(p.tripId)).execution).toEqual(saved.execution);
    expect(await db.planVersion.count({ where: { tripId: p.tripId } })).toBe(1);
  });
  it("CAS rejects duplicate/stale writes and requests aborted before commit", async () => {
    const p = await fixture(), raw = { expectedRevision: 0, expectedPlanVersion: 1, change: { action: "start", eventId: "d1-activity" } };
    const outcomes = await Promise.allSettled([execution.saveExecution(p.tripId, raw), execution.saveExecution(p.tripId, raw)]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const before = await db.executionState.findUniqueOrThrow({ where: { tripId: p.tripId } });
    await expect(execution.saveExecution(p.tripId, { ...raw, expectedRevision: 1, change: { action: "complete", eventId: "d1-activity" } }, AbortSignal.abort())).rejects.toThrow("取消");
    expect(await db.executionState.findUniqueOrThrow({ where: { tripId: p.tripId } })).toEqual(before);
  });
  it("generation in flight rejects when the traveller completes a step", async () => {
    const p = await fixture(); await write(p, { action: "start", eventId: "d1-activity" });
    await expect(replan.previewReplan(input(p), { completion: async () => { await write(p, { action: "complete", eventId: "d1-activity" }); return completion(); } })).rejects.toThrow("执行进度");
    expect((await execution.getExecution(p.tripId)).execution.items[0].completedAt).toBeTruthy();
    expect(await db.replanCandidate.count({ where: { tripId: p.tripId } })).toBe(0);
  });
  it.each(["after_preview", "before_commit"])("%s: completion prevents stale candidate commit", async (when) => {
    const p = await fixture(); await write(p, { action: "start", eventId: "d1-activity" });
    const candidate = await replan.previewReplan(input(p), { completion });
    const complete = async () => { await write(p, { action: "complete", eventId: "d1-activity" }); };
    if (when === "after_preview") await complete();
    await expect(replan.applyReplan(p.tripId, candidate.id, candidate.revision, undefined, when === "before_commit" ? { beforeCommit: complete } : {})).rejects.toThrow("执行进度");
    expect(await db.planVersion.count({ where: { tripId: p.tripId } })).toBe(1);
    expect((await execution.getExecution(p.tripId)).execution.items[0].completedAt).toBeTruthy();
  });
  it("manual location participates in capture and old phase22 candidates are rejected", async () => {
    const p = await fixture(), candidate = await replan.previewReplan(input(p), { completion });
    await write(p, { action: "manual_location", label: "站外广场" });
    await expect(replan.applyReplan(p.tripId, candidate.id, candidate.revision)).rejects.toThrow("位置");
    const c = await replan.previewReplan(input(p), { completion }), row = await db.replanCandidate.findUniqueOrThrow({ where: { id: c.id } }), payload = JSON.parse(row.payload);
    delete payload.capture.executionRevision; await db.replanCandidate.update({ where: { id: c.id }, data: { payload: JSON.stringify(payload) } });
    await expect(replan.applyReplan(p.tripId, c.id, c.revision)).rejects.toThrow("旧候选");
  });
  it("current, arrived and completed future events are frozen; other events may replan and undo", async () => {
    const p = await fixture(); await write(p, { action: "start", eventId: "d1-activity" }); await write(p, { action: "arrive", eventId: "d1-activity" }); await write(p, { action: "complete", eventId: "d1-activity" });
    const before = (await execution.getExecution(p.tripId)).execution;
    await expect(replan.previewReplan(input(p), { completion: async () => ({ ok: true, content: JSON.stringify({ requirementChange: null, edits: [{ eventId: "d1-activity", remove: true, fields: {} }] }) }) })).rejects.toThrow("保留事项");
    const candidate = await replan.previewReplan(input(p), { completion }); const applied = await replan.applyReplan(p.tripId, candidate.id, candidate.revision);
    expect(applied.outcome).toBe("applied"); if (applied.outcome !== "applied") return;
    expect((await execution.getExecution(p.tripId)).execution).toEqual({ ...before, planVersion: 2 });
    const undo = await replan.previewUndo(input(applied.plan)); await replan.applyReplan(p.tripId, undo.id, undo.revision);
    expect((await execution.getExecution(p.tripId)).execution).toEqual({ ...before, planVersion: 3 });
    await expect(execution.saveExecution(p.tripId, { expectedRevision: before.revision, expectedPlanVersion: 1, change: { action: "select", eventId: "d2-rest" } })).rejects.toThrow("计划");
  });
  it("basic plan regeneration cannot overwrite execution begun during generation", async () => {
    const p = await fixture(), capture = await plans.getPlanGenerationContext(p.tripId, p.requestRevision), plan = planFixture(capture.requestSnapshot);
    await write(p, { action: "start", eventId: "d1-activity" });
    await expect(plans.savePlanVersion({ capture, plan, validationResults: validatePlan(plan, capture.requestSnapshot) })).rejects.toThrow("执行进度");
    await expect(plans.getPlanGenerationContext(p.tripId, p.requestRevision)).rejects.toThrow("旅行已经开始");
  });
  it("after execution starts, elapsed but uncompleted transport is still a missed deadline", async () => {
    let p = await fixture();
    p = await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: 1, action: { action: "activate", acknowledged: true,
      ticket: ticketFixture(p.requestSnapshot.startDate!, { departureTime: "06:30", arrivalTime: "07:30", accessMode: "walking", accessDurationMinutes: 20 }) } });
    await write(p, { action: "start", eventId: "departure" });
    const deps = { completion, now: () => `${p.requestSnapshot.startDate}T09:00:00+08:00` };
    await expect(replan.previewReplan(input(p), deps)).rejects.toThrow("赶不上");
    await write(p, { action: "complete", eventId: "departure" });
    await expect(replan.previewReplan(input(p), deps)).resolves.toMatchObject({ status: "preview" });
  });
});
