import type { Page } from "@playwright/test";

export async function openRequirements(page: Page) {
  const toggle = page.getByRole("button", { name: "修改需求 / 重新生成", exact: true });
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
}

export async function openAdjustments(page: Page) {
  const toggle = page.locator("summary").filter({ hasText: "调整 / 重排行程" });
  if (!await toggle.locator("..").evaluate((element) => element.hasAttribute("open"))) await toggle.click();
}

export async function openSnapshot(page: Page) {
  const toggle = page.locator("summary").filter({ hasText: "查看本版需求快照" });
  if (!await toggle.locator("..").evaluate((element) => element.hasAttribute("open"))) await toggle.click();
}

export async function useUnavailableAI(page: Page) {
  await page.route("**/api/trips/*/request/extract", (route) => route.fulfill({
    status: 400, contentType: "application/json",
    body: JSON.stringify({ error: "AI 服务尚未配置或缺少 API Key，请先在设置页完成连接测试并保存。" }),
  }));
}
