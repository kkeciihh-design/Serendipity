import { describe, expect, it } from "vitest";
import { attractionCatalog } from "../lib/attraction-catalog";
import { attractionExclusionReasons, buildAttractionCard, buildAttractionRecommendations, catalogEntryForEvent, confirmedBudgetLimit } from "../lib/attractions";
import { derivePlanCosts } from "../lib/budget";
import type { EvidenceFactClient } from "../lib/evidence";
import { normalizePlanOutput } from "../lib/plan";
import type { PlanVersionRecord } from "../lib/plan-service";
import { placeIdentity, placeSchema } from "../lib/places";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

function fixture(): PlanVersionRecord {
  const request = requestFixture();
  const plan = planFixture(request);
  plan.events.find((event) => event.id === "d1-activity")!.locationName = "湖南博物院";
  return { id: "plan-1", tripId: "trip-1", versionNumber: 1, requestRevision: 1, requestSnapshot: request,
    ...plan, costs: derivePlanCosts(plan.events), places: [], routeLegs: [], tickets: [], isCurrent: true,
    validationResults: { status: "needs_review", errors: [], warnings: [] }, requirementUpToDate: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

describe("attraction recommendations and field truth", () => {
  it("uses the plan's own interests and rhythm with modest route claims", () => {
    const plan = fixture();
    plan.requestSnapshot.pace = "relaxed";
    plan.requirementUpToDate = false;
    const result = buildAttractionRecommendations(plan, "d1-activity");
    expect(result.current?.reasons.join(" ")).toContain("博物馆");
    expect(result.current?.reasons.join(" ")).toContain("舒缓");
    expect(result.current?.reasons.join(" ")).toContain("尚无可比较的绕路耗时");
    expect(result.current?.reservation.required).toBe(true);
    expect(result.current?.reservation.status).toBe("pending");
    expect(result.notices.join(" ")).toContain("原有偏好与日期");
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it("never shows a previous title's photograph after an explicit location change", () => {
    const plan = fixture();
    const event = plan.events.find((item) => item.id === "d1-activity")!;
    event.title = "湖南博物院";
    event.locationName = "其他城市的博物馆";
    event.attractionSelection = { catalogId: "hunan-museum", action: "replace", selectedAt: new Date().toISOString() };
    expect(catalogEntryForEvent(plan, event)).toBeNull();
    const candidate = { ...attractionCatalog[0].location!, city: "武汉", name: "湖南博物院" };
    const place = placeSchema.parse({ ...candidate, id: placeIdentity(candidate, "poi"), precision: "poi", confirmation: "user_confirmed", confirmedAt: new Date().toISOString(), source: "OpenStreetMap / Nominatim" });
    plan.places = [place]; event.placeId = place.id;
    expect(catalogEntryForEvent(plan, event)).toBeNull();
    expect(buildAttractionRecommendations(plan, event.id).current).toBeNull();
  });

  it("excludes a verified applicable closure but does not turn an undated rule into a closure fact", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-activity")!;
    const entry = structuredClone(attractionCatalog[0]);
    entry.opening = { ...entry.opening, status: "verified", closedDates: [event.date], applicableFrom: event.date, applicableUntil: event.date };
    expect(attractionExclusionReasons(entry, plan, event).join(" ")).toContain("闭馆");
    entry.opening.applicableUntil = null;
    expect(attractionExclusionReasons(entry, plan, event)).toEqual([]);
    expect(buildAttractionCard(entry, plan, event, false).opening.status).toBe("pending");
  });

  it("excludes an explicitly sourced calendar closure without certifying unrelated opening rules", () => {
    const plan = fixture(), event = { ...plan.events.find((item) => item.id === "d1-activity")!, date: "2026-10-08" };
    expect(attractionExclusionReasons(attractionCatalog[0], plan, event).join(" ")).toContain("官方公告明确闭馆");
    const orphan = structuredClone(attractionCatalog[0]); orphan.sources = [];
    expect(attractionExclusionReasons(orphan, plan, event)).toEqual([]);
    event.date = "2027-10-08";
    expect(attractionExclusionReasons(attractionCatalog[0], plan, event)).toEqual([]);
  });

  it.each([
    ["总预算不超过1000元。最好少走路", 100000],
    ["最好少走路，总预算控制在1000元以内", 100000],
    ["总预算不超过1000元", 100000],
    ["总预算尽量不超过1000元", null],
    ["总预算1000元左右", null],
    ["最好总预算控制在1000元以内。少走路", null],
    ["总预算不超过1000元左右；少走路", null],
    ["预算不超过1000.50元。大概下午三点到", 100050],
  ])("M1 judges only the budget clause: %s", (constraint, expected) => {
    const plan = fixture(); plan.requestSnapshot.constraints = [constraint as string];
    expect(confirmedBudgetLimit(plan)).toBe(expected);
  });

  it.each(["。", "；", ";", "！", "!", "？", "?", "\n", "\r\n", "，", ",", "."])("M1 separates unrelated soft preferences at %j", (separator) => {
    const plan = fixture(); plan.requestSnapshot.constraints = [`尽量住地铁口${separator}总预算不超过1000元${separator}大概下午三点到`];
    expect(confirmedBudgetLimit(plan)).toBe(100000);
  });

  it.each(["预算不超过 50 元", "预算不能超过 50 元", "预算至多 50 元"])("recognizes the explicit maximum %s", (constraint) => {
    const plan = fixture(); plan.requestSnapshot.constraints = [constraint];
    expect(confirmedBudgetLimit(plan)).toBe(5000);
    plan.requestSnapshot.constraints = [`最好${constraint}`];
    expect(confirmedBudgetLimit(plan)).toBeNull();
  });

  it("respects explicit exclusions and only interprets an explicit maximum as a hard budget", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-activity")!;
    const entry = structuredClone(attractionCatalog.find((item) => item.id === "yuelu-academy")!);
    entry.ticket.status = "verified";
    plan.requestSnapshot.budgetAmountCents = 1;
    expect(attractionExclusionReasons(entry, plan, event)).toEqual([]);
    plan.requestSnapshot.constraints = ["总预算上限 1 元。最好少走路"];
    expect(attractionExclusionReasons(entry, plan, event).join(" ")).toContain("预算上限");
    plan.requestSnapshot.constraints = ["不去岳麓书院"];
    expect(attractionExclusionReasons(entry, plan, event).join(" ")).toContain("明确保留");
  });

  it("takes verified price amounts from the matching plan cost, never stale catalogue prices", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-activity")!;
    const cost = plan.costs.find((item) => item.linkedEventId === event.id)!;
    cost.unit = "per_person"; cost.unitAmountCents = 6600; cost.unitAmountMaxCents = 6600;
    const fact: EvidenceFactClient = { id: "price-fact", planVersionId: plan.id, targetType: "event", targetId: event.id,
      field: "price", status: "verified", effectiveStatus: "verified", sourceTitle: "适用日票价", sourceUrl: "https://www.hnmuseum.com/visit", sourcePublisher: "hnmuseum.com",
      sourcePublishedAt: null, sourceDateStatus: "applicable", extractedValue: "66 元/人", searchProvider: "test", searchQuery: "test",
      retrievedAt: new Date().toISOString(), applicableFrom: `${event.date}T00:00:00+08:00`, applicableUntil: `${event.date}T23:59:59+08:00`,
      lastRefreshAt: null, lastRefreshStatus: "success", lastRefreshError: null, contentQuote: "全价票 66 元/人", conflictReason: null };
    const card = buildAttractionCard(attractionCatalog[0], plan, event, true, [fact]);
    expect(card.ticket).toMatchObject({ status: "verified", minCents: 6600, maxCents: 6600 });
    expect(card.reservation.status).toBe("pending");
    cost.unit = "one_time";
    expect(buildAttractionCard(attractionCatalog[0], plan, event, true, [fact]).ticket).toMatchObject({ status: "pending", minCents: null });
  });

  it("keeps missing ticket amounts unknown and makes long-visit warnings visible", () => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-activity")!;
    const unknown = attractionCatalog.find((entry) => entry.id === "orange-isle")!;
    expect(buildAttractionCard(unknown, plan, event, false).ticket.minCents).toBeNull();
    plan.requestSnapshot.pace = "relaxed";
    const card = buildAttractionCard(attractionCatalog[0], plan, event, false);
    expect(card.warnings.join(" ")).toContain("超过原活动窗口");
    expect(card.warnings.join(" ")).toContain("不代表预约成功");
  });

  it("does not grant model output the user's keep/replace selection authority", () => {
    const plan = planFixture(requestFixture());
    plan.events[0].attractionSelection = { action: "keep", catalogId: "hunan-museum", selectedAt: new Date().toISOString() };
    expect(normalizePlanOutput(plan).events[0].attractionSelection).toBeUndefined();
  });

  it.each(["required", "not_required"])("synchronizes the reservation fact's %s value, displayed text and date scope", (value) => {
    const plan = fixture(), event = plan.events.find((item) => item.id === "d1-activity")!;
    const base: EvidenceFactClient = { id: "reservation-fact", planVersionId: plan.id, targetType: "event", targetId: event.id,
      field: "reservation", status: "verified", effectiveStatus: "verified", sourceTitle: "适用日预约规则", sourceUrl: "https://www.hnmuseum.com/visit", sourcePublisher: "hnmuseum.com",
      sourcePublishedAt: null, sourceDateStatus: "applicable", extractedValue: value, searchProvider: "test", searchQuery: "test",
      retrievedAt: new Date().toISOString(), applicableFrom: `${event.date}T00:00:00+08:00`, applicableUntil: `${event.date}T23:59:59+08:00`,
      lastRefreshAt: null, lastRefreshStatus: "success", lastRefreshError: null, contentQuote: "本次预约规则", conflictReason: null };
    const opening = { ...base, id: "opening-fact", field: "opening_hours" as const, evaluationVersion: 1, extractedValue: "09:00–17:00" };
    const card = buildAttractionCard(attractionCatalog[0], plan, event, true, [base, opening]);
    expect(card.reservation.required).toBe(value === "required");
    expect(card.reservation.text).not.toContain("required");
    expect(card.opening).toMatchObject({ status: "verified", applicableFrom: event.date, applicableUntil: event.date });
    const partialWindow = { ...opening, applicableFrom: `${event.date}T11:00:00+08:00`, applicableUntil: `${event.date}T13:00:00+08:00` };
    expect(buildAttractionCard(attractionCatalog[0], plan, event, true, [partialWindow]).opening.status).toBe("pending");
  });
});
