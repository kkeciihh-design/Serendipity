import { describe, expect, it } from "vitest";
import {
  emptyRequestSnapshot,
  normalizeRequestSnapshot,
  parseAIRequirementOutput,
  isValidRequestDate,
  requestDateQuestions,
  requestSnapshotSchema,
  requestToday,
  remainingQuestions,
  requestSnapshotChanged,
  resolveRelativeDates,
  validateRequestSnapshot,
} from "../lib/trip-request";

const fixedNow = new Date(2026, 9, 29);

describe("trip request parsing", () => {
  it("resolves a weekend across a month boundary with a fixed clock", () => {
    const snapshot = resolveRelativeDates(
      "周末去长沙",
      emptyRequestSnapshot(),
      fixedNow,
    );

    expect(snapshot.startDate).toBe("2026-10-31");
    expect(snapshot.endDate).toBe("2026-11-01");
    expect(snapshot.fieldSources.startDate).toBe("program_derived");
  });

  it("shows a default traveler count and total-budget scope", () => {
    const snapshot = normalizeRequestSnapshot({
      ...emptyRequestSnapshot(),
      destination: "长沙",
      budgetAmountCents: 150000,
    });

    expect(snapshot.travelerCount).toBe(1);
    expect(snapshot.budgetScope).toBe("total");
    expect(snapshot.fieldSources.travelerCount).toBe("default_assumption");
    expect(snapshot.fieldSources.budgetScope).toBe("default_assumption");
  });

  it("rejects past dates and trips longer than four days", () => {
    const past = normalizeRequestSnapshot({
      ...emptyRequestSnapshot(),
      destination: "长沙",
      startDate: "2026-10-01",
      endDate: "2026-10-02",
    });
    const tooLong = normalizeRequestSnapshot({
      ...emptyRequestSnapshot(),
      destination: "长沙",
      startDate: "2026-11-01",
      endDate: "2026-11-05",
    });

    expect(validateRequestSnapshot(past, fixedNow, "draft")).toContain(
      "出发日期已经过去，请修改为未来日期。",
    );
    expect(validateRequestSnapshot(tooLong, fixedNow, "draft")).toContain(
      "当前行程为 5 天；本阶段仅支持 2 到 4 天，请缩短或修改日期。",
    );
  });

  it("requires destination and dates only for confirmation", () => {
    const missingDestination = normalizeRequestSnapshot({
      ...emptyRequestSnapshot(),
      startDate: "2026-11-01",
      endDate: "2026-11-02",
    });
    const complete = normalizeRequestSnapshot({
      ...emptyRequestSnapshot(),
      destination: "长沙",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
    });

    expect(validateRequestSnapshot(missingDestination, fixedNow, "confirmation"))
      .toContain("请先确认目的地。");
    expect(validateRequestSnapshot(complete, fixedNow, "confirmation")).toEqual([]);
  });

  it("parses a controlled JSON response and removes answered questions", () => {
    const output = parseAIRequirementOutput(
      JSON.stringify({
        request: {
          destination: "长沙",
          startDate: null,
          endDate: null,
          travelerCount: 2,
          budgetAmountCents: 150000,
          budgetScope: "total",
          pace: "relaxed",
          interests: ["自然风景"],
          accommodation: null,
          constraints: ["第二天下午返程"],
          fieldSources: {
            destination: "ai_extracted",
            startDate: "unspecified",
            endDate: "unspecified",
            travelerCount: "ai_extracted",
            budgetAmountCents: "ai_extracted",
            budgetScope: "ai_extracted",
            pace: "ai_extracted",
            interests: "ai_extracted",
            accommodation: "unspecified",
            constraints: "ai_extracted",
          },
        },
        openQuestions: [
          {
            id: "travel-date",
            field: "startDate",
            question: "哪两天出发？",
            reason: "原话没有具体日期。",
            suggestedAnswer: null,
          },
          {
            id: "travelers",
            field: "travelerCount",
            question: "几个人出行？",
            reason: "原话没有人数。",
            suggestedAnswer: null,
          },
        ],
        defaultAssumptions: [],
      }),
    );

    const normalized = normalizeRequestSnapshot(output.request);
    expect(remainingQuestions(output.openQuestions, normalized)).toHaveLength(1);
    expect(requestSnapshotChanged(normalized, { ...normalized })).toBe(false);
  });

  it("rejects malformed model output", () => {
    expect(() => parseAIRequirementOutput("这不是 JSON")).toThrow(
      "模型没有返回 JSON 对象。",
    );
  });
});

