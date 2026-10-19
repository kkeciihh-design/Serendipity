import type { Locator, Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";
import { useUnavailableAI } from "./workspace-helpers";

test.beforeEach(async ({ page }) => useUnavailableAI(page));

const storageKey = "serendipity:home-gallery:v1";
const destinations = [
  { id: "jiuzhaigou", name: "九寨沟" },
  { id: "west-lake", name: "西湖" },
  { id: "li-river", name: "漓江" },
  { id: "hongcun", name: "宏村" },
  { id: "xiapu", name: "霞浦" },
];

function collectDraftPosts(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/trips") requests.push(request);
  });
  return requests;
}

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|did not match|Minified React error/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

async function expectLoadedPhoto(landscape: Locator) {
  const image = landscape.locator("img");
  await expect(image).toHaveCount(1);
  await expect(image).toBeVisible();
  const page = landscape.page();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  // Card photographs are intentionally lazy-loaded below the fold on mobile.
  // Exercise their real loading path, then return to the user's scroll position.
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((element) => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  })).toBe(true);
  await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y, behavior: "instant" }), scroll);
}

async function expectMode(page: Page, mode: "photo" | "sketch") {
  await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-aesthetic", mode);
  const hero = page.getByTestId("hero-landscape");
  const previews = page.getByTestId("sample-trip-preview");
  await expect(previews).toHaveCount(3);
  for (const landscape of [hero, previews.nth(0), previews.nth(1), previews.nth(2)]) {
    await expect(landscape).toHaveAttribute("data-aesthetic", mode);
    if (mode === "photo") await expectLoadedPhoto(landscape);
    else {
      await expect(landscape.locator("img")).toHaveCount(0);
      await expect(landscape.locator("svg")).toBeVisible();
    }
  }
  await expect(page.getByRole("button", { name: "实景画廊模式", exact: true })).toHaveAttribute("aria-pressed", String(mode === "photo"));
  await expect(page.getByRole("button", { name: "素描手账模式", exact: true })).toHaveAttribute("aria-pressed", String(mode === "sketch"));
}

test("服务端始终输出九寨沟实景，客户端恢复记忆且无水合错误", async ({ page, request }) => {
  const errors = collectBrowserErrors(page);
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ mode: "sketch", destinationId: "hongcun" }));
  }, { key: storageKey });

  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  const serverGallery = html.match(/<main\b[^>]*\bdata-testid="home-gallery"[^>]*>/)?.[0];
  expect(serverGallery).toBeDefined();
  expect(serverGallery).toContain('data-aesthetic="photo"');
  expect(serverGallery).toContain('data-destination="jiuzhaigou"');

  await page.goto("/");
  await expectMode(page, "sketch");
  await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination", "hongcun");
  await expect(page.getByTestId("destination-nameplate")).toContainText("宏村");
  await expect(page.getByTestId("trip-request-input")).toHaveValue("");
  expect(errors).toEqual([]);
});

