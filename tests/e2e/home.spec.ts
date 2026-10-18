import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";

const headline = "从一句向往出发，把心之所向写成笃定的旅程";
const headlineLines = ["从一句向往出发", "把心之所向写成笃定的旅程"];
const placeholder = "想去哪里走走？比如：12月初和伴侣去成都待三天，预算 3000 元，偏爱地道小馆与不赶路的市区漫步……";
const sampleDisclaimer = "* 以下为内置精选样本，展示行程结构与核验维度";
const quickPrompts = [
  "12月初去成都玩三天，两个人，预算3000元",
  "周末去杭州住一晚，想绕西湖安静走走",
  "青岛三天两晚看海，喜欢老建筑和海鲜",
];

function collectDraftPosts(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/trips") {
      requests.push(request);
    }
  });
  return requests;
}

test("首页以首屏输入舱开始，保留导航、可访问说明与图片许可", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: headline, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "一趟好旅行，当有清晰的脉络", exact: true })).toBeVisible();
  await expect(page.getByText("个人旅行规划工作室", { exact: true })).toBeVisible();
  await expect(page.getByText("写下你想去的地方、同行的人与偏爱的节奏——路线推演、预算精算与时刻接驳，皆在你的本机妥帖排布。", { exact: true })).toBeVisible();

  for (const [name, href] of [
    ["我的旅行", "/trips"],
    ["运行状态", "/runtime"],
    ["个人设置", "/settings"],
  ]) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  }
  await expect(page.getByRole("link", { name: "个人设置", exact: true })).toHaveAttribute("title", "个人设置");

  const composer = page.getByTestId("hero-composer");
  const input = composer.getByRole("textbox", { name: "开始一段新旅程", exact: true });
  await expect(composer).toHaveCount(1);
  await expect(input).toBeEditable();
  await expect(input).toHaveAttribute("id", "trip-request");
  await expect(input).toHaveAttribute("name", "trip-request");
  await expect(page.getByPlaceholder(placeholder, { exact: true })).toHaveCount(1);
  await expect(input).toHaveAccessibleDescription(/Enter 开启规划.*Shift \+ Enter 换行.*100% 本机私密存储/);
  await expect(page.getByTestId("trip-character-count")).toHaveText("0 / 3000");
  await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);
  await expect(composer.getByRole("alert")).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "填入灵感示例", exact: true })).toBeEnabled();
  await expect(page.getByTestId("create-trip-submit")).toHaveAccessibleName(/开启旅程规划/);
  await expect(page.getByTestId("create-trip-submit")).toBeEnabled();

  await expect(page.getByText("从每日动线、交通接驳到待核实的门票细节，翻阅三份精选样本，感受旅途如何被井然梳理。", { exact: true })).toBeVisible();
  await expect(page.getByText(sampleDisclaimer, { exact: true })).toBeVisible();
  const license = page.getByRole("link", { name: "查看图片许可", exact: true });
  await expect(license).toBeVisible();
  await expect(license).toHaveAttribute("href", "https://commons.wikimedia.org/wiki/File:1_jiuzhaigou_valley_wu_hua_hai_2011b.jpg");
});

