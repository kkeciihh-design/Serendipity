import { test as base, expect } from "@playwright/test";

// Controlled API setup requests declare their origin explicitly. Browser
// requests keep the browser's own Origin/Fetch Metadata (no global bypass).
export const test = base.extend({
  request: async ({ playwright, baseURL }, use) => {
    const request = await playwright.request.newContext({
      baseURL, extraHTTPHeaders: { Origin: baseURL! },
    });
    await use(request);
    await request.dispose();
  },
});
export { expect };
