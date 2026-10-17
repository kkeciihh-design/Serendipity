import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { test, expect } from "./fixtures";
import { exportFixture, PRIVATE_ADDRESS } from "../helpers/export-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
import { placeSchema } from "../../lib/places";
import { restaurantCatalog } from "../../lib/restaurant-catalog";
import { mobileExportOptionsSchema, type ExportFileSummary, type ExportSnapshot } from "../../lib/export-snapshot";
import { renderGeographicMap, renderLongImageHtml } from "../../lib/long-image-html";
import { renderPdfHtml } from "../../lib/pdf-html";
import type { AdvisoryView } from "../../lib/advisories";

const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
const output = verificationEvidenceDirectory("phase30-export-regression");
test.afterAll(async () => { await db.$disconnect(); });

test("R30-01/05/06: actual five-format exports preserve public places and saved advice while excluding residential details", async ({ request, browser }) => {
  test.setTimeout(120_000);
  await fs.mkdir(output, { recursive: true });
  const fixture = await exportFixture(2), plan = fixture.plan, date = plan.requestSnapshot.startDate!;
  const selectedEventIds = plan.events.filter((event) => event.date === date).map((event) => event.id).sort();
  const restaurant = restaurantCatalog.find((entry) => entry.id === "xinyuloudong-wanjiali")!;
  const privateName = "合成天鹅湾", privateAddress = "合成星河小区3栋1201室";
  const privateNote = "我家：北京市海淀区安宁庄东路一号二单元三零二室";
  plan.events.find((event) => event.id === "d1-activity")!.title = "合成公开场馆参观";
  plan.events.find((event) => event.id === "d1-activity")!.note = privateNote;
  Object.assign(plan.events.find((event) => event.id === "d1-lunch")!, {
    title: restaurant.name, restaurantSelection: { catalogId: restaurant.id, action: "replace", selectedAt: fixture.generatedAt },
  });
  plan.events.find((event) => event.id === "d1-rest")!.title = "午间休息";
  for (const [index, assignment] of [
    { eventId: "d1-activity", name: "合成公开场馆", address: "合成公共公园", longitude: 112.90, latitude: 28.20 },
    { eventId: "d1-lunch", name: restaurant.name, address: "万家丽中路115号", longitude: 113.00, latitude: 28.30 },
    { eventId: "d1-rest", name: privateName, address: privateAddress, longitude: 112.956, latitude: 28.243 },
  ].entries()) {
    const place = placeSchema.parse({ ...assignment, id: `review-place-${index}`, provider: "osm", poiId: `node:${index + 1}`,
      city: "长沙", district: "合成区", adcode: "", category: "test", coordinateSystem: "WGS84", retrievedAt: fixture.generatedAt,
      precision: "poi", confirmation: "user_confirmed", confirmedAt: fixture.generatedAt, source: "OpenStreetMap / Nominatim" });
    plan.places.push(place);
    Object.assign(plan.events.find((event) => event.id === assignment.eventId)!, { placeId: place.id, locationName: place.name });
  }
  const created = await request.post("/api/trips", { data: { originalRequest: "阶段30导出修复首日合成回归，无真实订单和住址。" } });
  expect(created.status()).toBe(201);
  const { trip } = await created.json();
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: plan.requestSnapshot } })).ok()).toBe(true);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).ok()).toBe(true);
  const savedPlan = await db.planVersion.create({ data: {
    tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(plan.requestSnapshot),
    events: JSON.stringify(plan.events), costs: JSON.stringify(plan.costs), places: JSON.stringify(plan.places), tickets: JSON.stringify(plan.tickets),
    pendingItems: JSON.stringify(plan.pendingItems), validationResults: JSON.stringify(plan.validationResults),
  } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: savedPlan.id, status: "planned" } });
  const retrievedAt = new Date(), sourceTitle = "合成测试场馆闭馆公告";
  await db.evidenceFact.create({ data: {
    tripId: trip.id, planVersionId: savedPlan.id, targetType: "event", targetId: "d1-activity", field: "opening_hours",
    evaluationVersion: 1, status: "verified", sourceDateStatus: "applicable", sourceTitle, sourceUrl: "https://example.invalid/synthetic-closure",
    sourcePublisher: "合成场馆", extractedValue: "闭馆", contentQuote: "合成回归：本次到访日期闭馆，不能作为实际出行依据。",
    retrievedAt, applicableFrom: new Date(`${date}T00:00:00+08:00`), applicableUntil: new Date(`${date}T23:59:59+08:00`),
    searchProvider: "synthetic", searchQuery: "synthetic",
  } });
  const viewResponse = await request.get(`/api/trips/${trip.id}/advisories?planVersion=1`);
  expect(viewResponse.ok()).toBe(true);
  const { advisories }: { advisories: AdvisoryView } = await viewResponse.json();
  const advisory = advisories.items.find((item) => item.id === "opening:d1-activity")!;
  expect(advisory).toBeDefined();
  const acknowledged = await request.post(`/api/trips/${trip.id}/advisories`, { data: {
    action: "acknowledge", expectedPlanVersion: 1, expectedRevision: advisories.revision,
    advisoryId: advisory.id, signature: advisory.signature, acknowledged: true,
  } });
  expect(acknowledged.ok()).toBe(true);
  const formats = ["mobile-html", "plain-text", "markdown", "long-image", "pdf"] as const;
  const files: ExportFileSummary[] = [];
  const choices = mobileExportOptionsSchema.parse({ dates: [date] });
  const forbidden = [PRIVATE_ADDRESS, privateName, privateAddress, privateNote, "08车06A"];
  const inspect = (document: string) => {
    for (const text of [restaurant.name, advisory.title, advisory.recommendation, sourceTitle, "用户标记已知于", "导出时适用", "标记已知不表示风险解除", "私人地址细节已隐藏"]) expect(document).toContain(text);
    for (const text of forbidden) expect(document).not.toContain(text);
    expect(document.split(advisory.title)).toHaveLength(2);
    expect(document).toContain("00:00"); expect(document).toContain("23:59");
  };
  for (const format of formats) {
    const response = await request.post(`/api/trips/${trip.id}/exports`, { data: {
      expectedPlanVersion: 1, format, options: choices,
      ...(format === "long-image" ? { imageContent: { includeMap: true, includePhotos: false } } : {}),
      ...(format === "pdf" ? { pdfContent: { mode: "complete", includePhotos: false } } : {}),
    } });
    expect(response.status(), await response.text()).toBe(201);
    const { file }: { file: ExportFileSummary } = await response.json(); files.push(file);
    const row = await db.exportFile.findUniqueOrThrow({ where: { id: file.id } });
    const snapshot: ExportSnapshot = JSON.parse(row.snapshot);
    expect(snapshot.plan.id).toBe(savedPlan.id);
    expect(snapshot.advisories!.items.find((item) => item.id === advisory.id)).toMatchObject({ acknowledged: true, title: advisory.title, sourceLabel: sourceTitle });
    if (format === "long-image" || format === "pdf") {
      // Persist the renderer input from the actual captured export. Binary
      // downloads and renderer metadata are checked below; these source files
      // make map and advisory semantics inspectable without decoding pixels.
      const source = format === "long-image" ? await renderLongImageHtml(snapshot, choices, { includeMap: true, includePhotos: false }) :
        await renderPdfHtml(snapshot, choices, { mode: "complete", includePhotos: false });
      inspect(source);
      expect(source.match(/<circle /g)).toHaveLength(2);
      const publicSnapshot = structuredClone(snapshot);
      publicSnapshot.plan.events.find((event) => event.id === "d1-rest")!.placeId = null;
      expect(renderGeographicMap(snapshot, choices, date)).toBe(renderGeographicMap(publicSnapshot, choices, date));
      await fs.writeFile(path.join(output, `${format}-source.html`), source);
    }
    if (format === "long-image") {
      expect(file.parts!.length).toBeGreaterThan(0);
      expect([...new Set(file.parts!.flatMap((part) => part.eventIds))].sort()).toEqual(selectedEventIds);
      for (const part of file.parts!) {
        const download = await request.get(`/api/trips/${trip.id}/exports/${file.id}?part=${part.index}&download=1`);
        expect(download.ok()).toBe(true);
        const bytes = await download.body(), metadata = await sharp(bytes).metadata();
        expect(metadata.width).toBe(1080); expect(metadata.exif).toBeUndefined();
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(part.sha256);
        await fs.writeFile(path.join(output, `review-${part.index}.png`), bytes);
      }
    } else {
      const download = await request.get(`/api/trips/${trip.id}/exports/${file.id}?download=1`);
      expect(download.ok()).toBe(true);
      const bytes = await download.body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
      const extension = format === "mobile-html" ? "html" : format === "plain-text" ? "txt" : format === "markdown" ? "md" : "pdf";
      await fs.writeFile(path.join(output, `review.${extension}`), bytes);
      if (format === "pdf") {
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        expect(file.pdf!.pages).toBeGreaterThan(1);
        expect(file.pdf!.eventIds.sort()).toEqual(selectedEventIds);
      } else inspect(bytes.toString("utf8"));
    }
  }
  const offline = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  try {
    await offline.setOffline(true);
    const page = await offline.newPage();
    await page.goto(pathToFileURL(path.join(output, "review.html")).href);
    await expect(page.locator("#advisories")).toContainText(advisory.title);
    await expect(page.locator("#advisories")).toContainText("用户标记已知于");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, "mobile-full.png"), fullPage: true });
    await page.locator("#advisories").screenshot({ path: path.join(output, "mobile-advisories.png") });
  } finally { await offline.close(); }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ tripId: trip.id, date, publicRestaurant: restaurant.name,
    expectedPublicMapMarkers: 2, acknowledgedAdvisory: advisory.id, files,
    checks: "Downloaded HTML/TXT/Markdown semantics; PNG/PDF source projection, exact bytes, event coverage, and offline HTML. PNG/PDF visual review is recorded separately." }, null, 2));
});
