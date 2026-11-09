import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/l1-gate-selftest.test.ts"],
    passWithNoTests: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
