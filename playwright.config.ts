import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/dashboard/tests",
  outputDir: "data/e2e/browser-results",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    browserName: "chromium",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
