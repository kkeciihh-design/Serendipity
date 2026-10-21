import { describe, expect, it } from "vitest";
import { exportPrivacy } from "../lib/export-privacy";
import { mobileExportOptionsSchema } from "../lib/export-snapshot";
import { renderMobileHtml } from "../lib/mobile-export";
import { renderTextExport } from "../lib/text-export";
import { renderLongImageHtml } from "../lib/long-image-html";
import { renderPdfHtml } from "../lib/pdf-html";
import { sanitizeTravelerText } from "../lib/content-sanitizer";
import { unknownWeatherRecord } from "../lib/weather";
import { exportFixture } from "./helpers/export-fixtures";

const options = mobileExportOptionsSchema.parse({});

describe("Quanzhou offline export regression", () => {
  it("removes map calibration tails without eating the preceding sentence period", () => {
    expect(sanitizeTravelerText("1.2 已按站区指引安排接驳。；泉州站标点按公共铁路站区基准校准，仍为待核实建议标点。"))
      .toBe("1.2 已按站区指引安排接驳。");
    expect(sanitizeTravelerText("2.2 已按站区指引安排接驳；泉州站标点按公共铁路站区基准校准，仍为待核实建议标点"))
      .toBe("2.2 已按站区指引安排接驳。");
  });

  it.each(["深圳北站", "泉州站", "虹桥火车站", "首都机场", "厦门第一码头"])("preserves the public hub %s across five formats next to home directions", async (hub) => {
    const snapshot = await exportFixture();
    const departure = snapshot.plan.events.find((event) => event.id === "d1-preparation")!;
    departure.locationName = hub;
    departure.title = `从家里出发前往${hub}`;
    departure.note = `提前到${hub}安检，16:00 高铁返程后从${hub}回深圳家里；从我家星河小区1栋1201室出发前往${hub}，车程约30分钟。`;
    snapshot.plan.tickets[0].chainOriginName = hub;
    expect(exportPrivacy(snapshot, options).privateIds.has(departure.id)).toBe(false);
    for (const document of [renderMobileHtml(snapshot, options), renderTextExport(snapshot, options, "plain-text"), renderTextExport(snapshot, options, "markdown"), await renderLongImageHtml(snapshot, options, { includeMap: true, includePhotos: false }), await renderPdfHtml(snapshot, options, { mode: "complete", includePhotos: false })]) {
      expect(document).toContain(hub);
      expect(document).toContain(`提前到${hub}安检`);
      expect(document).toContain(`16:00 高铁返程后从${hub}`);
      expect(document).toContain("车程约30分钟");
      expect(document).not.toContain("星河小区1栋1201室");
      expect(document).not.toContain("家里");
    }
  });

  it("exports AI points, route order, weather, category budget and the explicit return time without confirmation", async () => {
    const snapshot = await exportFixture();
    snapshot.plan.requestSnapshot.constraints = ["第 2 天下午 16:00 的高铁回深圳"];
    const day = snapshot.plan.events[0].date;
    // The dynamic trip date and saved forecast must share the same forecast window.
    snapshot.generatedAt = `${day}T04:00:00.000Z`;
    Object.assign(snapshot.plan.events.find((event) => event.id === "d1-activity")!, { latitude: 24.913, longitude: 118.585, coordinateSystem: "WGS84", locationName: "开元寺" });
    Object.assign(snapshot.plan.events.find((event) => event.id === "d1-lunch")!, { latitude: 24.914, longitude: 118.591, coordinateSystem: "WGS84", locationName: "西街" });
    snapshot.weather = [{ ...unknownWeatherRecord({ date: day, locationName: "泉州", latitude: 24.91, longitude: 118.58, status: "fresh" }), retrievedAt: snapshot.generatedAt, temperatureMinC: 19, temperatureMaxC: 26, precipitationProbabilityMax: 20, precipitationSumMm: 0 }];
    expect(snapshot.plan.places).toHaveLength(0);
    for (const document of [renderMobileHtml(snapshot, options), await renderLongImageHtml(snapshot, options, { includeMap: true, includePhotos: false }), await renderPdfHtml(snapshot, options, { mode: "complete", includePhotos: false })]) {
      expect(document).toContain("<svg");
      expect(document).toContain('class="route-line"');
      expect(document).toContain("棕色：建议地点或方位参考");
      expect(document).toContain("③ 开元寺");
      expect(document).toContain("④ 西街");
      expect(document).toContain("19–26℃");
      expect(document).toContain("Open-Meteo");
      expect(document).toContain("住宿：");
      expect(document).toContain("16:00 返程发车 · 硬时间");
      expect(document).not.toContain("118.585");
    }
  });

  it("presents a travel-book cover and strips internal map IDs from every export", async () => {
    const snapshot = await exportFixture();
    snapshot.tripTitle = "福建泉州 · 三日轻松漫游";
    const activity = snapshot.plan.events.find((event) => event.id === "d1-activity")!;
    activity.note = "从西街（OSM 1878551036）步行前往开元寺，再沿 (OSM 1879551038) 的路牌确认入口。";
    const documents = [
      renderMobileHtml(snapshot, options),
      renderTextExport(snapshot, options, "plain-text"),
      renderTextExport(snapshot, options, "markdown"),
      await renderLongImageHtml(snapshot, options, { includeMap: false, includePhotos: false }),
      await renderPdfHtml(snapshot, options, { mode: "complete", includePhotos: false }),
    ];
    for (const document of documents) {
      expect(document).toContain("福建泉州 · 三日轻松漫游");
      expect(document).not.toContain("OSM 1878551036");
      expect(document).not.toContain("OSM 1879551038");
      expect(document).not.toContain("计划 V");
      expect(document).not.toContain("需求修订");
      expect(document).not.toContain("版本快照哈希");
    }
    for (const document of [documents[0], documents[3], documents[4]]) {
      expect(document).toContain("当日动线");
      expect(document).toContain('<span class="route-arrow" aria-hidden="true">→</span>');
      expect(document).not.toContain("➡️");
      expect(document).toContain("已知费用");
    }
  });
});