test("顶部导航继续打开旅行列表、运行状态与设置", async ({ page }) => {
  const destinations = [
    { name: "我的旅行", path: "/trips", heading: "我的旅行" },
    { name: "运行状态", path: "/runtime", heading: "运行状态与数据" },
    { name: "个人设置", path: "/settings", heading: "AI 服务与旅行数据" },
  ];
  for (const destination of destinations) {
    await page.goto("/");
    await page.getByRole("link", { name: destination.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(destination.path + "$"));
    await expect(page.getByRole("heading", { level: 1, name: destination.heading, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "返回首页", exact: true }).click();
    await expect(page.getByTestId("hero-composer")).toBeVisible();
  }
});

test("三份精选样本在原页打开完整规划卡片，逐日行程与出行准备均可阅读", async ({ page }) => {
  await page.goto("/");
  const originalUrl = page.url();
  const cards = page.getByTestId("sample-trip-card");
  await expect(cards).toHaveCount(3);
  const samples = [
    {
      title: "杭州两日轻松漫步",
      duration: "2 天 1 晚",
      days: 2,
      description: "西湖晨雾与南山茶事 · 适合初次造访、偏爱少折返慢节奏的你",
      preview: ["Day 1", "湖滨漫步", "法喜寺寻幽", "Day 2", "龙井问茶"],
    },
    {
      title: "成都五日美食与周边",
      duration: "5 天 4 晚",
      days: 5,
      description: "街巷烟火与川西林盘 · 兼顾老城慢逛与一日近郊的松弛排布",
      preview: ["Day 1", "少城茶叙", "锦江夜游", "Day 3", "都江堰寻古"],
    },
    {
      title: "青岛三日海岸线",
      duration: "3 天 2 晚",
      days: 3,
      description: "红瓦老城与礁石海风 · 在山海栈道与百年街区之间从容漫游",
      preview: ["Day 1", "信号山俯瞰", "琴屿路日落", "Day 2", "八大关漫游"],
    },
  ];

  for (const [index, sample] of samples.entries()) {
    const card = cards.nth(index);
    await expect(card.getByRole("heading", { level: 3, name: sample.title, exact: true })).toBeVisible();
    await expect(card.getByText(sample.duration, { exact: true })).toBeVisible();
    await expect(card.getByText(sample.description, { exact: true })).toBeVisible();
    for (const stop of sample.preview) await expect(card.getByTestId("sample-trip-preview")).toContainText(stop);
    const trigger = card.getByRole("button", { name: "查看完整规划：" + sample.title, exact: true });
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await expect(card.getByText("查看完整规划", { exact: true })).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    const cardBefore = await card.boundingBox();
    // Click the photograph rather than the footer to exercise the whole-card target.
    await trigger.click({ position: { x: 30, y: 30 } });
    const dialog = page.getByRole("dialog", { name: sample.title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(originalUrl);
    await expect(dialog.getByTestId("sample-trip-details")).toBeVisible();
    const cardAfter = await card.boundingBox();
    expect(cardBefore).not.toBeNull();
    expect(cardAfter).not.toBeNull();
    expect(cardAfter!.height).toBeCloseTo(cardBefore!.height, 0);
    expect(cardAfter!.width).toBeCloseTo(cardBefore!.width, 0);

    const sections = dialog.getByRole("tablist", { name: "规划内容", exact: true });
    await expect(sections.getByRole("tab", { name: "每日行程", exact: true })).toHaveAttribute("aria-selected", "true");
    const days = dialog.getByRole("tablist", { name: "选择行程日期", exact: true });
    await expect(days.getByRole("tab")).toHaveCount(sample.days);
    for (let day = 1; day <= sample.days; day += 1) {
      const dayName = new RegExp("^Day " + day + "\\b");
      const dayTab = days.getByRole("tab", { name: dayName });
      await dayTab.click();
      await expect(dayTab).toHaveAttribute("aria-selected", "true");
      const dayPanel = dialog.getByRole("tabpanel", { name: dayName });
      await expect(dayPanel).toBeVisible();
      await expect(dayPanel).toContainText(/\b\d{1,2}:\d{2}\b/);
      expect(await dayPanel.getByRole("listitem").count()).toBeGreaterThanOrEqual(3);
      if (day > 1) await expect(dialog.getByRole("tabpanel", { name: new RegExp("^Day " + (day - 1) + "\\b") })).not.toBeVisible();
    }

    await sections.getByRole("tab", { name: "交通与住宿", exact: true }).click();
    for (const heading of ["交通接驳", "门票核验", "住宿建议"]) {
      await expect(dialog.getByText(heading, { exact: true })).toBeVisible();
    }
    await sections.getByRole("tab", { name: "预算与准备", exact: true }).click();
    // Switching panels must not let scroll anchoring tuck the budget under the sticky tabs.
    await expect.poll(async () => {
      const tabBounds = await sections.boundingBox();
      const headingBounds = await dialog.getByRole("heading", { name: "预算参考", exact: true }).boundingBox();
      return Boolean(tabBounds && headingBounds && headingBounds.y >= tabBounds.y + tabBounds.height);
    }).toBe(true);
    for (const heading of ["预算参考", "行前清单", "天气与备选"]) {
      await expect(dialog.getByText(heading, { exact: true })).toBeVisible();
    }
    await dialog.getByRole("button", { name: "关闭完整规划", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(originalUrl);
    await expect(page.getByText(sampleDisclaimer, { exact: true })).toBeVisible();
  }
});

test("完整规划支持键盘切换，焦点留在卡片窗口内且 Escape 返回原样本", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "查看完整规划：杭州两日轻松漫步", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "杭州两日轻松漫步", exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  const dayTabs = dialog.getByRole("tablist", { name: "选择行程日期", exact: true });
  await dayTabs.getByRole("tab", { name: /^Day 1\b/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dayTabs.getByRole("tab", { name: /^Day 2\b/ })).toBeFocused();
  await expect(dayTabs.getByRole("tab", { name: /^Day 2\b/ })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tabpanel", { name: /^Day 2\b/ })).toBeVisible();

  const sections = dialog.getByRole("tablist", { name: "规划内容", exact: true });
  await sections.getByRole("tab", { name: "每日行程", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(sections.getByRole("tab", { name: "交通与住宿", exact: true })).toBeFocused();
  await expect(sections.getByRole("tab", { name: "交通与住宿", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByText("住宿建议", { exact: true })).toBeVisible();

  // Traverse beyond a full cycle in each direction; background controls must stay inert.
  const controls = await dialog.locator('button, a[href], input, select, textarea, [tabindex="0"]').count();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let step = 0; step < controls + 2; step += 1) {
      await page.keyboard.press(key);
      await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 540, height: 900 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
  test("完整规划在 " + viewport.width + "px 可完整阅读，关闭遮罩后恢复页面滚动", async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const originalUrl = page.url();
    const trigger = page.getByRole("button", { name: "查看完整规划：成都五日美食与周边", exact: true });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "成都五日美食与周边", exact: true });
    await expect(dialog).toBeVisible();
    const scrollAtOpen = await page.evaluate(() => window.scrollY);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await expect(dialog.getByRole("button", { name: "关闭完整规划", exact: true })).toBeInViewport({ ratio: 1 });

    const dayTabs = dialog.getByRole("tablist", { name: "选择行程日期", exact: true });
    await dayTabs.getByRole("tab", { name: /^Day 5\b/ }).click();
    const lastDay = dialog.getByRole("tabpanel", { name: /^Day 5\b/ });
    await expect(lastDay).toBeVisible();
    const finalStop = lastDay.getByRole("listitem").last();
    await finalStop.scrollIntoViewIfNeeded();
    await expect(finalStop).toBeInViewport();

    await dialog.getByRole("tab", { name: "预算与准备", exact: true }).click();
    const alternatives = dialog.getByText("天气与备选", { exact: true });
    await alternatives.scrollIntoViewIfNeeded();
    await expect(alternatives).toBeInViewport();
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    const dialogLayout = await dialog.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(dialogLayout.scrollWidth).toBeLessThanOrEqual(dialogLayout.width);

    // A wheel over the backdrop cannot move the page behind the open itinerary.
    await page.mouse.move(1, 1);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollAtOpen);
    await page.mouse.click(1, 1);
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(originalUrl);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollAtOpen);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrollAtOpen);
  });
}

test("填入灵感示例只填充原话并聚焦，字数按 Unicode 字符显示", async ({ page }) => {
  const posts = collectDraftPosts(page);
  await page.goto("/");
  const input = page.getByTestId("trip-request-input");
  await page.getByRole("button", { name: "填入灵感示例", exact: true }).click();
  await expect(input).toHaveValue("我想在 11 月中旬去杭州玩两天，从上海出发。\n两个人预算 1500 元，喜欢自然风景和老街，不想每天赶太多景点。\n第二天下午要返程，最好留出买特产和走到车站的时间。");
  await expect(input).toBeFocused();
  await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);

  await input.fill("杭州🌿\n散步");
  await expect(page.getByTestId("trip-character-count")).toHaveText("6 / 3000");
  await expect(page).toHaveURL(/\/$/);
  expect(posts).toHaveLength(0);
});

test("三枚快捷灵感胶囊准确填入、清除旧错误且不会自动提交", async ({ page }) => {
  const posts = collectDraftPosts(page);
  await page.goto("/");
  const input = page.getByTestId("trip-request-input");
  const prompts = page.getByTestId("quick-prompt");
  await expect(prompts).toHaveCount(3);
  await page.getByTestId("create-trip-submit").click();
  await expect(page.getByTestId("trip-request-feedback")).toBeVisible();

  for (const [index, prompt] of quickPrompts.entries()) {
    await expect(prompts.nth(index)).toContainText(prompt);
    await prompts.nth(index).click();
    await expect(input).toHaveValue(prompt);
    await expect(input).toBeFocused();
    await expect(page.getByTestId("trip-character-count")).toHaveText(Array.from(prompt).length + " / 3000");
    await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-invalid", "false");
  }
  await expect(page).toHaveURL(/\/$/);
  expect(posts).toHaveLength(0);
});

test("Shift+Enter 与输入法候选确认不保存，普通 Enter 原样保存多行草稿", async ({ page, request }) => {
  const posts = collectDraftPosts(page);
  await page.goto("/");
  const input = page.getByTestId("trip-request-input");
  const firstLine = "首页键盘验收：杭州🌿";
  const secondLine = "  第二天去茶园，保留这段空格。  ";
  const originalRequest = firstLine + "\n" + secondLine;
  await input.fill(firstLine);
  await input.press("End");
  await input.press("Shift+Enter");
  await page.keyboard.insertText(secondLine);
  await expect(input).toHaveValue(originalRequest);
  await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);
  expect(posts).toHaveLength(0);

  await input.dispatchEvent("compositionstart", { data: "游" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true });
  // Some IMEs omit isComposing on the candidate-confirmation event.
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: false, bubbles: true, cancelable: true });
  await input.dispatchEvent("compositionend", { data: "游" });
  // Safari/legacy IMEs identify candidate confirmation with keyCode 229.
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, bubbles: true, cancelable: true });
  await expect(input).toHaveValue(originalRequest);
  await expect(page.getByTestId("create-trip-submit")).toBeEnabled();
  await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);
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
  await expect(page.locator('a[href="/trips/' + trip.id + '"]')).toBeVisible();
  const persisted = await request.get("/api/trips/" + trip.id);
  expect(persisted.status()).toBe(200);
  expect((await persisted.json()).trip.originalRequest).toBe(originalRequest);
});

