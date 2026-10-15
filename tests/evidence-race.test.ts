import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { derivePlanCosts } from "../lib/budget";
import { CURRENT_EVIDENCE_EVALUATION_VERSION, summarizeEventEvidence, type EvidenceField } from "../lib/evidence";
import type { EvidenceTarget } from "../lib/evidence-evaluation";
import type { EvidenceCandidate, collectEvidence } from "../lib/evidence-source";
import { collectEvidence as collectFromPages } from "../lib/evidence-source";
import { nextPlanDate } from "../lib/plan";
import { isolatedDatabase } from "./helpers/test-database";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

let database: ReturnType<typeof isolatedDatabase>;
let prisma: PrismaClient;
let evidence: typeof import("../lib/evidence-service");
let plans: typeof import("../lib/plan-service");
let settings: typeof import("../lib/settings");

beforeAll(async () => {
  database = isolatedDatabase("evidence-race");
  prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  evidence = await import("../lib/evidence-service");
  plans = await import("../lib/plan-service");
  settings = await import("../lib/settings");
  const config = { provider: "duckduckgo" as const, language: "en" as const };
  await settings.saveSearchConfiguration(config, settings.createSearchTestToken(config));
});

afterAll(async () => {
  await Promise.all([prisma?.$disconnect(), evidence?.closeEvidenceStore(), plans?.closePlanStore(), settings?.closeSettingsStore()]);
  database?.cleanup();
});

async function seed(field: EvidenceField = "opening_hours") {
  const snapshot = requestFixture();
  const plan = planFixture(snapshot);
  const event = plan.events.find((item) => item.id === "d1-activity")!;
  event.note = "Reservations are required.";
  event.locationName = "10 Museum Road";
  const costs = derivePlanCosts(plan.events);
  const trip = await prisma.trip.create({ data: { title: "受控来源并发测试", originalRequest: "测试需求", status: "planned" } });
  const row = await prisma.planVersion.create({ data: {
    tripId: trip.id, versionNumber: 1, requestRevision: 1, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(plan.events), costs: JSON.stringify(costs), pendingItems: JSON.stringify(plan.pendingItems),
    validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }),
  } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id } });
  return { trip, row, event, costs, input: { tripId: trip.id, expectedPlanVersion: 1, eventId: event.id, field,
    query: "Example Museum visitor information", officialHost: "example.com" } };
}

function supported(target: EvidenceTarget, field: EvidenceField, changes: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    status: "verified", readStatus: "read", sourceTitle: "Example Museum", sourceUrl: "https://www.example.com/visit",
    sourcePublisher: "www.example.com", sourcePublishedAt: null, sourceDateStatus: "applicable",
    applicableFrom: new Date(`${target.event.date}T00:00:00+08:00`),
    applicableUntil: new Date(`${nextPlanDate(target.event.endDate ?? target.event.date)}T23:59:59+08:00`),
    extractedValue: field === "opening_hours" ? "09:00–17:00" : field === "price" ? "18 元（一次性）" : field === "location" ? "10 Museum Road" : "required",
    contentQuote: "Example Museum official field value and explicit validity dates.", conflictReason: null, ...changes,
  };
}
const successCollector: typeof collectEvidence = async ({ target, field }) => supported(target!, field);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function controlled() {
  const started = deferred<Parameters<typeof collectEvidence>[0]>();
  const response = deferred<EvidenceCandidate>();
  const collector: typeof collectEvidence = async (input) => { started.resolve(input); return response.promise; };
  return { started: started.promise, response, collector };
}

