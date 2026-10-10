import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: [
      "frogie-source",
      "module",
      "browser",
      "development|production",
    ],
  },
  environments: {
    ssr: { resolve: { conditions: ["frogie-source"] } },
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "scripts/**/*.test.ts",
      "seeds/**/*.test.ts",
      "evals/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    allowOnly: false,
    passWithNoTests: false,
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: "v8",
      include: [
        "packages/core/src/**/*.ts",
        "apps/dashboard/src/**/*.{ts,tsx}",
        "seeds/**/*.ts",
        "evals/**/*.ts",
        "squads/**/*.mjs",
        "scripts/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts", "apps/dashboard/src/views/**"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
