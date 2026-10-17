import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { attractionCatalog } from "../lib/attraction-catalog";
import { executionSummary, type ExecutionChange } from "../lib/execution";
import { validatePlan } from "../lib/plan";
import type { PlanVersionRecord } from "../lib/plan-service";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { isolatedDatabase } from "./helpers/test-database";

let database: ReturnType<typeof isolatedDatabase>, db: PrismaClient;
let trips: typeof import("../lib/trips"), requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service"), execution: typeof import("../lib/execution-service");
let attractions: typeof import("../lib/attraction-service"), restaurants: typeof import("../lib/restaurant-service");
let evidence: typeof import("../lib/evidence-service"), maps: typeof import("../lib/map-settings");
let afterPlanCreate: (() => void) | undefined, afterChecklistWrite: (() => void) | undefined;

beforeAll(async () => {
  database = isolatedDatabase("unit-execution-fact-guards");
  db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  // Hooks run after real SQLite writes inside the interactive transaction.
  // They deterministically reproduce cancellation while the transaction is open.
  const planClient = db.$extends({ query: {
    planVersion: { async create({ args, query }) { const result = await query(args); afterPlanCreate?.(); return result; } },
    checklistState: { async updateMany({ args, query }) { const result = await query(args); afterChecklistWrite?.(); return result; } },
  } });
  (globalThis as typeof globalThis & { serendipityPlanPrisma?: PrismaClient }).serendipityPlanPrisma = planClient as unknown as PrismaClient;
  trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service");
  plans = await import("../lib/plan-service"); execution = await import("../lib/execution-service");
  attractions = await import("../lib/attraction-service"); restaurants = await import("../lib/restaurant-service");
  evidence = await import("../lib/evidence-service"); maps = await import("../lib/map-settings");
});
afterEach(() => { afterPlanCreate = undefined; afterChecklistWrite = undefined; });
afterAll(async () => {
  await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(),
    execution?.closeExecutionStore(), evidence?.closeEvidenceStore(), maps?.closeMapSettingsStore(), db?.$disconnect()]);
  delete (globalThis as typeof globalThis & { serendipityPlanPrisma?: PrismaClient }).serendipityPlanPrisma;
  database?.cleanup();
});

async function fixture() {
  const trip = await trips.createTrip({ originalRequest: "R30-02/R30-07 隔离回归" });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture() });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision), plan = planFixture(capture.requestSnapshot);
  plan.events.push({ ...plan.events.find((event) => event.id === "d1-activity")!, id: "optional", title: "已实际参观的展览", startTime: "15:00", endTime: "16:00", suggestedDurationSeconds: 3600 });
  return plans.savePlanVersion({ capture, plan, validationResults: validatePlan(plan, capture.requestSnapshot) });
}
async function write(plan: PlanVersionRecord, change: ExecutionChange) {
  const current = await execution.getExecution(plan.tripId);
  return execution.saveExecution(plan.tripId, { expectedRevision: current.execution.revision, expectedPlanVersion: current.plan.versionNumber, change });
}
async function reach(plan: PlanVersionRecord, eventId: string, state: "current" | "arrived" | "completed") {
  await write(plan, { action: "start", eventId });
  if (state !== "current") await write(plan, { action: "arrive", eventId });
  if (state === "completed") await write(plan, { action: "complete", eventId });
}
const edit = (eventId: string) => ({ eventId, note: null, locked: false, status: "suggested" as const, remove: false });
const pricing = { dinerCount: 2, minCents: 1800, maxCents: 2500 };

