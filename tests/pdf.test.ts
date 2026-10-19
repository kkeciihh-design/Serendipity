import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { longImageFixture } from "./helpers/long-image-fixtures";
import { PRIVATE_ADDRESS } from "./helpers/export-fixtures";
import { renderPdfHtml } from "../lib/pdf-html";
import { printPdf } from "../lib/pdf-renderer";
import { mobileExportOptionsSchema } from "../lib/export-snapshot";
import { verificationEvidenceDirectory } from "./helpers/evidence-directory";
import { renderGeographicMap } from "../lib/long-image-html";
const options = mobileExportOptionsSchema.parse({}), content = { mode: "complete" as const, includePhotos: true };
const directory = verificationEvidenceDirectory("phase27-renderer");
async function save(name: string, html: string) {
  const manifest = await printPdf(html);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${name}.pdf`), Buffer.from(manifest.base64, "base64"));
  const { base64, ...metadata } = manifest; void base64;
  await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(metadata, null, 2));
  return manifest;
}
describe("PDF handbook with controlled Chromium", () => {
  it("saved dining/stay choices, refund/unknown costs and explicit privacy opt-in remain distinguishable", async () => {
    const s = await longImageFixture();
    const hotel = s.plan.events.find((e) => e.id === "d1-hotel")!;
    hotel.accommodationSelection = { stayId: "stay", areaId: "area", areaName: "合成公共住宿区域", kind: "area", checkIn: s.plan.requestSnapshot.startDate!, checkOut: s.plan.requestSnapshot.endDate!, roomCount: 2, nightCount: 1, morningDepartureTime: "08:00", checkInFrom: "14:00", checkOutBy: "12:00", luggageStorage: "available", conditionNote: "合成入住资料", selectedAt: s.generatedAt };
    s.plan.events.find((e) => e.id === "d1-lunch")!.restaurantSelection = { catalogId: null, action: "adjust", selectedAt: s.generatedAt };
    s.plan.costs[0].unitAmountCents = null; s.plan.costs[1].paymentStatus = "refund_pending";
    const html = await renderPdfHtml(s, { ...options, includePrivateAddress: true, includeSeats: true }, content);
    for (const text of [PRIVATE_ADDRESS, "08车06A", "住宿区域参考，非已订酒店", "2 间 / 1 晚", "14:00", "12:00", "用户记录可用", "退款待处理", "金额待确认"]) expect(html).toContain(text);
  });
  for (const days of [2, 4]) it(`${days} days: complete Chinese PDF, chapters, resources and privacy`, async () => {
    const s = await longImageFixture(days), html = await renderPdfHtml(s, options, content);
    for (const text of ["完整旅行手册", "旅行总览", "景点推荐", "餐厅推荐", "住宿区域", "全程预算", "出发前清单", "旅行提醒", "资料来源", "22:55", "1500 元", "OpenStreetMap", "CC BY"]) expect(html).toContain(text);
    expect(html).not.toContain(PRIVATE_ADDRESS); expect(html).not.toContain("08车06A");
    const m = await save(`${days}days`, html); expect(m.pages).toBeGreaterThan(days);
    expect(m.eventIds.sort()).toEqual(s.plan.events.map((e) => e.id).sort());
  }, 90_000);
  it("missing manual confirmations allow suggested maps or a compact fallback; invalid saved points still fail", async () => {
    const s = await longImageFixture();
    s.plan.events.find((e) => e.id === "d2-activity")!.placeId = null;
    expect(await renderPdfHtml(s, options, content)).toContain("map-unavailable");
    Object.assign(s.plan.events.find((e) => e.id === "d2-activity")!, { latitude: 24.91, longitude: 118.58 });
    expect(await renderPdfHtml(s, options, content)).toContain("含待核实建议标点");
    const html = await renderPdfHtml(s, options, { mode: "simplified", includePhotos: false });
    expect(html).toContain("简化旅行资料（无地图）"); expect(html).not.toContain("<svg");
    s.plan.events.find((e) => e.id === "d2-activity")!.placeId = s.plan.places[1].id;
    s.plan.places[0].longitude = 999;
    await expect(renderPdfHtml(s, options, content)).rejects.toThrow("坐标");
    s.plan.places[0].longitude = 112; s.plan.places[0].provider = "amap";
    await expect(renderPdfHtml(s, options, content)).rejects.toThrow("许可");
  });
  it("coincident map markers group without dropping any original daily numbers", async () => {
    const s = await longImageFixture();
    s.plan.events.find((e) => e.id === "d1-lunch")!.placeId = s.plan.places[0].id;
    const map = renderGeographicMap(s, options, s.plan.events[0].date, undefined, true);
    expect(map.match(/<circle/g)).toHaveLength(1); expect(map).toContain("A1 · 1.4"); expect(map).toContain("A1 · 1.5");
  });
  it("cross-city maps and long cards, multi-page checklist/sources preserve all content", async () => {
    const s = await longImageFixture(2), event = s.plan.events.find((e) => e.id === "d1-lunch")!;
    s.plan.places.push({ ...s.plan.places[0], id: "other-city", name: "上海公开地点", city: "上海", longitude: 121.47, latitude: 31.23 }); event.placeId = "other-city";
    s.plan.events.find((e) => e.id === "d1-activity")!.note = "长卡片内容用于分页核对。".repeat(250) + "长卡片终点";
    for (let i = 1; i <= 36; i++) s.evidence.push({ eventId: "d1-activity", field: "reservation", status: "pending", value: `压力来源第${i}项：${"请提前核对本人预约及当日条件。".repeat(12)}；来源终点${i}`, source: "合成压力资料", retrievedAt: s.generatedAt, applicableFrom: null, applicableUntil: null });
    // Actual schema fixture generated in a separate helper is unnecessary: these
    // print-only records exercise the complete already projected checklist.
    const { checklistItemSchema } = await import("../lib/checklist");
    for (let i = 1; i <= 70; i++) s.checklist.items.push(checklistItemSchema.parse({ id: `stress-${i}`, group: "essentials", title: `压力清单第${i}项`, note: "核对随身物品和出行条件。".repeat(8), date: null, eventId: null, eventIds: [], ticketIds: [], source: "custom", sourceLabel: "合成清单", sourceKey: `stress-${i}`, signature: "stress", officialUrl: null, custom: true, completed: i % 2 === 0, completedAt: null, deleted: false, orphaned: false, changeNote: null }));
    const html = await renderPdfHtml(s, options, { ...content, includePhotos: false }); expect(html).toContain("上海公开地点"); expect(html).toContain("route-line");
    const m = await save("stress", html); expect(m.pages).toBeGreaterThan(8);
  }, 90_000);
  it("missing font/map/image and blocked external resources never yield a successful PDF; cancellation closes Chromium", async () => {
    const html = await renderPdfHtml(await longImageFixture(), options, content);
    const launch = chromium.launch.bind(chromium), browsers: Browser[] = [];
    const spy = vi.spyOn(chromium, "launch").mockImplementation(async (args) => { const b = await launch(args); browsers.push(b); return b; });
    try {
      await expect(printPdf(html.replace(/@font-face\s*\{[^}]+\}/g, ""))).rejects.toThrow("渲染失败");
      await expect(printPdf(html.replace(/<svg[\s\S]*?<\/svg>/g, ""))).rejects.toThrow("渲染失败");
      await expect(printPdf(html.replace(/src="data:image[^"]+"/, 'src="http://127.0.0.1:9/blocked"'))).rejects.toThrow("渲染失败");
      await expect(printPdf(html, AbortSignal.abort())).rejects.toThrow("取消");
      const controller = new AbortController(), pending = printPdf(html, controller.signal); setTimeout(() => controller.abort(), 50);
      await expect(pending).rejects.toThrow("取消"); expect(browsers.every((b) => !b.isConnected())).toBe(true);
    } finally { spy.mockRestore(); }
  }, 90_000);
  it("a shortened controlled deadline closes a browser that launches late", async () => {
    const html = await renderPdfHtml(await longImageFixture(), options, content);
    const originalTimer = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => originalTimer(handler, delay === 60_000 ? 20 : delay, ...args)) as typeof setTimeout);
    const launch = chromium.launch.bind(chromium); let started: Browser | undefined;
    const spy = vi.spyOn(chromium, "launch").mockImplementation(async (args) => { started = await launch(args); return started; });
    try { await expect(printPdf(html)).rejects.toThrow("超时"); expect(started?.isConnected()).toBe(false); }
    finally { timer.mockRestore(); spy.mockRestore(); }
  }, 30_000);
});
