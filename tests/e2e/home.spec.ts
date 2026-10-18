import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";

const headline = "把旅行想法整理成能执行的计划";
const placeholder = "例如：我想 12 月初从北京去成都玩三天，两个人，预算 3000 元，喜欢美食和轻松的市区路线。";
const sampleDisclaimer = "展示样例：内容为人工编写，不包含实时价格、开放状态或预约信息。";
const initialFeedback = "保存后会在这里显示状态。空白、过长、重复点击或数据库写入失败都会有明确提示。";

function collectDraftPosts(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/trips") {
      requests.push(request);
    }
  });
  return requests;
}

test("首页保留标题、导航、表单可访问性与公开说明", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: headline, exact: true })).toHaveText(headline);
  await expect(page.getByRole("heading", { level: 2, name: "先看它要整理什么样的信息", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "用一句话开始一趟旅行", exact: true })).toBeVisible();

  for (const [name, href] of [
    ["开始创建旅行", "#trip-input"],
    ["查看展示样例", "#sample-trips"],
    ["我的旅行", "/trips"],
    ["运行状态", "/runtime"],
    ["个人设置", "/settings"],
  ]) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  }
  await expect(page.getByRole("link", { name: "个人设置", exact: true })).toHaveAttribute("title", "个人设置");

  const input = page.getByRole("textbox", { name: "旅行想法原话", exact: true });
  await expect(input).toBeEditable();
  await expect(input).toHaveAttribute("id", "trip-request");
  await expect(input).toHaveAttribute("name", "trip-request");
  await expect(page.getByPlaceholder(placeholder, { exact: true })).toHaveCount(1);
  await expect(input).toHaveAttribute("aria-describedby", "trip-request-hint trip-request-feedback");
  await expect(page.locator("#trip-request-feedback")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#trip-request-feedback")).toHaveText(initialFeedback);
  await expect(page.locator("#trip-request-feedback")).toBeVisible();
  await expect(page.locator("#trip-request-hint")).toHaveText("当前 0/3000 字；保存后仅创建原话草稿，不会解析需求或调用 AI。");
  await expect(input).toHaveAccessibleDescription(/当前 0\/3000 字.*保存后会在这里显示状态/);
  await expect(page.getByRole("button", { name: "填入示例", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "保存旅行草稿", exact: true })).toBeEnabled();

  for (const text of [
    "用一句或多句中文描述都可以；按 Enter 保存，按 Shift + Enter 换行。中文输入法选词时的 Enter 不会误提交。",
    "支持多行输入和粘贴",
    "以下是人工编写的展示样例，用来说明信息层级；它们不是 AI 实时生成，也不是你的个人旅行。",
    "先写下你的想法，应用会完整保留原话并保存到本机数据库。AI 只生成待确认的需求摘要，不会直接生成行程。",
    "首页图片：Chensiyuan，CC BY-SA 4.0，via Wikimedia Commons，2026-10-08 获取。",
  ]) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  const license = page.getByRole("link", { name: "查看图片许可", exact: true });
  await expect(license).toBeVisible();
  await expect(license).toHaveAttribute("href", "https://commons.wikimedia.org/wiki/File:1_jiuzhaigou_valley_wu_hua_hai_2011b.jpg");
});

test("三个城市样例保留原生展开、内容和始终可见的免责声明", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator("#sample-trips").getByRole("article");
  await expect(cards).toHaveCount(3);
  const samples = [
    { title: "杭州两日轻松漫步", city: "杭州", duration: "2 天 1 晚", count: 2, first: "第一天：西湖清晨环线、湖滨午餐、河坊街傍晚。" },
    { title: "成都五日美食与周边", city: "成都", duration: "5 天 4 晚", count: 2, first: "市区：人民公园、宽窄巷子、玉林社区晚餐。" },
    { title: "青岛三日海岸线", city: "青岛", duration: "3 天 2 晚", count: 3, first: "第一天：栈桥、小青岛、八大关步行路线。" },
  ];

  for (const [index, sample] of samples.entries()) {
    const card = cards.nth(index);
    await expect(card.getByRole("heading", { level: 3, name: sample.title, exact: true })).toBeVisible();
    await expect(card.getByText(sample.city, { exact: true })).toBeVisible();
    await expect(card.getByText(sample.duration, { exact: true })).toBeVisible();
    await expect(card.getByText(sampleDisclaimer, { exact: true })).toBeVisible();
    await expect(card.locator("details")).not.toHaveAttribute("open");
    const disclosure = card.getByText("查看样例内容", { exact: true });
    await disclosure.click();
    await expect(card.locator("details")).toHaveAttribute("open", "");
    await expect(card.getByRole("list")).toBeVisible();
    await expect(card.getByRole("listitem")).toHaveCount(sample.count);
    await expect(card.getByRole("listitem").first()).toHaveText(sample.first);
    await disclosure.click();
    await expect(card.locator("details")).not.toHaveAttribute("open");
    await expect(card.getByText(sampleDisclaimer, { exact: true })).toBeVisible();
  }
});

test("填入示例只填充原话并聚焦，字数按 Unicode 字符显示", async ({ page }) => {
  const posts = collectDraftPosts(page);
  await page.goto("/");
  const input = page.getByLabel("旅行想法原话", { exact: true });
  await page.getByRole("button", { name: "填入示例", exact: true }).click();
  await expect(input).toHaveValue("我想在 11 月中旬去杭州玩两天，从上海出发。\n两个人预算 1500 元，喜欢自然风景和老街，不想每天赶太多景点。\n第二天下午要返程，最好留出买特产和走到车站的时间。");
  await expect(input).toBeFocused();
  await expect(page.locator("#trip-request-feedback")).toHaveText("已填入示例。你可以直接修改内容，再保存为自己的旅行草稿。");

  await input.fill("杭州🌿\n散步");
  await expect(page.locator("#trip-request-hint")).toHaveText("当前 6/3000 字；保存后仅创建原话草稿，不会解析需求或调用 AI。");
  await expect(page).toHaveURL(/\/$/);
  expect(posts).toHaveLength(0);
});

