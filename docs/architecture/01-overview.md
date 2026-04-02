# 01 - Project Overview

## Vision

Frogie is a **local-first web shell for an agent engine** — a browser-based interface that wraps open-agent-sdk, providing multi-workspace management, session persistence, and rich UI for AI-assisted coding workflows.

## Core Goals

1. **Browser-native Experience**
   - Rich web UI for chat, tool visualization, and session management
   - Works on any device with a browser
   - No CLI required for end users

2. **Full Agent Capabilities**
   - Multi-turn conversations with persistent context
   - 30+ built-in tools for file operations, shell execution, search
   - MCP server integration for extended capabilities
   - Automatic context compression for long sessions

3. **LLM API Connection**
   - Uses **Anthropic Messages API** (`/v1/messages`) natively
   - Connects via Raven Proxy for upstream routing
   - User configures URL, API Key, Model in Settings page

4. **Multi-workspace Support**
   - Work on multiple projects simultaneously
   - Each workspace is a **git-managed project directory**
   - Users can add projects and switch between workspaces
   - Isolated sessions, MCP configs, and tool execution contexts per workspace
   - All data persisted locally in SQLite (single DB file)

## Non-Goals (v1)

- Mobile-first design (desktop browser is primary target)
- Collaborative editing (single-user focus)
- Cloud deployment (local-only)
- Sandboxed execution (runs with full user permissions)

## Reference Projects