describe("execution facts survive every earlier editing entry point", () => {
  it.each(["current", "arrived", "completed"] as const)("%s visits reject deletion, time changes and map retargeting", async (state) => {
    const plan = await fixture(); await reach(plan, "optional", state);
    const before = (await execution.getExecution(plan.tripId)).execution;
    for (const change of [{ ...edit("optional"), remove: true }, { ...edit("optional"), timeEdit: "start_duration" as const, startTime: "15:30", durationMinutes: 30 }]) {
      await expect(plans.savePlanEventEdit({ tripId: plan.tripId, expectedPlanVersion: 1, edit: change })).rejects.toThrow("实际进度已保留");
    }
    await expect(plans.savePlanPlaceEdit({ tripId: plan.tripId, expectedPlanVersion: 1, eventId: "optional", precision: "poi",
      candidate: attractionCatalog.find((entry) => entry.id === "yuelu-academy")!.location! })).rejects.toThrow("实际进度已保留");
    const after = await execution.getExecution(plan.tripId);
    expect(after.execution).toEqual(before); expect(after.plan).toEqual(plan);
    expect(executionSummary(after.plan.events, after.execution, Date.now()).completedCount).toBe(state === "completed" ? 1 : 0);
    expect(await db.planVersion.count({ where: { tripId: plan.tripId } })).toBe(1);
  });

  it("notes and future events remain editable without changing a completed visit", async () => {
    let plan = await fixture(); await reach(plan, "optional", "completed");
    const before = (await execution.getExecution(plan.tripId)).execution;
    const original = plan.events.find((event) => event.id === "optional")!;
    plan = await plans.savePlanEventEdit({ tripId: plan.tripId, expectedPlanVersion: 1, edit: { ...edit("optional"), note: "补充参观笔记" } });
    plan = await plans.savePlanEventEdit({ tripId: plan.tripId, expectedPlanVersion: 2, edit: { ...edit("d2-rest"), timeEdit: "start_duration", startTime: "14:15", durationMinutes: 15 } });
    expect(plan.events.find((event) => event.id === "optional")).toEqual({ ...original, endDate: original.date, note: "补充参观笔记" });
    expect((await execution.getExecution(plan.tripId)).execution).toEqual({ ...before, planVersion: 3 });
  });

  it.each(["current", "arrived", "completed"] as const)("%s attractions and meals cannot produce replacement previews", async (state) => {
    const activity = await fixture(); await reach(activity, "d1-activity", state);
    await expect(attractions.previewAttractionReplacement(activity.tripId, 1, "d1-activity", "yuelu-academy")).rejects.toThrow("不能替换");
    const meal = await fixture(); await reach(meal, "d1-lunch", state);
    await expect(restaurants.previewRestaurantEdit(meal.tripId, 1, "d1-lunch", "xiaoer-tongtai", pricing)).rejects.toThrow("不能通过推荐改写");
    expect(await db.planVersion.count({ where: { tripId: { in: [activity.tripId, meal.tripId] } } })).toBe(2);
  });

  it.each(["attraction", "restaurant"] as const)("%s preview cannot commit after completion in another page", async (kind) => {
    const plan = await fixture(), eventId = kind === "attraction" ? "d1-activity" : "d1-lunch";
    const preview = kind === "attraction" ? await attractions.previewAttractionReplacement(plan.tripId, 1, eventId, "yuelu-academy") :
      await restaurants.previewRestaurantEdit(plan.tripId, 1, eventId, "xiaoer-tongtai", pricing);
    expect(preview.canApply).toBe(true);
    await reach(plan, eventId, "completed"); const before = await execution.getExecution(plan.tripId);
    const apply = () => kind === "attraction" ? attractions.applyAttractionReplacement(plan.tripId, 1, eventId, "yuelu-academy", preview.previewToken) :
      restaurants.applyRestaurantEdit(plan.tripId, 1, eventId, preview.previewToken);
    await expect(apply()).rejects.toThrow("执行进度");
    expect(await execution.getExecution(plan.tripId)).toMatchObject({ execution: before.execution, plan });
    expect(await db.planVersion.count({ where: { tripId: plan.tripId } })).toBe(1);
  });

  it("a forged latest revision cannot transfer old execution facts to a new venue", async () => {
    const plan = await fixture(); await reach(plan, "d1-activity", "completed");
    const capture = await plans.getPlanExecutionCapture(plan.tripId, 1), before = plan.events.find((event) => event.id === "d1-activity")!;
    await expect(plans.savePlanAttractionEdit({ tripId: plan.tripId, expectedPlanVersion: 1, expectedExecutionRevision: capture.revision,
      eventId: before.id, action: "replace", event: { ...before, title: "新景点", locationName: "新景点" },
      places: plan.places, costs: plan.costs, routeLegs: plan.routeLegs, pendingItems: plan.pendingItems, warnings: [] })).rejects.toThrow("实际进度已保留");
    expect(await db.planVersion.count({ where: { tripId: plan.tripId } })).toBe(1);
  });

  it("a position change invalidates an otherwise applicable cached recommendation", async () => {
    const plan = await fixture();
    const preview = await attractions.previewAttractionReplacement(plan.tripId, 1, "d1-activity", "yuelu-academy");
    await write(plan, { action: "manual_location", label: "公共广场" });
    await expect(attractions.applyAttractionReplacement(plan.tripId, 1, "d1-activity", "yuelu-academy", preview.previewToken)).rejects.toThrow("执行进度或位置");
    expect(await db.planVersion.count({ where: { tripId: plan.tripId } })).toBe(1);
  });
});

describe("generation cancellation rolls back the complete transaction", () => {
  it.each(["after_plan_create", "after_checklist_write"] as const)("%s preserves the old plan, pointer and checklist", async (when) => {
    const plan = await fixture(), capture = await plans.getPlanGenerationContext(plan.tripId, plan.requestRevision);
    const content = planFixture(capture.requestSnapshot), controller = new AbortController();
    const priorTrip = await db.trip.findUniqueOrThrow({ where: { id: plan.tripId } });
    const priorChecklist = await db.checklistState.findUniqueOrThrow({ where: { tripId: plan.tripId } });
    if (when === "after_plan_create") afterPlanCreate = () => controller.abort();
    else afterChecklistWrite = () => controller.abort();
    await expect(plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot), abortSignal: controller.signal })).rejects.toThrow("生成已取消");
    expect(controller.signal.aborted).toBe(true);
    expect(await db.trip.findUniqueOrThrow({ where: { id: plan.tripId } })).toEqual(priorTrip);
    expect(await db.checklistState.findUniqueOrThrow({ where: { tripId: plan.tripId } })).toEqual(priorChecklist);
    expect(await plans.listPlanVersions(plan.tripId)).toEqual([plan]);
  });
});
