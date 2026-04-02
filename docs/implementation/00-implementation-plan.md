# Frogie Implementation Plan

> Atomic commit-level implementation roadmap with 6DQ quality gates

## Overview

This document breaks down Frogie implementation into **6 phases** (Phase 0-5), with each phase containing atomic commits. Every commit must:

1. Pass all existing tests
2. Maintain ≥95% coverage on touched core modules
3. Have zero lint errors/warnings
4. Be independently reviewable

---

## Phase 0: Quality Infrastructure (6DQ Foundation)

**Goal**: Establish quality gates so every subsequent commit is validated automatically.

### 0.1 Initialize Monorepo Structure

```
feat(repo): initialize bun workspace monorepo

- Create root package.json with workspaces: ["packages/*"]
- Create packages/server/package.json
- Create packages/web/package.json
- Add bun.lock
- Add .gitignore (node_modules, dist, .env, *.db)
```

**Files**:
- `package.json`
- `packages/server/package.json`
- `packages/web/package.json`
- `.gitignore`

**Verify**: `bun install` succeeds

---

### 0.2 Configure TypeScript Strict Mode

```
chore(ts): configure typescript strict mode for both packages

- Add tsconfig.json with strict: true, noUncheckedIndexedAccess: true
- Add packages/server/tsconfig.json extending root
- Add packages/web/tsconfig.json extending root
- Ensure skipLibCheck: false for full type safety
```

**Files**:
- `tsconfig.json`
- `packages/server/tsconfig.json`
- `packages/web/tsconfig.json`

**Verify**: `bun run typecheck` passes (add script)

---

### 0.3 Configure ESLint Strict Mode

```
chore(lint): configure eslint with zero-warning policy

- Add eslint.config.js (flat config, ESLint 9+)
- Enable @typescript-eslint/strict-type-checked
- Enable @typescript-eslint/stylistic-type-checked
- Set max-warnings: 0
- Add .eslintignore for dist/, coverage/
```

**Files**:
- `eslint.config.js`
- `.eslintignore`

**Verify**: `bun run lint` passes with 0 warnings

---

### 0.4 Configure Vitest with Coverage

```
chore(test): configure vitest with 95% coverage threshold

- Add vitest.config.ts for server package
- Add vitest.config.ts for web package  
- Configure coverage provider: v8
- Set coverage thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 }
- Exclude: view components (*.view.tsx), page shells (page.tsx, layout.tsx)
```

**Files**:
- `packages/server/vitest.config.ts`
- `packages/web/vitest.config.ts`

**Verify**: `bun run test` runs (no tests yet, but config works)

---

### 0.5 Setup Husky Pre-commit Hook (L1 + G1)

```
chore(husky): add pre-commit hook for L1 tests and G1 static analysis

- Install husky
- Add .husky/pre-commit script
- Run sequence: typecheck → lint → test (affected only)
- Target: <30s execution time
```

**Hook Script** (`.husky/pre-commit`):
```bash
#!/bin/sh
bun run typecheck
bun run lint
bun run test --changed --coverage
```

**Verify**: Commit triggers hook, blocks on failure

---

### 0.6 Setup Husky Pre-push Hook (L2 + G2)

```
chore(husky): add pre-push hook for L2 integration tests and G2 security scan

- Add .husky/pre-push script
- Run: L2 tests (if any) → osv-scanner → gitleaks
- Target: <3min execution time
```

**Hook Script** (`.husky/pre-push`):
```bash
#!/bin/sh
bun run test:l2
bunx osv-scanner --lockfile=bun.lock
bunx gitleaks detect --source . --verbose
```

**Dependencies**:
- `osv-scanner` (installed via bunx on demand)
- `gitleaks` (installed via bunx on demand)

**Verify**: Push triggers hook

---

### 0.7 Add Root Package Scripts

