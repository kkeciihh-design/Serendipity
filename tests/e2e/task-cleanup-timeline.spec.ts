// A temporary Playwright test that seeds the timeline-integrity trip and
// asserts the section 三 timeline rules against the rendered detail page.
import { test, expect } from "./fixtures";
import { seedTimelineIntegrityTrip } from "./timeline-integrity-helpers";

test("timeline cards follow the minimal three-part text layout", async ({ page, request }) => {
  const { PrismaClient } = await import("@prisma/client");
  const path = await import("node:path");
  const directory = path.resolve("test-data/e2e");
  const db = new PrismaClient({
    datasources: { db: { url: `file:${path.join(directory, "data/serendipity.db").replaceAll("\\", "/")}` } },
  });
  try {
    const seed = await seedTimelineIntegrityTrip(request, db as never);
    await page.goto(`/trips/${seed.tripId}`);
    await page.waitForTimeout(2500);

    const probe = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[class*="eventCard"]')];
      const pills: { text: string; bg: string }[] = [];
      let separators = 0;
      for (const card of cards) {
        for (const el of card.querySelectorAll("*")) {
          const cs = getComputedStyle(el);
          const m = cs.backgroundColor.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
          if (m) {
            const alpha = m[4] === undefined ? 1 : Number.parseFloat(m[4]);
            const isWhite = m[1] === "255" && m[2] === "255" && m[3] === "255";
            const radius = Number.parseFloat(cs.borderTopLeftRadius) || 0;
            const fs = Number.parseFloat(cs.fontSize) || 0;
            const pad = Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.paddingLeft);
            if (alpha > 0.05 && !isWhite && radius >= 6 && pad > 0 && fs <= 14) {
              pills.push({ text: (el.textContent || "").trim().slice(0, 20), bg: cs.backgroundColor });
            }
          }
          if (/factSeparator/.test(String(el.className))) separators += 1;
        }
      }
      const metaRows = [...document.querySelectorAll('[class*="factFooter"]')];
      const ruleRows = [...document.querySelectorAll('[class*="cardMetaRow"]')].filter(
        (el) => Number.parseFloat(getComputedStyle(el).borderTopWidth) >= 1,
      );
      const lead = document.querySelector('[class*="noteLead"]');
      const leadCs = lead ? getComputedStyle(lead) : null;
      const multiItemRows = metaRows.filter(
        (el) => el.querySelectorAll('[class*="factItem"]').length > 1,
      ).length;
      return {
        cards: cards.length,
        pills: pills.slice(0, 6),
        pillCount: pills.length,
        metaRows: metaRows.length,
        ruleRows: ruleRows.length,
        separators,
        multiItemRows,
        metaSample: (metaRows[0] as HTMLElement | undefined)?.innerText.replace(/\s+/g, " ").trim().slice(0, 160) ?? "",
        leadSize: leadCs?.fontSize ?? "",
        leadColor: leadCs?.color ?? "",
      };
    });

    console.log("TIMELINE PROBE:", JSON.stringify(probe, null, 2));

    expect(probe.cards, "event cards rendered").toBeGreaterThan(0);
    expect(probe.pillCount, `no coloured capsules inside card bodies: ${JSON.stringify(probe.pills)}`).toBe(0);
    expect(probe.metaRows, "one metadata row per card").toBeGreaterThan(0);
    expect(probe.ruleRows, "metadata row has a hairline rule").toBeGreaterThan(0);
    // A "·" only joins items once a card actually has more than one, so at least
    // the multi-item cards must show one.
    expect(probe.separators, "metadata items joined by ·").toBeGreaterThan(0);
    expect(probe.multiItemRows, "multi-item metadata rows exist in the fixture").toBeGreaterThan(0);
    expect(
      probe.separators >= probe.multiItemRows,
      `every multi-item row has a ·: separators=${probe.separators} multiItemRows=${probe.multiItemRows}`,
    ).toBe(true);
    expect(probe.leadSize, "body text 14px").toBe("14px");
    expect(probe.leadColor, "body ink #2C3630").toBe("rgb(44, 54, 48)");
  } finally {
    await db.$disconnect();
  }
});
