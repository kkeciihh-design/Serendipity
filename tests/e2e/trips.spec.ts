import { expect, test } from "@playwright/test";

const evidenceDirectory = "docs/阶段验收/证据";

test("旅行可保存、打开、修改并跨刷新保留", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(
        `${message.location().url ?? "unknown-url"}: ${message.text()}`,
      );
    }
  });

  const originalText = `杭州两日轻松漫步
两个人预算 1500 元，喜欢自然风景和老街。`;

  await page.goto("/");
  await page.locator("#trip-request").fill(originalText);
  await page.getByRole("button", { name: "保存旅行草稿" }).click();

  await expect(page).toHaveURL(/\/trips$/);
  await expect(
    page.getByRole("heading", { name: "杭州两日轻松漫步" }),
  ).toBeVisible();
  await expect(page.getByText("两个人预算 1500 元")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "杭州两日轻松漫步" }),
  ).toBeVisible();

  await page
    .getByRole("article")
    .filter({ hasText: "杭州两日轻松漫步" })
    .getByRole("link", { name: "打开继续" })
    .click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(page.locator("#trip-request-original")).toHaveValue(originalText);

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
  await page.getByRole("button", { name: "保存旅行草稿" }).click();
  await expect(page).toHaveURL(/\/trips$/);

  await page.goto("/");
  await page.locator("#trip-request").fill("青岛三日海岸线");
  await page.getByRole("button", { name: "保存旅行草稿" }).click();
  await expect(page).toHaveURL(/\/trips$/);

  await page
    .getByRole("article")
    .filter({ hasText: "成都三日美食与周边" })
    .getByRole("link", { name: "打开继续" })
    .click();

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
  await page.getByRole("button", { name: "保存旅行草稿" }).click();

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
  await page.getByRole("button", { name: "保存旅行草稿" }).click();
  await expect(page).toHaveURL(/\/trips$/);

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
    await expect(page.locator("#trip-title")).toBeVisible();
    await page.screenshot({
      path: `${evidenceDirectory}/阶段-03-详情-${viewport.name}-${viewport.width}px.png`,
      fullPage: true,
    });
  }
});

test("受影响的首页与 404 旧功能仍可用", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "开始创建旅行" }).click();
  await expect(page.locator("#trip-input")).toBeInViewport();

  await page.getByRole("link", { name: "查看展示样例" }).click();
  await expect(page).toHaveURL(/#sample-trips$/);

  const firstSample = page.getByRole("article").first();
  await firstSample.getByText("查看样例内容").click();
  await expect(firstSample.getByRole("list")).toBeVisible();

  await page.goto("/missing");
  await expect(
    page.getByRole("heading", { name: "没有找到这个页面" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回首页" }).click();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});