```
chore(scripts): add unified dev/test/build scripts to root package.json

Scripts:
- dev: run both packages in parallel
- dev:server: run server only
- dev:web: run web only
- typecheck: tsc --noEmit across workspaces
- lint: eslint across workspaces
- test: vitest run
- test:l2: vitest run --project l2 (placeholder)
- test:l3: playwright test (placeholder)
- build: build both packages
```

**Verify**: All scripts execute without error

---

### 0.8 Setup Test Database Isolation (D1)

```
chore(test): setup D1 test database isolation

- Create packages/server/src/test/setup.ts
- Configure test DB path: /tmp/frogie-test-{random}.db
- Add beforeEach: create fresh DB
- Add afterEach: delete test DB
- Export test utilities: createTestDb(), cleanupTestDb()
```

**Files**:
- `packages/server/src/test/setup.ts`
- `packages/server/src/test/utils.ts`
- `packages/server/vitest.config.ts` (update setupFiles)

**Verify**: Tests use isolated DB, no cross-test pollution

---

### Phase 0 Checkpoint ✅ COMPLETED

After Phase 0, the following must work:

```bash
bun install                    # ✅ Installs all deps
bun run typecheck             # ✅ Zero errors
bun run lint                  # ✅ Zero warnings
bun run test                  # ✅ Passes
git commit                    # ✅ Triggers pre-commit hook
git push                      # ✅ Triggers pre-push hook
```

---

## Phase 1: Database & Configuration Layer

**Goal**: SQLite persistence for workspaces, session index, MCP configs, and global settings.

### 1.1 Add better-sqlite3 Dependency

```
feat(db): add better-sqlite3 and ulid dependencies

- Add better-sqlite3 to server dependencies
- Add @types/better-sqlite3 to devDependencies
- Add ulid for ID generation
```

**Verify**: `bun install` succeeds, types resolve

---

### 1.2 Implement DB Connection Module

```
feat(db): implement database connection with WAL mode

- Create packages/server/src/db/connection.ts
- Initialize Database with WAL mode, foreign keys ON
- Support custom dbPath from config
- Export getDb() singleton
```

**Files**:
- `packages/server/src/db/connection.ts`

**Test** (`packages/server/src/db/connection.test.ts`):
- Creates DB file at specified path
- WAL mode is enabled
- Foreign keys are enforced

---

### 1.3 Implement Schema Migrations

```
feat(db): implement schema migration system

- Create packages/server/src/db/migrations/
- Create 001_initial.sql with all tables
- Implement runMigrations() function
- Track applied migrations in _migrations table
```

**Tables** (from 06-data-model.md):
- `settings` (global, single row)
- `workspaces`
- `sessions` (index only, no messages)
- `mcp_configs`

**Files**:
- `packages/server/src/db/migrations/001_initial.sql`
- `packages/server/src/db/migrate.ts`

**Test**:
- Fresh DB gets all tables
- Running twice is idempotent
- Schema matches expected structure

---

### 1.4 Implement Settings Repository

```
feat(db): implement global settings repository

- Create packages/server/src/db/repositories/settings.ts
- getSettings(): Settings
- updateSettings(partial): Settings
- Initialize with defaults on first access
```

**Files**:
- `packages/server/src/db/repositories/settings.ts`
- `packages/server/src/db/types.ts` (Settings interface)

**Test**:
- Get returns defaults on fresh DB
- Update persists changes
- Partial update preserves other fields

---

### 1.5 Implement Workspace Repository

```
feat(db): implement workspace repository

- Create packages/server/src/db/repositories/workspaces.ts
- create(name, path): Workspace
- getById(id): Workspace | null
- getByPath(path): Workspace | null
- list(): Workspace[]
- touch(id): void (update last_accessed)
- delete(id): void
```

**Files**:
- `packages/server/src/db/repositories/workspaces.ts`
- `packages/server/src/db/types.ts` (Workspace interface)

**Test**:
- CRUD operations work correctly
- Path uniqueness enforced
- Cascade delete (sessions, mcp_configs)

---

### 1.6 Implement Session Index Repository

