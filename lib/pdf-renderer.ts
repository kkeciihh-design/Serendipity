import type { Browser } from "playwright";
import { launchExportBrowser } from "./export-browser";
import { ExportError } from "./export-snapshot";
import { PDF_LIMITS as limits, type PdfManifest } from "./pdf";

// HTML is produced internally from the captured snapshot. No URL is accepted.
export async function printPdf(html: string, signal?: AbortSignal): Promise<PdfManifest> {
  let browser: Browser | undefined, stopped = false;
  const stop = () => { stopped = true; void browser?.close(); };
  const timer = setTimeout(stop, limits.timeoutMs);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    if (signal?.aborted) throw new ExportError("PDF生成已取消。", 409);
    if (Buffer.byteLength(html) > limits.htmlBytes) throw new ExportError("PDF资料超出本机上限，请减少所选日期。");
    browser = await launchExportBrowser();
    if (stopped) throw new ExportError("PDF生成超时或已取消，请重试。", 503);
    const context = await browser.newContext({ viewport: { width: 800, height: 1123 }, serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const text = document.body.textContent ?? "";
      if (!(await document.fonts.load('12px "Noto Sans SC"', text)).length || !document.fonts.check('12px "Noto Sans SC"', text)) throw new Error("FONT_MISSING");
      await Promise.all([...document.images].map(async (img) => { await img.decode(); if (!img.naturalWidth) throw new Error("IMAGE_MISSING"); }));
      if (!document.querySelector(".event") || !document.querySelector("#preparation")) throw new Error("EMPTY_DOCUMENT");
      if (document.body.dataset.pdfMode === "complete" && [...document.querySelectorAll(".day")].some((day) => !day.querySelector("svg,.map-unavailable"))) throw new Error("MAP_MISSING");
    });
    const metadata = await page.evaluate((maxPages) => {
      const footer = document.querySelector<HTMLElement>("body>footer")!;
      const originalText = [...document.body.childNodes].filter((node) => node !== footer)
        .map((node) => node.textContent ?? "").join("").replace(/\s/g, "");
      const eventIds = [...document.querySelectorAll<HTMLElement>("[data-event]")].map((e) => e.dataset.event!);
      const header = document.querySelector<HTMLElement>("body>header")!;
      const title = header.querySelector("h1")!.textContent!;
      const units: { node: HTMLElement; chapter?: string; fresh?: boolean }[] = [{ node: header, chapter: "旅行总览" }];
      for (const section of [...document.querySelectorAll<HTMLElement>("main>section")]) {
        const heading = section.querySelector<HTMLElement>("h2")!;
        const chapter = heading.textContent!;
        if (section.classList.contains("day")) {
          const visuals = [...section.querySelector<HTMLElement>(".visuals")!.children] as HTMLElement[];
          const first = document.createElement("section");
          const route = section.querySelector<HTMLElement>(".day-route");
          first.append(heading);
          if (route) first.append(route);
          first.append(...[...section.children].filter((node) => node.matches(".weather")), visuals.shift()!);
          units.push({ node: first, chapter }, ...visuals.map((node) => ({ node, chapter })));
          const events = [...section.querySelectorAll<HTMLElement>(".timeline>.event")];
          units.push(...events.map((node) => ({ node, chapter: `${chapter} · 时间轴` })));
        } else {
          const children = [...section.children] as HTMLElement[];
          const first = document.createElement("section"); first.id = section.id; first.append(...children.splice(0, 2));
          units.push({ node: first, chapter, fresh: false }, ...children.map((node) => ({ node, chapter })));
        }
      }
      document.body.replaceChildren();
      const sheets: HTMLElement[] = []; let sheet: HTMLElement, area: HTMLElement, chapter = "";
      function fresh() {
        if (sheets.length >= maxPages) throw new Error("TOO_MANY_PAGES");
        sheet = document.createElement("div"); sheet.className = "pdf-page";
        const h = document.createElement("div"); h.className = "pdf-header"; h.dataset.repeat = "true";
        h.textContent = `SERENDIPITY · ${chapter}`;
        area = document.createElement("div"); area.className = "pdf-content";
        sheet.append(h, area); document.body.append(sheet); sheets.push(sheet);
      }
      function fits() { return area.scrollHeight <= area.clientHeight + 1 && area.scrollWidth <= area.clientWidth + 1; }
      function appendCosts(node: HTMLElement) {
        const costs = [...node.children] as HTMLElement[];
        let offset = 0;
        while (offset < costs.length) {
          const grid = node.cloneNode(false) as HTMLElement;
          const left = document.createElement("div"), right = document.createElement("div");
          grid.append(left, right); area.append(grid);
          let count = 0;
          const layout = (size: number) => {
            const split = Math.ceil(size / 2);
            left.replaceChildren(...costs.slice(offset, offset + split));
            right.replaceChildren(...costs.slice(offset + split, offset + size));
          };
          // Measure each candidate split in its final two-column layout. Both
          // screen and print now use the same DOM and left-then-right order.
          while (offset + count < costs.length) {
            layout(count + 1);
            if (!fits()) { costs[offset + count].remove(); layout(count); break; }
            count += 1;
          }
          if (count) { offset += count; }
          else {
            grid.remove();
            const hasContent = [...area.children].some((child) => !(child as HTMLElement).dataset.repeat);
            if (!hasContent) { append(costs[offset]); offset += 1; }
          }
          if (offset < costs.length) {
            fresh();
            const heading = document.createElement("h2"); heading.dataset.repeat = "true";
            heading.textContent = `${chapter}（续）`; area.append(heading);
          }
        }
      }
      function append(node: HTMLElement, continued?: HTMLElement) {
        if (node.matches(".cost-grid")) { appendCosts(node); return; }
        area.append(node);
        if (fits()) return;
        const nodeHeight = node.getBoundingClientRect().height;
        node.remove();
        // An oversized block cannot fit on a fresh page either. Split it here;
        // otherwise recursive wrappers leave pages containing only a label.
        if ([...area.children].some((child) => !(child as HTMLElement).dataset.repeat) && nodeHeight <= area.clientHeight) {
          fresh();
          if (continued) { const c = continued.cloneNode(true) as HTMLElement; c.dataset.repeat = "true"; area.append(c); }
          area.append(node); if (fits()) return; node.remove();
        }
        // Split oversized cards at natural child boundaries and repeat identity
        // on continuation pages. Text is retained exactly once for comparison.
        const repeat = continued ?? (node.matches(".event,.recommendation,.cost,.advisory,.source,.redline") ? document.createElement("div") : undefined);
        if (repeat && repeat !== continued) {
          repeat.className = "continuation";
          repeat.textContent = `${node.querySelector(".number")?.textContent ?? ""} ${node.querySelector("h3")?.textContent ?? ""}（续）`;
        }
        const wrap = (child: HTMLElement) => {
          const container = document.createElement("div"); container.className = node.className; container.id = node.id;
          if (node.dataset.event) container.dataset.event = node.dataset.event;
          container.append(child); return container;
        };
        if (node.children.length > 1) {
          const children = [...node.children] as HTMLElement[];
          // Keep headings with the first paragraph, including the event number.
          const lead = document.createElement("div");
          while (children.length && (children[0].matches("h2,h3,.event-head,summary") || !lead.children.length)) lead.append(children.shift()!);
          if (children.length) lead.append(children.shift()!);
          // Avoid recursively wrapping a leading group that is itself oversized.
          if (!children.length) {
            for (const child of [...lead.children] as HTMLElement[]) append(wrap(child), repeat);
          } else { append(wrap(lead), repeat); for (const child of children) append(wrap(child), repeat); }
        } else if (node.firstElementChild && node.firstElementChild.children.length) {
          const child = node.firstElementChild as HTMLElement;
          if (node.dataset.event) child.dataset.event = node.dataset.event;
          append(child, repeat);
        } else if (node.textContent && node.textContent.length > 240 && !node.querySelector("img,svg")) {
          const chars = [...node.textContent];
          for (let i = 0; i < chars.length; i += 240) { const p = document.createElement("p"); p.textContent = chars.slice(i, i + 240).join(""); append(wrap(p), repeat); }
        } else throw new Error("BLOCK_TOO_LARGE");
      }
      for (const unit of units) {
        chapter = unit.chapter ?? chapter;
        if (!sheets.length || unit.fresh && area!.childElementCount) fresh();
        append(unit.node);
      }
      const contentText = [...document.querySelectorAll(".pdf-content")].map((a) => { const clone = a.cloneNode(true) as HTMLElement; clone.querySelectorAll("[data-repeat]").forEach((n) => n.remove()); return clone.textContent; }).join("").replace(/\s/g, "");
      if (contentText !== originalText) throw new Error("MISSING_CONTENT");
      const finalEvents = [...new Set([...document.querySelectorAll<HTMLElement>("[data-event]")].map((e) => e.dataset.event!))];
      if (eventIds.some((id) => !finalEvents.includes(id))) throw new Error("MISSING_EVENT");
      for (const [i, s] of sheets.entries()) {
        const content = s.querySelector(".pdf-content")!.cloneNode(true) as HTMLElement;
        content.querySelectorAll("[data-repeat]").forEach((node) => node.remove());
        if (!content.textContent?.trim()) throw new Error("EMPTY_PAGE");
        const footer = document.createElement("div"); footer.className = "pdf-footer";
        const left = document.createElement("span");
        left.textContent = i === sheets.length - 1 ? `${title} · 行程结束 · 请核对返家安排` : title;
        const right = document.createElement("span"); right.textContent = `第 ${i + 1} / ${sheets.length} 页`;
        footer.append(left, right); s.append(footer);
      }
      document.title = title;
      return { pages: sheets.length, eventIds: finalEvents };
    }, limits.pages);
    const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
    if (stopped) throw new ExportError("PDF生成超时或已取消，请重试。", 503);
    if (bytes.length > limits.bytes || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new ExportError("PDF文件超出限制或生成不完整，请减少所选日期重试。", 503);
    return { schemaVersion: 1, ...metadata, bytes: bytes.length, base64: bytes.toString("base64") };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    const failure = new ExportError(stopped ? "PDF生成超时或已取消，请重试。" : "PDF渲染失败，请检查 Chromium、中文字体、地图和照片资源后重试。", 503);
    failure.cause = error; throw failure;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); await browser?.close(); }
}
