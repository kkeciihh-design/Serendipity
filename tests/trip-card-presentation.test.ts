import { describe, expect, it } from "vitest";
import { parsePlanEvents, stopLabel, stopPreview } from "@/lib/stop-preview";
import { cardTexture } from "@/lib/card-texture";

describe("stopLabel", () => {
  it("prefers the location name when present", () => {
    expect(stopLabel({ title: "午餐 · 西街面线糊与闽南小吃", locationName: "西街" })).toBe("西街");
  });

  it("trims the descriptive tail from a title", () => {
    expect(stopLabel({ title: "开元寺游览 · 东西塔与古榕树" })).toBe("开元寺");
  });

  it("strips a leading verb", () => {
    expect(stopLabel({ title: "前往洛伽寺", locationName: "" })).toBe("洛伽寺");
  });

  it("drops meal and transit noise", () => {
    expect(stopLabel({ title: "晚餐" })).toBeNull();
    expect(stopLabel({ title: "出发" })).toBeNull();
    expect(stopLabel({ title: "" })).toBeNull();
  });

  it("keeps a complete place name instead of clipping it", () => {
    const label = stopLabel({ title: "泉州海外交通史博物馆特别展览" });
    expect(label).toBe("泉州海外交通史博物馆特别展览");
  });

  it("extracts the first complete place phrase at natural boundaries", () => {
    expect(stopLabel({ title: "湖滨银泰in77与柳浪闻莺" })).toBe("湖滨银泰in77");
    expect(stopLabel({ title: "柳浪闻莺—白堤漫步" })).toBe("柳浪闻莺");
    expect(stopLabel({ title: "孤山公园—白堤" })).toBe("孤山公园");
    expect(stopLabel({ title: "桂林站或两江四湖", type: "activity" })).toBe("两江四湖");
    expect(stopLabel({ title: "象鼻山" })).toBe("象鼻山");
  });
});

describe("stopPreview", () => {
  const events = [
    { dayNumber: 1, startTime: "08:30", title: "深圳北站乘高铁至泉州站", locationName: "深圳北站", type: "departure_transport" },
    { dayNumber: 1, startTime: "13:10", title: "午餐 · 西街面线糊与闽南小吃", locationName: "西街", type: "meal" },
    { dayNumber: 1, startTime: "14:10", title: "开元寺游览 · 东西塔与古榕树", locationName: "泉州开元寺", type: "activity" },
    { dayNumber: 1, startTime: "16:40", title: "西街慢逛 · 钟楼与肃清门广场", locationName: "西街", type: "activity" },
    { dayNumber: 2, startTime: "09:00", title: "洛伽寺", locationName: "洛伽寺", type: "activity" },
  ];

  it("returns three distinct stops in itinerary order", () => {
    const stops = stopPreview(events);
    expect(stops).toHaveLength(3);
    // The duplicate 西街 appears once, and later stops fill the remaining slots.
    expect(new Set(stops).size).toBe(3);
  });

  it("skips hotel check-in noise", () => {
    const stops = stopPreview([{ title: "入住酒店", locationName: "西街钟楼住宿片区", type: "hotel_checkin" }, ...events]);
    expect(stops).not.toContain("入住酒店");
  });

  it("returns an empty list for missing plans rather than inventing stops", () => {
    expect(stopPreview(null)).toEqual([]);
    expect(stopPreview([])).toEqual([]);
  });

  it("honours a custom limit", () => {
    expect(stopPreview(events, 1)).toHaveLength(1);
  });
});

describe("parsePlanEvents", () => {
  it("parses a JSON array", () => {
    expect(parsePlanEvents('[{"title":"西街"}]')).toEqual([{ title: "西街" }]);
  });

  it("survives malformed or missing data", () => {
    expect(parsePlanEvents(null)).toEqual([]);
    expect(parsePlanEvents("not json")).toEqual([]);
    expect(parsePlanEvents('{"a":1}')).toEqual([]);
  });
});

describe("cardTexture", () => {
  it("gives a coastal destination the coast texture", () => {
    expect(cardTexture("霞浦", 0).id).toBe("coast");
  });

  it("gives an ancient city the warm-brown texture", () => {
    expect(cardTexture("福建泉州", 0).id).toBe("ancient");
  });

  it("always returns the same texture for the same trip", () => {
    expect(cardTexture("福建泉州", 3)).toEqual(cardTexture("福建泉州", 3));
  });

  it("varies neighbouring cards when the destination says nothing", () => {
    const ids = [0, 1, 2, 3].map((index) => cardTexture("目的地待补充", index).id);
    expect(new Set(ids).size).toBeGreaterThan(1);
  });

  it("exposes a background and ink colour for every texture", () => {
    for (const index of [0, 1, 2, 3]) {
      const texture = cardTexture(null, index);
      expect(texture.from).toMatch(/^#[0-9a-f]{6}$/);
      expect(texture.to).toMatch(/^#[0-9a-f]{6}$/);
      expect(texture.ink).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
