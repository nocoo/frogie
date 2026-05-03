import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/index.ts',
        'src/main.ts',
        // Bootstrap component (router/provider wiring) — exercised at runtime
        'src/App.tsx',
        // View components are coverage exempt
        'src/components/**/*.tsx',
        'src/pages/**/*.tsx',
        'src/layouts/**/*.tsx',
        // Type-only modules
        'src/models/events.ts',
        // Viewmodels for features not yet under test
        'src/viewmodels/models.viewmodel.ts',
        'src/viewmodels/prompts.viewmodel.ts',
      ],
      thresholds: {
        // Targets reflect what is currently testable: viewmodels still have
        // gaps and many branches are defensive null guards.
        lines: 75,
        functions: 70,
        branches: 50,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
