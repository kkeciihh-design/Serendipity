import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { Locator } from "@playwright/test";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";
import { test, expect } from "./fixtures";
import { controlledBasemap, expectCompanionBasemap } from "./basemap-helpers";
import { mockTimelineIntegrityAdvisories, seedTimelineIntegrityTrip } from "./timeline-integrity-helpers";

const directory = assertTestDataPath(path.resolve("test-data/e2e"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, "data/serendipity.db").replaceAll("\\", "/")}` } } });
const visitLabels = Array.from("①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳");
test.afterAll(async () => db.$disconnect());

async function expectUncompressedTimeline(timeline: Locator) {
  const rows = await timeline.evaluate((list) => Array.from(list.children, (row) => {
    const card = row.firstElementChild as HTMLElement;
    const main = card.querySelector<HTMLButtonElement>(":scope > button")!;
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, height: box.height, width: box.width };
    };
    const reminders = Array.from(card.querySelectorAll<HTMLButtonElement>(":scope > button"))
      .filter((button) => button.textContent?.startsWith("行程提醒："));
    const mainChildren = Array.from(main.querySelectorAll("span"), rect);
    return {
      id: row.id, level: row.getAttribute("data-timeline-level"), row: rect(row), card: rect(card), main: rect(main),
      mainChildren, mainClipped: main.scrollHeight > main.clientHeight + 1,
      children: Array.from(card.children, rect),
      reminders: reminders.map((button) => ({ ...rect(button), position: getComputedStyle(button).position, marginTop: Number.parseFloat(getComputedStyle(button).marginTop) })),
    };
  }));
  for (const [index, item] of rows.entries()) {
    expect(item.row.height, `${item.id}: row remains expanded`).toBeGreaterThan(44);
    expect(item.main.height, `${item.id}: readable main card`).toBeGreaterThan(item.level === "briefing" ? 40 : 90);
    expect(item.mainClipped, `${item.id}: main content is not clipped`).toBe(false);
    expect(item.card.top).toBeGreaterThanOrEqual(item.row.top - 1);
    expect(item.card.bottom).toBeLessThanOrEqual(item.row.bottom + 1);
    for (const child of item.mainChildren) {
      expect(child.top, `${item.id}: main content top`).toBeGreaterThanOrEqual(item.main.top - 1);
      expect(child.bottom, `${item.id}: main content bottom`).toBeLessThanOrEqual(item.main.bottom + 1);
      expect(child.left, `${item.id}: main content left`).toBeGreaterThanOrEqual(item.main.left - 1);
      expect(child.right, `${item.id}: main content right`).toBeLessThanOrEqual(item.main.right + 1);
    }
    for (const child of item.children) {
      expect(child.bottom, `${item.id}: child remains inside card`).toBeLessThanOrEqual(item.card.bottom + 1);
    }
    let previousBottom = item.main.bottom;
    for (const reminder of item.reminders) {
      expect(reminder.height, `${item.id}: reminder is readable`).toBeGreaterThan(25);
      expect(reminder.top, `${item.id}: reminder follows main and earlier reminders`).toBeGreaterThanOrEqual(previousBottom - 1);
      expect(reminder.bottom, `${item.id}: reminder is contained`).toBeLessThanOrEqual(item.card.bottom + 1);
      expect(["absolute", "fixed"], `${item.id}: reminder stays in document flow`).not.toContain(reminder.position);
      expect(reminder.marginTop).toBeGreaterThanOrEqual(0);
      previousBottom = reminder.bottom;
    }
    if (index > 0) expect(item.row.top, `${rows[index - 1].id} cannot overlap ${item.id}`).toBeGreaterThanOrEqual(rows[index - 1].row.bottom - 1);
  }
}

for (const width of [1600, 390, 320]) {
  test(`${width}px 杭州三日长备注与多条提醒不挤压白天行程，所有节点和地图序号一一对应`, async ({ page, request }) => {
    const seed = await seedTimelineIntegrityTrip(request, db);
    await page.setViewportSize({ width, height: 1000 });
    await controlledBasemap(page);
    await mockTimelineIntegrityAdvisories(page, seed);
    await page.goto(`/trips/${seed.tripId}`);
    await page.evaluate(() => document.fonts.ready);
    const timeline = page.getByRole("list", { name: "当日行程时间轴", exact: true });
    const companion = page.getByRole("complementary", { name: "当日伴随看板", exact: true });

    for (const day of [1, 2, 3]) {
      await page.getByRole("button", { name: new RegExp(`^第 ${day} 天｜`) }).click();
      const dayEvents = seed.events.filter((event) => event.dayNumber === day);
      await expect(timeline.locator(":scope > li")).toHaveCount(dayEvents.length);
      const morning = page.locator(`#timeline-event-integrity-d${day}-morning-sight`);
      await expect(morning.getByRole("button", { name: /^行程提醒：/ })).toHaveCount(3);
      await expect(timeline.locator('[data-timeline-level="briefing"]')).toHaveCount(day === 1 ? 2 : 0);
      const map = await expectCompanionBasemap(companion);
      await expect(map.locator(".serendipity-map-pin")).toHaveCount(dayEvents.length);
      await expect(timeline.getByTestId("timeline-visit-number")).toHaveText(visitLabels.slice(0, dayEvents.length));

      for (const [index, event] of dayEvents.entries()) {
        const row = page.locator(`#timeline-event-${event.id}`);
        await expect(row).toBeVisible();
        await expect(row.getByRole("button", { name: `第 ${index + 1} 项：${event.title}`, exact: true })).toBeVisible();
        const expectedLevel = ["integrity-d1-preparation", "integrity-d1-home-breakfast"].includes(event.id) ? "briefing" : "experience";
        await expect(row).toHaveAttribute("data-timeline-level", expectedLevel);
        await expect(row.getByTestId("timeline-visit-number")).toHaveText(visitLabels[index]);
        const pin = map.locator(`.serendipity-map-pin[title="${event.locationName}"]`);
        await expect(pin).toHaveCount(1);
        await expect(pin).toHaveText(visitLabels[index]);
      }
      await expect(page.locator(`#timeline-event-integrity-d${day}-breakfast`)).toContainText("07:30");
      await expect(page.locator(`#timeline-event-integrity-d${day}-morning-transfer`)).toContainText("08:00");
      await expect(page.locator(`#timeline-event-integrity-d${day}-late-sight`)).toContainText("17:15");
      await expect(page.locator(`#timeline-event-integrity-d${day}-dinner`)).toContainText("17:30");
      if (day < 3) await expect(page.locator(`#timeline-event-integrity-d${day}-hotel`)).toContainText(/入住酒店|返回酒店休息/);
      else await expect(page.locator("#timeline-event-integrity-d3-return")).toContainText("返程");
      await expectUncompressedTimeline(timeline);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(await db.planVersion.count({ where: { tripId: seed.tripId } })).toBe(1);
  });
}

