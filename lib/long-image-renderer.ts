import { createHash } from "node:crypto";
import type { Browser } from "playwright";
import { launchExportBrowser } from "./export-browser";
import sharp from "sharp";
import { ExportError } from "./export-snapshot";
import { LONG_IMAGE_LIMITS as limits, type ImageManifest } from "./long-image";

// Shared by every route/module in this Node instance; reject excess work, no queue.
const state = globalThis as typeof globalThis & { longImageBusy?: boolean };
export async function withLongImageSlot<T>(work: () => Promise<T>): Promise<T> {
  if (state.longImageBusy) throw new ExportError("正在生成另一份长图或PDF，请稍后重试。", 429);
  state.longImageBusy = true;
  try { return await work(); } finally { state.longImageBusy = false; }
}

export function screenshotLongImage(html: string, prefix: string, signal?: AbortSignal): Promise<ImageManifest> {
  return screenshotAtHeight(html, prefix, limits.height, Date.now() + limits.timeoutMs, signal);
}
class ImageTooLarge extends Error {}
async function screenshotAtHeight(html: string, prefix: string, renderHeight: number, deadline: number, signal?: AbortSignal): Promise<ImageManifest> {
  let browser: Browser | undefined, stopped = false;
  const stop = () => { stopped = true; void browser?.close(); };
  const timeout = setTimeout(stop, Math.max(1, deadline - Date.now()));
  signal?.addEventListener("abort", stop, { once: true });
  try {
    if (signal?.aborted) throw new ExportError("长图生成已取消。", 409);
    if (Buffer.byteLength(html) > 40 * 1024 * 1024) throw new ExportError("长图资料超出本机渲染上限，请按单日生成。");
    browser = await launchExportBrowser();
    if (stopped) throw new ExportError("长图生成超时或已取消，请重试。", 503);
    const context = await browser.newContext({ viewport: { width: limits.width, height: 900 }, deviceScaleFactor: limits.scale, serviceWorkers: "block", acceptDownloads: false });
    // setContent on about:blank only. No application URL, cookies, local files,
    // remote images, redirects, or arbitrary snapshot-provided resource requests.
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = await document.fonts.load('18px "Noto Sans SC"', "旅行中文预算红线");
      if (!loaded.length) throw new Error("FONT_MISSING");
      if (!document.fonts.check('18px "Noto Sans SC"', "旅行中文预算红线")) throw new Error("FONT_NOT_READY");
      await Promise.all([...document.images].map(async (img) => { await img.decode(); if (!img.naturalWidth) throw new Error("IMAGE_NOT_READY"); }));
      if (!document.body.textContent?.includes("关键时间红线") || !document.querySelector(".event")) throw new Error("EMPTY_DOCUMENT");
    });
    const metadata = await page.evaluate(({ height, parts }) => {
      const originalText = document.body.textContent!.replace(/\s/g, "");
      const originalEvents = [...document.querySelectorAll<HTMLElement>("[data-event]")].map((e) => e.dataset.event!);
      const days = [...document.querySelectorAll<HTMLElement>(".day")];
      const sheets: HTMLElement[] = [];
      const units: { node: HTMLElement; day: string; newDay?: boolean }[] = [];
      const header = document.querySelector<HTMLElement>("body>header")!;
      const versionLabel = [...header.querySelectorAll("p")].find((p) => p.textContent?.startsWith("计划 V"))?.textContent ?? "";
      const footer = document.querySelector<HTMLElement>("body>footer")!;
      // Preserve the entire document for short trips when it fits the verified cap.
      const fullHeight = document.documentElement.scrollHeight;
      if (days.length <= 2 && fullHeight + 240 <= height) {
        const sheet = document.createElement("div"); sheet.className = "sheet";
        sheet.append(header, ...document.querySelector("main")!.children, footer); document.body.replaceChildren(sheet); sheets.push(sheet);
      } else {
        units.push({ node: header, day: "" });
        for (const section of [...document.querySelectorAll<HTMLElement>("main>section")]) {
          const day = section.classList.contains("day") ? section.id.slice(4) : "";
          if (day) {
            // Direct visual blocks only, never duplicate their descendant text.
            const visuals = [...section.querySelector<HTMLElement>(".visuals")!.children] as HTMLElement[];
            const events = [...section.querySelectorAll<HTMLElement>(":scope>.timeline>.event")];
            const first = document.createElement("section");
            const route = section.querySelector<HTMLElement>(".day-route");
            first.append(section.querySelector("h2")!);
            if (route) first.append(route);
            first.append(...[...section.children].filter((node) => node.matches(".weather")), ...(visuals.length ? [visuals.shift()!] : [events.shift()!]));
            units.push({ node: first, day, newDay: true }, ...[...visuals, ...events].map((node) => ({ node, day })));
          } else units.push({ node: section, day });
        }
        units.push({ node: footer, day: "" });
        document.body.replaceChildren();
        let sheet: HTMLElement;
        const fresh = () => {
          if (sheets.length >= parts) throw new Error("TOO_MANY_PARTS");
          sheet = document.createElement("div"); sheet.className = "sheet"; document.body.append(sheet); sheets.push(sheet);
        };
        fresh();
        const append = (node: HTMLElement, day: string) => {
          if (day) node.dataset.day = day;
          sheet.append(node);
          if (sheet.getBoundingClientRect().height <= height - 240) return;
          node.remove();
          if (sheet.children.length) {
            const previous = sheet; fresh(); sheet.append(node);
            if (sheet.getBoundingClientRect().height <= height - 240) return;
            node.remove(); sheet.remove(); sheets.pop(); sheet = previous;
          }
          // Split only at natural child/paragraph boundaries, with stable event
          // identity on all continuations. Never crop a rendered card.
          if (node.children.length > 1) {
            for (const child of [...node.children] as HTMLElement[]) {
              const wrapper = document.createElement("div");
              wrapper.className = node.className;
              if (node.dataset.event) wrapper.dataset.event = node.dataset.event;
              wrapper.append(child); append(wrapper, day);
            }
          } else if (node.children.length === 1 && node.firstElementChild!.children.length > 0 && !node.querySelector("img,svg")) {
            const child = node.firstElementChild as HTMLElement;
            if (node.dataset.event) child.dataset.event = node.dataset.event;
            append(child, day);
          } else if (node.textContent && node.textContent.length > 1000 && !node.querySelector("img,svg")) {
            const value = node.textContent;
            for (let i = 0; i < value.length; i += 800) {
              const paragraph = document.createElement("p"); paragraph.textContent = value.slice(i, i + 800);
              if (node.dataset.event) paragraph.dataset.event = node.dataset.event;
              append(paragraph, day);
            }
          } else throw new Error("BLOCK_TOO_LARGE");
        };
        for (const unit of units) { if (days.length > 2 && unit.newDay && sheets.length && sheet!.children.length) fresh(); append(unit.node, unit.day); }
      }
      if (sheets.map((sheet) => sheet.textContent).join("").replace(/\s/g, "") !== originalText) throw new Error("MISSING_CONTENT");
      const result = sheets.map((sheet, i) => {
        const dates = [...new Set([...sheet.querySelectorAll<HTMLElement>("[data-day],.day")].map((e) => e.dataset.day ?? e.id.slice(4)))];
        const label = document.createElement("div"); label.className = "part-label"; label.textContent = `SERENDIPITY · 旅行长图 · 第 ${i + 1} / ${sheets.length} 张 · ${dates.join(" / ") || "总览"} · ${versionLabel}`;
        const end = document.createElement("div"); end.className = "part-end"; end.textContent = i + 1 < sheets.length ? `本张结束 · 请继续第 ${i + 2} 张` : "全部资料结束 · 保存全部图片，随时翻阅";
        sheet.prepend(label); sheet.append(end); sheet.dataset.part = String(i + 1);
        const h = Math.ceil(sheet.getBoundingClientRect().height);
        if (h > height || sheet.scrollWidth > 720) throw new Error("INVALID_DIMENSIONS");
        return { height: h, dates, eventIds: [...new Set([...sheet.querySelectorAll<HTMLElement>("[data-event]")].map((e) => e.dataset.event!))] };
      });
      if (originalEvents.some((id) => !result.some((p) => p.eventIds.includes(id)))) throw new Error("MISSING_EVENT");
      return result;
    }, { height: renderHeight, parts: limits.parts });
    const parts: ImageManifest["parts"] = []; let total = 0;
    for (const [i, meta] of metadata.entries()) {
      if (stopped) throw new ExportError("长图生成超时或已取消，请重试。", 503);
      const bytes = await page.locator(`[data-part="${i + 1}"]`).screenshot({ type: "png", animations: "disabled", timeout: 15_000 });
      const check = await sharp(bytes).metadata();
      if (check.width !== limits.width * limits.scale || !check.height || check.height > renderHeight * limits.scale) throw new ExportError("单张图片超过已验证尺寸，请减少所选日期或内容后重试。");
      if (bytes.length > limits.partBytes) throw new ImageTooLarge();
      total += bytes.length;
      if (total > limits.totalBytes) throw new ExportError("图片总大小超出限制，请按单日生成。");
      parts.push({ index: i + 1, width: check.width, height: check.height, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), filename: `${prefix}-${i + 1}.png`, dates: meta.dates, eventIds: meta.eventIds, base64: bytes.toString("base64") });
    }
    if (!parts.length) throw new ExportError("未生成完整图片，请重试。", 503);
    return { schemaVersion: 1, parts };
  } catch (error) {
    if (error instanceof ImageTooLarge && renderHeight > 1250 && !stopped) {
      await browser?.close(); browser = undefined;
      clearTimeout(timeout); signal?.removeEventListener("abort", stop);
      // Re-layout at natural boundaries with a smaller height, never crop PNGs.
      // All attempts share the original 60-second deadline and one browser slot.
      return screenshotAtHeight(html, prefix, Math.floor(renderHeight / 2), deadline, signal);
    }
    if (error instanceof ExportError) throw error;
    const failure = new ExportError(stopped ? "长图生成超时或已取消，请重试。" : "长图渲染失败，请检查 Chromium、中文字体和图片资源后重试。", 503);
    failure.cause = error; throw failure;
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", stop); await browser?.close(); }
}
