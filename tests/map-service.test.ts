import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest";
import { isolatedDatabase } from "./helpers/test-database";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { validatePlan, aiPlanOutputSchema } from "../lib/plan";
import type { PlaceCandidate } from "../lib/places";

let database: ReturnType<typeof isolatedDatabase>;
let prisma: PrismaClient;
let trips: typeof import("../lib/trips");
let requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service");
let maps: typeof import("../lib/map-service");
let settings: typeof import("../lib/settings");
let mapSettings: typeof import("../lib/map-settings");
let security: typeof import("../lib/security");
const candidate: PlaceCandidate = { provider: "osm", poiId: "way:174194694", name: "深圳站", city: "深圳市", district: "罗湖区", address: "深圳市罗湖区", adcode: "", category: "railway:station", longitude: 114.1121107, latitude: 22.5344874, coordinateSystem: "WGS84", retrievedAt: new Date().toISOString() };
beforeAll(async () => {
  database = isolatedDatabase("phase11-map");
  prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service"); plans = await import("../lib/plan-service");
  maps = await import("../lib/map-service"); settings = await import("../lib/settings"); mapSettings = await import("../lib/map-settings"); security = await import("../lib/security");
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await Promise.all([prisma.$disconnect(), trips.closeTripStore(), requests.closeTripRequestStore(), plans.closePlanStore(), settings.closeSettingsStore(), mapSettings.closeMapSettingsStore()]); database.cleanup(); });

async function seed() {
  const trip = await trips.createTrip({ originalRequest: "地图定位测试：深圳两天" });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture(2, { destination: "深圳" }) });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision);
  const plan = planFixture(capture.requestSnapshot);
  const saved = await plans.savePlanVersion({ capture, plan, validationResults: validatePlan(plan, capture.requestSnapshot) });
  return { trip, saved };
}
function token(tripId: string, version: number, eventId = "d1-activity", place = candidate, exp = Date.now() + 60000) {
  return security.createSignedPayload({ scope: "place-selection", tripId, version, eventId, candidate: place, exp });
}
function edit(tripId: string, version: number, eventId = "d1-activity", place = candidate) {
  return maps.confirmPlanPlace(tripId, version, { eventId, selectionToken: token(tripId, version, eventId, place), precision: "poi" });
}

it("reads legacy plans without invented coordinates and strips AI place references", async () => {
  const { saved } = await seed();
  expect(saved.places).toEqual([]);
  const input = planFixture(saved.requestSnapshot); input.events[0].placeId = "fake-place";
  expect(aiPlanOutputSchema.parse(input).events[0]).not.toHaveProperty("placeId");
  expect((await mapSettings.getSafeMapSettings()).provider).toBe("osm");
});

it("persists places as new snapshots, shares a POI across visits, preserves edits and freezes history", async () => {
  const { trip, saved } = await seed();
  const v2 = await edit(trip.id, 1);
  const v3 = await edit(trip.id, 2, "d2-activity");
  expect(v3.places).toHaveLength(1);
  expect(v3.events.filter((event) => event.placeId === v2.places[0].id)).toHaveLength(2);
  expect((await plans.getPlanVersion(trip.id, 1)).places).toEqual([]);
  expect(v3.requestSnapshot).toEqual(saved.requestSnapshot);
  expect(v3.costs).toEqual(saved.costs);
  const v4 = await plans.savePlanEventEdit({ tripId: trip.id, expectedPlanVersion: 3, edit: { eventId: "d1-activity", timeEdit: "preserve", note: "保留位置", locked: false, status: "suggested", remove: false } });
  expect(v4.places).toEqual(v3.places);
  expect(v4.events.find((event) => event.id === "d1-activity")?.placeId).toBe(v2.places[0].id);
  await expect(edit(trip.id, 1)).rejects.toThrow("版本");
  await expect(plans.getPlanGenerationContext(trip.id, saved.requestRevision)).rejects.toThrow("已确认");
  const v5 = await maps.confirmPlanPlace(trip.id, 4, { eventId: "d1-activity", selectionToken: null, precision: "poi" });
  expect(v5.places).toHaveLength(1);
  expect(v5.events.find((event) => event.id === "d1-activity")?.placeId).toBeNull();
});

