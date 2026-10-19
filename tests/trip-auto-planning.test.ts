import { describe, expect, it, vi } from "vitest";
import {
  AutoPlanningError,
  autoPlanningRecoveryUrl,
  completeAutoPlanningRequest,
  createTripWithPlan,
  generatePlanWithRetry,
} from "../lib/trip-auto-planning";
import { emptyRequestSnapshot, validateRequestSnapshot, type RequestSnapshot } from "../lib/trip-request";
import type { TripRequestRecord } from "../lib/trip-request-service";

const now = new Date("2026-10-18T15:30:00Z");
const originalRequest = "去杭州玩 3 天，喜欢安静散步";
const extracted = () => ({ ...emptyRequestSnapshot(), destination: "杭州" });
const complete = () => completeAutoPlanningRequest(originalRequest, extracted(), now);
const record = (revision: number, snapshot: RequestSnapshot | null, confirmed = false): TripRequestRecord => ({
  id: "request-1", tripId: "trip-1", originalRequest, requestRevision: revision,
  extractedRequest: snapshot, fieldSources: snapshot?.fieldSources ?? null, defaultAssumptions: [], pendingQuestions: [],
  confirmedRequest: confirmed ? snapshot : null, confirmedRevision: confirmed ? revision : null,
  confirmedAt: confirmed ? now.toISOString() : null, updatedAt: now.toISOString(),
});
const ok = (payload: unknown) => Response.json(payload);
const creation = () => ok({ trip: { id: "trip-1", request: { requestRevision: 1 } } });
const requestRecord = (revision: number, snapshot = complete(), confirmed = false) => ok({ request: record(revision, snapshot, confirmed) });

function pipelineFetch(responses: (Response | Error)[]) {
  const calls: { url: string; method?: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected API call");
    if (response instanceof Error) throw response;
    return response;
  });
  return { calls, fetcher };
}

describe("one-click planning defaults", () => {
  it("turns a stated three-day trip into next week's dates with visible assumption sources", () => {
    const snapshot = complete();
    expect(snapshot).toMatchObject({ startDate: "2026-10-19", endDate: "2026-10-21", travelerCount: 1, pace: "balanced" });
    expect(snapshot.fieldSources).toMatchObject({ startDate: "default_assumption", endDate: "default_assumption", travelerCount: "default_assumption" });
    expect(validateRequestSnapshot(snapshot, now, "confirmation")).toEqual([]);
  });

  it("uses the China calendar at midnight and correctly crosses the year", () => {
    expect(completeAutoPlanningRequest(originalRequest, extracted(), new Date("2026-10-18T16:30:00Z"))).toMatchObject({ startDate: "2026-10-26", endDate: "2026-10-28" });
    const snapshot = completeAutoPlanningRequest("去杭州四天", { ...extracted(), startDate: "2026-12-30" }, now);
    expect(snapshot).toMatchObject({ startDate: "2026-12-30", endDate: "2027-01-02" });
    expect(snapshot.fieldSources.endDate).toBe("program_derived");
  });

  it("keeps stated approximate travel months and infers two days from one hotel night", () => {
    expect(completeAutoPlanningRequest("11 月中旬杭州住一晚", extracted(), now)).toMatchObject({ startDate: "2026-11-15", endDate: "2026-11-16" });
    expect(completeAutoPlanningRequest("12月初去成都三天", extracted(), now)).toMatchObject({ startDate: "2026-12-01", endDate: "2026-12-03" });
  });

  it("derives a missing start from the known return, and never overwrites an explicit date range", () => {
    expect(completeAutoPlanningRequest(originalRequest, { ...extracted(), endDate: "2026-11-03" }, now)).toMatchObject({ startDate: "2026-11-01", endDate: "2026-11-03" });
    const snapshot = completeAutoPlanningRequest("杭州四天", { ...extracted(), startDate: "2026-11-01", endDate: "2026-11-02" }, now);
    expect(snapshot).toMatchObject({ startDate: "2026-11-01", endDate: "2026-11-02" });
  });

  it("defaults unspecified duration to two days, keeps an optional budget empty and does not mutate AI data", () => {
    const source = { ...extracted(), budgetScope: "total" as const };
    const before = structuredClone(source);
    const snapshot = completeAutoPlanningRequest("去杭州散步", source, now);
    expect(snapshot).toMatchObject({ startDate: "2026-10-19", endDate: "2026-10-20", budgetAmountCents: null, budgetScope: null });
    expect(source).toEqual(before);
  });

  it("does not silently truncate explicitly unsupported travel durations", () => {
    const snapshot = completeAutoPlanningRequest("杭州玩 7 天", extracted(), now);
    expect(snapshot.endDate).toBe("2026-10-25");
    expect(validateRequestSnapshot(snapshot, now, "confirmation")[0]).toContain("当前行程为 7 天");
  });

  it("does not invent a destination when only a trip duration was stated", () => {
    const snapshot = completeAutoPlanningRequest("想玩3天", emptyRequestSnapshot(), now);
    expect(snapshot.destination).toBeNull();
    expect(snapshot.fieldSources.destination).toBe("unspecified");
    expect(validateRequestSnapshot(snapshot, now, "confirmation")).toEqual(["请先确认目的地。"]);
  });
});

