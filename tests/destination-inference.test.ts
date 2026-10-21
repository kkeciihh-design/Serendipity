import { describe, expect, it } from "vitest";
import { inferDestination, isPlaceholderDestination, resolveDestination } from "@/lib/destination-inference";

describe("inferDestination", () => {
  it("reads the real Quanzhou request that showed 目的地待补充", () => {
    const quote = "想和伴侣下个月找个周末从深圳出发去福建泉州玩三天 2 晚，总预算控制在 3500 元以内，想去西街和开元寺、去海边的洛伽寺…";
    const result = inferDestination(quote);
    expect(result?.label).toBe("福建泉州");
    expect(result?.source).toBe("province-city");
  });

  it("uses just the city when no province is written", () => {
    expect(inferDestination("想去泉州看开元寺")?.label).toBe("泉州");
  });

  it("recognises a landmark as its city", () => {
    expect(inferDestination("想去西湖走走")?.label).toBe("杭州");
    expect(inferDestination("想去看兵马俑")?.label).toBe("西安");
  });

  it("keeps the province when no city is recognised", () => {
    expect(inferDestination("去福建随便走走")?.label).toBe("福建");
  });

  it("returns null when there is no usable signal, never inventing a place", () => {
    expect(inferDestination("想找个安静的地方发呆几天")).toBeNull();
    expect(inferDestination("")).toBeNull();
    expect(inferDestination(null)).toBeNull();
  });

  it("is case-safe for long quotes with the city late in the text", () => {
    const long = `${"愿。".repeat(200)}最后想去桂林和阳朔。`;
    expect(inferDestination(long)?.label).toBe("桂林");
  });
});

describe("isPlaceholderDestination", () => {
  it("treats the known placeholders as missing", () => {
    for (const value of ["目的地待补充", "待补充", "未知", "未定", "—", "", null, undefined]) {
      expect(isPlaceholderDestination(value)).toBe(true);
    }
  });

  it("accepts real destinations", () => {
    expect(isPlaceholderDestination("福建泉州")).toBe(false);
    expect(isPlaceholderDestination("桂林")).toBe(false);
  });
});

describe("resolveDestination", () => {
  it("repairs a placeholder using the original words", () => {
    expect(resolveDestination("目的地待补充", "去福建泉州玩三天")).toBe("福建泉州");
  });

  it("prefers a real stored destination", () => {
    expect(resolveDestination("杭州", "去福建泉州玩三天")).toBe("杭州");
  });

  it("falls back when nothing can be inferred", () => {
    expect(resolveDestination(null, "随便走走")).toBe("目的地待补充");
    expect(resolveDestination(null, "随便走走", "待定")).toBe("待定");
  });
});