test("双生模式同步替换首屏、样本与规划弹窗画境，并保留输入", async ({ page }) => {
  const posts = collectDraftPosts(page);
  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await expectMode(page, "photo");
  const input = page.getByTestId("trip-request-input");
  const original = "  保留我的杭州想法🌿\n第二天只去茶园，不赶路。  ";
  await input.fill(original);
  const card = page.getByTestId("sample-trip-card").first();
  const trigger = card.getByRole("button", { name: "查看完整规划：杭州两日轻松漫步", exact: true });
  const dialog = page.getByRole("dialog", { name: "杭州两日轻松漫步", exact: true });
  const cover = dialog.getByTestId("sample-trip-cover");
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(cover).toHaveAttribute("data-aesthetic", "photo");
  await expectLoadedPhoto(cover);
  await dialog.getByRole("button", { name: "关闭完整规划", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  await page.getByRole("button", { name: "素描手账模式", exact: true }).click();
  await expectMode(page, "sketch");
  await expect(input).toHaveValue(original);
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(cover).toHaveAttribute("data-aesthetic", "sketch");
  await expect(cover.locator("img")).toHaveCount(0);
  await expect(cover.locator("svg").first()).toBeVisible();
  await expect(dialog.getByTestId("sample-trip-details")).toBeVisible();
  await dialog.getByRole("button", { name: "关闭完整规划", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "偶遇下一处风景", exact: true }).click();
  await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination", "west-lake");
  await expect(input).toHaveValue(original);

  await page.getByRole("button", { name: "实景画廊模式", exact: true }).click();
  await expectMode(page, "photo");
  await expect(input).toHaveValue(original);
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(cover).toHaveAttribute("data-aesthetic", "photo");
  await expectLoadedPhoto(cover);
  await dialog.getByRole("button", { name: "关闭完整规划", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);
  expect(posts).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("五处风物志循环轮换，各自的旅行想法清错、聚焦且不会自动提交", async ({ page }) => {
  const posts = collectDraftPosts(page);
  await page.goto("/");
  const input = page.getByTestId("trip-request-input");
  const nameplate = page.getByTestId("destination-nameplate");
  const prompts = new Set<string>();
  const photoSources = new Set<string>();
  const sketches = new Set<string>();

  for (const destination of destinations) {
    await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination", destination.id);
    await expect(page.getByTestId("hero-landscape")).toHaveAttribute("data-destination", destination.id);
    await expect(nameplate).toContainText(destination.name);
    await expect(nameplate).toContainText(/[N北].*[E东]/);
    await expectLoadedPhoto(page.getByTestId("hero-landscape"));
    photoSources.add((await page.getByTestId("hero-landscape").locator("img").getAttribute("src"))!);

    await input.fill("   ");
    await page.getByTestId("create-trip-submit").click();
    await expect(page.getByTestId("trip-request-feedback")).toBeVisible();
    await nameplate.getByRole("button", { name: "以此地开启规划", exact: true }).click();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(new RegExp(destination.name));
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);
    const prompt = await input.inputValue();
    expect(Array.from(prompt).length).toBeGreaterThan(30);
    prompts.add(prompt);
    await expect(page.getByTestId("trip-character-count")).toHaveText(Array.from(prompt).length + " / 3000");

    await page.getByRole("button", { name: "素描手账模式", exact: true }).click();
    const sketch = page.getByTestId("hero-landscape").locator("svg");
    await expect(sketch).toBeVisible();
    sketches.add(await sketch.evaluate((element) => Array.from(element.querySelectorAll("path"), (path) => path.getAttribute("d")).join("\n")));
    await page.getByRole("button", { name: "实景画廊模式", exact: true }).click();
    await expect(input).toHaveValue(prompt);
    await page.getByRole("button", { name: "偶遇下一处风景", exact: true }).click();
  }

  expect(prompts.size).toBe(destinations.length);
  expect(photoSources.size).toBe(destinations.length);
  expect(sketches.size).toBe(destinations.length);
  await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination", "jiuzhaigou");
  await expect(page).toHaveURL(/\/$/);
  expect(posts).toHaveLength(0);
});

for (const scenario of [
  { width: 1440, height: 900, mode: "photo" },
  { width: 390, height: 844, mode: "sketch" },
] as const) {
  test(`${scenario.width}px 样本快捷规划关闭弹窗，并将对应需求带回首屏输入舱`, async ({ page }) => {
    const posts = collectDraftPosts(page);
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto("/");
    if (scenario.mode === "sketch") await page.getByRole("button", { name: "素描手账模式", exact: true }).click();
    const input = page.getByTestId("trip-request-input");
    const prompts = new Set<string>();

    for (const sample of [
      { title: "杭州两日轻松漫步", content: /杭州.*2 天 1 晚.*西湖.*法喜寺.*龙井/ },
      { title: "成都五日美食与周边", content: /成都.*5 天 4 晚.*人民公园.*都江堰.*三圣乡/ },
      { title: "青岛三日海岸线", content: /青岛.*3 天 2 晚.*信号山.*八大关.*栈桥/ },
    ]) {
      await input.fill("   ");
      await page.getByTestId("create-trip-submit").click();
      await expect(page.getByTestId("trip-request-feedback")).toBeVisible();
      await page.getByRole("button", { name: `查看完整规划：${sample.title}`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: sample.title, exact: true });
      const startPlanning = dialog.getByRole("button", { name: "以此样本开启规划", exact: true });
      await expect(dialog.getByTestId("sample-trip-cover")).toHaveAttribute("data-aesthetic", scenario.mode);
      await expect(startPlanning).toBeInViewport({ ratio: 1 });
      await dialog.getByRole("tab", { name: "预算与准备", exact: true }).click();
      await dialog.getByText("天气与备选", { exact: true }).scrollIntoViewIfNeeded();
      await expect(startPlanning).toBeInViewport({ ratio: 1 });
      await startPlanning.click();

      await expect(dialog).toHaveCount(0);
      await expect(input).toHaveValue(sample.content);
      await expect(input).toBeFocused();
      await expect(input).toBeInViewport({ ratio: 1 });
      await expect(input).toHaveAttribute("aria-invalid", "false");
      await expect(page.getByTestId("trip-request-feedback")).toHaveCount(0);
      await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-aesthetic", scenario.mode);
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
      const prompt = await input.inputValue();
      prompts.add(prompt);
      await expect(page.getByTestId("trip-character-count")).toHaveText(`${Array.from(prompt).length} / 3000`);
    }
    expect(prompts.size).toBe(3);
    expect(posts).toHaveLength(0);
    expect(errors).toEqual([]);
    await expect(page).toHaveURL(/\/$/);
  });
}

test("手动选择保存到本机，刷新后恢复最后的模式与目的地", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "素描手账模式", exact: true }).click();
  await page.getByRole("button", { name: "偶遇下一处风景", exact: true }).click();
  await page.getByRole("button", { name: "偶遇下一处风景", exact: true }).click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), storageKey))
    .toEqual({ mode: "sketch", destinationId: "li-river" });
  await page.reload();
  await expectMode(page, "sketch");
  await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination", "li-river");
  await expect(page.getByTestId("destination-nameplate")).toContainText("漓江");
});

