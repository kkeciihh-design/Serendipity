import { describe, expect, it } from "vitest";
import { deriveTripTitle, tripDisplayTitle } from "../lib/trip-title";
import { emptyRequestSnapshot } from "../lib/trip-request";

describe("deriveTripTitle", () => {
  it("uses the first non-empty line", () => {
    expect(
      deriveTripTitle("\n  \n杭州两日轻松漫步\n第二天返程"),
    ).toBe("杭州两日轻松漫步");
  });

  it("truncates by Unicode code points", () => {
    const title = deriveTripTitle("😀".repeat(31));
    expect(Array.from(title)).toHaveLength(31);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("tripDisplayTitle", () => {
  const snapshot = {
    ...emptyRequestSnapshot(),
    destination: "杭州",
    startDate: "2026-11-14",
    endDate: "2026-11-15",
    pace: "relaxed" as const,
  };

  it("turns an original request sentence into a destination, duration and theme", () => {
    const originalRequest = "我想在 11 月中旬去杭州玩两天，从上海出发。";
    expect(tripDisplayTitle({ title: originalRequest, originalRequest, snapshot })).toBe("杭州 · 两日轻松漫游");
  });

  it("recognizes automatically truncated original titles", () => {
    const originalRequest = "我想在 11 月中旬去杭州玩两天，从上海出发，希望能看看西湖和河坊街。";
    expect(tripDisplayTitle({ title: deriveTripTitle(originalRequest), originalRequest, snapshot })).toBe("杭州 · 两日轻松漫游");
  });

  it("keeps a deliberately edited title", () => {
    const title = "和妈妈一起，再见西湖";
    expect(tripDisplayTitle({ title, originalRequest: "我想去杭州玩两天。", snapshot })).toBe(title);
  });

  it("keeps a short original heading without repeating it as prose", () => {
    const title = "杭州两日轻松漫步";
    expect(tripDisplayTitle({ title, originalRequest: `${title}\n第二天返程`, snapshot })).toBe(title);
  });

  it("uses explicit duration when extraction has not resolved calendar dates", () => {
    const originalRequest = "我想去杭州玩两天，重点看看博物馆。";
    expect(tripDisplayTitle({
      title: deriveTripTitle(originalRequest), originalRequest,
      snapshot: { ...emptyRequestSnapshot(), destination: "杭州", interests: ["历史文化", "博物馆"] },
    })).toBe("杭州 · 两日人文漫游");
  });

  it("prefers the currently confirmed dates over the original request", () => {
    const originalRequest = "我想去杭州玩两天。";
    expect(tripDisplayTitle({ title: originalRequest, originalRequest, snapshot: { ...snapshot, endDate: "2026-11-16" } })).toBe("杭州 · 三日轻松漫游");
  });

  it("does not invent a destination or mistake a calendar date for a duration", () => {
    const originalRequest = "我想十一日出发，目的地还没想好。";
    expect(tripDisplayTitle({ title: originalRequest, originalRequest, snapshot: null })).toBe("下一站 · 自在漫游");
  });
});
