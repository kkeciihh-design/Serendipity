import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { chromium, type Browser } from "playwright";
import { longImageFixture } from "./helpers/long-image-fixtures";
import { PRIVATE_ADDRESS } from "./helpers/export-fixtures";
import { renderGeographicMap, renderLongImageHtml } from "../lib/long-image-html";
import { screenshotLongImage, withLongImageSlot } from "../lib/long-image-renderer";
import { mobileExportOptionsSchema } from "../lib/export-snapshot";
import { LONG_IMAGE_LIMITS } from "../lib/long-image";
import { verificationEvidenceDirectory } from "./helpers/evidence-directory";
const options = mobileExportOptionsSchema.parse({}), content = { includeMap: true, includePhotos: true };
const directory = verificationEvidenceDirectory("phase26-renderer");
describe("controlled long image rendering", () => {
  for (const days of [2, 4]) it(`${days} days render all events with Chinese text and licensed resources`, async () => {
    const s = await longImageFixture(days);
    const html = await renderLongImageHtml(s, options, content);
    expect(html).toContain("22:55"); expect(html).toContain("1500 元"); expect(html).toContain("OpenStreetMap"); expect(html).toContain("CC BY");
    expect(html).not.toContain(PRIVATE_ADDRESS); expect(html).not.toContain("08车06A");
    expect(html).not.toContain('src="http'); expect(html).not.toContain('src="file:');
    const manifest = await screenshotLongImage(html, `${days}days`);
    if (days === 2) expect(manifest.parts).toHaveLength(1); else expect(manifest.parts.length).toBeGreaterThan(1);
    expect([...new Set(manifest.parts.flatMap((p) => p.eventIds))].sort()).toEqual(s.plan.events.map((e) => e.id).sort());
    await fs.mkdir(directory, { recursive: true });
    for (const part of manifest.parts) {
      const bytes = Buffer.from(part.base64, "base64"), meta = await sharp(bytes).metadata();
      expect(meta.width).toBe(1080); expect(meta.height).toBeLessThanOrEqual(15000); expect(meta.exif).toBeUndefined(); expect(bytes.length).toBeLessThan(LONG_IMAGE_LIMITS.partBytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(part.sha256);
      await fs.writeFile(path.join(directory, part.filename), bytes);
    }
    await fs.writeFile(path.join(directory, `${days}days.json`), JSON.stringify({ generatedAt: s.generatedAt, events: s.plan.events.map((e) => ({ id: e.id, title: e.title, date: e.date })), parts: manifest.parts.map(({ base64, ...p }) => { void base64; return p; }) }, null, 2));
  }, 90_000);
  it("rejects unauthorized map sources; no private marker or route geometry escapes", async () => {
    const s = await longImageFixture();
    const day = s.plan.events[0].date;
    const map = renderGeographicMap(s, options, day);
    expect(map).toContain("1."); expect(map).not.toContain(String(s.plan.places[0].longitude)); expect(map).not.toContain(PRIVATE_ADDRESS);
    s.plan.places[0].provider = "amap";
    expect(() => renderGeographicMap(s, options, day)).toThrow("许可");
    expect(await renderLongImageHtml(s, options, { includeMap: false, includePhotos: false })).toContain("未选择位置示意图");
    s.plan.places[0].provider = "osm"; s.plan.places[0].longitude = NaN;
    expect(() => renderGeographicMap(s, options, day)).toThrow("坐标");
  });
  it("missing or corrupt licensed photos fail clearly and can be excluded", async () => {
    const s = await longImageFixture();
    const original = fs.readFile.bind(fs);
    const spy = vi.spyOn(fs, "readFile").mockImplementation(((...args: Parameters<typeof fs.readFile>) => String(args[0]).endsWith(".webp") ? Promise.reject(new Error("missing")) : original(...args)) as typeof fs.readFile);
    try { await expect(renderLongImageHtml(s, options, content)).rejects.toThrow("照片加载失败"); }
    finally { spy.mockRestore(); }
    expect(await renderLongImageHtml(s, options, { ...content, includePhotos: false })).not.toContain("<img ");
  });
  it("fails broken and external resources, cancellation and empty output without reporting success", async () => {
    const html = await renderLongImageHtml(await longImageFixture(), options, content);
    const browsers: Browser[] = [], launch = chromium.launch.bind(chromium);
    const spy = vi.spyOn(chromium, "launch").mockImplementation(async (options) => { const browser = await launch(options); browsers.push(browser); return browser; });
    try {
      await expect(screenshotLongImage(html.replace(/src="data:image[^"]+"/, 'src="http://127.0.0.1:9/never"'), "broken")).rejects.toThrow("渲染失败");
      await expect(screenshotLongImage(html, "cancelled", AbortSignal.abort())).rejects.toThrow("取消");
      await expect(screenshotLongImage("<html><body>empty</body></html>", "empty")).rejects.toThrow("渲染失败");
      const controller = new AbortController(); const running = screenshotLongImage(html, "mid-cancel", controller.signal);
      setTimeout(() => controller.abort(), 100); await expect(running).rejects.toThrow("取消");
      expect(browsers.every((b) => !b.isConnected())).toBe(true);
    } finally { spy.mockRestore(); }
  }, 90_000);
  it("oversized source paragraphs split without losing source text or events", async () => {
    const s = await longImageFixture(2);
    for (let i = 0; i < 130; i++) s.evidence.push({ eventId: "d1-activity", field: "reservation", status: "pending", value: `第${i + 1}项预约须知：${"请提前核实当日开放预约条件。".repeat(20)}`, source: "合成压力资料", retrievedAt: s.generatedAt, applicableFrom: null, applicableUntil: null });
    const manifest = await screenshotLongImage(await renderLongImageHtml(s, options, { includeMap: false, includePhotos: false }), "paragraphs");
    expect(manifest.parts.length).toBeGreaterThan(2);
    expect([...new Set(manifest.parts.flatMap((p) => p.eventIds))].sort()).toEqual(s.plan.events.map((e) => e.id).sort());
    await fs.writeFile(path.join(directory, "paragraphs.json"), JSON.stringify(manifest.parts.map(({ base64, ...part }) => { void base64; return part; }), null, 2));
    for (const p of manifest.parts) await fs.writeFile(path.join(directory, p.filename), Buffer.from(p.base64, "base64"));
  }, 90_000);
  it("rejects concurrent work and releases its slot after failures", async () => {
    let release!: () => void;
    const running = withLongImageSlot(() => new Promise<void>((resolve) => { release = resolve; }));
    await expect(withLongImageSlot(async () => 1)).rejects.toMatchObject({ status: 429 });
    release(); await running;
    await expect(withLongImageSlot(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(await withLongImageSlot(async () => "recovered")).toBe("recovered");
  });
  it("a shortened controlled deadline closes a browser that finishes launching late", async () => {
    const html = await renderLongImageHtml(await longImageFixture(), options, content);
    const originalTimer = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => originalTimer(handler, delay && delay > 59_000 ? 20 : delay, ...args)) as typeof setTimeout);
    const launch = chromium.launch.bind(chromium); let started: Browser | undefined;
    const spy = vi.spyOn(chromium, "launch").mockImplementation(async (options) => { started = await launch(options); return started; });
    try { await expect(screenshotLongImage(html, "deadline")).rejects.toThrow("超时"); expect(started?.isConnected()).toBe(false); }
    finally { timer.mockRestore(); spy.mockRestore(); }
  }, 30_000);
});
