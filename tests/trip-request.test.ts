import { describe, expect, it } from "vitest";
import {
  emptyRequestSnapshot,
  normalizeRequestSnapshot,
  parseAIRequirementOutput,
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
