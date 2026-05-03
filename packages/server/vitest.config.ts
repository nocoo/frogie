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
        // Runtime-bridge: bun:sqlite branch is dead under Node test runner; better-sqlite3 branch is exercised by every test
        'src/db/connection.ts',
        // Type-only modules
        'src/db/types.ts',
        'src/engine/types.ts',
        'src/config/types.ts',
        // Hono app factory: real wiring tested through integration; CORS env branches not unit-testable
        'src/app.ts',
        // WebSocket chat handler: requires live WebSocket + Anthropic SDK to fully exercise streaming/turn loops
        'src/routes/ws-chat.ts',
      ],
      thresholds: {
        // Lines/statements: 95% target. Branches: 80% — many remaining branches
        // are defensive `?? null` defaults, catch blocks for unreachable states,
        // and fallback switch arms that cannot be exercised through public APIs.
        lines: 95,
        functions: 95,
        branches: 80,
        statements: 94,
      },
    },
  },
})
