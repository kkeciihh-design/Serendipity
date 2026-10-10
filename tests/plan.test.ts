import { describe, expect, it } from "vitest";
import {
  emptyRequestSnapshot,
  normalizeRequestSnapshot,
  type RequestSnapshot,
} from "../lib/trip-request";
import {
  parseAIPlanOutput,
  validatePlan,
  type AIPlanOutput,
  type PlanEvent,
} from "../lib/plan";

function futureDates(days: number) {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 30,
  );
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  const format = (date: Date) =>
    `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  return { start: format(start), end: format(end), dates: [...Array(days)].map((_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return format(date);
  }) };
}

function snapshotFor(days: number): RequestSnapshot {
  const dates = futureDates(days);
  return normalizeRequestSnapshot({
    ...emptyRequestSnapshot(),
    destination: "长沙",
    startDate: dates.start,
    endDate: dates.end,
    travelerCount: 2,
    budgetAmountCents: 150000,
    budgetScope: "total",
    pace: "balanced",
    fieldSources: {
      ...emptyRequestSnapshot().fieldSources,
      destination: "ai_extracted",
      startDate: "program_derived",
      endDate: "program_derived",
      travelerCount: "ai_extracted",
      budgetAmountCents: "ai_extracted",
      budgetScope: "user_confirmed",
      pace: "user_confirmed",
    },
  });
}

function event(input: Partial<PlanEvent> & Pick<PlanEvent, "id" | "dayNumber" | "date" | "startTime" | "endTime" | "type" | "title">): PlanEvent {
  return {
    locationName: "长沙市中心",
    suggestedDurationSeconds: 3600,
    costDraftCents: null,
    costStatus: "estimated",
    note: null,
    ...input,
  };
}

function completePlan(days: number): AIPlanOutput {
  const dates = futureDates(days).dates;
  const events: PlanEvent[] = [];

  dates.forEach((date, index) => {
    const dayNumber = index + 1;
    events.push(
      event({
        id: `day-${dayNumber}-preparation`,
        dayNumber,
        date,
        startTime: "07:30",
        endTime: "07:50",
        type: "preparation",
        title: "当日准备",
      }),
    );
    events.push(
      event({
        id: `day-${dayNumber}-breakfast`,
        dayNumber,
        date,
        startTime: "08:00",
        endTime: "08:45",
        type: "meal",
        title: "早餐",
      }),
    );
    events.push(
      event({
        id: `day-${dayNumber}-activity`,
        dayNumber,
        date,
        startTime: "10:00",
        endTime: "12:00",
        type: "activity",
        title: "城市公园散步",
      }),
    );
    events.push(
      event({
        id: `day-${dayNumber}-lunch`,
        dayNumber,
        date,
        startTime: "12:30",
        endTime: "13:30",
        type: "meal",
        title: "午餐",
      }),
    );
    events.push(
      event({
        id: `day-${dayNumber}-rest`,
        dayNumber,
        date,
        startTime: "14:00",
        endTime: "14:30",
        type: "rest",
        title: "回酒店休息",
      }),
    );
    if (dayNumber < days) {
      events.push(
        event({
          id: `day-${dayNumber}-hotel`,
          dayNumber,
          date,
          startTime: "20:00",
          endTime: "22:00",
          type: "accommodation",
          title: "住宿区域",
        }),
      );
    }
  });

  events.push(
    event({
      id: "departure",
      dayNumber: 1,
      date: dates[0],
      startTime: "06:30",
      endTime: "07:30",
      type: "departure_transport",
      title: "前往长沙",
      locationName: "出发站",
    }),
  );
  events.push(
    event({
      id: "return",
      dayNumber: days,
      date: dates[dates.length - 1],
      startTime: "17:00",
      endTime: "18:30",
      type: "return_transport",
      title: "返程",
      locationName: "返程站",
    }),
  );

  return {
    events,
    pendingItems: [
      {
        id: "ticket",
        category: "transport_ticket",
        title: "确认去返程车票",
        reason: "本阶段没有实时余票依据。",
        requiredBefore: dates[0],
      },
    ],
  };
}

describe("basic plan validation", () => {
  it("accepts complete two-day and four-day drafts", () => {
    for (const days of [2, 4]) {
      const result = validatePlan(completePlan(days), snapshotFor(days));
      expect(result.errors).toEqual([]);
      expect(result.status).toBe("valid");
    }
  });

  it("marks low budgets and over-budget drafts for review", () => {
    const snapshot = {
      ...snapshotFor(2),
      budgetAmountCents: 100,
      budgetScope: "total" as const,
    };
    const result = validatePlan(completePlan(2), snapshot);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("预算非常低"))).toBe(
      true,
    );
  });

  it("rejects a missing return transport", () => {
    const plan = completePlan(2);
    plan.events = plan.events.filter((item) => item.type !== "return_transport");
    const result = validatePlan(plan, snapshotFor(2));
    expect(result.errors).toContain("第 2 天必须且只能有一个返程交通安排。");
  });

  it("rejects overlapping events", () => {
    const plan = completePlan(2);
    const duplicate = {
      ...plan.events.find((item) => item.type === "activity")!,
      id: "overlap",
      startTime: "10:30",
      endTime: "11:30",
    };
    plan.events.push(duplicate);
    const result = validatePlan(plan, snapshotFor(2));
    expect(result.errors.some((error) => error.includes("时段重叠"))).toBe(true);
  });

  it("accepts a cross-midnight event within the trip dates", () => {
    const plan = completePlan(2);
    const dates = futureDates(2).dates;
    const activity = plan.events.find(
      (item) => item.id === "day-1-activity",
    )!;
    activity.startTime = "23:00";
    activity.endTime = "01:00";
    activity.endDate = dates[1];
    activity.suggestedDurationSeconds = 7200;

    const result = validatePlan(plan, snapshotFor(2));
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("valid");
  });

  it("rejects a cross-midnight event that overlaps the next day", () => {
    const plan = completePlan(2);
    const dates = futureDates(2).dates;
    const activity = plan.events.find(
      (item) => item.id === "day-1-activity",
    )!;
    activity.startTime = "23:00";
    activity.endTime = "01:00";
    activity.endDate = dates[1];
    activity.suggestedDurationSeconds = 7200;

    const nextDayPreparation = plan.events.find(
      (item) => item.id === "day-2-preparation",
    )!;
    nextDayPreparation.startTime = "00:30";
    nextDayPreparation.endTime = "00:50";

    const result = validatePlan(plan, snapshotFor(2));
    expect(result.errors.some((error) => error.includes("时段重叠"))).toBe(true);
  });

  it("rejects cross-midnight events that end after the trip", () => {
    const plan = completePlan(2);
    const dates = futureDates(2).dates;
    const returnEvent = plan.events.find((item) => item.id === "return")!;
    returnEvent.startTime = "23:00";
    returnEvent.endTime = "01:00";
    returnEvent.endDate = "2099-01-01";
    returnEvent.suggestedDurationSeconds = 7200;

    const result = validatePlan(plan, snapshotFor(2));
    expect(result.errors).toContain("返程 的结束日期只能当天或次日。");
    expect(result.errors).toContain("返程 的结束日期超出行程日期范围。");
    expect(dates.length).toBe(2);
  });

  it("rejects zero and negative-duration events", () => {
    const plan = completePlan(2);
    const activity = plan.events.find(
      (item) => item.id === "day-1-activity",
    )!;
    activity.endTime = activity.startTime;
    const result = validatePlan(plan, snapshotFor(2));
    expect(result.errors.some((error) => error.includes("结束时刻必须晚于开始时刻"))).toBe(true);
  });

  it("rejects negative durations through schema validation", () => {
    const plan = completePlan(2);
    plan.events[0].suggestedDurationSeconds = -1;
    expect(() =>
      parseAIPlanOutput(JSON.stringify(plan)),
    ).toThrow(/建议时长必须大于 0 秒/);
  });

  it("rejects malformed model output", () => {
    expect(() => parseAIPlanOutput("not-json")).toThrow(
      /模型没有返回 JSON 对象/,
    );
    expect(() => parseAIPlanOutput("{ broken }")).toThrow(
      /JSON 无法解析/,
    );
  });
});
