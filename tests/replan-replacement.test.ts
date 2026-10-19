import { describe, expect, it } from "vitest";
import { applyReplanProposal, assertReplacementGoal, replanSummary } from "../lib/replan";
import type { PlanVersionRecord } from "../lib/plan-service";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { derivePlanCosts } from "../lib/budget";
import { buildDailyRouteMarkers } from "../lib/route-illustration";
import { preparePlanForStorage } from "../lib/plan";
import { QUANZHOU_STATION_REFERENCE, XUNPU_VILLAGE_REFERENCE } from "../lib/place-reference";

const reason = "第2天下雨，把海边洛伽寺改成室内博物馆或非遗体验，调整接驳";
function basePlan(): PlanVersionRecord {
  const requestSnapshot = requestFixture(3, { destination: "泉州", startDate: "2026-11-07", endDate: "2026-11-09" });
  const content = planFixture(requestSnapshot);
  const original = content.events.find((event) => event.id === "d2-activity")!;
  Object.assign(original, { title: "洛伽寺拍照", locationName: "洛伽寺", startTime: "14:00", endTime: "17:00", latitude: 24.8519, longitude: 118.6466 });
  content.events = content.events.filter((event) => event.id !== "d2-rest");
  content.events.push({ ...original, id: "access", type: "local_transport", startTime: "13:30", endTime: "14:00", title: "前往洛伽寺", locationName: "洛伽寺" },
    { ...original, id: "back", type: "local_transport", startTime: "17:00", endTime: "18:00", title: "返回西街", locationName: "西街" },
    { ...original, id: "dinner", type: "meal", startTime: "18:00", endTime: "19:00", title: "姜母鸭", locationName: "西街" });
  return { ...preparePlanForStorage(content), id: "plan", tripId: "trip", versionNumber: 1, requestRevision: 1, requestSnapshot, costs: derivePlanCosts(content.events), places: [], routeLegs: [], tickets: [], validationResults: { status: "valid", warnings: [], errors: [] }, requirementUpToDate: true, isCurrent: true, createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z" };
}
const now = "2026-10-19T00:00:00Z";
describe("rain replacement goal validation", () => {
  it("rejects the audited delete-only candidate and a note-only fake replacement", () => {
    const base = basePlan();
    const proposal = { requirementChange: null, edits: ["access", "d2-activity", "back"].map((eventId) => ({ eventId, remove: true, fields: {} })) };
    const candidate = applyReplanProposal(base, base.requestSnapshot, 1, proposal, now);
    expect(() => assertReplacementGoal(base, candidate, reason)).toThrow("不能只删除");
    const noteOnly = applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [{ eventId: "d2-activity", remove: false, fields: { note: "改成室内" } }] }, now);
    expect(() => assertReplacementGoal(base, noteOnly, reason)).toThrow("具体室内");
  });
  it("accepts an actual indoor replacement with two transfers and clears the old coastal coordinate", () => {
    const base = basePlan();
    const candidate = applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [
      { eventId: "d2-activity", remove: false, fields: { title: "泉州海外交通史博物馆", locationName: "泉州海外交通史博物馆", costDraftCents: 0 } },
      { eventId: "access", remove: false, fields: { title: "打车至海外交通史博物馆", locationName: "泉州海外交通史博物馆", costDraftCents: 2000 } },
      { eventId: "back", remove: false, fields: { title: "博物馆打车返回西街", costDraftCents: 2000 } },
    ] }, now);
    expect(() => assertReplacementGoal(base, candidate, reason)).not.toThrow();
    expect(candidate.events.find((event) => event.id === "d2-activity")).toMatchObject({ latitude: null, longitude: null });
    expect(replanSummary(base, candidate)).toMatchObject({ removed: expect.arrayContaining(["洛伽寺拍照"]), added: expect.arrayContaining(["泉州海外交通史博物馆"]) });
  });
  it("rejects an indoor title that still leaves the afternoon blank or has no return transfer", () => {
    const base = basePlan();
    const candidate = applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [
      { eventId: "d2-activity", remove: false, fields: { title: "室内非遗体验", startTime: "10:00", endTime: "11:00" } },
      { eventId: "access", remove: true, fields: {} }, { eventId: "back", remove: true, fields: {} },
    ] }, now);
    expect(() => assertReplacementGoal(base, candidate, reason)).toThrow("空档");
    const missingBack = { ...candidate, events: candidate.events.map((event) => event.id === "d2-activity" ? { ...event, startTime: "14:00", endTime: "17:00" } : event) };
    expect(() => assertReplacementGoal(base, missingBack, reason)).toThrow("接驳");
  });
  it("supports adding missing transit nodes without giving the model confirmation authority", () => {
    const base = basePlan();
    const candidate = applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [{ eventId: "back", remove: true, fields: {} }], additions: [{ type: "local_transport", dayNumber: 2, date: "2026-11-08", startTime: "17:00", endTime: "18:00", title: "博物馆返回西街", locationName: "西街", costDraftCents: 2000, note: "打车约30分钟，保留等车缓冲" }] }, now);
    expect(candidate.events.find((event) => event.id === "replan-1-1-1")).toMatchObject({ status: "suggested", locked: false, suggestedDurationSeconds: 3600 });
    expect(candidate.costs.some((cost) => cost.linkedEventId === "replan-1-1-1")).toBe(true);
  });
  it("renders fresh indoor coordinate suggestions on maps and validates coordinate pairs and authority", () => {
    const base = basePlan();
    const fields = { title: "泉州海外交通史博物馆", locationName: "泉州海外交通史博物馆", latitude: 24.9143, longitude: 118.6068 };
    const candidate = applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [{ eventId: "d2-activity", remove: false, fields }], additions: [
      { type: "activity", dayNumber: 2, date: "2026-11-08", startTime: "09:00", endTime: "10:00", title: "非遗工坊体验", locationName: "西街非遗工坊", latitude: 24.915, longitude: 118.584, costDraftCents: 0 },
    ] }, now);
    const museum = candidate.events.find((event) => event.id === "d2-activity")!;
    expect(museum).toMatchObject({ latitude: fields.latitude, longitude: fields.longitude, coordinateSystem: "WGS84", placeId: null });
    const markers = buildDailyRouteMarkers(candidate.events.filter((event) => event.dayNumber === 2), candidate.places, "泉州");
    expect(markers.find((marker) => marker.events.some((event) => event.id === museum.id))).toMatchObject({ latitude: fields.latitude, longitude: fields.longitude, illustrative: true, geographic: true });
    expect(candidate.events.find((event) => event.id === "replan-1-1-1")).toMatchObject({ latitude: 24.915, longitude: 118.584, placeId: null, status: "suggested" });
    for (const invalid of [{ ...fields, longitude: undefined }, { ...fields, coordinateSystem: "GCJ-02" }, { ...fields, placeId: "invented-confirmation" }]) {
      expect(() => applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [{ eventId: "d2-activity", remove: false, fields: invalid }] }, now)).toThrow();
    }
  });
  it("updates the real V2 lunch, previous-evening guidance and weather reminder without rewriting protected facts", () => {
    const base = basePlan();
    // Exact stale guidance observed in the 2026-10-19 real-service V2 export.
    base.events.find((event) => event.id === "d1-hotel")!.note = "西街到钟楼片区酒店基本步行可达，约10—20分钟，不产生交通费。若行李多或住得稍远，可乘小白车，2元/人。晚间早点休息，第二天去蟳埔村和洛伽寺需要一定车程。";
    base.events.find((event) => event.id === "d2-lunch")!.note = "在蟳埔村内吃海鲜卤面、海蛎煎、白灼虾或紫菜煲，两人约120元。蟳埔靠海，海蛎和紫菜新鲜。饭后整理拍照服装，准备打车去石狮洛伽寺。";
    base.pendingItems.push({ id: "pending-weather", category: "weather", title: "出发前查看泉州和石狮天气及海边风况", reason: "洛伽寺海边拍照受天气和潮汐影响，若大风或降雨需调整蟳埔村与洛伽寺顺序。", requiredBefore: "2026-11-06" });
    const locked = base.events.find((event) => event.id === "d1-rest")!;
    Object.assign(locked, { locked: true, note: "用户明确保留：洛伽寺的旧笔记" });
    const paid = base.events.find((event) => event.id === "d1-breakfast")!;
    paid.note = "已发生费用：洛伽寺相关事实记录";
    base.costs.find((cost) => cost.linkedEventId === paid.id)!.paymentStatus = "paid";
    const original = JSON.stringify(base);
    const candidate = applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [
      { eventId: "d2-activity", remove: false, fields: { title: "泉州海外交通史博物馆室内参观", locationName: "泉州海外交通史博物馆", costDraftCents: 0 } },
    ] }, now);
    for (const id of ["d1-hotel", "d2-lunch"]) {
      expect(candidate.events.find((event) => event.id === id)?.note).not.toContain("洛伽寺");
      expect(candidate.events.find((event) => event.id === id)?.note).toContain("泉州海外交通史博物馆");
    }
    expect(candidate.events.find((event) => event.id === "d2-lunch")?.note).not.toContain("石狮泉州");
    expect(candidate.events.find((event) => event.id === "d2-lunch")?.note).toContain("两人约120元");
    const weather = candidate.pendingItems.find((item) => item.id === "pending-weather")!;
    expect(`${weather.title} ${weather.reason}`).not.toMatch(/洛伽寺|潮汐|海边风况/);
    expect(weather.reason).toContain("泉州海外交通史博物馆");
    expect(candidate.events.find((event) => event.id === locked.id)).toMatchObject({ note: locked.note, locked: true });
    expect(candidate.events.find((event) => event.id === paid.id)?.note).toBe(paid.note);
    expect(JSON.stringify(base)).toBe(original);
  });
  it("upgrades unconfirmed existing landmark suggestions during replan but preserves protected facts", () => {
    const base = basePlan();
    const station = base.events.find((event) => event.id === "return")!;
    Object.assign(station, { locationName: "泉州站", latitude: 24.8876, longitude: 118.5865 });
    const village = base.events.find((event) => event.id === "d2-lunch")!;
    Object.assign(village, { locationName: "蟳埔村", latitude: 24.8845, longitude: 118.6247 });
    const protectedStop = base.events.find((event) => event.id === "d1-lunch")!;
    Object.assign(protectedStop, { locationName: "蟳埔村", latitude: 24.88, longitude: 118.62, locked: true });
    const candidate = applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [
      { eventId: "d3-rest", remove: false, fields: { note: "轻松安排" } },
    ] }, now);
    expect(candidate.events.find((event) => event.id === station.id)).toMatchObject(QUANZHOU_STATION_REFERENCE);
    expect(candidate.events.find((event) => event.id === village.id)).toMatchObject(XUNPU_VILLAGE_REFERENCE);
    expect(candidate.events.find((event) => event.id === protectedStop.id)).toMatchObject({ latitude: 24.88, longitude: 118.62, locked: true });
  });
  it("replaces only named Luojia while retaining Xunpu flower styling after automatic coordinate calibration", () => {
    const base = basePlan();
    const original = base.events.find((event) => event.id === "d2-activity")!;
    base.events.push({ ...original, id: "d2-zanhua", title: "蟳埔村簪花围体验与蚵壳厝拍照", locationName: "蟳埔村", startTime: "10:00", endTime: "12:00", suggestedDurationSeconds: 7200, latitude: 24.8845, longitude: 118.6247 });
    const candidate = applyReplanProposal(base, base.requestSnapshot, 1, { requirementChange: null, edits: [
      { eventId: "d2-activity", remove: false, fields: { title: "泉州海外交通史博物馆室内参观", locationName: "泉州海外交通史博物馆", costDraftCents: 0 } },
      { eventId: "access", remove: false, fields: { title: "从蟳埔村打车至泉州海外交通史博物馆", locationName: "泉州海外交通史博物馆" } },
      { eventId: "back", remove: false, fields: { title: "从博物馆返回西街" } },
    ] }, now);
    expect(candidate.events.find((event) => event.id === "d2-zanhua")).toMatchObject({ title: "蟳埔村簪花围体验与蚵壳厝拍照", ...XUNPU_VILLAGE_REFERENCE });
    expect(() => assertReplacementGoal(base, candidate, "第2天下雨，保留蟳埔村簪花，将洛伽寺改成室内博物馆，并调整接驳")).not.toThrow();
    expect(() => assertReplacementGoal(base, candidate, "第2天下雨，把海边活动改成室内博物馆，并调整接驳")).not.toThrow();
  });
});