type Edit = "note" | "schedule" | "cost";
async function editPlan(fixture: Awaited<ReturnType<typeof seed>>, edit: Edit) {
  if (edit === "cost") {
    return plans.savePlanCostEdit({ tripId: fixture.trip.id, expectedPlanVersion: 1, edit: {
      costId: fixture.costs.find((cost) => cost.linkedEventId === fixture.event.id)!.id,
      unit: "one_time", unitAmountCents: 2300, unitAmountMaxCents: null, quantity: null, paymentStatus: "paid",
    } });
  }
  return plans.savePlanEventEdit({ tripId: fixture.trip.id, expectedPlanVersion: 1, edit: {
    eventId: fixture.event.id, note: "Reservations are required. 带雨伞。", status: "suggested", locked: false, remove: false,
    ...(edit === "schedule" ? { timeEdit: "start_duration" as const, startTime: "10:00", durationMinutes: 135 } : { timeEdit: "preserve" as const }),
  } });
}
async function snapshotState(tripId: string) {
  return {
    trip: await prisma.trip.findUniqueOrThrow({ where: { id: tripId } }),
    plans: await prisma.planVersion.findMany({ where: { tripId }, orderBy: { versionNumber: "asc" } }),
    facts: await prisma.evidenceFact.findMany({ where: { tripId }, orderBy: [{ planVersionId: "asc" }, { field: "asc" }] }),
  };
}