```
feat(db): implement session index repository

- Create packages/server/src/db/repositories/sessions.ts
- create(workspaceId, name, model): SessionIndex
- getById(id): SessionIndex | null
- listByWorkspace(workspaceId): SessionIndex[]
- updateStats(id, stats): void
- touch(id): void (update updated_at)
- deleteIndex(id): void
```

**Note**: This is INDEX only. Messages stored by open-agent-sdk.

**Files**:
- `packages/server/src/db/repositories/sessions.ts`
- `packages/server/src/db/types.ts` (SessionIndex interface)

**Test**:
- CRUD operations
- Workspace foreign key enforced
- Stats update works

---

### 1.7 Implement MCP Config Repository

```
feat(db): implement MCP config repository

- Create packages/server/src/db/repositories/mcp-configs.ts
- save(workspaceId, config): MCPConfig (upsert by name)
- get(workspaceId, name): MCPConfig | null
- listByWorkspace(workspaceId): MCPConfig[]
- delete(workspaceId, name): void
- setEnabled(workspaceId, name, enabled): void
```

**Files**:
- `packages/server/src/db/repositories/mcp-configs.ts`
- `packages/server/src/db/types.ts` (MCPConfig interface)

**Test**:
- Upsert creates or updates
- Name uniqueness per workspace
- JSON config serialization/deserialization

---

### 1.8 Implement Config Module

```
feat(config): implement configuration loading from env

- Create packages/server/src/config/index.ts
- Load from env: FROGIE_PORT, FROGIE_HOST, FROGIE_DB_PATH
- Provide defaults: 7034, '0.0.0.0', '~/.frogie/frogie.db'
- Expand ~ to home directory
```

**Files**:
- `packages/server/src/config/index.ts`
- `packages/server/src/config/types.ts`

**Test**:
- Default values used when env not set
- Env overrides defaults
- ~ expansion works

---

### 1.9 Export DB Public API

```
feat(db): export unified database API

- Create packages/server/src/db/index.ts
- Export: initDb(), getSettings(), workspaces, sessions, mcpConfigs
- Ensure single initialization point
```

**Files**:
- `packages/server/src/db/index.ts`

**Test**:
- Integration test using all repositories together

---

### Phase 1 Checkpoint ✅ COMPLETED

After Phase 1:

```bash
bun run test                  # All DB tests pass
bun run test --coverage       # ≥95% on db/ modules
```

Database operations verified:
- Settings CRUD ✓
- Workspace CRUD with cascade ✓
- Session index CRUD ✓
- MCP config CRUD ✓

---

## Phase 2: Agent Engine Adapter Layer

**Goal**: Wrap open-agent-sdk with Frogie's event transformation and session sync.

### 2.1 Add open-agent-sdk Dependency

```
feat(engine): add open-agent-sdk dependency

- Add @codeany/open-agent-sdk to server dependencies
- Verify types are available
```

**Verify**: Import resolves, types work

---

### 2.2 Define Frogie Event Types

```
feat(engine): define frogie websocket event types

- Create packages/server/src/engine/types.ts
- Define AgentEvent union type matching 07-api-protocol.md
- Types: session_start, text, thinking, tool_use, tool_result, 
         turn_complete, interrupted, budget_exceeded, session_saved,
         compact_start, compact_done
```

**Files**:
- `packages/server/src/engine/types.ts`

**Test**: Type compilation only (no runtime test needed)

---

### 2.3 Implement SDK Event Transformer

```
feat(engine): implement SDK event to WebSocket event transformer

- Create packages/server/src/engine/transform.ts
- transformSdkEvent(SDKMessage): AgentEvent[]
- Handle: assistant → text/thinking/tool_use
- Handle: tool_result → tool_result
- Handle: result → (usage tracking, not emitted)
```

**Files**:
- `packages/server/src/engine/transform.ts`

**Test**:
- assistant message with text → text event
- assistant message with thinking → thinking event  
- assistant message with tool_use → tool_use event
- tool_result → tool_result event with correct field mapping

---