describe("one-click pipeline revision boundaries", () => {
  it("saves, extracts, fills defaults, confirms and generates using each returned revision", async () => {
    const { fetcher, calls } = pipelineFetch([
      creation(), requestRecord(3, extracted()), requestRecord(7), requestRecord(7, complete(), true), ok({ plan: { versionNumber: 1 } }),
    ]);
    const onStage = vi.fn();
    expect(await createTripWithPlan({ originalRequest, fetcher, onStage, now })).toBe("trip-1");
    expect(calls.map(({ url, method }) => [method, url])).toEqual([
      ["POST", "/api/trips"], ["POST", "/api/trips/trip-1/request/extract"], ["PATCH", "/api/trips/trip-1/request"],
      ["POST", "/api/trips/trip-1/request/confirm"], ["POST", "/api/trips/trip-1/plans/generate"],
    ]);
    expect(calls[0].body).toEqual({ originalRequest });
    expect(calls[1].body).toEqual({ expectedRequestRevision: 1 });
    expect(calls[2].body).toMatchObject({ expectedRequestRevision: 3, request: { startDate: "2026-10-19", endDate: "2026-10-21" } });
    expect(calls[3].body).toEqual({ expectedRequestRevision: 7 });
    expect(calls[4].body).toEqual({ expectedRequestRevision: 7, expectedPlanVersion: null });
    expect(onStage.mock.calls.flat()).toEqual(["saving", "understanding", "preparing", "confirming", "planning"]);
  });

  it("accepts a no-change save without inventing a new revision", async () => {
    const { fetcher, calls } = pipelineFetch([creation(), requestRecord(2), requestRecord(2), requestRecord(2, complete(), true), ok({ plan: {} })]);
    await createTripWithPlan({ originalRequest, fetcher, now });
    expect(calls[3].body).toEqual({ expectedRequestRevision: 2 });
    expect(calls[4].body).toEqual({ expectedRequestRevision: 2, expectedPlanVersion: null });
  });

  it("returns to the saved workspace when AI is unconfigured, without sending later writes", async () => {
    const { fetcher, calls } = pipelineFetch([creation(), Response.json({ category: "configuration", error: "缺少 API Key" }, { status: 400 })]);
    await expect(createTripWithPlan({ originalRequest, fetcher, now })).rejects.toMatchObject({ tripId: "trip-1", recoverInWorkspace: true, message: expect.stringContaining("配置可用的 AI 服务") });
    expect(calls).toHaveLength(2);
    const url = new URL(autoPlanningRecoveryUrl("trip-1", "AI 暂时失败，请稍后重试。"), "http://localhost");
    expect(url.pathname).toBe("/trips/trip-1");
    expect(url.searchParams.has("editRequirements")).toBe(false);
    expect(url.searchParams.get("planningNotice")).toBe("AI 暂时失败，请稍后重试。");
  });

  it("keeps the confirmed request available when plan generation fails", async () => {
    const timeout = () => Response.json({ error: "AI timeout", category: "timeout" }, { status: 502 });
    const { fetcher, calls } = pipelineFetch([creation(), requestRecord(2), requestRecord(2), requestRecord(2, complete(), true), timeout(), ok({ plans: [] }), timeout(), ok({ plans: [] })]);
    await expect(createTripWithPlan({ originalRequest, fetcher, now })).rejects.toMatchObject({ tripId: "trip-1", recoverInWorkspace: true, message: expect.stringContaining("AI timeout") });
    expect(calls.filter((call) => call.url.endsWith("/generate")).map((call) => call.body)).toEqual([
      { expectedRequestRevision: 2, expectedPlanVersion: null }, { expectedRequestRevision: 2, expectedPlanVersion: null },
    ]);
  });

  for (const failure of [{ status: 409, reloadRequired: true }, { status: 423, reloadRequired: true }, { status: 409, reloadRequired: false }]) {
    it(`stops on ${failure.status} / reload=${failure.reloadRequired} during extraction without treating it as an AI fallback`, async () => {
      const { fetcher, calls } = pipelineFetch([creation(), Response.json({ error: "需求或数据已变化", reloadRequired: failure.reloadRequired }, { status: failure.status })]);
      await expect(createTripWithPlan({ originalRequest, fetcher, now })).rejects.toMatchObject({ tripId: "trip-1", recoverInWorkspace: false });
      expect(calls).toHaveLength(2);
    });
  }

  it("never generates if confirmation was rejected or did not confirm the returned revision", async () => {
    const { fetcher, calls } = pipelineFetch([creation(), requestRecord(2), requestRecord(3), requestRecord(3)]);
    await expect(createTripWithPlan({ originalRequest, fetcher, now })).rejects.toBeInstanceOf(AutoPlanningError);
    expect(calls).toHaveLength(4);
  });

  it("resumes a saved draft after an interrupted write without creating a second trip", async () => {
    const { fetcher, calls } = pipelineFetch([requestRecord(9), requestRecord(9), requestRecord(9, complete(), true), ok({ plan: {} })]);
    await createTripWithPlan({ originalRequest, existingTripId: "trip-1", fetcher, now });
    expect(calls[0]).toEqual({ url: "/api/trips/trip-1/request", method: "GET", body: undefined });
    expect(calls.some((call) => call.url === "/api/trips")).toBe(false);
    expect(calls[1].body).toMatchObject({ expectedRequestRevision: 9 });
  });

  it("does not resume with an original request that another tab changed", async () => {
    const { fetcher, calls } = pipelineFetch([ok({ request: { ...record(9, complete()), originalRequest: "已修改去青岛" } })]);
    await expect(createTripWithPlan({ originalRequest, existingTripId: "trip-1", fetcher, now })).rejects.toMatchObject({ recoverInWorkspace: false, message: expect.stringContaining("想法已修改") });
    expect(calls).toHaveLength(1);
  });

  it("stops before confirmation or generation when the AI response has no destination", async () => {
    const { fetcher, calls } = pipelineFetch([creation(), requestRecord(2, emptyRequestSnapshot())]);
    await expect(createTripWithPlan({ originalRequest, fetcher, now })).rejects.toMatchObject({ tripId: "trip-1", recoverInWorkspace: true, message: expect.stringContaining("目的地") });
    expect(calls).toHaveLength(2);
  });

  it("keeps the first-plan guard when resuming, so a plan created by another tab is never replaced", async () => {
    const { fetcher, calls } = pipelineFetch([
      requestRecord(9), requestRecord(9), requestRecord(9, complete(), true),
      Response.json({ error: "当前计划版本已经变化，旧生成结果不能提交。" }, { status: 409 }),
    ]);
    await expect(createTripWithPlan({ originalRequest, existingTripId: "trip-1", fetcher, now })).rejects.toMatchObject({ tripId: "trip-1", recoverInWorkspace: false });
    expect(calls.at(-1)?.body).toEqual({ expectedRequestRevision: 9, expectedPlanVersion: null });
    expect(calls).toHaveLength(4);
  });
});

