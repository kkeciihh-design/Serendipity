import { expect, test } from "./fixtures";
import { openRequirements, useUnavailableAI } from "./workspace-helpers";
import { requestFixture } from "../helpers/plan-fixtures";

test.beforeEach(async ({ page }) => useUnavailableAI(page));

const evidenceDirectory = "test-results/phase10r-responsive";

test("旅行列表与详情共用精简标题，原始想法只作为引文", async ({ page, request }) => {
  const originalRequest = "想去杭州西湖过一个3天的慢周末，两个人从上海出发，沿湖走走、喝茶、看看老街，不想把行程排得太满。";
  const created = await request.post("/api/trips", { data: { originalRequest } });
  expect(created.status()).toBe(201);
  const { trip } = await created.json();
  const snapshot = requestFixture(3, { destination: "杭州西湖", pace: "relaxed" });
  expect((await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } })).status()).toBe(200);
  expect((await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } })).status()).toBe(200);

  await page.goto(`/trips/${trip.id}`);
  const displayTitle = "杭州西湖 · 三日轻松漫游";
  await expect(page.getByRole("heading", { level: 1, name: displayTitle, exact: true })).toBeVisible();
  await page.goto("/trips");
  const card = page.locator(`article[data-trip-id="${trip.id}"]`);
  await expect(card.getByRole("heading", { name: displayTitle, exact: true })).toBeVisible();
  await expect(card.getByLabel("出发灵感")).toHaveText(`“${originalRequest}”`);
  await expect(card.getByRole("button", { name: `删除旅行：${displayTitle}`, exact: true })).toBeVisible();
  await card.getByRole("link", { name: "打开继续", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: displayTitle, exact: true })).toBeVisible();
});

test("列表删除可取消，只移除所选旅行且总数立即更新并跨刷新保留", async ({ page, request }) => {
  const removed = await request.post("/api/trips", { data: { originalRequest: "列表删除专属杭州草稿" } });
  const retained = await request.post("/api/trips", { data: { originalRequest: "列表删除保留成都草稿" } });
  expect(removed.status()).toBe(201);
  expect(retained.status()).toBe(201);
  const { trip } = await removed.json();
  const { trip: retainedTrip } = await retained.json();
  await page.goto("/trips");
  const card = page.locator(`article[data-trip-id="${trip.id}"]`);
  await expect(card).toBeVisible();
  const beforeCount = await page.getByRole("article").count();
  const deleteButton = card.getByRole("button", { name: /^删除旅行/ });
  const dialog = page.getByRole("alertdialog");
  await deleteButton.click();
  await expect(dialog).toContainText(trip.title);
  await expect(dialog.getByRole("button", { name: "保留旅行" })).toBeFocused();
  await dialog.getByRole("button", { name: "保留旅行" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(deleteButton).toBeFocused();
  expect((await request.get(`/api/trips/${trip.id}`)).status()).toBe(200);
  await expect(page.getByTestId("trip-collection-count")).toHaveText(`${String(beforeCount).padStart(2, "0")}趟旅行，等待出发`);

  await deleteButton.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(deleteButton).toBeFocused();
  await deleteButton.click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("trip-collection-count")).toHaveText(`${String(beforeCount - 1).padStart(2, "0")}趟旅行，等待出发`);
  await expect(page.locator(`article[data-trip-id="${retainedTrip.id}"]`)).toBeVisible();
  expect((await request.get(`/api/trips/${trip.id}`)).status()).toBe(404);
  expect((await request.get(`/api/trips/${retainedTrip.id}`)).status()).toBe(200);
  await page.reload();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("trip-collection-count")).toHaveText(`${String(beforeCount - 1).padStart(2, "0")}趟旅行，等待出发`);
});

test("列表删除失败时保留旅行与总数，可在同一确认框重试", async ({ page, request }) => {
  const created = await request.post("/api/trips", { data: { originalRequest: "删除失败重试专属草稿" } });
  expect(created.status()).toBe(201);
  const { trip } = await created.json();
  let shouldFail = true;
  await page.route(`**/api/trips/${trip.id}`, async (route) => {
    if (route.request().method() !== "DELETE" || !shouldFail) return route.continue();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "删除失败，数据库暂时不可写，请稍后重试。" }) });
  });
  await page.goto("/trips");
  const card = page.locator(`article[data-trip-id="${trip.id}"]`);
  await expect(card).toBeVisible();
  const beforeCount = await page.getByRole("article").count();
  await card.getByRole("button", { name: /^删除旅行/ }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("删除失败，数据库暂时不可写，请稍后重试。");
  await expect(card).toBeAttached();
  await expect(page.getByTestId("trip-collection-count")).toHaveText(`${String(beforeCount).padStart(2, "0")}趟旅行，等待出发`);
  expect((await request.get(`/api/trips/${trip.id}`)).status()).toBe(200);
  shouldFail = false;
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("trip-collection-count")).toHaveText(`${String(beforeCount - 1).padStart(2, "0")}趟旅行，等待出发`);
});

