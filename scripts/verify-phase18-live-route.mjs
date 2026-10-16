// Real OSRM reads; all trips and baseline routes are explicitly synthetic.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
import { assertTestDataPath } from "./test-data-safety.mjs";

const base = "http://127.0.0.1:3128";
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase18-live-route"));
const db = await openVerifiedIsolatedDatabase(base, "test-data/phase18-live");
async function post(url, data, method = "POST") {
  const response = await fetch(`${base}${url}`, { method, headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(data), signal: globalThis.AbortSignal.timeout(60_000) });
  const result = await response.json(); assert.equal(response.ok, true, JSON.stringify(result)); return result;
}
try {
  await fs.mkdir(output, { recursive: true });
  const fixture = JSON.parse(await fs.readFile("test-data/verification-output/phase18-browser/demo-seed.json", "utf8"));
  const assets = JSON.parse(await fs.readFile("lib/attraction-assets.json", "utf8"));
  const candidate = assets.locations.find((item) => item.entryId === "hunan-museum").candidate;
  const place = { ...candidate, id: `osm:${candidate.poiId}:poi`, precision: "poi", confirmation: "user_confirmed", confirmedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim" };
  const events = JSON.parse(fixture.events);
  for (const [id, title] of [["d1-activity", "湖南博物院（公共集合点）"], ["d1-lunch", "旧用餐点（合成位置）"], ["d1-rest", "湖南博物院（公共集合点）"]]) Object.assign(events.find((event) => event.id === id), { placeId: place.id, title, locationName: title });
  const trip = await db.trip.create({ data: { title: "餐厅替换 · 真实道路验证（合成旅行）", originalRequest: "以公共地标坐标验证餐厅替换路线，旧用餐点和时间为合成数据。", status: "plan_needs_review" } });
  await db.tripRequest.create({ data: { tripId: trip.id, originalRequest: trip.originalRequest, requestRevision: 2, confirmedRevision: 2, extractedRequest: fixture.requestSnapshot, confirmedRequest: fixture.requestSnapshot, confirmedAt: new Date() } });
  let row = await db.planVersion.create({ data: { tripId: trip.id, ...fixture, events: JSON.stringify(events), places: JSON.stringify([place]) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id } });
  for (const [fromEventId, toEventId, departureTime] of [["d1-activity", "d1-lunch", "12:00"], ["d1-lunch", "d1-rest", "13:30"]]) {
    const { plan } = await post(`/api/trips/${trip.id}/plans/${row.versionNumber}/routes`, { fromEventId, toEventId, departureTime,
      manualReference: { availability: "available", instructions: "旧路线为合成夹具，非真实道路", durationMinutes: 10, fareCents: null, sourceName: "合成夹具", sourceUrl: null, checkedAt: new Date().toISOString(), acknowledged: true } }, "PATCH");
    row = plan;
  }
  const baselineRoutes = row.routeLegs.map(({ manualReference, ...route }) => { void manualReference; return { ...route, mode: "driving", status: "estimated", includedTimes: ["driving"] }; });
  await db.planVersion.update({ where: { id: row.id }, data: { routeLegs: JSON.stringify(baselineRoutes) } });
  const endpoint = `/api/trips/${trip.id}/plans/${row.versionNumber}/restaurants`;
  const { preview } = await post(endpoint, { action: "preview", eventId: "d1-lunch", candidateId: "xinyuloudong-wanjiali", pricing: { dinerCount: 3, minCents: null, maxCents: null } });
  const result = { checkedAt: new Date().toISOString(), tripId: trip.id, url: `${base}/trips/${trip.id}`, baselineRouteIsSynthetic: true, preview };
  await fs.writeFile(path.join(output, "actual.json"), JSON.stringify(result, null, 2));
  for (const route of [preview.card.incomingRoute, preview.card.outgoingRoute]) {
    assert.equal(route.source, "OpenStreetMap / OSRM"); assert.ok(route.durationSeconds > 0); assert.ok(route.polyline.length > 1);
  }
  assert.ok(preview.canApply, preview.conflicts.join("; "));
  const { plan: saved } = await post(endpoint, { action: "apply", eventId: "d1-lunch", previewToken: preview.previewToken });
  assert.equal(saved.versionNumber, row.versionNumber + 1); assert.deepEqual(saved.routeLegs, [preview.card.incomingRoute, preview.card.outgoingRoute]);
  result.savedVersion = saved.versionNumber; result.savedRoutes = saved.routeLegs; result.savedCosts = saved.costs;
  await fs.writeFile(path.join(output, "actual.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: "passed", savedVersion: saved.versionNumber, routes: saved.routeLegs.map(({ source, distanceMeters, durationSeconds, cost }) => ({ source, distanceMeters, durationSeconds, cost })) }));
} finally { await db.$disconnect(); }
