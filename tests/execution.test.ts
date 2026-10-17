import { describe, expect, it } from "vitest";
import { applyExecutionChange, emptyExecution, executionSummary, executionTiming, executionWriteSchema } from "../lib/execution";
import { calibrateTravelClock, readTravelClock } from "../lib/travel-clock";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { forwardCheck, liveRedlineCheck, redlineUrgency, type RedlineInput, type RedlineResult } from "../lib/redlines";
const events = planFixture(requestFixture(2, { startDate: "2026-10-20", endDate: "2026-10-21" })).events;
const now = "2026-10-20T09:00:00+08:00";
describe("执行进度及共享时钟", () => {
  it("never infers completion from time, handles before start, expired and all completed", () => {
    let state = emptyExecution();
    expect(executionSummary(events, state, Date.parse(now)).status).toBe("not_started");
    expect(executionSummary(events, state, Date.parse("2026-10-22T10:00:00+08:00")).scheduleEnded).toBe(true);
    state = applyExecutionChange(state, events, { action: "start", eventId: "d1-activity" }, now);
    expect(executionSummary(events, state, Date.parse("2026-10-22T10:00:00+08:00")).current?.id).toBe("d1-activity");
    expect(executionTiming(events.find((e) => e.id === "d1-activity")!, Date.parse(now)).phase).toBe("future");
    expect(executionTiming(events.find((e) => e.id === "d1-activity")!, Date.parse("2026-10-20T11:00:00+08:00")).phase).toBe("ongoing");
    expect(executionTiming(events.find((e) => e.id === "d1-activity")!, Date.parse("2026-10-20T12:00:00+08:00")).phase).toBe("expired");
    for (const event of events) {
      state = applyExecutionChange(state, events, { action: "select", eventId: event.id }, now);
      state = applyExecutionChange(state, events, { action: "complete", eventId: event.id }, now);
    }
    expect(executionSummary(events, state, Date.parse(now))).toMatchObject({ status: "ended", current: null, next: null, completedCount: events.length });
    expect(state.endedAt).toBe(now);
  });
  it("manual progress outranks scheduled place; selecting or locating never claims arrival", () => {
    let state = applyExecutionChange(emptyExecution(), events, { action: "start", eventId: "d2-activity" }, now);
    expect(state.location).toBeNull(); expect(state.items).toEqual([]);
    state = applyExecutionChange(state, events, { action: "arrive", eventId: "d2-activity" }, now);
    expect(state.location).toMatchObject({ source: "manual", eventId: "d2-activity" });
    state = applyExecutionChange(state, events, { action: "locate", latitude: 28.1, longitude: 113.1, accuracy: 20 }, now);
    expect(state.currentEventId).toBe("d2-activity"); expect(state.items[0].completedAt).toBeNull();
    state = applyExecutionChange(state, events, { action: "manual_location", label: "公共地标" }, now);
    expect(state.location).toMatchObject({ source: "manual", label: "公共地标" });
    expect(JSON.stringify(state)).not.toContain("113.1");
  });
  it("completing a manually selected step advances forwards and keeps earlier omissions visible", () => {
    let state = applyExecutionChange(emptyExecution(), events, { action: "start", eventId: "d1-activity" }, now);
    state = applyExecutionChange(state, events, { action: "complete", eventId: "d1-activity" }, now);
    expect(state.currentEventId).toBe("d1-lunch");
    const summary = executionSummary(events, state, Date.parse(now));
    expect(summary.earlierIncompleteCount).toBeGreaterThan(0); expect(summary.next?.id).toBe("d1-rest");
    state = applyExecutionChange(state, events, { action: "select", eventId: "return" }, now);
    expect(executionSummary(events, state, Date.parse(now)).next).toBeNull();
  });
  it("rejects nonexistent actions, server timestamps and forged completion lists", () => {
    expect(() => applyExecutionChange(emptyExecution(), events, { action: "arrive", eventId: "d1-activity" }, now)).toThrow("开始");
    expect(() => executionWriteSchema.parse({ expectedRevision: 0, expectedPlanVersion: 1, change: { action: "start", eventId: "d1-activity", completedAt: now } })).toThrow();
    expect(() => executionWriteSchema.parse({ expectedRevision: 0, expectedPlanVersion: 1, change: { action: "locate", latitude: 95, longitude: 10, accuracy: 1 } })).toThrow();
  });
  it("advances after long sleep, identifies wall-clock jumps and device/server skew", () => {
    const anchor = calibrateTravelClock(now, Date.parse(now), Date.parse(now), 100);
    expect(readTravelClock(anchor, Date.parse(now) + 3_600_000, 3_600_100)).toMatchObject({ now: Date.parse(now) + 3_600_000, reliable: true });
    expect(readTravelClock(anchor, Date.parse(now) + 3_600_000, 110)).toMatchObject({ now: Date.parse(now) + 3_600_000, reliable: false, jumped: true });
    expect(readTravelClock(anchor, Date.parse(now) - 3_600_000, 110).now).toBeGreaterThanOrEqual(Date.parse(now));
    const skewed = calibrateTravelClock(now, Date.parse(now) + 300_000, Date.parse(now) + 300_000, 100);
    expect(readTravelClock(skewed, skewed.wall, 100).reliable).toBe(false);
  });
  it("never keeps an expired deadline green, even with stale timed routes or uncertain clocks", () => {
    const input: RedlineInput = { id: "ticket", eventId: "departure", direction: "departure", origin: "家门口", destination: "车站", departureAt: "2026-10-20T10:35:00+08:00", earliestDepartureAt: null, blockers: [], assumptions: [], steps: [], buffers: [],
      deadlines: [{ id: "gate", label: "检票", at: "2026-10-20T10:30:00+08:00", afterStep: "route", nature: "assumed", source: "测试" }],
      route: { kind: "timed", durationSeconds: 60, status: "estimated", source: "测试", applicableAt: now, validFrom: now, validUntil: "2026-10-20T10:00:00+08:00", futureCapability: false, includedTimes: [], details: [] } };
    const initial = forwardCheck(input, now, input.route);
    const result: RedlineResult = { input, currentCheck: initial, suggestedCheck: initial, suggestedAt: "2026-10-20T09:30:00+08:00", calculatedAt: now, precision: "estimated", algorithm: "test", calculationVersion: "test", necessarySeconds: 60, bufferSeconds: 0, reason: "测试", attempts: [], conflicts: [] };
    expect(liveRedlineCheck(result, Date.parse(now) + 1000).status).toBe("unknown");
    const expired = Date.parse("2026-10-20T10:30:00+08:00");
    expect(redlineUrgency(result.suggestedAt, expired).color).toBe("red");
    expect(liveRedlineCheck(result, expired, false).status).toBe("infeasible");
  });
});