describe("audit calendar and relative-date regressions", () => {
  it.each(["2027-02-29", "2028-02-30", "2027-04-31", "2027-13-01", "2027-00-10", "2027-01-00", "0000-01-01"])("rejects impossible new date %s while preserving legacy reads", (value) => {
    const snapshot = { ...emptyRequestSnapshot(), destination: "长沙", startDate: value, endDate: "2027-05-01" };
    expect(isValidRequestDate(value)).toBe(false);
    expect(validateRequestSnapshot(snapshot, fixedNow, "draft")).toContain("出发日期不是有效的日历日期。");
    expect(validateRequestSnapshot({ ...snapshot, startDate: null, endDate: value }, fixedNow, "draft")).toContain("返回日期不是有效的日历日期。");
    expect(() => parseAIRequirementOutput(JSON.stringify({ request: snapshot }))).toThrow("日期不是有效的日历日期");
    expect(requestSnapshotSchema.parse(snapshot).startDate).toBe(value);
  });

  it("accepts a real leap date and keeps historical valid dates readable", () => {
    expect(isValidRequestDate("2028-02-29")).toBe(true);
    expect(validateRequestSnapshot({ ...emptyRequestSnapshot(), destination: "长沙", startDate: "2028-02-28", endDate: "2028-03-01" }, fixedNow, "confirmation")).toEqual([]);
    expect(requestSnapshotSchema.parse({ ...emptyRequestSnapshot(), startDate: "2020-02-29" }).startDate).toBe("2020-02-29");
  });

  it.each(["2027年2月29日到2027年3月1日去长沙", "2027-04-31 到 2027-05-02 去长沙", "13月1日出发玩两天"])("does not silently roll invalid natural dates into another day: %s", (text) => {
    expect(() => resolveRelativeDates(text, emptyRequestSnapshot(), fixedNow)).toThrow("不是有效的日历日期");
  });

  it.each([
    ["明天去长沙四天", "2026-10-30", "2026-11-02"],
    ["明天去长沙四天，第二天参观博物馆", "2026-10-30", "2026-11-02"],
    ["后天出发，玩3天", "2026-10-31", "2026-11-02"],
    ["2026年11月2日出发，四天三晚", "2026-11-02", "2026-11-05"],
    ["2026年12月31日到1月2日去长沙", "2026-12-31", "2027-01-02"],
  ])("uses the stated duration and calendar boundaries: %s", (text, start, end) => {
    const result = resolveRelativeDates(text, emptyRequestSnapshot(), fixedNow);
    expect([result.startDate, result.endDate]).toEqual([start, end]);
  });

  it("keeps an unstated return date unknown and asks instead of assuming two days", () => {
    const snapshot = resolveRelativeDates("明天去长沙", { ...emptyRequestSnapshot(), destination: "长沙", startDate: "2026-10-30", endDate: "2026-10-31" }, fixedNow);
    expect(snapshot).toMatchObject({ startDate: "2026-10-30", endDate: null, fieldSources: { endDate: "unspecified" } });
    expect(requestDateQuestions(snapshot).map((question) => question.field)).toEqual(["endDate"]);
    expect(validateRequestSnapshot(snapshot, fixedNow, "draft")).toEqual([]);
    expect(validateRequestSnapshot(snapshot, fixedNow, "confirmation")).toContain("请先确认具体出发和返回日期。");
  });

  it("counts a single complete Chinese date once and leaves duration unknown", () => {
    const snapshot = resolveRelativeDates("2026年11月2日去长沙", emptyRequestSnapshot(), fixedNow);
    expect([snapshot.startDate, snapshot.endDate]).toEqual(["2026-11-02", null]);
  });

  it.each(["明天去长沙，第 2 天参观博物馆", "明天去长沙玩三到四天"])("does not confuse an ordinal or duration range with a definite trip length: %s", (text) => {
    expect(resolveRelativeDates(text, emptyRequestSnapshot(), fixedNow).endDate).toBeNull();
  });

  it("resolves tomorrow from the China date even before UTC midnight", () => {
    const clock = new Date("2026-12-31T16:30:00Z");
    expect(requestToday(clock)).toBe("2027-01-01");
    const snapshot = resolveRelativeDates("明天出发玩两天", emptyRequestSnapshot(), clock);
    expect([snapshot.startDate, snapshot.endDate]).toEqual(["2027-01-02", "2027-01-03"]);
  });
});
