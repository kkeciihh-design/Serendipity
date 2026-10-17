import { test as base, expect } from "@playwright/test";

// Controlled API setup requests declare their origin explicitly. Browser
// requests keep the browser's own Origin/Fetch Metadata (no global bypass).
export const test = base.extend({
  page: async ({ page }, use) => {
    const state = await (await page.request.get("/api/data-management/status")).json();
    await page.context().setExtraHTTPHeaders({ "x-data-generation": state.dataGeneration });
    await use(page);
  },
  request: async ({ playwright, baseURL }, use) => {
    const probe = await playwright.request.newContext({ baseURL });
    const state = await (await probe.get("/api/data-management/status")).json();
    await probe.dispose();
    const request = await playwright.request.newContext({
      baseURL, extraHTTPHeaders: { Origin: baseURL!, "x-data-generation": state.dataGeneration },
    });
    await use(request);
    await request.dispose();
  },
});
export { expect };
