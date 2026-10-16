// Real external route check, using only synthetic data and public venue coordinates.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
import { assertTestDataPath } from "./test-data-safety.mjs";

const base = "http://127.0.0.1:3127";
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase17-live-route"));
const db = await openVerifiedIsolatedDatabase(base, "test-data/phase17-live");
const post = async (url, data, method = "POST") => {
  const response = await fetch(`${base}${url}`, { method, headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify(data), signal: globalThis.AbortSignal.timeout(60_000) });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return result;
};
try {
  await fs.mkdir(output, { recursive: true });
  const fixture = JSON.parse(await fs.readFile("test-data/verification-output/phase17-browser/demo-seed.json", "utf8"));
  const events = JSON.parse(fixture.events);
  const activity = events.find((event) => event.id === "d1-activity");
  const lunch = events.find((event) => event.id === "d1-lunch");
  lunch.placeId = activity.placeId;
  lunch.locationName = "湖南博物院（公共集合点，隔离测试）";
  const snapshot = JSON.parse(fixture.requestSnapshot);
  snapshot.pace = "balanced";
  fixture.requestSnapshot = JSON.stringify(snapshot);
  const trip = await db.trip.create({ data: { title: "阶段17真实路线验证（隔离测试）", originalRequest: "公共景点坐标与合成时段，用于核对景点替换的真实道路查询", status: "plan_needs_review" } });
  await db.tripRequest.create({ data: { tripId: trip.id, originalRequest: trip.originalRequest, requestRevision: 2, confirmedRevision: 2,
    extractedRequest: fixture.requestSnapshot, confirmedRequest: fixture.requestSnapshot, confirmedAt: new Date() } });
  const row = await db.planVersion.create({ data: { tripId: trip.id, ...fixture, events: JSON.stringify(events) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id } });
  // Only the old route is a synthetic fixture. The replacement must issue a
  // real OSRM query between the two different, sourced public venue locations.
  const { plan: routed } = await post(`/api/trips/${trip.id}/plans/1/routes`, { fromEventId: activity.id, toEventId: lunch.id,
    departureTime: activity.endTime, manualReference: { availability: "available", instructions: "隔离测试占位，非真实旧路线", durationMinutes: 10,
      fareCents: null, sourceName: "合成夹具", sourceUrl: null, checkedAt: new Date().toISOString(), acknowledged: true } }, "PATCH");
  const baselineRoutes = routed.routeLegs.map(({ manualReference, ...route }) => { void manualReference; return { ...route, mode: "driving", status: "estimated", includedTimes: ["driving"] }; });
  await db.planVersion.update({ where: { id: routed.id }, data: { routeLegs: JSON.stringify(baselineRoutes) } });
  const endpoint = `/api/trips/${trip.id}/plans/${routed.versionNumber}/attractions`;
  const { preview } = await post(endpoint, { action: "preview", eventId: activity.id, candidateId: "yuelu-academy" });
  const result = { checkedAt: new Date().toISOString(), tripId: trip.id, url: `${base}/trips/${trip.id}`, preview,
    route: preview.card.outgoingRoute, versionBeforeApply: routed.versionNumber, baselineRouteIsSynthetic: true };
  await fs.writeFile(path.join(output, "actual.json"), JSON.stringify(result, null, 2));
  assert.equal(preview.card.outgoingRoute?.source, "OpenStreetMap / OSRM");
  assert.ok(preview.card.outgoingRoute.durationSeconds > 0);
  assert.ok(preview.card.outgoingRoute.polyline.length > 1);
  assert.ok(preview.canApply, preview.conflicts.join("; "));
  const { plan: saved } = await post(endpoint, { action: "apply", eventId: activity.id, candidateId: "yuelu-academy", previewToken: preview.previewToken });
  assert.equal(saved.versionNumber, routed.versionNumber + 1);
  assert.deepEqual(saved.routeLegs, [preview.card.outgoingRoute]);
  result.savedVersion = saved.versionNumber;
  result.savedPlace = saved.places.find((place) => place.id === saved.events.find((event) => event.id === activity.id).placeId);
  result.savedCosts = saved.costs;
  await fs.writeFile(path.join(output, "actual.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: "passed", source: result.route.source, durationSeconds: result.route.durationSeconds,
    distanceMeters: result.route.distanceMeters, cost: result.route.cost, savedVersion: saved.versionNumber }));
} finally { await db.$disconnect(); }
