import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { isolatedDatabase } from "./helpers/test-database";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { validatePlan } from "../lib/plan";
import type { AdvisoryView } from "../lib/advisories";
let database: ReturnType<typeof isolatedDatabase>, db: PrismaClient;
let trips: typeof import("../lib/trips"), requests: typeof import("../lib/trip-request-service"), plans: typeof import("../lib/plan-service"), service: typeof import("../lib/advisory-service");
beforeAll(async () => { database = isolatedDatabase("unit-advisories"); db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } }); trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service"); plans = await import("../lib/plan-service"); service = await import("../lib/advisory-service"); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await Promise.all([trips.closeTripStore(), requests.closeTripRequestStore(), plans.closePlanStore(), service.closeAdvisoryStore(), (await import("../lib/settings")).closeSettingsStore(), (await import("../lib/weather-settings")).closeWeatherSettingsStore(), (await import("../lib/evidence-service")).closeEvidenceStore(), db.$disconnect()]); database.cleanup(); });
async function fixture() {
  const trip = await trips.createTrip({ originalRequest: "阶段21隔离提醒演练" });
  const request = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture() });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: request.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, request.requestRevision), content = planFixture(capture.requestSnapshot);
  content.events.find((e) => e.id === "d1-activity")!.locationName = "橘子洲";
  return plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
}
const acknowledge = (v: AdvisoryView, id = v.items[0].id) => service.saveAdvisories(v.tripId, { action: "acknowledge", expectedPlanVersion: v.planVersion, expectedRevision: v.revision, advisoryId: id, signature: v.items.find((i) => i.id === id)!.signature, acknowledged: true });
const refresh = (v: AdvisoryView, signal?: AbortSignal) => service.saveAdvisories(v.tripId, { action: "refresh", expectedPlanVersion: v.planVersion, expectedRevision: v.revision }, signal);
function mockForecast(onRequest?: () => Promise<void>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    await onRequest?.(); const u = new URL(url), dates = [u.searchParams.get("start_date")!];
    return Response.json({ daily: { time: dates, temperature_2m_max: [28], temperature_2m_min: [18], precipitation_sum: [12], precipitation_probability_max: [80], weather_code: [61], wind_speed_10m_max: [10] } });
  }));
}
describe("提醒保存、并发与失败保护", () => {
  it("GET remains read-only, acknowledgement survives store reopen without mutating plan or checklist", async () => {
    const p = await fixture(), v = await service.getAdvisories(p.tripId, 1);
    expect(await db.advisoryState.findUnique({ where: { tripId: p.tripId } })).toBeNull();
    const before = await db.planVersion.findUniqueOrThrow({ where: { id: p.id } }), checklist = await db.checklistState.findUnique({ where: { tripId: p.tripId } });
    const saved = await acknowledge(v); await service.closeAdvisoryStore();
    expect(await service.getAdvisories(p.tripId, 1)).toEqual(saved);
    expect(await db.planVersion.findUniqueOrThrow({ where: { id: p.id } })).toEqual(before);
    expect(await db.checklistState.findUnique({ where: { tripId: p.tripId } })).toEqual(checklist);
  });
  it("concurrent writes cannot overwrite acknowledgement and stale page is rejected", async () => {
    const p = await fixture(), v = await service.getAdvisories(p.tripId, 1);
    const results = await Promise.allSettled([acknowledge(v), acknowledge(v)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(acknowledge(v)).rejects.toMatchObject({ status: 409 });
  });
  it("query failure removes fresh claims but preserves plan; successful weather and acknowledgement persist", async () => {
    const p = await fixture(); mockForecast();
    const before = await db.planVersion.findUniqueOrThrow({ where: { id: p.id } });
    let v = await refresh(await service.getAdvisories(p.tripId, 1));
    expect(v.weather[0].status).toBe("fresh"); expect(v.items.some((i) => i.id === "rain:d1-activity")).toBe(true);
    v = await acknowledge(v, "rain:d1-activity");
    v = await refresh(v); expect(v.items.find((i) => i.id === "rain:d1-activity")?.acknowledged).toBe(true);
    expect((await service.getAdvisories(p.tripId, 1)).items.find((i) => i.id === "rain:d1-activity")?.acknowledged).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    v = await refresh(v); expect(v.weather[0].status).toBe("failed"); expect(v.items.some((i) => i.category === "weather")).toBe(false);
    expect(await db.planVersion.findUniqueOrThrow({ where: { id: p.id } })).toEqual(before);
  });
  it("rejects a refresh when sources/checklist change during external work", async () => {
    const p = await fixture(), v = await service.getAdvisories(p.tripId, 1);
    mockForecast(async () => { await db.evidenceFact.create({ data: { tripId: p.tripId, planVersionId: p.id, targetType: "event", targetId: "d1-activity", field: "reservation", status: "unverified", sourceTitle: "合成来源变更", sourceUrl: "https://example.com", sourcePublisher: "测试", extractedValue: "需要预约", searchProvider: "test", searchQuery: "test", retrievedAt: new Date(), contentQuote: "资料发生变化" } }); });
    await expect(refresh(v)).rejects.toMatchObject({ status: 409 });
    expect(await db.advisoryState.findUnique({ where: { tripId: p.tripId } })).toBeNull();
  });
  it("rejects an old item signature after associated event/source changes", async () => {
    const p = await fixture(), v = await service.getAdvisories(p.tripId, 1);
    await db.evidenceFact.create({ data: { tripId: p.tripId, planVersionId: p.id, targetType: "event", targetId: "d1-activity", field: "reservation", status: "unverified", sourceTitle: "新来源", sourceUrl: "https://example.com", sourcePublisher: "测试", extractedValue: "需要预约", searchProvider: "test", searchQuery: "test", retrievedAt: new Date(), contentQuote: "预约规则变化" } });
    await expect(acknowledge(v, "reservation:d1-activity")).rejects.toMatchObject({ status: 409 });
  });
  it("new plan derives fresh associations, old version cannot write and trip deletion cascades", async () => {
    const p = await fixture(), v = await acknowledge(await service.getAdvisories(p.tripId, 1));
    const next = await plans.savePlanEventEdit({ tripId: p.tripId, expectedPlanVersion: 1, edit: { eventId: "d1-rest", timeEdit: "preserve", note: "普通编辑", locked: false, status: "suggested", remove: false } });
    await expect(acknowledge(v)).rejects.toMatchObject({ status: 409 });
    await expect(service.getAdvisories(p.tripId, 1)).rejects.toMatchObject({ status: 409 });
    expect((await service.getAdvisories(p.tripId, next.versionNumber)).items.find((i) => i.id === v.items[0].id)?.acknowledged).toBe(true);
    await trips.deleteTrip(p.tripId); expect(await db.advisoryState.findUnique({ where: { tripId: p.tripId } })).toBeNull();
  });
  it("aborted refresh and database write failure keep previous state", async () => {
    const p = await fixture(), v = await acknowledge(await service.getAdvisories(p.tripId, 1));
    mockForecast(); const abort = new AbortController(); abort.abort();
    await expect(refresh(v, abort.signal)).rejects.toMatchObject({ status: 409 });
    await db.$executeRawUnsafe("CREATE TRIGGER fail_advisory BEFORE UPDATE ON AdvisoryState BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    try { await expect(refresh(v)).rejects.toThrow(); expect(await service.getAdvisories(p.tripId, 1)).toEqual(v); }
    finally { await db.$executeRawUnsafe("DROP TRIGGER fail_advisory"); }
  });
  it("accepts bounded AI explanation only for known rule IDs and safely falls back on failure", async () => {
    const p = await fixture(); mockForecast();
    vi.spyOn(await import("../lib/settings"), "storedAIConfiguration").mockResolvedValue({ provider: "openai-chat-completions", baseUrl: "http://localhost/v1", apiKey: "synthetic", model: "test", basePrompt: "", systemPrompt: "" });
    const adapter = vi.spyOn(await import("../lib/ai-adapter"), "completeText").mockResolvedValue({ ok: true, content: JSON.stringify([{ id: "rain:d1-activity", text: "户外安排可预留室内备选。" }]) });
    let v = await refresh(await service.getAdvisories(p.tripId, 1)); expect(v.aiStatus).toBe("used"); expect(v.items.find((i) => i.id === "rain:d1-activity")?.aiExplanation).toBe("户外安排可预留室内备选。");
    adapter.mockResolvedValue({ ok: true, content: JSON.stringify([{ id: "invented-id", text: "无关内容" }]) });
    v = await refresh(v); expect(v.aiStatus).toBe("failed"); expect(v.items.some((i) => i.id === "invented-id")).toBe(false);
    adapter.mockResolvedValue({ ok: false, category: "timeout", message: "模拟超时" });
    expect((await refresh(v)).aiStatus).toBe("failed");
  });
  it("weather settings save requires a successful signed test and failed test preserves last good config", async () => {
    const settings = await import("../lib/weather-settings"); mockForecast();
    await expect(settings.saveWeatherConfiguration({ testToken: "forged" })).rejects.toThrow("测试已过期");
    const tested = await settings.testWeatherConfiguration(), saved = await settings.saveWeatherConfiguration({ testToken: tested.testToken });
    expect(saved.status).toBe("connected");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(settings.testWeatherConfiguration()).rejects.toThrow("未通过"); expect(await settings.getSafeWeatherSettings()).toEqual(saved);
  });
});