### 2.4 Implement FrogieAgent Class (Core)

```
feat(engine): implement FrogieAgent wrapper class

- Create packages/server/src/engine/frogie-agent.ts
- static create(config): FrogieAgent
- query(prompt): AsyncGenerator<AgentEvent>
- interrupt(): void
- close(): Promise<void>
- NOTE: Does NOT handle session index - that's session-sync's job
```

**Files**:
- `packages/server/src/engine/frogie-agent.ts`

**Test** (with mocked open-agent-sdk):
- create() calls createAgent() synchronously
- query() transforms and yields events
- query() extracts total_cost_usd from SDK result event (not calculated locally)
- interrupt() calls agent.interrupt()
- close() calls agent.close()

---

### 2.5 Implement Session Sync Service

```
feat(engine): implement session sync service for dual persistence

- Create packages/server/src/engine/session-sync.ts
- createSession(workspaceId, name, model): sessionId
  - Generates sessionId
  - Creates SQLite index entry (SINGLE SOURCE for index writes)
  - Returns sessionId for FrogieAgent to use
- deleteSession(sessionId): Promise<void>
  - Calls db.sessions.deleteIndex(id)
  - Calls SDK deleteSession(id)
- getSessionWithMessages(sessionId): { index, messages }
  - Gets index from SQLite
  - Gets messages from SDK getSessionMessages()
- updateSessionStats(sessionId, stats): void
  - Updates SQLite index with usage stats after query completes
```

**Session Creation Flow**:
1. API layer calls `sessionSync.createSession()` → returns sessionId
2. API layer creates `FrogieAgent.create({ sessionId })` → uses existing sessionId
3. FrogieAgent does NOT write to session index

**Files**:
- `packages/server/src/engine/session-sync.ts`

**Test**:
- createSession creates index entry with correct fields
- deleteSession removes both index and SDK files
- getSessionWithMessages merges both sources
- updateSessionStats updates index correctly

---

### 2.6 Export Engine Public API

```
feat(engine): export unified engine API

- Create packages/server/src/engine/index.ts
- Export: FrogieAgent, sessionSync, types
```

**Note**: Cost is obtained from SDK's `result.total_cost_usd`, not calculated locally.
This avoids price drift between Frogie and SDK.

**Files**:
- `packages/server/src/engine/index.ts`

---

### Phase 2 Checkpoint ✅ COMPLETED

After Phase 2:

```bash
bun run test                  # All engine tests pass
bun run test --coverage       # ≥95% on engine/ modules
```

Engine verified:
- SDK event transformation ✓
- FrogieAgent lifecycle ✓
- Dual persistence sync ✓

---

## Phase 3: HTTP/WebSocket API Layer

**Goal**: Expose REST endpoints and WebSocket chat protocol.

### 3.1 Add Hono Framework

```
feat(api): add hono framework and dependencies

- Add hono to server dependencies
- Add @hono/node-server for Bun compatibility
- Add zod for request validation
```

---

### 3.2 Setup Hono App Skeleton

```
feat(api): setup hono app with middleware

- Create packages/server/src/app.ts
- Add CORS middleware
- Add error handler middleware
- Add request logging middleware
- Export app instance
```

**Files**:
- `packages/server/src/app.ts`
- `packages/server/src/middleware/error.ts`
- `packages/server/src/middleware/logger.ts`

**Test**: App starts, middleware executes

---

### 3.3 Implement Settings Routes

```
feat(api): implement settings REST endpoints

- GET /api/settings → get global settings
- PATCH /api/settings → update settings
- Validate with zod schema
```

**Files**:
- `packages/server/src/routes/settings.ts`

**Test (L2)**:
- GET returns current settings
- PATCH updates and returns new settings
- Invalid body returns 400

---

### 3.4 Implement Workspace Routes

```
feat(api): implement workspace REST endpoints

- GET /api/workspaces → list all
- POST /api/workspaces → create (validate path exists)
- GET /api/workspaces/:id → get by id
- DELETE /api/workspaces/:id → delete with cascade
```