test("保存期间的画境与目的地操作不会替换正在保存的原话或重复提交", async ({ page }) => {
  const posts = collectDraftPosts(page);
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  await page.route("**/api/trips", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    markStarted();
    await gate;
    await route.continue();
  });
  await page.goto("/");
  const input = page.getByTestId("trip-request-input");
  const original = "我的宏村摄影行程正在保存，请保留这句原话。";
  await input.fill(original);
  const saved = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/trips");
  await page.getByTestId("create-trip-submit").click();
  try {
    await started;
    await page.getByRole("button", { name: "素描手账模式", exact: true }).click();
    await page.getByRole("button", { name: "偶遇下一处风景", exact: true }).click();
    await page.getByRole("button", { name: "以此地开启规划", exact: true }).click();
    await page.getByRole("button", { name: "查看完整规划：杭州两日轻松漫步", exact: true }).click();
    const sampleDialog = page.getByRole("dialog", { name: "杭州两日轻松漫步", exact: true });
    await sampleDialog.getByRole("button", { name: "以此样本开启规划", exact: true }).click();
    await expect(sampleDialog).toHaveCount(0);
    await expect(input).toHaveValue(original);
    await expect(page.getByTestId("create-trip-submit")).toBeDisabled();
    expect(posts).toHaveLength(1);
    expect(posts[0].postDataJSON()).toEqual({ originalRequest: original });
  } finally {
    release();
  }
  const response = await saved;
  expect(response.status()).toBe(201);
  expect((await response.json()).trip.originalRequest).toBe(original);
  await expect(page).toHaveURL(/\/trips\/[^/?]+(?:\?|$)/);
  expect(posts).toHaveLength(1);
});

for (const saved of [
  { name: "损坏的 JSON", value: "{unreadable", mode: "photo", destinationId: "jiuzhaigou" },
  { name: "空记录", value: "null", mode: "photo", destinationId: "jiuzhaigou" },
  { name: "未知模式", value: JSON.stringify({ mode: "unknown", destinationId: "xiapu" }), mode: "photo", destinationId: "xiapu" },
  { name: "未知目的地", value: JSON.stringify({ mode: "sketch", destinationId: "missing" }), mode: "sketch", destinationId: "jiuzhaigou" },
] as const) {
  test(saved.name + "不会破坏首页，有效字段仍可恢复", async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: saved.value });
    await page.goto("/");
    await expectMode(page, saved.mode);
    await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination", saved.destinationId);
    await expect(page.getByTestId("trip-request-input")).toBeEditable();
    await page.getByRole("button", { name: "偶遇下一处风景", exact: true }).click();
    await expect(page.getByTestId("home-gallery")).not.toHaveAttribute("data-destination", saved.destinationId);
    expect(errors).toEqual([]);
  });
}

for (const failure of ["access", "write"] as const) {
  test((failure === "access" ? "浏览器禁用本地存储" : "本地存储写入配额耗尽") + "时仍可切换并填入想法", async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.addInitScript(({ failure }) => {
      if (failure === "access") {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() { throw new DOMException("Storage is unavailable", "SecurityError"); },
        });
      } else {
        Storage.prototype.setItem = () => { throw new DOMException("Storage is full", "QuotaExceededError"); };
      }
    }, { failure });
    await page.goto("/");
    await expectMode(page, "photo");
    await page.getByRole("button", { name: "素描手账模式", exact: true }).click();
    await expectMode(page, "sketch");
    await page.getByRole("button", { name: "偶遇下一处风景", exact: true }).click();
    await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination", "west-lake");
    await page.getByRole("button", { name: "以此地开启规划", exact: true }).click();
    await expect(page.getByTestId("trip-request-input")).toHaveValue(/西湖/);
    await expect(page.getByTestId("trip-request-input")).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("390px 移动端的两种画境均无横向溢出，输入与风物志操作在首屏可用", async ({ page }) => {
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  for (const mode of ["photo", "sketch"] as const) {
    await page.getByRole("button", { name: mode === "photo" ? "实景画廊模式" : "素描手账模式", exact: true }).click();
    await expectMode(page, mode);
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollY: window.scrollY,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.scrollY).toBe(0);
    for (const control of [
      page.getByTestId("trip-request-input"),
      page.getByTestId("create-trip-submit"),
      page.getByRole("button", { name: "以此地开启规划", exact: true }),
      page.getByRole("button", { name: "偶遇下一处风景", exact: true }),
      page.getByRole("button", { name: "实景画廊模式", exact: true }),
      page.getByRole("button", { name: "素描手账模式", exact: true }),
    ]) await expect(control).toBeInViewport({ ratio: 1 });

    const composer = await page.getByTestId("hero-composer").boundingBox();
    const nameplate = await page.getByTestId("destination-nameplate").boundingBox();
    expect(composer).not.toBeNull();
    expect(nameplate).not.toBeNull();
    expect(nameplate!.y).toBeGreaterThanOrEqual(composer!.y + composer!.height);
  }
});