describe("SD-07 asynchronous source refresh boundaries", () => {
  it("keeps legacy stored and inherited opening evidence stale until the full page is evaluated again", async () => {
    const fixture = await seed();
    const original = await prisma.evidenceFact.create({ data: {
      tripId: fixture.trip.id, planVersionId: fixture.row.id, targetType: "event", targetId: fixture.event.id,
      field: "opening_hours", status: "verified", sourceTitle: "Example Museum", sourceUrl: "https://www.example.com/visit",
      sourcePublisher: "www.example.com", sourceDateStatus: "applicable", extractedValue: "09:00–17:00",
      contentQuote: "Opening hours daily 09:00–17:00.", searchProvider: "duckduckgo", searchQuery: "Example Museum",
      retrievedAt: new Date(), applicableFrom: new Date(`${fixture.event.date}T00:00:00+08:00`),
      applicableUntil: new Date(`${nextPlanDate(fixture.event.date)}T23:59:59+08:00`), lastRefreshStatus: "success",
    } });
    expect(original.evaluationVersion).toBe(0);
    await evidence.closeEvidenceStore();
    expect((await evidence.listEvidenceFacts(fixture.trip.id))[0]).toMatchObject({ status: "verified", evaluationVersion: 0, effectiveStatus: "stale" });
    expect(await prisma.evidenceFact.findUnique({ where: { id: original.id } })).toEqual(original);

    const next = await editPlan(fixture, "note");
    const inherited = (await evidence.listEvidenceFacts(fixture.trip.id)).find((fact) => fact.planVersionId === next.id)!;
    expect(inherited).toMatchObject({ status: "verified", evaluationVersion: 0, effectiveStatus: "stale" });
    expect(inherited.conflictReason).toContain("重新读取完整来源");
    const refreshed = await evidence.verifyEvidenceFact({ ...fixture.input, expectedPlanVersion: next.versionNumber }, {
      collectEvidence: (input) => collectFromPages({ ...input,
        lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: async (url) => new Response(url.startsWith("https://html.duckduckgo.com/")
          ? '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fvisit">Example Museum</a>'
          : `<title>Example Museum</title><p>Valid from ${fixture.event.date} to ${nextPlanDate(fixture.event.date)}</p><p>Opening hours daily 09:00–17:00.</p>`,
        { headers: { "content-type": "text/html" } }),
      }),
    });
    expect(refreshed).toMatchObject({ status: "verified", effectiveStatus: "verified", evaluationVersion: CURRENT_EVIDENCE_EVALUATION_VERSION });
    expect(await prisma.evidenceFact.findUnique({ where: { id: original.id } })).toEqual(original);
    await evidence.closeEvidenceStore();
    expect((await evidence.listEvidenceFacts(fixture.trip.id)).find((fact) => fact.planVersionId === next.id)).toMatchObject({ effectiveStatus: "verified", evaluationVersion: CURRENT_EVIDENCE_EVALUATION_VERSION });
  });

  const scenarios = (["note", "schedule", "cost"] as const).flatMap((edit) =>
    (["success", "throw", "failed_result"] as const).map((outcome) => ({ edit, outcome })));
  it.each(scenarios)("keeps both snapshots and pointer unchanged after late $outcome with a $edit edit", async ({ edit, outcome }) => {
    const fixture = await seed(edit === "cost" ? "price" : "opening_hours");
    const original = await evidence.verifyEvidenceFact(fixture.input, { collectEvidence: successCollector });
    expect(original.effectiveStatus).toBe("verified");
    const pending = controlled();
    const request = evidence.verifyEvidenceFact(fixture.input, { collectEvidence: pending.collector });
    const captured = await pending.started;
    const inFlight = (await evidence.listEvidenceFacts(fixture.trip.id))[0];
    expect(inFlight).toMatchObject({ status: "verified", effectiveStatus: "stale", lastRefreshStatus: "refreshing" });
    expect(inFlight.contentQuote).toBe(original.contentQuote);

    const next = await editPlan(fixture, edit);
    expect(next.versionNumber).toBe(2);
    const beforeLate = await snapshotState(fixture.trip.id);
    const inherited = (await evidence.listEvidenceFacts(fixture.trip.id)).filter((fact) => fact.planVersionId === next.id);
    expect(inherited[0]).toMatchObject({ lastRefreshStatus: "needs_review", effectiveStatus: "stale", sourceUrl: original.sourceUrl });
    expect(summarizeEventEvidence(inherited)).toMatchObject({ status: "stale", label: "来源需复核" });
    expect(beforeLate.plans[0]).toEqual(fixture.row);
    expect(beforeLate.trip.currentPlanVersionId).toBe(next.id);

    const rejected = expect(request).rejects.toMatchObject({ name: "EvidenceConflictError" });
    if (outcome === "throw") pending.response.reject(new Error("受控读取失败"));
    else pending.response.resolve(supported(captured.target!, fixture.input.field, outcome === "failed_result"
      ? { readStatus: "failed", status: "unverified", conflictReason: "受控读取失败" }
      : { sourceUrl: "https://www.example.com/late", contentQuote: "迟到的成功正文" }));
    await rejected;
    expect(await snapshotState(fixture.trip.id)).toEqual(beforeLate);
    expect(summarizeEventEvidence((await evidence.listEvidenceFacts(fixture.trip.id)).filter((fact) => fact.planVersionId === next.id)).status).toBe("stale");
    if (edit === "cost") expect(next.costs.find((cost) => cost.linkedEventId === fixture.event.id)).toMatchObject({ unitAmountCents: 2300, paymentStatus: "paid" });
  });

  it.each(["success", "failure"] as const)("inherits a first-ever refresh conservatively before late %s", async (outcome) => {
    const fixture = await seed();
    const pending = controlled();
    const request = evidence.verifyEvidenceFact(fixture.input, { collectEvidence: pending.collector });
    const captured = await pending.started;
    const next = await editPlan(fixture, "note");
    const before = await snapshotState(fixture.trip.id);
    const facts = await evidence.listEvidenceFacts(fixture.trip.id);
    expect(facts).toHaveLength(2);
    expect(facts.find((fact) => fact.planVersionId === next.id)).toMatchObject({ status: "unverified", lastRefreshStatus: "needs_review", effectiveStatus: "stale" });
    const rejected = expect(request).rejects.toMatchObject({ name: "EvidenceConflictError" });
    if (outcome === "failure") pending.response.reject(new Error("首次读取失败"));
    else pending.response.resolve(supported(captured.target!, fixture.input.field));
    await rejected;
    expect(await snapshotState(fixture.trip.id)).toEqual(before);
  });

  it.each(["success", "failure"] as const)("rejects older same-field %s even when the plan version is unchanged", async (outcome) => {
    const fixture = await seed();
    const pending = controlled();
    const older = evidence.verifyEvidenceFact(fixture.input, { collectEvidence: pending.collector });
    const captured = await pending.started;
    await evidence.verifyEvidenceFact(fixture.input, { collectEvidence: successCollector });
    const before = await snapshotState(fixture.trip.id);
    const rejected = expect(older).rejects.toMatchObject({ name: "EvidenceConflictError" });
    if (outcome === "failure") pending.response.reject(new Error("旧请求失败"));
    else pending.response.resolve(supported(captured.target!, fixture.input.field, { contentQuote: "旧请求的正文" }));
    await rejected;
    expect(await snapshotState(fixture.trip.id)).toEqual(before);
    expect((await evidence.listEvidenceFacts(fixture.trip.id))[0].effectiveStatus).toBe("verified");
  });

  it("retains old trace data when the collector reports a failed read without throwing", async () => {
    const fixture = await seed();
    const original = await evidence.verifyEvidenceFact(fixture.input, { collectEvidence: successCollector });
    const failed = await evidence.verifyEvidenceFact(fixture.input, { collectEvidence: async ({ target, field }) =>
      supported(target!, field, { status: "unverified", readStatus: "failed", extractedValue: "", contentQuote: "", sourceUrl: "", conflictReason: "受控 HTTP 503" }) });
    expect(failed).toMatchObject({ status: "verified", effectiveStatus: "stale", lastRefreshStatus: "failed",
      sourceUrl: original.sourceUrl, contentQuote: original.contentQuote, extractedValue: original.extractedValue });
    expect((await snapshotState(fixture.trip.id)).trip.currentPlanVersionId).toBe(fixture.row.id);
  });

  it("preserves completed evidence on a note edit but invalidates changed time and price targets", async () => {
    for (const edit of ["note", "schedule", "cost"] as const) {
      const fixture = await seed();
      for (const field of ["opening_hours", "price"] as const) {
        await evidence.verifyEvidenceFact({ ...fixture.input, field }, { collectEvidence: successCollector });
      }
      const oldRows = (await snapshotState(fixture.trip.id)).facts;
      const next = await editPlan(fixture, edit);
      const all = await evidence.listEvidenceFacts(fixture.trip.id);
      const newer = all.filter((fact) => fact.planVersionId === next.id);
      expect(newer.find((fact) => fact.field === "opening_hours")!.effectiveStatus).toBe(edit === "schedule" ? "stale" : "verified");
      expect(newer.find((fact) => fact.field === "price")!.effectiveStatus).toBe(edit === "cost" ? "stale" : "verified");
      expect((await snapshotState(fixture.trip.id)).facts.filter((fact) => fact.planVersionId === fixture.row.id)).toEqual(oldRows);
      const collect = vi.fn(successCollector);
      await expect(evidence.verifyEvidenceFact(fixture.input, { collectEvidence: collect })).rejects.toMatchObject({ name: "EvidenceConflictError" });
      expect(collect).not.toHaveBeenCalled();
    }
  });

  it("rechecks the actual target before committing even if a same-version row changes", async () => {
    const fixture = await seed();
    const pending = controlled();
    const request = evidence.verifyEvidenceFact(fixture.input, { collectEvidence: pending.collector });
    const captured = await pending.started;
    const events = JSON.parse(fixture.row.events) as { id: string; endTime: string }[];
    events.find((event) => event.id === fixture.event.id)!.endTime = "12:15";
    await prisma.planVersion.update({ where: { id: fixture.row.id }, data: { events: JSON.stringify(events) } });
    const before = await snapshotState(fixture.trip.id);
    const rejected = expect(request).rejects.toMatchObject({ name: "EvidenceConflictError" });
    pending.response.resolve(supported(captured.target!, fixture.input.field));
    await rejected;
    expect(await snapshotState(fixture.trip.id)).toEqual(before);
  });

  it.each([
    { extractedValue: "" }, { sourceDateStatus: "undated" }, { applicableUntil: new Date("2000-01-01") }, { sourceUrl: "https://unrelated.example.net/visit" },
  ])("refuses an incomplete claimed verified result at the service boundary: %j", async (changes) => {
    const fixture = await seed();
    const result = await evidence.verifyEvidenceFact(fixture.input, { collectEvidence: async ({ target, field }) => supported(target!, field, changes) });
    expect(result).toMatchObject({ status: "unverified", effectiveStatus: "pending" });
  });
});
