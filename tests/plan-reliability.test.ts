import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isolatedDatabase } from "./helpers/test-database";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { validatePlan, type PlanCapture } from "../lib/plan";
import { calculateBudgetSummary } from "../lib/budget";
import type { RequestSnapshot } from "../lib/trip-request";

let database: ReturnType<typeof isolatedDatabase>;
let prisma: PrismaClient;
let trips: typeof import("../lib/trips");
let requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service");
let generation: typeof import("../lib/plan-generation");
let settings: typeof import("../lib/settings");
let server: http.Server;
let reply: unknown;
const capturedPrompts: string[] = [];
const syntheticKey = randomUUID();

beforeAll(async () => {
  database = isolatedDatabase("phase10r-plans");
  prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips");
  requests = await import("../lib/trip-request-service");
  plans = await import("../lib/plan-service");
  generation = await import("../lib/plan-generation");
  settings = await import("../lib/settings");
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    capturedPrompts.push(body.messages.find((message: { role: string }) => message.role === "user").content);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const configuration = {
    provider: "openai-chat-completions" as const,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    model: "controlled-test-model", apiKey: syntheticKey,
  };
  await settings.saveAIConfiguration(configuration, settings.createTestToken(configuration));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([prisma.$disconnect(), trips.closeTripStore(), requests.closeTripRequestStore(), plans.closePlanStore(), settings.closeSettingsStore()]);
  database.cleanup();
});

async function confirm(tripId: string, revision: number, request: RequestSnapshot) {
  const edited = await requests.saveRequestDraft(tripId, { expectedRequestRevision: revision, request });
  return requests.confirmRequest(tripId, { expectedRequestRevision: edited.requestRevision });
}

async function createConfirmed(snapshot = requestFixture()) {
  const originalRequest = "原始想法保持不变：两个人，节奏紧凑，住老城区。";
  const trip = await trips.createTrip({ originalRequest });
  const confirmed = await confirm(trip.id, 1, snapshot);
  const capture = await plans.getPlanGenerationContext(trip.id, confirmed.requestRevision);
  return { trip, confirmed, capture, originalRequest };
}

function save(capture: PlanCapture, plan = planFixture(capture.requestSnapshot)) {
  return plans.savePlanVersion({ capture, plan, validationResults: validatePlan(plan, capture.requestSnapshot) });
}

