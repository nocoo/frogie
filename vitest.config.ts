import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/server', 'packages/web'],
    coverage: {
      provider: 'v8',
      include: ['packages/{server,web}/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/index.ts',
        '**/test/**',
        '**/dist/**',
      ],
      thresholds: {
        lines: 50,
        functions: 44,
        branches: 37,
        statements: 50,
      },
    },
  },
})
