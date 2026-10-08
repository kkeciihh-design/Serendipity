import { describe, expect, it } from "vitest";
import { deriveTripTitle } from "../lib/trip-title";

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