test("旅行可保存、打开、修改并跨刷新保留", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url?.endsWith("/request/extract")) {
      consoleErrors.push(
        `${message.location().url ?? "unknown-url"}: ${message.text()}`,
      );
    }
  });

  const originalText = `杭州两日轻松漫步
两个人预算 1500 元，喜欢自然风景和老街。`;

  await page.goto("/");
  await page.locator("#trip-request").fill(originalText);
  await page.getByTestId("create-trip-submit").click();

  await expect(page).toHaveURL(/\/trips\/[^/?]+\?/);
  await expect(
    page.getByRole("heading", { name: "杭州两日轻松漫步", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#trip-request-original")).toHaveValue(originalText);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "杭州两日轻松漫步", exact: true }),
  ).toBeVisible();

  await expect(page.locator("#trip-request-original")).toHaveValue(originalText);

  await expect(page.locator("#trip-title")).not.toBeVisible();
  await expect(page.locator("#trip-request-original")).not.toBeVisible();
  await page.getByRole("button", { name: /^修改旅行标题/ }).click();
  await openRequirements(page);
  await page.locator("#trip-title").fill("杭州两日修改版");
  await page
    .locator("#trip-request-original")
    .fill(`${originalText}\n第二天下午要返程。`);
  await page.getByRole("button", { name: "保存标题" }).click();
  await expect(page.getByText("标题已保存；这不会改变需求修订或确认状态。")).toBeVisible();

  await page.getByRole("button", { name: "保存需求修订" }).click();
  await expect(
    page.getByText(/需求修订 2 已保存，需要重新确认/),
  ).toBeVisible();

  await expect(page.getByText("标题未保存")).toHaveCount(0);

  await page.reload();
  await expect(page.locator("#trip-title")).toHaveValue("杭州两日修改版");
  await expect(page.locator("#trip-request-original")).toHaveValue(
    `${originalText}\n第二天下午要返程。`,
  );

  expect(consoleErrors).toEqual([]);
});