**Files**:
- `packages/server/src/routes/workspaces.ts`

**Test (L2)**:
- CRUD operations via HTTP
- 404 on missing workspace
- 400 on invalid path

---

### 3.5 Implement Session Routes

```
feat(api): implement session REST endpoints

- GET /api/workspaces/:wid/sessions → list
- POST /api/workspaces/:wid/sessions → create
- GET /api/workspaces/:wid/sessions/:id → get with messages
- DELETE /api/workspaces/:wid/sessions/:id → delete (dual persistence)
- POST /api/workspaces/:wid/sessions/:id/fork → fork session
```

**Files**:
- `packages/server/src/routes/sessions.ts`

**Test (L2)**:
- List returns sessions for workspace
- Create returns new session
- Get includes messages from SDK
- Delete removes both index and files

---

### 3.6 Implement MCP Routes

```
feat(api): implement MCP config REST endpoints

- GET /api/workspaces/:wid/mcp → list configs
- POST /api/workspaces/:wid/mcp → add server
- DELETE /api/workspaces/:wid/mcp/:name → remove
- POST /api/workspaces/:wid/mcp/:name/reconnect → reconnect
```

**Files**:
- `packages/server/src/routes/mcp.ts`

**Test (L2)**:
- CRUD operations
- Validation of config schema

---

### 3.7 Implement WebSocket Chat Handler

```
feat(api): implement websocket chat handler

- Create packages/server/src/routes/ws-chat.ts
- Handle connection upgrade
- Message types: chat, interrupt
- Emit events as JSON to client
- Track active sessions per connection
```

**Files**:
- `packages/server/src/routes/ws-chat.ts`

**Test (L2)**:
- Connection established
- chat message triggers agent query
- Events streamed back
- interrupt stops current query

---

### 3.8 Implement Server Entry Point

```
feat(api): implement server entry point

- Create packages/server/src/index.ts
- Initialize DB
- Mount all routes
- Start server on configured port
- Graceful shutdown handling
```

**Files**:
- `packages/server/src/index.ts`

**Test**:
- Server starts and responds to health check
- Shutdown cleans up resources

---

### Phase 3 Checkpoint ✅ COMPLETED

After Phase 3:

```bash
bun run dev:server            # Server runs on :7034
curl localhost:7034/api/settings  # Returns settings
bun run test:l2               # All API tests pass
```

API verified:
- All REST endpoints functional ✓
- WebSocket chat protocol working ✓

---

## Phase 4: Web UI Foundation

**Goal**: MVVM architecture with Zustand stores and core components.

### 4.1 Initialize Vite React Project

```
feat(web): initialize vite react project with typescript

- Setup Vite 7 + React 19
- Configure TypeScript strict mode
- Add Tailwind CSS 4
- Configure path aliases (@/)
```

**Files**:
- `packages/web/vite.config.ts`
- `packages/web/tailwind.config.ts`
- `packages/web/src/main.tsx`
- `packages/web/index.html`

---

### 4.2 Define Model Types

```
feat(web): define model types matching API responses

- Create packages/web/src/models/index.ts
- Types: Workspace, Session, Message, MCPConfig, Settings
- Types: AgentEvent union (matches server)
```

**Files**:
- `packages/web/src/models/index.ts`
- `packages/web/src/models/events.ts`

---

### 4.3 Implement Settings ViewModel

```
feat(web): implement settings viewmodel with zustand

- Create packages/web/src/viewmodels/settings.viewmodel.ts
- State: settings, isLoading, error
- Actions: fetchSettings, updateSettings
```

**Files**:
- `packages/web/src/viewmodels/settings.viewmodel.ts`

**Test (L1)**:
- Initial state correct
- fetchSettings updates state
- updateSettings calls API and updates

---

### 4.4 Implement Workspace ViewModel

```
feat(web): implement workspace viewmodel

- Create packages/web/src/viewmodels/workspace.viewmodel.ts
- State: workspaces, currentWorkspaceId, isLoading
- Actions: fetchWorkspaces, createWorkspace, selectWorkspace, deleteWorkspace
```