it("rejects tampering, cross-event, cross-trip, expired candidates and area precision overclaims", async () => {
  const { trip } = await seed();
  const valid = token(trip.id, 1);
  for (const selectionToken of [valid + "tampered", token("other-trip", 1), token(trip.id, 1, "d2-activity"), token(trip.id, 1, "d1-activity", candidate, Date.now() - 1)]) {
    await expect(maps.confirmPlanPlace(trip.id, 1, { eventId: "d1-activity", selectionToken, precision: "poi" })).rejects.toThrow();
  }
  await expect(edit(trip.id, 1, "d1-hotel", { ...candidate, category: "boundary:administrative" })).rejects.toThrow("区域");
  const area = await maps.confirmPlanPlace(trip.id, 1, { eventId: "d1-hotel", selectionToken: token(trip.id, 1, "d1-hotel", { ...candidate, category: "boundary:administrative" }), precision: "area_reference" });
  expect(area.places[0].precision).toBe("area_reference");
});

it("invalidates related evidence even when two POIs have the same display name", async () => {
  const { trip } = await seed();
  const v2 = await edit(trip.id, 1);
  await prisma.evidenceFact.create({ data: { tripId: trip.id, planVersionId: v2.id, targetType: "event", targetId: "d1-activity", field: "location", status: "verified", sourceTitle: "station", sourceUrl: "https://example.com/station", sourcePublisher: "example.com", extractedValue: "深圳站", searchProvider: "test", searchQuery: "深圳站", retrievedAt: new Date(), contentQuote: "深圳站", lastRefreshStatus: "success" } });
  const v3 = await edit(trip.id, 2, "d1-activity", { ...candidate, poiId: "way:999", longitude: 114.2 });
  expect(await prisma.evidenceFact.findFirst({ where: { planVersionId: v3.id } })).toMatchObject({ lastRefreshStatus: "needs_review" });
  expect(await prisma.evidenceFact.findFirst({ where: { planVersionId: v2.id } })).toMatchObject({ lastRefreshStatus: "success" });
});

it("rejects locked changes, cancelled commits and concurrent duplicate submissions", async () => {
  const { trip } = await seed();
  const result = await Promise.allSettled([edit(trip.id, 1), edit(trip.id, 1)]);
  expect(result.filter((value) => value.status === "fulfilled")).toHaveLength(1);
  expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
  await plans.savePlanEventEdit({ tripId: trip.id, expectedPlanVersion: 2, edit: { eventId: "d1-activity", note: null, locked: true, status: "suggested", remove: false } });
  await expect(edit(trip.id, 3, "d1-activity", { ...candidate, poiId: "way:999" })).rejects.toThrow("锁定");
  await expect(maps.confirmPlanPlace(trip.id, 3, { eventId: "d2-activity", selectionToken: token(trip.id, 3, "d2-activity"), precision: "poi" }, AbortSignal.abort())).rejects.toThrow("取消");
});

it("caches free user searches, sends identifying headers and rejects late results", async () => {
  const { trip } = await seed();
  const result = [{ osm_type: "way", osm_id: 174194694, name: "深圳站", lon: "114.1121107", lat: "22.5344874", category: "railway", type: "station", display_name: "深圳站, 深圳市, 广东省", address: { city: "深圳市" } }];
  const mocked = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(result));
  const candidates = await maps.searchPlanPlaces(trip.id, 1, { eventId: "d1-activity", city: "深圳", keywords: "深圳站" });
  expect(candidates).toHaveLength(1);
  await maps.searchPlanPlaces(trip.id, 1, { eventId: "d1-activity", city: "深圳", keywords: "深圳站" });
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(mocked.mock.calls[0][1]?.headers).toMatchObject({ "User-Agent": expect.stringContaining("Serendipity") });
  mocked.mockImplementation(async () => { await edit(trip.id, 1); return Response.json(result); });
  await expect(maps.searchPlanPlaces(trip.id, 1, { eventId: "d1-activity", city: "深圳", keywords: "深圳北站" })).rejects.toThrow("变化");
});

it("keeps secrets encrypted, exposes only configuration status and preserves good settings on failure", async () => {
  const config = { browserKey: "browser-key-12345678", webServiceKey: "web-service-12345678", securityCode: "security-code-123456" };
  await settings.getSettingsRecord();
  await prisma.appSettings.update({ where: { id: "singleton" }, data: { mapConfigurationCiphertext: security.encryptSecret(JSON.stringify(config)) } });
  expect(JSON.stringify(await mapSettings.getSafeMapSettings())).not.toContain(config.securityCode);
  expect(await mapSettings.getMapConfiguration()).toEqual(config);
  await expect(mapSettings.saveMapConfiguration(null, { testToken: "fake", browserMapLoaded: true })).rejects.toThrow();
  expect(await mapSettings.getMapConfiguration()).toEqual(config);
  await expect(mapSettings.testMapConfiguration({ ...config, browserKey: config.webServiceKey })).rejects.toThrow("类型不同");
  await mapSettings.useFreeMapProvider();
  expect(await mapSettings.getMapConfiguration()).toEqual(config);
});