describe("confirmed generation inputs and protected user facts", () => {
  it.each([2, 4])("sends the full latest confirmed snapshot through the real model adapter for %i days", async (days) => {
    const initial = requestFixture(days, { pace: "packed", interests: ["旧偏好"], accommodation: "老城区", budgetAmountCents: 100000 });
    const { trip, confirmed, originalRequest } = await createConfirmed(initial);
    const revised = await confirm(trip.id, confirmed.requestRevision, {
      ...initial, travelerCount: 4, budgetAmountCents: 300000, budgetScope: "per_person", pace: "relaxed",
      interests: ["自然", "安静展览"], accommodation: "车站附近双床房", constraints: ["不自驾", "同行者行动不便", "下午留出休息"],
    });
    reply = planFixture(revised.confirmedRequest!);
    const before = capturedPrompts.length;
    const generated = await generation.generatePlanVersion({
      tripId: trip.id, expectedRequestRevision: revised.requestRevision, expectedPlanVersion: null,
    });
    expect(capturedPrompts.length).toBe(before + 1);
    const prompt = capturedPrompts.at(-1)!;
    const snapshotLine = prompt.split("\n").find((line) => line.startsWith("已确认需求快照："))!;
    const sent = JSON.parse(snapshotLine.slice("已确认需求快照：".length));
    expect(sent).toEqual(revised.confirmedRequest);
    expect(sent.pace).toBe("relaxed");
    expect(sent.interests).not.toContain("旧偏好");
    expect(prompt.includes(syntheticKey)).toBe(false);
    expect((await requests.getTripRequestRecord(trip.id)).originalRequest).toBe(originalRequest);
    expect(generated.requestSnapshot).toEqual(sent);
    expect(new Set(generated.events.map((event) => event.date)).size).toBe(days);
    expect(validatePlan(generated, generated.requestSnapshot).errors).toEqual([]);
  });

  it("strips model confirmation, locks and payment claims before saving, while preserving human operations", async () => {
    const { trip, capture } = await createConfirmed();
    const malicious = planFixture(capture.requestSnapshot);
    reply = {
      ...malicious,
      events: malicious.events.map((event) => ({ ...event, status: "confirmed", locked: true,
        costStatus: "user_confirmed", paymentStatus: "paid", certainty: "user_confirmed" })),
      costs: [{ paymentStatus: "paid", source: "user_confirmed" }],
    };
    const saved = await generation.generatePlanVersion({
      tripId: trip.id, expectedRequestRevision: capture.expectedRequestRevision, expectedPlanVersion: null,
    });
    expect(saved.events.every((event) => event.status === "suggested" && !event.locked && event.costStatus === "pending_confirmation")).toBe(true);
    expect(saved.costs.every((cost) => cost.paymentStatus === "not_paid" && cost.source === "ai_draft")).toBe(true);
    const edited = await plans.savePlanEventEdit({ tripId: trip.id, expectedPlanVersion: 1,
      edit: { eventId: "d1-activity", note: "用户亲自确认", status: "confirmed", locked: true, remove: false } });
    expect(edited.events.find((event) => event.id === "d1-activity")).toMatchObject({ status: "confirmed", locked: true });
    expect((await plans.getPlanVersion(trip.id, 1)).events.every((event) => !event.locked)).toBe(true);
  });

  for (const kind of ["locked", "confirmed_event", "confirmed_cost", "paid", "refund_pending"] as const) {
    it.each([false, true])(`rejects overwriting ${kind} facts (new requirement revision: %s) before AI and at commit`, async (newRevision) => {
      const { trip, capture, confirmed } = await createConfirmed();
      const first = await save(capture);
      const protectedPlan = kind === "locked" || kind === "confirmed_event"
        ? await plans.savePlanEventEdit({ tripId: trip.id, expectedPlanVersion: first.versionNumber, edit: {
          eventId: "d1-activity", note: null, status: kind === "confirmed_event" ? "confirmed" : "suggested",
          locked: kind === "locked", remove: false,
        } })
        : await plans.savePlanCostEdit({ tripId: trip.id, expectedPlanVersion: first.versionNumber, edit: {
          costId: "cost-d1-activity", unit: "per_person", unitAmountCents: 7200,
          unitAmountMaxCents: null, quantity: null, paymentStatus: kind === "confirmed_cost" ? "not_paid" : kind,
        } });
      const currentRequest = newRevision ? await confirm(trip.id, confirmed.requestRevision, {
        ...capture.requestSnapshot, travelerCount: 4, budgetAmountCents: 300000,
      }) : confirmed;
      const before = await plans.listPlanVersions(trip.id);
      const beforeBudget = calculateBudgetSummary(before[0].costs, before[0].requestSnapshot);
      const completion = vi.fn();
      await expect(generation.generatePlanVersion({ tripId: trip.id, expectedRequestRevision: currentRequest.requestRevision,
        expectedPlanVersion: protectedPlan.versionNumber, completion })).rejects.toThrow(/已保留当前计划/);
      expect(completion).not.toHaveBeenCalled();
      // Also exercise the transactional guard independently of the early check.
      await expect(save({ ...capture, expectedPlanVersion: protectedPlan.versionNumber,
        expectedRequestRevision: currentRequest.requestRevision, requestSnapshot: currentRequest.confirmedRequest!,
      })).rejects.toThrow(/已保留当前计划/);
      const after = await plans.listPlanVersions(trip.id);
      expect(after).toEqual(before);
      expect((await trips.getTrip(trip.id))?.currentPlanVersionId).toBe(protectedPlan.id);
      expect(calculateBudgetSummary(after[0].costs, after[0].requestSnapshot)).toEqual(beforeBudget);
      if (kind === "paid") expect(beforeBudget.paidMinCents).toBe(14400);
      if (kind === "refund_pending") expect(beforeBudget.refundPendingItemCount).toBe(1);
    });
  }

  it("still regenerates suggestion-only plans and switches all budget inputs to the new snapshot", async () => {
    const { trip, capture, confirmed } = await createConfirmed();
    const first = await save(capture);
    const revised = await confirm(trip.id, confirmed.requestRevision, {
      ...capture.requestSnapshot, travelerCount: 4, budgetAmountCents: 300000,
    });
    const second = await save(await plans.getPlanGenerationContext(trip.id, revised.requestRevision));
    expect(second.versionNumber).toBe(2);
    expect(calculateBudgetSummary(second.costs, second.requestSnapshot).factors.travelerCount).toBe(4);
    expect(calculateBudgetSummary(second.costs, second.requestSnapshot).budgetTargetCents).toBe(300000);
    expect((await plans.getPlanVersion(trip.id, 1)).requestSnapshot).toEqual(first.requestSnapshot);
  });

  it("rechecks hard structural constraints at save even if a caller claims validation succeeded", async () => {
    const { capture } = await createConfirmed();
    const bad = planFixture(capture.requestSnapshot);
    bad.events = bad.events.filter((event) => event.type !== "return_transport");
    await expect(plans.savePlanVersion({ capture, plan: bad,
      validationResults: { status: "valid", errors: [], warnings: [] } })).rejects.toThrow(/返程/);
    expect(await plans.listPlanVersions(capture.tripId)).toHaveLength(0);
  });

  it.each(["departure", "return"])("rejects a falsely validated destination plan outside the %s boundary before persisting", async (direction) => {
    const { capture } = await createConfirmed();
    const bad = planFixture(capture.requestSnapshot);
    Object.assign(bad.events.find((event) => event.id === direction)!, direction === "departure"
      ? { startTime: "15:00", endTime: "16:00" } : { startTime: "07:00", endTime: "08:00" });
    await expect(plans.savePlanVersion({ capture, plan: bad,
      validationResults: { status: "valid", errors: [], warnings: [] } })).rejects.toThrow(direction === "departure" ? /去程到达前/ : /返程出发后/);
    expect(await plans.listPlanVersions(capture.tripId)).toHaveLength(0);
    expect((await trips.getTrip(capture.tripId))?.currentPlanVersionId).toBeNull();
  });

  it("rejects an AI destination-order error after bounded repair without saving a plan", async () => {
    const { trip, capture } = await createConfirmed();
    const bad = planFixture(capture.requestSnapshot);
    Object.assign(bad.events.find((event) => event.id === "departure")!, { startTime: "15:00", endTime: "16:00" });
    reply = bad;
    const requestsBefore = capturedPrompts.length;
    await expect(generation.generatePlanVersion({ tripId: trip.id, expectedRequestRevision: capture.expectedRequestRevision,
      expectedPlanVersion: null })).rejects.toMatchObject({ name: "PlanGenerationError", category: "invalid_output" });
    expect(capturedPrompts.length - requestsBefore).toBe(2);
    expect(await plans.listPlanVersions(trip.id)).toHaveLength(0);
  });
});