**Files**:
- `packages/web/src/viewmodels/workspace.viewmodel.ts`

**Test (L1)**:
- CRUD state updates
- Selection persists

---

### 4.5 Implement Session ViewModel

```
feat(web): implement session viewmodel

- Create packages/web/src/viewmodels/session.viewmodel.ts
- State: sessions, currentSessionId, isLoading
- Actions: fetchSessions, createSession, selectSession, deleteSession
```

**Files**:
- `packages/web/src/viewmodels/session.viewmodel.ts`

**Test (L1)**:
- Filtered by workspace
- Selection updates

---

### 4.6 Implement Chat ViewModel

```
feat(web): implement chat viewmodel

- Create packages/web/src/viewmodels/chat.viewmodel.ts
- State: messages, isLoading, stats, error
- Actions: addUserMessage, handleAgentEvent, clearMessages
```

**Files**:
- `packages/web/src/viewmodels/chat.viewmodel.ts`

**Test (L1)**:
- Message accumulation
- Event handling (text, tool_use, tool_result)
- Stats from turn_complete

---

### 4.7 Implement useChatWebSocket Hook

```
feat(web): implement websocket chat hook

- Create packages/web/src/hooks/use-chat-websocket.ts
- Connect to ws://localhost:7034/ws/chat
- sendMessage(sessionId, workspaceId, prompt): void
- interrupt(): void
- Connection state management (connecting/connected/disconnected)
```

**Files**:
- `packages/web/src/hooks/use-chat-websocket.ts`

**Test (L1 with mock WebSocket)**:
- Connects on mount
- Sends correctly formatted messages
- Handles incoming events
- interrupt sends interrupt message

**Note**: Auto-reconnect deferred to Phase 5.5

---

### 4.8 Implement MessageList Component

```
feat(web): implement message list component

- Create packages/web/src/components/chat/message-list.tsx
- Render user/assistant messages
- Auto-scroll to bottom
- Loading indicator
```

**Files**:
- `packages/web/src/components/chat/message-list.tsx`

**Test**: Renders messages correctly

---

### 4.9 Implement ThinkingBlock Component

```
feat(web): implement thinking block component

- Create packages/web/src/components/chat/thinking-block.tsx
- Collapsible thinking content
- Amber styling per design
```

**Files**:
- `packages/web/src/components/chat/thinking-block.tsx`

---

### 4.10 Implement ToolUseCard Component

```
feat(web): implement tool use card component

- Create packages/web/src/components/chat/tool-use-card.tsx
- Show tool name, input preview
- Expandable input JSON
- Status indicator (pending/success/error)
```

**Files**:
- `packages/web/src/components/chat/tool-use-card.tsx`

---

### 4.11 Implement ChatInput Component

```
feat(web): implement chat input component

- Create packages/web/src/components/chat/chat-input.tsx
- Textarea with Cmd+Enter to send
- Stop button when loading
- Disabled state
```

**Files**:
- `packages/web/src/components/chat/chat-input.tsx`

---

### 4.12 Implement ChatPanel Component

```
feat(web): implement chat panel container

- Create packages/web/src/components/chat/chat-panel.tsx
- Compose message-list + chat-input
- Connect to viewmodels and hooks
```

**Files**:
- `packages/web/src/components/chat/chat-panel.tsx`

---

### 4.13 Implement SessionList Component

```
feat(web): implement session list sidebar

- Create packages/web/src/components/sidebar/session-list.tsx
- List sessions for current workspace
- New session button
- Selection highlighting
```

**Files**:
- `packages/web/src/components/sidebar/session-list.tsx`

---

### 4.14 Implement WorkspaceSelector Component

```
feat(web): implement workspace selector dropdown

- Create packages/web/src/components/shared/workspace-selector.tsx
- Dropdown with workspace list
- Add workspace option
```