test("确认删除只删除当前旅行", async ({ page }) => {
  await page.goto("/");
  await page.locator("#trip-request").fill("成都三日美食与周边");
  await page.getByTestId("create-trip-submit").click();
  await expect(page).toHaveURL(/\/trips\/[^/?]+\?/);

  await page.goto("/");
  await page.locator("#trip-request").fill("青岛三日海岸线");
  await page.getByTestId("create-trip-submit").click();
  await expect(page).toHaveURL(/\/trips\/[^/?]+\?/);
  await page.goto("/trips");

  await page
    .getByRole("article")
    .filter({ hasText: "成都三日美食与周边" })
    .getByRole("link", { name: "打开继续" })
    .click();

  await page.getByRole("button", { name: /^修改旅行标题/ }).click();
  await page.getByRole("button", { name: "删除旅行" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();

  const confirmInput = page.getByLabel("输入旅行名称确认删除");
  await confirmInput.fill("青岛三日海岸线");
  await expect(
    page.getByRole("button", { name: "确认删除" }),
  ).toBeDisabled();

  await confirmInput.fill("成都三日美食与周边");
  await page.getByRole("button", { name: "确认删除" }).click();

  await expect(page).toHaveURL(/\/trips$/);
  await expect(
    page.getByText("成都三日美食与周边"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "青岛三日海岸线" }),
  ).toBeVisible();
});

test("R30-09 标题保存响应保留等待期间的新输入，后续保存可刷新读取", async ({ page, request }) => {
  const created = await request.post("/api/trips", { data: { originalRequest: "标题保存竞态隔离回归" } });
  expect(created.status()).toBe(201);
  const { trip } = await created.json();
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("button", { name: /^修改旅行标题/ }).click();
  const input = page.locator("#trip-title");
  let release!: () => void;
  let saved!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const written = new Promise<void>((resolve) => { saved = resolve; });
  await page.route(`**/api/trips/${trip.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    saved();
    await gate;
    await route.fulfill({ response });
  });
  await input.fill("第一版标题");
  await page.getByRole("button", { name: "保存标题", exact: true }).click();
  try {
    await written;
    await expect(input).toBeEditable();
    await input.fill("保存期间继续输入的新标题");
  } finally { release(); }
  await expect(page.getByRole("heading", { name: "第一版标题", exact: true })).toBeVisible();
  await expect(input).toHaveValue("保存期间继续输入的新标题");
  await expect(page.getByText("标题未保存", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存标题", exact: true })).toBeEnabled();
  expect((await (await request.get(`/api/trips/${trip.id}`)).json()).trip.title).toBe("第一版标题");
  await page.getByRole("button", { name: "保存标题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "保存期间继续输入的新标题", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存标题", exact: true })).toBeDisabled();
  await page.reload();
  await expect(input).toHaveValue("保存期间继续输入的新标题");
});

test("写入失败不显示已保存也不清空输入", async ({ page }) => {
  await page.route("**/api/trips", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "保存失败：数据库暂时不可写。你输入的内容没有丢，请稍后重试。",
      }),
    });
  });

  const failedText = "这趟旅行保存失败时必须保留原话。";
  await page.goto("/");
  await page.locator("#trip-request").fill(failedText);
  await page.getByTestId("create-trip-submit").click();

  await expect(page.getByText("保存失败：数据库暂时不可写。")).toBeVisible();
  await expect(page.locator("#trip-request")).toHaveValue(failedText);
  await expect(page).toHaveURL(/\/$/);
});

test("响应式布局可读且无横向溢出", async ({ page }) => {
  const viewports = [
    { name: "手机", width: 390, height: 844 },
    { name: "平板", width: 768, height: 1024 },
    { name: "桌面", width: 1440, height: 900 },
  ] as const;

  await page.goto("/");
  await page.locator("#trip-request").fill("响应式布局专属两日漫步");
  await page.getByTestId("create-trip-submit").click();
  await expect(page).toHaveURL(/\/trips\/[^/?]+\?/);

  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/trips");

    const layout = await page.evaluate(() => {
      const element = document.documentElement;
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    await page.screenshot({
      path: `${evidenceDirectory}/阶段-03-列表-${viewport.name}-${viewport.width}px.png`,
      fullPage: true,
    });

    await page
      .getByRole("article")
      .filter({ hasText: "响应式布局专属两日漫步" })
      .getByRole("link", { name: "打开继续" })
      .click();
    await expect(page.getByTestId("compact-trip-header")).toBeVisible();
    await expect(page.locator("#trip-title")).not.toBeVisible();
    await expect(page.locator("#request-destination")).not.toBeVisible();
    await page.screenshot({
      path: `${evidenceDirectory}/阶段-03-详情-${viewport.name}-${viewport.width}px.png`,
      fullPage: true,
    });
  }
});

test("未生成的旅行即使携带旧版编辑与超时参数，也只在主动点击后展开需求", async ({ page, request }) => {
  const created = await request.post("/api/trips", { data: { originalRequest: "我想在十一月去杭州玩两天，从上海出发。" } });
  expect(created.status()).toBe(201);
  const { trip } = await created.json();
  await page.goto(`/trips/${trip.id}?editRequirements=1&planningNotice=${encodeURIComponent("生成超时，请重试。")}`);
  const toggle = page.getByRole("button", { name: "修改需求 / 重新生成", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#request-destination")).not.toBeVisible();
  await expect(page.locator("#trip-title")).not.toBeVisible();
  await toggle.click();
  await expect(page.locator("#request-destination")).toBeVisible();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#request-destination")).not.toBeVisible();
});

test("新建旅行锚点、首页样本与 404 返回路径仍可用", async ({ page }) => {
  await page.goto("/trips");
  await page.getByRole("link", { name: "新建旅行", exact: true }).click();
  await expect(page).toHaveURL(/\/#trip-input$/);
  await expect(page.getByTestId("hero-composer")).toBeInViewport();
  await expect(page.locator("#trip-request")).toBeEditable();

  await page.goto("/");
  const firstSample = page.getByTestId("sample-trip-card").first();
  await firstSample.getByRole("button", { name: /查看完整规划/ }).click();
  await expect(page.getByRole("dialog").getByTestId("sample-trip-details")).toBeVisible();

  await page.goto("/missing");
  await expect(
    page.getByRole("heading", { name: "没有找到这个页面" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回首页" }).click();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});
