import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(".") } },
  test: {
    // Database/OCR suites and real-clock deadline tests compete for CPU and
    // disk on desktop machines. Bound concurrency instead of relaxing timeouts.
    maxWorkers: 4,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