describe("generation retry and ambiguous network outcomes", () => {
  const savedPlan = { versionNumber: 1, requestRevision: 7, isCurrent: true, requirementUpToDate: true };
  const generate = (fetcher: Parameters<typeof generatePlanWithRetry>[0]["fetcher"], signal?: AbortSignal) =>
    generatePlanWithRetry({ tripId: "trip-1", expectedRequestRevision: 7, expectedPlanVersion: null, fetcher, signal });

  it.each([
    new TypeError("Failed to fetch"),
    new DOMException("The operation timed out", "TimeoutError"),
    Response.json({ category: "timeout", error: "AI timeout" }, { status: 502 }),
    new Response("upstream timeout", { status: 504 }),
  ])("silently retries a transient generation failure once with the original revision guard", async (failure) => {
    const { fetcher, calls } = pipelineFetch([failure, ok({ plans: [] }), ok({ plan: savedPlan })]);
    expect(await generate(fetcher)).toEqual({ plan: savedPlan });
    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ["POST", "/api/trips/trip-1/plans/generate"], ["GET", "/api/trips/trip-1/plans"], ["POST", "/api/trips/trip-1/plans/generate"],
    ]);
    expect(calls[0].body).toEqual(calls[2].body);
  });

  it("recognizes a committed plan after a lost response without generating a second version", async () => {
    const { fetcher, calls } = pipelineFetch([new TypeError("connection lost after commit"), ok({ plans: [savedPlan] })]);
    expect(await generate(fetcher)).toEqual({ plan: savedPlan });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("recognizes a commit that won the race with the guarded retry", async () => {
    const { fetcher, calls } = pipelineFetch([
      new TypeError("connection lost"), ok({ plans: [] }),
      Response.json({ error: "当前版本已变化" }, { status: 409 }), ok({ plans: [savedPlan] }),
    ]);
    expect(await generate(fetcher)).toEqual({ plan: savedPlan });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
  });

  it.each([
    { category: "generation_in_progress", reloadRequired: false, recoverInWorkspace: true, reads: 2 },
    { category: undefined, reloadRequired: false, recoverInWorkspace: false, reads: 2 },
    { category: "generation_in_progress", reloadRequired: true, recoverInWorkspace: false, reads: 1 },
  ])("recovers only an in-progress generation conflict after timeout: $category / reload=$reloadRequired", async ({ category, reloadRequired, recoverInWorkspace, reads }) => {
    const { fetcher, calls } = pipelineFetch([
      new TypeError("connection lost"), ok({ plans: [] }),
      Response.json({ category, reloadRequired, error: "生成状态发生变化" }, { status: 409 }), ok({ plans: [] }),
    ]);
    await expect(generate(fetcher)).rejects.toMatchObject({ recoverInWorkspace });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(reads);
  });

  it("does not mistake an outdated request's plan for a successful retry", async () => {
    const conflict = () => Response.json({ error: "当前版本已变化" }, { status: 409 });
    const { fetcher } = pipelineFetch([
      new TypeError("connection lost"), ok({ plans: [{ ...savedPlan, requestRevision: 6 }] }),
      conflict(), ok({ plans: [{ ...savedPlan, requestRevision: 6 }] }),
    ]);
    await expect(generate(fetcher)).rejects.toMatchObject({ recoverInWorkspace: false, message: "当前版本已变化" });
  });

  it.each(["configuration", "auth", "rate_limit", "invalid_output"])("does not retry %s errors", async (category) => {
    const { fetcher, calls } = pipelineFetch([Response.json({ error: "不可重试", category }, { status: 502 })]);
    await expect(generate(fetcher)).rejects.toBeInstanceOf(AutoPlanningError);
    expect(calls).toHaveLength(1);
  });

  it("stops immediately when restore interrupts the reconciliation read", async () => {
    const { fetcher, calls } = pipelineFetch([
      new TypeError("connection lost"), Response.json({ error: "数据已恢复", reloadRequired: true }, { status: 409 }),
    ]);
    await expect(generate(fetcher)).rejects.toMatchObject({ recoverInWorkspace: false, message: "数据已恢复" });
    expect(calls).toHaveLength(2);
  });

  it("does not read or retry after explicit cancellation", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      throw new DOMException("Canceled", "AbortError");
    });
    await expect(generate(fetcher, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