test("Shift+Enter 和输入法 Enter 不保存，普通 Enter 原样保存多行草稿", async ({ page, request }) => {
  const posts = collectDraftPosts(page);
  await page.goto("/");
  const input = page.getByLabel("旅行想法原话", { exact: true });
  const firstLine = "首页键盘验收：杭州🌿";
  const secondLine = "  第二天去茶园，保留这段空格。  ";
  const originalRequest = `${firstLine}\n${secondLine}`;
  await input.fill(firstLine);
  await input.press("End");
  await input.press("Shift+Enter");
  await page.keyboard.insertText(secondLine);
  await expect(input).toHaveValue(originalRequest);
  await expect(page.locator("#trip-request-feedback")).toHaveText(initialFeedback);
  expect(posts).toHaveLength(0);

  await input.dispatchEvent("compositionstart", { data: "游" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true });
  await input.dispatchEvent("compositionend", { data: "游" });
  await expect(input).toHaveValue(originalRequest);
  await expect(page.getByRole("button", { name: "保存旅行草稿", exact: true })).toBeEnabled();
  await expect(page.locator("#trip-request-feedback")).toHaveText(initialFeedback);
  await expect(page).toHaveURL(/\/$/);
  expect(posts).toHaveLength(0);

  const saved = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/trips");
  await input.press("Enter");
  const response = await saved;
  expect(response.status()).toBe(201);
  const { trip } = await response.json() as { trip: { id: string; originalRequest: string } };
  expect(trip.originalRequest).toBe(originalRequest);
  expect(posts).toHaveLength(1);
  expect(posts[0].postDataJSON()).toEqual({ originalRequest });
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.locator(`a[href="/trips/${trip.id}"]`)).toBeVisible();
  const persisted = await request.get(`/api/trips/${trip.id}`);
  expect(persisted.status()).toBe(200);
  expect((await persisted.json()).trip.originalRequest).toBe(originalRequest);
});

for (const invalid of [
  { name: "空白", value: " \n\t ", feedback: "请先写下你的旅行想法。空格和换行不能作为完整输入。" },
  { name: "3001 字超长", value: "旅".repeat(3001), feedback: "内容过长：当前 3001 字，最多 3000 字。请缩短后再保存；已输入内容会保留。" },
]) {
  test(`${invalid.name}草稿在本页被拦截且保留输入`, async ({ page }) => {
    const posts = collectDraftPosts(page);
    await page.goto("/");
    const input = page.getByLabel("旅行想法原话", { exact: true });
    await input.fill(invalid.value);
    await page.getByRole("button", { name: "保存旅行草稿", exact: true }).click();
    await expect(page.locator("#trip-request-feedback")).toHaveText(invalid.feedback);
    await expect(page.locator("#trip-request-feedback")).toBeVisible();
    await expect(input).toHaveValue(invalid.value);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/$/);
    expect(posts).toHaveLength(0);
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`首页 ${viewport.width}px 无横向溢出、标题无孤字且创作表单可访问`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const title = page.getByRole("heading", { level: 1, name: headline, exact: true });
    await expect(title).toHaveText(headline);

    // Measure rendered glyphs, so a clipped or single-character line cannot pass
    // just because the heading's own bounding box fits inside the page.
    const glyphLayout = await title.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const lines: { top: number; text: string }[] = [];
      let left = Infinity;
      let right = -Infinity;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const value = node.textContent ?? "";
        let offset = 0;
        for (const character of value) {
          const nextOffset = offset + character.length;
          if (!/\s/.test(character)) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, nextOffset);
            const rect = range.getBoundingClientRect();
            left = Math.min(left, rect.left);
            right = Math.max(right, rect.right);
            const line = lines.find((candidate) => Math.abs(candidate.top - rect.top) < 2);
            if (line) line.text += character;
            else lines.push({ top: rect.top, text: character });
          }
          offset = nextOffset;
        }
      }
      return { lines: lines.sort((a, b) => a.top - b.top).map((line) => line.text), left, right };
    });
    expect(glyphLayout.lines.join("")).toBe(headline);
    expect(glyphLayout.lines.length).toBeGreaterThanOrEqual(1);
    expect(glyphLayout.lines.length).toBeLessThanOrEqual(2);
    for (const line of glyphLayout.lines) expect([...line].length).toBeGreaterThan(1);
    expect(glyphLayout.left).toBeGreaterThanOrEqual(0);
    expect(glyphLayout.right).toBeLessThanOrEqual(viewport.width);
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);

    const manifesto = page.locator("aside").filter({ hasText: "原话留存" });
    await expect(manifesto).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("complementary")).toHaveCount(0);
    const input = page.getByRole("textbox", { name: "旅行想法原话", exact: true });
    await expect(input).toHaveCount(1);
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
    await input.focus();
    await expect(input).toBeFocused();
    const inputBounds = await input.boundingBox();
    expect(inputBounds).not.toBeNull();
    expect(inputBounds!.x).toBeGreaterThanOrEqual(0);
    expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByRole("button", { name: "保存旅行草稿", exact: true })).toBeEnabled();
  });
}