for (const invalid of [
  { name: "空白", value: " \n\t ", feedback: "请先写下你的旅行想法。空格和换行不能作为完整输入。" },
  { name: "3001 字超长", value: "旅".repeat(3001), feedback: "内容过长：当前 3001 字，最多 3000 字。请缩短后再保存；已输入内容会保留。" },
]) {
  test(invalid.name + "仅在提交后显示错误并保留原话，重新输入后清除", async ({ page }) => {
    const posts = collectDraftPosts(page);
    await page.goto("/");
    const input = page.getByTestId("trip-request-input");
    await input.fill(invalid.value);
    await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);
    await page.getByTestId("create-trip-submit").click();
    const feedback = page.getByTestId("trip-request-feedback");
    await expect(feedback).toHaveAttribute("role", "alert");
    await expect(feedback).toHaveText(invalid.feedback);
    await expect(feedback).toBeVisible();
    await expect(input).toHaveValue(invalid.value);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(new RegExp(invalid.feedback));
    await expect(page).toHaveURL(/\/$/);
    expect(posts).toHaveLength(0);

    await input.fill("周末去杭州走走");
    await expect(feedback).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-invalid", "false");
    expect(posts).toHaveLength(0);
  });
}

test("移动端浮动错误提示可关闭且不遮挡输入", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const input = page.getByTestId("trip-request-input");
  await input.fill("  ");
  await page.getByTestId("create-trip-submit").click();
  const feedback = page.getByTestId("trip-request-feedback");
  await expect(feedback).toBeInViewport({ ratio: 1 });
  await feedback.getByRole("button", { name: "关闭提示", exact: true }).click();
  await expect(feedback).toHaveCount(0);
  await expect(input).toHaveValue("  ");
  await expect(input).toBeEditable();
});