| Project | Role |
|---------|------|
| **open-agent-sdk** | **Engine base** — Agent, QueryEngine, MCP, session ([GitHub](https://github.com/codeany-ai/open-agent-sdk-typescript)) |
| **Claude Code CLI** | **Design reference** — product patterns, prompts, permission design |

### Architecture Strategy

**Principle**: open-agent-sdk is the engine; Claude Code CLI is an important design reference. We study mature products to build a web-based coding platform.

#### open-agent-sdk as Engine Base

open-agent-sdk is a modular, Anthropic-native engine that provides:

- `Agent` class with agentic loop (`src/agent.ts`)
- `QueryEngine` for single-turn queries (`src/engine.ts`)
- Tool concurrent execution with read-only batching
- MCP client integration (stdio/sse/http transports)
- Session persistence with fork/resume (`src/session.ts`)

Frogie builds a **thin adapter layer** on top:

| open-agent-sdk provides | Frogie adds |
|-------------------------|-------------|
| Agent loop, tool execution | WebSocket transport for browser |
| Session file storage | SQLite indexing for multi-session management |
| Single workspace context | Multi-workspace support |
| CLI/programmatic API | Web UI with MVVM architecture |

This follows open-agent-sdk's own web example pattern (`examples/web/server.ts`).

#### Claude Code CLI as Design Reference

Claude Code CLI is an important reference for product design. We study its patterns to inform our implementation:

| What We Study | Source | What We Build |
|---------------|--------|---------------|
| Tool prompt patterns | `README.md:81` | Our own prompts with 6DQ discipline |
| Tool pool assembly strategy | `src/tools.ts:330` | "built-in + MCP + deny rules + dedup + stable sort" |
| Permission architecture | `permissions.ts`, `bridgePermissionCallbacks.ts` | Web-friendly permission flow |
| File tool defenses | `FileReadTool.ts`, `FileEditTool.ts` | Path expansion, size limits, similar path hints |

### API Format: Anthropic-Native

Frogie uses **Anthropic Messages API** as the primary protocol:

- Native `messages` array with `role: user | assistant`
- Native `tool_use` and `tool_result` content blocks
- Extended thinking support via `thinking` blocks
- Raven Proxy handles upstream routing

### Frogie's Value-Add

| Area | What We Build |
|------|---------------|
| **Adapter Layer** | WebSocket transport, SQLite session indexing, multi-workspace |
| **6DQ** | L1/L2/L3 tests, G1/G2 gates, D1 isolation for all modules |
| **UI/UX** | Basalt Gen 2 MVVM, chat experience, tool visualization |

## Development Environment

### Port Allocation

Default development ports:

| Port | Component | Notes |
|------|-----------|-------|
| 7033 | frogie-web | Web UI (Vite dev server) |
| 7034 | frogie-server | Agent Server (Hono) |
| 17033 | — | Reserved for L2 API E2E tests |
| 27033 | — | Reserved for L3 Playwright E2E |

### Local Development

```bash
# Start both packages in parallel
bun run dev

# Or start individually
bun run dev:web      # Web UI at http://localhost:7033
bun run dev:server   # Agent Server at http://localhost:7034
```

### Custom Domain Setup (Optional)

For HTTPS local development, you can configure a reverse proxy (e.g., Caddy, nginx) with custom certificates.

Example Caddy configuration:

```caddyfile
your-domain.local {
    reverse_proxy localhost:7033
    tls /path/to/cert.pem /path/to/key.pem
}
```

Then add your domain to environment variables:
- `VITE_ALLOWED_HOSTS=your-domain.local` (for Vite)
- `CORS_ORIGINS=https://your-domain.local` (for server)

## LLM API Configuration

Frogie connects to LLM APIs through **Raven Proxy**.

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Frogie Server  │────▶│  LLM API Proxy  │────▶│  Anthropic API  │
│  :7034          │     │  (optional)     │     │  (Claude)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

You can connect directly to Anthropic API or use a proxy for upstream routing.

### User Configuration

Settings are configured in the Frogie web UI Settings page:

| Setting | Description | Example |
|---------|-------------|---------|
| **API URL** | Anthropic API base URL | `https://api.anthropic.com` |
| **API Key** | Bearer token for authentication | (from Raven or provider) |
| **Model** | Default model for new sessions | `claude-sonnet-4-6` |

These settings are persisted in SQLite (`~/.frogie/frogie.db`).

## Target Architecture

```
┌─────────────────────────────────────────────────────┐
│              Browser (localhost:7033)               │
│  React 19 + Vite 7 + Tailwind CSS 4                │
│  - Chat interface                                   │
│  - Tool visualization                               │
│  - Session management                               │
│  - Workspace selector                               │
└─────────────────────────┬───────────────────────────┘
                          │ WebSocket (:7034)
┌─────────────────────────▼───────────────────────────┐
│              Frogie Agent Server (:7034)            │
│  Bun + Hono (runs locally, same machine)           │
│  - Agentic loop engine                              │
│  - Tool executor (no sandbox, full permissions)    │
│  - MCP manager (spawns stdio processes locally)    │
│  - Session persistence (SQLite)                     │
└───────────┬─────────────────────────┬───────────────┘
            │ HTTP                    │ stdio/sse/http
┌───────────▼───────────┐   ┌────────▼────────┐
│   LLM API Proxy       │   │   MCP Servers   │
│   (optional)          │   │   (local spawn) │
└───────────┬───────────┘   └─────────────────┘
            │
┌───────────▼───────────┐
│    Anthropic API      │
│    (Claude)           │
└───────────────────────┘
```

**Key Points**:
- Everything runs locally on user's machine
- No cloud deployment, no sandboxing
- MCP servers are spawned as child processes by Frogie Server
- Tool execution has full user permissions (cwd = workspace path)

## Workspace Concept

A **Workspace** represents a git-managed project directory on the local machine. Users can:

1. **Add a Project**: Select a local git repository to add as a workspace
2. **Switch Workspaces**: Quickly switch between multiple projects
3. **Isolated Context**: Each workspace maintains its own:
   - Chat sessions (conversation history)
   - MCP server configurations
   - Tool execution context (cwd = workspace path)

### Data Model

```
┌─────────────────────────────────────────────────────────────┐
│                     SQLite (frogie.db)                       │
│                                                              │
│  ┌─────────────┐                                            │
│  │  Workspace  │ ← User's git project directory             │
│  │  - id       │                                            │
│  │  - name     │   e.g., "frogie"                          │
│  │  - path     │   e.g., "/Users/me/workspace/frogie"      │
│  └──────┬──────┘                                            │
│         │ 1:N                                               │
│  ┌──────▼──────┐                                            │
│  │   Session   │ ← Conversation history                     │
│  │  - id       │                                            │
│  │  - name     │   e.g., "Fix auth bug"                    │
│  │  - model    │   e.g., "claude-sonnet-4-6"               │
│  └──────┬──────┘                                            │
│         │ 1:N                                               │
│  ┌──────▼──────┐                                            │
│  │   Message   │ ← User/Assistant/System messages           │
│  │  - role     │                                            │
│  │  - content  │   JSON content blocks                     │
│  └─────────────┘                                            │
│                                                              │
│  ┌─────────────┐                                            │
│  │  MCPConfig  │ ← MCP servers per workspace                │
│  │  - name     │   e.g., "memory", "linear"                │
│  │  - type     │   stdio / sse / http                      │
│  │  - config   │   JSON connection config                  │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

### Workspace Workflow

```
User opens Frogie
        │
        ▼
┌───────────────────┐
│  No workspaces?   │──Yes──▶ Show "Add Project" dialog
└────────┬──────────┘                    │
         │ No                            │
         ▼                               ▼
┌───────────────────┐        ┌───────────────────┐
│  Load last active │        │  User selects a   │
│    workspace      │        │  git directory    │
└────────┬──────────┘        └────────┬──────────┘
         │                            │
         ▼                            ▼
┌─────────────────────────────────────────────────┐
│              Active Workspace                    │
│  - Sessions listed in sidebar                   │
│  - MCP servers connected                        │
│  - Tool cwd = workspace path                    │
│  - Switch via workspace selector in header      │
└─────────────────────────────────────────────────┘
```

### Storage

- **Location**: `~/.frogie/frogie.db` (SQLite)
- **Single file**: All workspaces, sessions, messages in one DB
- **No cloud sync**: Data stays local (privacy by default)

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Bun | Fast startup, native TypeScript, good DX |
| Web Framework | Hono | Lightweight, fast, good WebSocket support |
| Frontend | React 19 + Vite 7 | Modern, fast HMR, Basalt template ecosystem |
| UI Architecture | MVVM (Basalt Gen 2) | Clear separation: Model → ViewModel → View |
| Database | SQLite (better-sqlite3) | Simple, no external deps, sufficient for single-user |
| API Format | Anthropic Messages API | Native tool_use/tool_result, thinking blocks |
| Communication | WebSocket | Bidirectional, supports streaming, interrupts |

## Quality System (六维质量体系)

Frogie follows the **Six-Dimension Quality System**: 3 test layers (L1/L2/L3) + 2 quality gates (G1/G2) + 1 isolation layer (D1).

### Development Approach

- **Test-Driven Development (TDD)**: Tests first, implementation follows
- **Coverage Target**: ≥ 95% for core modules (Model, ViewModel, transformers, utilities)
- **UI Exception**: View components (thin UI shells) are exempt from coverage requirements

### Quality Dimensions

| Dimension | Description | Timing | Target |
|-----------|-------------|--------|--------|
| **L1** Unit/Component | ViewModel, Model, transformers, hooks, utils | pre-commit | ≥ 95% coverage |
| **L2** Integration/API | Real HTTP requests, WebSocket, DB operations | pre-push | 100% API endpoints |
| **L3** System/E2E | Playwright browser tests, user flows | CI/manual | Core business paths |
| **G1** Static Analysis | TypeScript strict + ESLint strict + 0 warnings | pre-commit | 0 errors/warnings |
| **G2** Security Scan | osv-scanner (deps) + gitleaks (secrets) | pre-push | 0 vulnerabilities |
| **D1** Test Isolation | Separate test DB instance, never touch prod | always | Physical isolation |

### Tier Target: S

To achieve S-tier quality rating, all six dimensions must pass:

```
L1 ✅ + L2 ✅ + L3 ✅ + G1 ✅ + G2 ✅ + D1 ✅ = Tier S
```

### Hook Mapping (Husky)

```
pre-commit (<30s):  L1 (unit tests + coverage) + G1 (typecheck + lint)
pre-push (<3min):   D1 (verify test DB) → L2 (API E2E) ‖ G2 (security scan)
CI/manual:          L3 (Playwright E2E)
```

### Coverage Strategy

| Module Type | Coverage Requirement | Rationale |
|-------------|---------------------|-----------|
| **Model** (types, schemas) | ≥ 95% | Core data structures |
| **ViewModel** (state logic) | ≥ 95% | Business logic hub |
| **Transformers** (data conversion) | ≥ 95% | Critical data flow |
| **Hooks** (custom React hooks) | ≥ 95% | Reusable logic |
| **Utils** (pure functions) | ≥ 95% | Foundational utilities |
| **View** (UI components) | Exempt | Thin presentation layer |
| **page.tsx / layout.tsx** | Exempt | Routing shells |