**Files**:
- `packages/web/src/components/shared/workspace-selector.tsx`

---

### 4.15 Implement App Shell Layout

```
feat(web): implement gen 2 app shell layout

- Create packages/web/src/layouts/app-shell.tsx
- Gen 2 sidebar with context
- Header with workspace selector
- Main content area
```

**Files**:
- `packages/web/src/layouts/app-shell.tsx`

---

### 4.16 Implement App Entry

```
feat(web): implement app entry with routing

- Update packages/web/src/App.tsx
- Setup router (if needed) or single-page layout
- Initialize viewmodels on mount
```

**Files**:
- `packages/web/src/App.tsx`

---

### Phase 4 Checkpoint

After Phase 4:

```bash
bun run dev:web               # UI runs on :7033
bun run test                  # All viewmodel tests pass
```

UI verified:
- ViewModels handle state ✓
- Components render ✓
- WebSocket hook connects ✓

---

## Phase 5: Integration & Polish

**Goal**: End-to-end functionality and production readiness.

### 5.1 Setup Playwright for L3 Tests

```
chore(test): setup playwright for e2e tests

- Add @playwright/test
- Configure playwright.config.ts
- Add test:l3 script
- Create tests/e2e/ directory
```

**Files**:
- `playwright.config.ts`
- `tests/e2e/.gitkeep`

---

### 5.2 Implement E2E: Workspace Flow

```
test(e2e): add workspace management e2e test

- Create workspace
- Verify appears in list
- Delete workspace
- Verify removed
```

**Files**:
- `tests/e2e/workspace.spec.ts`

---

### 5.3 Implement E2E: Session Flow

```
test(e2e): add session management e2e test

- Select workspace
- Create session
- Verify appears in sidebar
- Delete session
```

**Files**:
- `tests/e2e/session.spec.ts`

---

### 5.4 Implement E2E: Chat Flow

```
test(e2e): add basic chat e2e test

- Open session
- Send message
- Verify response appears
- Check tool use rendering
```

**Files**:
- `tests/e2e/chat.spec.ts`

---

### 5.5 Implement WebSocket Reconnection

```
feat(web): implement websocket auto-reconnection

- Update packages/web/src/hooks/use-chat-websocket.ts
- Add reconnect logic with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Max retry limit
- User notification on disconnect
```

**Files**:
- `packages/web/src/hooks/use-chat-websocket.ts` (update)

**Test**: Reconnects after disconnect

---

### 5.6 Implement Error Boundaries

```
feat(web): add error boundaries for graceful failures

- Create ErrorBoundary component
- Wrap main content areas
- Show friendly error UI
```

**Files**:
- `packages/web/src/components/ErrorBoundary.tsx`

---

### 5.7 Implement Settings Page

```
feat(web): implement settings page

- Create packages/web/src/pages/Settings.tsx
- Edit API URL, API Key, Model
- Save to backend
```

**Files**:
- `packages/web/src/pages/Settings.tsx`

---

### 5.8 Add Production Build

```
chore(build): configure production builds

- Add build scripts for server (bun build)
- Add build scripts for web (vite build)
- Verify dist outputs
```

---

### 5.9 Documentation Update

```
docs: update README with setup and usage instructions

- Quick start guide
- Development setup
- Architecture overview link
```

**Files**:
- `README.md`

---

### Phase 5 Checkpoint

After Phase 5:

```bash
bun run build                 # Both packages build
bun run test:l3               # E2E tests pass
```

Full system verified:
- E2E flows work ✓
- Error handling ✓
- Production ready ✓

---

## Summary

| Phase | Commits | Focus |
|-------|---------|-------|
| 0 | 8 | Quality infrastructure (6DQ) |
| 1 | 9 | Database & configuration |
| 2 | 7 | Agent engine adapter |
| 3 | 8 | HTTP/WebSocket API |
| 4 | 16 | Web UI foundation |
| 5 | 9 | Integration & polish |
| **Total** | **57** | |

Each commit is atomic, testable, and maintains quality gates.
