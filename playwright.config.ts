import path from "node:path";
import { defineConfig } from "@playwright/test";

const dataDirectory = path.resolve("test-data", "e2e");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "msedge",
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