describe("legacy event time integrity", () => {
  it("rechecks stored destination-order errors for current and historical reads without rewriting their data or budget basis", async () => {
    const { trip, capture, confirmed } = await createConfirmed();
    const first = await save(capture);
    const oldEvents = first.events.map((event) => event.id === "departure"
      ? { ...event, startTime: "15:00", endTime: "16:00" } : event);
    await prisma.planVersion.update({ where: { id: first.id }, data: {
      events: JSON.stringify(oldEvents), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: ["既有路线资料仍待复核"] }),
    } });
    const beforeCurrentRead = await prisma.planVersion.findUniqueOrThrow({ where: { id: first.id } });
    const current = await plans.getPlanVersion(trip.id, 1);
    expect(current.validationResults.status).toBe("invalid");
    expect(current.validationResults.errors.some((message) => message.includes("去程到达前"))).toBe(true);
    expect(current.validationResults.warnings).toContain("既有路线资料仍待复核");
    expect(await prisma.planVersion.findUniqueOrThrow({ where: { id: first.id } })).toEqual(beforeCurrentRead);

    const revised = await confirm(trip.id, confirmed.requestRevision, requestFixture(4, { destination: "杭州", travelerCount: 4 }));
    const second = await save(await plans.getPlanGenerationContext(trip.id, revised.requestRevision));
    const beforeHistoryRead = await prisma.planVersion.findUniqueOrThrow({ where: { id: first.id } });
    const historical = await plans.getPlanVersion(trip.id, 1);
    expect(historical.isCurrent).toBe(false);
    expect(historical.validationResults.status).toBe("invalid");
    expect(historical.validationResults.errors.some((message) => message.includes("去程到达前"))).toBe(true);
    expect(historical.validationResults.errors.some((message) => /日期必须等于|超出.*行程范围|没有安排/.test(message))).toBe(false);
    expect(historical.requestSnapshot).toEqual(capture.requestSnapshot);
    expect(historical.costs).toEqual(first.costs);
    expect(calculateBudgetSummary(historical.costs, historical.requestSnapshot).factors.travelerCount).toBe(2);
    expect(await prisma.planVersion.findUniqueOrThrow({ where: { id: first.id } })).toEqual(beforeHistoryRead);
    expect((await trips.getTrip(trip.id))?.currentPlanVersionId).toBe(second.id);
  });

  async function legacyPlan(crossesMidnight = false) {
    const { trip, capture } = await createConfirmed();
    const first = await save(capture);
    const legacy = first.events.map((event) => event.id === "d1-activity" ? {
      ...event, ...(crossesMidnight ? { startTime: "23:00", endTime: "01:00", endDate: null } : {}),
      suggestedDurationSeconds: 3600,
    } : event);
    await prisma.planVersion.update({ where: { id: first.id }, data: { events: JSON.stringify(legacy) } });
    return { trip, capture, first, legacy };
  }

  it.each(["note", "status", "locked"])("preserves legacy 10:00–12:00 during a %s-only edit and never rewrites history", async (field) => {
    const { trip, first, legacy } = await legacyPlan();
    const saved = await plans.savePlanEventEdit({ tripId: trip.id, expectedPlanVersion: 1, edit: {
      eventId: "d1-activity", startTime: "10:00", durationMinutes: 60,
      note: field === "note" ? "只改备注" : null, status: field === "status" ? "confirmed" : "suggested",
      locked: field === "locked", remove: false,
    } });
    expect(saved.events.find((event) => event.id === "d1-activity")).toMatchObject({
      startTime: "10:00", endTime: "12:00", endDate: first.requestSnapshot.startDate, suggestedDurationSeconds: 7200,
    });
    expect((await prisma.planVersion.findUniqueOrThrow({ where: { id: first.id } })).events).toBe(JSON.stringify(legacy));
    expect((await plans.getPlanVersion(trip.id, 1)).events.find((event) => event.id === "d1-activity")?.suggestedDurationSeconds).toBe(3600);
    expect(saved.versionNumber).toBe(2);
  });

  it("keeps cross-midnight times and the old request snapshot when notes change after a requirement revision", async () => {
    const { trip, capture, first, legacy } = await legacyPlan(true);
    await confirm(trip.id, capture.expectedRequestRevision, { ...capture.requestSnapshot, destination: "株洲" });
    const saved = await plans.savePlanEventEdit({ tripId: trip.id, expectedPlanVersion: 1, edit: {
      eventId: "d1-activity", timeEdit: "preserve", note: "夜间安排备注", status: "suggested", locked: false, remove: false,
    } });
    expect(saved.events.find((event) => event.id === "d1-activity")).toMatchObject({
      startTime: "23:00", endTime: "01:00", endDate: capture.requestSnapshot.endDate, suggestedDurationSeconds: 7200,
    });
    expect(saved.requestSnapshot).toEqual(first.requestSnapshot);
    expect(saved.requirementUpToDate).toBe(false);
    expect((await prisma.planVersion.findUniqueOrThrow({ where: { id: first.id } })).events).toBe(JSON.stringify(legacy));
  });

  it("normalizes inconsistent AI durations and new cost-edit snapshots without changing historical times", async () => {
    const { capture } = await createConfirmed();
    const inconsistent = planFixture(capture.requestSnapshot);
    inconsistent.events.forEach((event) => { event.suggestedDurationSeconds = 3600; });
    const generated = await save(capture, inconsistent);
    expect(generated.events.find((event) => event.id === "d1-activity")?.suggestedDurationSeconds).toBe(7200);
    const { trip, first, legacy } = await legacyPlan();
    const edited = await plans.savePlanCostEdit({ tripId: trip.id, expectedPlanVersion: 1, edit: {
      costId: "cost-d1-activity", unit: "one_time", unitAmountCents: 6000,
      unitAmountMaxCents: null, quantity: null, paymentStatus: "paid",
    } });
    expect(edited.events.find((event) => event.id === "d1-activity")).toMatchObject({ startTime: "10:00", endTime: "12:00", suggestedDurationSeconds: 7200 });
    expect((await prisma.planVersion.findUniqueOrThrow({ where: { id: first.id } })).events).toBe(JSON.stringify(legacy));
  });
});