test("时间轴与真实地图双向悬停只高亮、不打开编辑或跳动，点击选择同一站点", async ({ page, request }) => {
  const seed = await seedTimelineIntegrityTrip(request, db);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await controlledBasemap(page);
  await mockTimelineIntegrityAdvisories(page, seed);
  await page.goto(`/trips/${seed.tripId}`);
  const companion = page.getByRole("complementary", { name: "当日伴随看板", exact: true });
  const map = await expectCompanionBasemap(companion);
  const card = page.locator("#timeline-event-integrity-d1-morning-sight > div");
  const main = card.getByRole("button", { name: "第 6 项：柳浪闻莺湖畔漫步", exact: true });
  const pin = map.locator('.serendipity-map-pin[title="柳浪闻莺湖畔漫步"]');
  const otherCard = page.locator("#timeline-event-integrity-d1-late-sight > div");
  const otherPin = map.locator('.serendipity-map-pin[title="河坊街慢游"]');
  await main.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await main.hover();
  await expect(card).toHaveAttribute("data-highlighted", "true");
  await expect(pin).toHaveAttribute("data-highlighted", "true");
  await expect(pin).toHaveAttribute("data-selected", "false");
  await expect(page.locator("#plan-event-edit-title")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  await page.mouse.move(2, 2);
  await expect(pin).toHaveAttribute("data-highlighted", "false");
  await expect(card).toHaveAttribute("data-highlighted", "false");
  await otherPin.scrollIntoViewIfNeeded();
  const scrollBeforeMapHover = await page.evaluate(() => window.scrollY);
  await otherPin.hover();
  await expect(otherCard).toHaveAttribute("data-highlighted", "true");
  await expect(otherPin).toHaveAttribute("data-highlighted", "true");
  await expect(page.locator("#plan-event-edit-title")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeMapHover);

  await main.click();
  await expect(card).toHaveAttribute("data-selected", "true");
  await expect(pin).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("heading", { name: "编辑：柳浪闻莺湖畔漫步", exact: true })).toBeVisible();
  const popupClose = map.locator(".leaflet-popup-close-button");
  if (await popupClose.isVisible()) await popupClose.click();
  await otherPin.click();
  await expect(otherCard).toHaveAttribute("data-selected", "true");
  await expect(otherPin).toHaveAttribute("data-selected", "true");
  await expect(card).toHaveAttribute("data-selected", "false");
  await expect(pin).toHaveAttribute("data-selected", "false");
  await expect(page.getByRole("heading", { name: "编辑：河坊街慢游", exact: true })).toBeVisible();
  expect(await db.planVersion.count({ where: { tripId: seed.tripId } })).toBe(1);
});
