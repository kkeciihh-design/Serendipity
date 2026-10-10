import { describe, expect, it } from "vitest";
import {
  buildPlanOverviewDays,
  formatBudgetTarget,
  planRequiresUpdate,
  planStatusLabel,
} from "../lib/plan-overview";
import {
  emptyRequestSnapshot,
  normalizeRequestSnapshot,
  type RequestSnapshot,
} from "../lib/trip-request";
import type { PlanEvent } from "../lib/plan";

function snapshot(input: Partial<RequestSnapshot> = {}) {
  return normalizeRequestSnapshot({
    ...emptyRequestSnapshot(),
    destination: "长沙",
    startDate: "2026-11-01",
    endDate: "2026-11-04",
    travelerCount: 3,
    budgetAmountCents: 450000,
    budgetScope: "per_person",
    pace: "packed",
    ...input,
  });
}

function event(
  input: Pick<PlanEvent, "id" | "dayNumber" | "date" | "startTime" | "endTime" | "type" | "title">,
): PlanEvent {
  return {
    ...input,
    locationName: null,
    suggestedDurationSeconds: 1800,
    costDraftCents: null,
    costStatus: "pending_confirmation",
    note: null,
  };
}

describe("plan overview formatting", () => {
  it("builds four ordered days and wraps long destination names without losing data", () => {
    const longDestination =
      "内蒙古自治区呼伦贝尔市额尔古纳国家湿地公园周边小镇";
    const days = buildPlanOverviewDays(
      [
        event({
          id: "departure",
          dayNumber: 1,
          date: "2026-11-01",
          startTime: "08:00",
          endTime: "10:00",
          type: "departure_transport",
          title: "去程",
        }),
        event({
          id: "day2",
          dayNumber: 2,
          date: "2026-11-02",
          startTime: "09:00",
          endTime: "11:00",
          type: "activity",
          title: "草原湿地漫步",
        }),
        event({
          id: "day3",
          dayNumber: 3,
          date: "2026-11-03",
          startTime: "09:30",
          endTime: "11:30",
          type: "activity",
          title: "小镇骑马体验",
        }),
        event({
          id: "return",
          dayNumber: 4,
          date: "2026-11-04",
          startTime: "16:00",
          endTime: "18:00",
          type: "return_transport",
          title: "返程",
        }),
      ],
      snapshot({ destination: longDestination }),
    );

    expect(days.map((day) => day.dayNumber)).toEqual([1, 2, 3, 4]);
    expect(days[0].theme).toBe(`抵达${longDestination}`);
    expect(days[1].theme).toBe("草原湿地漫步");
    expect(days[3].theme).toBe(`返程离开${longDestination}`);
  });

  it("labels budget as a target instead of a calculated total", () => {
    expect(formatBudgetTarget(snapshot())).toBe(
      "预算目标 4500 元（人均预算）",
    );
    expect(formatBudgetTarget(snapshot({ budgetAmountCents: null }))).toBe(
      "预算目标未确认",
    );
  });

  it("detects stale plans from both persisted flags and latest request revisions", () => {
    expect(
      planRequiresUpdate({
        requestRevision: 2,
        requirementUpToDate: true,
        latestRequestRevision: 2,
      }),
    ).toBe(false);
    expect(
      planRequiresUpdate({
        requestRevision: 2,
        requirementUpToDate: false,
        latestRequestRevision: 2,
      }),
    ).toBe(true);
    expect(
      planRequiresUpdate({
        requestRevision: 2,
        requirementUpToDate: true,
        latestRequestRevision: 3,
      }),
    ).toBe(true);
  });

  it("labels historical versions separately from the current stale plan", () => {
    const base = {
      requestRevision: 2,
      requirementUpToDate: false,
      latestRequestRevision: 3,
    };
    expect(planStatusLabel({ ...base, isCurrent: true }, 3)).toBe(
      "当前计划待更新",
    );
    expect(planStatusLabel({ ...base, isCurrent: false }, 3)).toBe(
      "历史版本待更新",
    );
    expect(
      planStatusLabel(
        {
          requestRevision: 2,
          requirementUpToDate: true,
          isCurrent: false,
        },
        2,
      ),
    ).toBe("历史版本");
    expect(planStatusLabel(null, 3)).toBe("尚无计划");
  });
});