test("网络失败保留输入并允许重新提交", async ({ page }) => {
  await page.route("**/api/trips", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.abort("failed");
  });
  await page.goto("/");
  const input = page.getByTestId("trip-request-input");
  const originalRequest = "断网时也要保留我的青岛海岸线想法";
  await input.fill(originalRequest);
  await page.getByTestId("create-trip-submit").click();
  await expect(page.getByTestId("trip-request-feedback")).toBeVisible();
  await expect(input).toHaveValue(originalRequest);
  await expect(input).toBeFocused();
  await expect(page.getByTestId("create-trip-submit")).toBeEnabled();
  await expect(page).toHaveURL(/\/$/);

  await page.unroute("**/api/trips");
  const saved = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/trips");
  await page.getByTestId("create-trip-submit").click();
  expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(/\/trips$/);
});

test("保存期间重复提交只写入一份旅行草稿", async ({ page }) => {
  const posts = collectDraftPosts(page);
  let release!: () => void;
  let requestStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route("**/api/trips", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requestStarted();
    await gate;
    await route.continue();
  });
  await page.goto("/");
  const input = page.getByTestId("trip-request-input");
  await input.fill("仅保存一次的杭州周末漫步");
  const saved = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/trips");
  await page.getByTestId("create-trip-submit").click();
  try {
    await started;
    await expect(page.getByTestId("create-trip-submit")).toBeDisabled();
    await input.press("Enter");
    await page.getByTestId("hero-composer").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await expect(input).toHaveValue("仅保存一次的杭州周末漫步");
    expect(posts).toHaveLength(1);
  } finally {
    release();
  }
  expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(/\/trips$/);
  expect(posts).toHaveLength(1);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test("首页 " + viewport.width + "px 首屏可直接输入提交、标题无孤字且无横向溢出", async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const title = page.getByRole("heading", { level: 1, name: headline, exact: true });

    // Measure rendered glyphs so clipped text and one-character lines cannot
    // pass merely because the heading's bounding box fits inside the page.
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
    expect(glyphLayout.lines.join("")).toBe(headlineLines.join(""));
    if (viewport.width >= 1024) expect(glyphLayout.lines).toEqual(headlineLines);
    for (const line of glyphLayout.lines) expect([...line].length).toBeGreaterThan(1);
    expect(glyphLayout.left).toBeGreaterThanOrEqual(0);
    expect(glyphLayout.right).toBeLessThanOrEqual(viewport.width);
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollY: window.scrollY,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.scrollY).toBe(0);

    const input = page.getByRole("textbox", { name: "开始一段新旅程", exact: true });
    const submit = page.getByTestId("create-trip-submit");
    await expect(input).toHaveCount(1);
    await expect(input).toBeEditable();
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    for (const control of [input, submit]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    }
    await input.focus();
    await expect(input).toBeFocused();
    await expect(submit).toBeEnabled();
  });
}
