import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { applyPlanCostEdit, budgetFactorsFromSnapshot, calculateBudgetSummary, costItemLineTotals, derivePlanCosts, validatePlanCosts } from "../lib/budget";
import { evidenceTarget, evidenceTargetSignature } from "../lib/evidence-evaluation";
import { aiPlanOutputSchema } from "../lib/plan";
import type { PlanVersionRecord } from "../lib/plan-service";
import { placeIdentity, placeSchema } from "../lib/places";
import { restaurantCatalog, restaurantImages } from "../lib/restaurant-catalog";
import { buildRestaurantCard, buildRestaurantRecommendations, mealFitsOpening, mealPricingSchema, priceMealCost, restaurantExclusions, restaurantForEvent } from "../lib/restaurants";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

function fixture(): PlanVersionRecord {
  const request = requestFixture(), content = planFixture(request);
  content.events.find((event) => event.id === "d1-lunch")!.locationName = restaurantCatalog[0].name;
  return { id: "plan", tripId: "trip", versionNumber: 1, requestRevision: 1, requestSnapshot: request, ...content,
    costs: derivePlanCosts(content.events), places: [], routeLegs: [], tickets: [], isCurrent: true, requirementUpToDate: true,
    validationResults: { status: "needs_review", errors: [], warnings: [] }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
describe("meal pricing and branch facts", () => {
  it.each([1, 3, 7])("charges %i diners once for this meal, retaining the trip and other meal bases", (diners) => {
    const plan = fixture(), first = plan.costs.find((cost) => cost.linkedEventId === "d1-lunch")!;
    const cost = priceMealCost(first, { dinerCount: diners, minCents: 1850, maxCents: 2500 });
    expect(costItemLineTotals(cost, budgetFactorsFromSnapshot(plan.requestSnapshot))).toEqual({ quantity: diners, minCents: 1850 * diners, maxCents: 2500 * diners });
    const before = calculateBudgetSummary(plan.costs, plan.requestSnapshot);
    const after = calculateBudgetSummary(plan.costs.map((item) => item.id === cost.id ? cost : item), plan.requestSnapshot);
    expect(after.totalMinCents - before.totalMinCents).toBe(1850 * diners - 1800);
    expect(after.factors.travelerCount).toBe(2);
    expect(validatePlanCosts([cost], plan.events)).toEqual([]);
  });
  it("does not turn an old total into per-person pricing and preserves unknown versus free", () => {
    const plan = fixture(), result = buildRestaurantRecommendations(plan, "d1-lunch");
    expect(result.pricing.minCents).toBeNull(); expect(result.currentMealTotal.minCents).toBe(1800);
    expect(result.current?.totalMinCents).toBe(1800); expect(result.current?.warnings.join(" ")).not.toContain("本餐金额未知");
    const unknown = priceMealCost(plan.costs[0], { dinerCount: 3, minCents: null, maxCents: null });
    expect(costItemLineTotals(unknown, { travelerCount: 2, roomCount: 1, nightCount: 1 }).minCents).toBeNull();
    expect(costItemLineTotals({ ...unknown, unitAmountCents: 0 }, { travelerCount: 2, roomCount: 1, nightCount: 1 }).minCents).toBe(0);
    expect(mealPricingSchema.safeParse({ dinerCount: 3, minCents: null, maxCents: 100 }).success).toBe(false);
    expect(mealPricingSchema.safeParse({ dinerCount: 1.5, minCents: 100, maxCents: 50 }).success).toBe(false);
  });
  it("budget confirmation preserves meal participants; changing to a total removes that multiplier", () => {
    const plan = fixture(), item = priceMealCost(plan.costs.find((cost) => cost.linkedEventId === "d1-lunch")!, { dinerCount: 3, minCents: 1800, maxCents: null });
    const input = { costId: item.id, unit: "per_person" as const, unitAmountCents: 2000, unitAmountMaxCents: null, quantity: null, paymentStatus: "paid" as const };
    const [confirmed] = applyPlanCostEdit([item], input, plan.events);
    expect(confirmed.dinerCount).toBe(3); expect(costItemLineTotals(confirmed, budgetFactorsFromSnapshot(plan.requestSnapshot)).minCents).toBe(6000);
    const [total] = applyPlanCostEdit([confirmed], { ...input, unit: "one_time", unitAmountCents: 6000 }, plan.events);
    expect(total.dinerCount).toBeUndefined(); expect(validatePlanCosts([total], plan.events)).toEqual([]);
  });
  it("matches specific branches and rejects stale selection, same brand, wrong city and moved coordinates", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-lunch")!;
    expect(restaurantForEvent(plan, event)?.id).toBe("huogongdian-pozi");
    event.locationName = "火宫殿"; event.restaurantSelection = { catalogId: "huogongdian-pozi", action: "replace", selectedAt: new Date().toISOString() };
    expect(restaurantForEvent(plan, event)).toBeNull();
    event.locationName = restaurantCatalog[0].name; plan.requestSnapshot.destination = "杭州"; expect(restaurantForEvent(plan, event)).toBeNull();
    plan.requestSnapshot.destination = "长沙";
    const candidate = restaurantCatalog[2].location!;
    const place = placeSchema.parse({ ...candidate, longitude: candidate.longitude + 0.05, id: placeIdentity(candidate, "poi"), precision: "poi", confirmation: "user_confirmed", confirmedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim" });
    plan.places = [place]; event.placeId = place.id; expect(restaurantForEvent(plan, event)).toBeNull();
  });
  it("handles lunch breaks and overnight opening, while undated community hours remain pending", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-lunch")!, entry = structuredClone(restaurantCatalog[1]);
    expect(mealFitsOpening(entry, event)).toBe(true);
    event.startTime = "13:45"; event.endTime = "14:30"; expect(mealFitsOpening(entry, event)).toBe(false);
    const pending = buildRestaurantCard(entry, plan, event, false);
    expect(pending.eligibility).toBe("pending"); expect(pending.warnings.join(" ")).toContain("参考营业时段");
    entry.opening.periods = [{ start: "20:00", end: "02:00" }]; event.startTime = "00:30"; event.endTime = "01:30"; expect(mealFitsOpening(entry, event)).toBe(true);
  });
  it("excludes sourced closures, relocation and out-of-hours visits only within applicability", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-lunch")!, entry = structuredClone(restaurantCatalog[0]);
    const pricing = { dinerCount: 2, minCents: null, maxCents: null };
    entry.opening = { ...entry.opening, status: "verified", periods: [{ start: "17:00", end: "21:00" }], applicableFrom: event.date, applicableUntil: event.date };
    expect(restaurantExclusions(entry, plan, event, pricing).join(" ")).toContain("完整用餐时间");
    entry.opening.applicableUntil = null;
    entry.availability = { state: "relocated", applicableFrom: event.date, applicableUntil: event.date, sourceIds: [entry.sources[0].id] };
    expect(restaurantExclusions(entry, plan, event, pricing).join(" ")).toContain("搬迁");
    entry.availability.sourceIds = []; expect(restaurantExclusions(entry, plan, event, pricing)).toEqual([]);
  });
  it("uses saved people and limitations, ranks an individual meal, and provides an honest empty city", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-lunch")!;
    plan.requestSnapshot.travelerCount = 1; plan.requestSnapshot.constraints = ["花生过敏"]; plan.requirementUpToDate = false;
    const result = buildRestaurantRecommendations(plan, event.id);
    expect(result.candidates[0].service).toBe("individual"); expect(result.current?.diningFit).toContain("1人");
    expect(result.current?.warnings.join(" ")).toContain("未标为已满足"); expect(result.notices.join(" ")).toContain("最新需求尚未应用");
    plan.requestSnapshot.destination = "杭州";
    expect(buildRestaurantRecommendations(plan, event.id)).toMatchObject({ current: null, candidates: [], canEdit: true });
  });
  it("does not invent queues from crowd descriptions or stale/future observations", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-lunch")!, entry = structuredClone(restaurantCatalog[0]);
    expect(buildRestaurantCard(entry, plan, event, true).queueText).toBe("暂无可靠排队信息");
    const now = Date.parse(`${event.date}T12:30:00+08:00`), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      entry.queue = { minMinutes: 5, maxMinutes: 10, observedAt: new Date(now - 60_000).toISOString(), sourceIds: [entry.sources[0].id] };
      expect(buildRestaurantCard(entry, plan, event, true).queueText).toContain("仅当时观察");
      entry.queue.observedAt = new Date(now - 16 * 60_000).toISOString(); expect(buildRestaurantCard(entry, plan, event, true).queueText).toBe("暂无可靠排队信息");
      entry.queue.observedAt = new Date(now + 60_000).toISOString(); expect(buildRestaurantCard(entry, plan, event, true).queueText).toBe("暂无可靠排队信息");
    } finally { clock.mockRestore(); }
  });
  it("invalidates price evidence when meal participants change and strips AI selection authority", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-lunch")!;
    const cost = priceMealCost(plan.costs.find((item) => item.linkedEventId === event.id)!, { dinerCount: 1, minCents: 1800, maxCents: null });
    expect(evidenceTargetSignature(evidenceTarget(event, [cost]), "price")).not.toBe(evidenceTargetSignature(evidenceTarget(event, [{ ...cost, dinerCount: 3 }]), "price"));
    event.restaurantSelection = { catalogId: "fake", action: "replace", selectedAt: new Date().toISOString() };
    expect(aiPlanOutputSchema.parse(plan).events.find((item) => item.id === event.id)).not.toHaveProperty("restaurantSelection");
  });
  it("ships a real decodable attributed photograph and rejects swapped files or branches", async () => {
    const entry = restaurantCatalog[0], photo = restaurantImages(entry)[0];
    const bytes = await fs.readFile(path.join(process.cwd(), "public", photo.url));
    const meta = await sharp(bytes).metadata();
    expect(bytes.length).toBeLessThan(400_000); expect(meta.width).toBeLessThanOrEqual(960); expect(meta.exif).toBeUndefined();
    expect(photo.license).toBe("CC BY-SA 4.0");
    for (const change of [{ city: "杭州" }, { entryId: "another-branch" }, { url: "/attractions/hunan-museum.webp" }, { displayAllowed: false }, { license: "unknown" }]) expect(restaurantImages({ ...entry, images: [{ ...photo, ...change }] })).toEqual([]);
  });
});
