import { describe, expect, it, vi } from "vitest";
import { applyPlanEventEdit, type PlanEventEditInput } from "../lib/plan-edit";
import { planEventStart, planEventEnd, nextPlanDate } from "../lib/plan";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

function edit(changes: Partial<PlanEventEditInput>) {
  const plan = planFixture(requestFixture());
  const target = plan.events.find((event) => event.id === "d1-activity")!;
  target.suggestedDurationSeconds = 3600;
  const output = applyPlanEventEdit(plan, {
    eventId: target.id, note: null, status: "suggested", locked: false, remove: false, ...changes,
  });
  return { event: output.events.find((event) => event.id === target.id)!, original: target };
}

describe("explicit time edit rules", () => {
  it("preserves detailed generated directions when editing or confirming an event", () => {
    const note = "沟口检票后乘观光车至五花海站，再沿木栈道步行至珍珠滩瀑布。".repeat(12);
    const { event, original } = edit({ note, status: "confirmed", timeEdit: "preserve" });
    expect(note.length).toBeGreaterThan(240);
    expect(event.note).toBe(note);
    expect(event.startTime).toBe(original.startTime);
    expect(event.endTime).toBe(original.endTime);
  });

  it("changes duration only when explicitly requested, including the stale legacy duration value", () => {
    expect(edit({ timeEdit: "start_duration", durationMinutes: 60 }).event).toMatchObject({ startTime: "10:00", endTime: "11:00", suggestedDurationSeconds: 3600 });
    expect(edit({ timeEdit: "start_duration", durationMinutes: 90 }).event).toMatchObject({ endTime: "11:30", suggestedDurationSeconds: 5400 });
  });
  it("moves the start using the actual occupied duration and derives duration from explicit endpoints", () => {
    expect(edit({ timeEdit: "start_duration", startTime: "09:00" }).event).toMatchObject({ startTime: "09:00", endTime: "11:00", suggestedDurationSeconds: 7200 });
    expect(edit({ timeEdit: "start_end", startTime: "09:30", endTime: "12:00" }).event).toMatchObject({ startTime: "09:30", endTime: "12:00", suggestedDurationSeconds: 9000 });
  });
  it("handles midnight and month boundaries independently of the OS timezone", () => {
    vi.stubEnv("TZ", "America/New_York");
    try {
      const { event } = edit({ timeEdit: "start_end", startTime: "23:00", endTime: "01:00" });
      expect(planEventEnd(event).getTime() - planEventStart(event).getTime()).toBe(7200_000);
      expect(event.endDate).toBe(nextPlanDate(event.date));
      expect(planEventStart({ ...event, date: "2026-10-31" }).toISOString()).toBe("2026-10-31T15:00:00.000Z");
      expect(nextPlanDate("2026-10-31")).toBe("2026-11-01");
      expect(nextPlanDate("2028-02-28")).toBe("2028-02-29");
    } finally { vi.unstubAllEnvs(); }
  });
  it("rejects zero, overlong and invalid end dates", () => {
    expect(() => edit({ timeEdit: "start_end", endTime: "10:00" })).toThrow(/结束时刻/);
    expect(() => edit({ timeEdit: "start_end", endDate: "2099-02-30", endTime: "12:00" })).toThrow();
    expect(() => edit({ timeEdit: "start_duration", durationMinutes: 1441 })).toThrow(/时长/);
  });
});
