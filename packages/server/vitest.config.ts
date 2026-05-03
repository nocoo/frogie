import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/test/**',
        // Entry point uses Bun runtime, WebSocket server and process lifecycle
        'src/index.ts',
        // Engine modules that wrap the Anthropic SDK / streaming; not unit-testable
        'src/engine/builtin-tools.ts',
        'src/engine/compact.ts',
        'src/engine/frogie-agent.ts',
        // MCP layer requires real MCP server subprocesses
        'src/mcp/**',
        // Type-only modules
        'src/db/types.ts',
        'src/engine/types.ts',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
})
