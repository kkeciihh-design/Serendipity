import path from "node:path";
import { defineConfig } from "@playwright/test";

const dataDirectory = path.resolve("test-data", "e2e");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  // The shared isolated instance has stateful settings and whole-travel restores.
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "msedge",
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } } : {}),
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/clean-test-data.mjs && npm run start:test",
    url: "http://127.0.0.1:3100/api/trips",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      RUST_LOG: "info",
      SERENDIPITY_DATA_DIR: dataDirectory,
    },
  },
});
