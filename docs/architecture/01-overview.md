# 01 - Project Overview

## Vision

Frogie is a **web-based Claude Code** - bringing the full power of an AI coding agent to the browser. Users can interact with an intelligent assistant that can read, write, and execute code in their local workspace, all through a web interface.

## Core Goals

1. **Browser-native Experience**
   - No complex CLI setup required
   - Rich web UI for chat, tool visualization, and session management
   - Works on any device with a browser

2. **Full Agent Capabilities**
   - Multi-turn conversations with persistent context
   - 30+ built-in tools for file operations, shell execution, search
   - MCP server integration for extended capabilities
   - Automatic context compression for long sessions

3. **Flexible Backend Connection**
   - Connect to any OpenAI-compatible API endpoint
   - Works with Raven Proxy, direct Anthropic API, or other providers
   - Independent URL and Token configuration

4. **Multi-workspace Support**
   - Work on multiple projects simultaneously
   - Each workspace is a **git-managed project directory**
   - Users can add projects and switch between workspaces
   - Isolated sessions, MCP configs, and tool execution contexts per workspace
   - All data persisted locally in SQLite (single DB file)

## Non-Goals (v1)

- Mobile-first design (desktop browser is primary target)
- Collaborative editing (single-user focus)
- Cloud deployment (local-only, equivalent to Claude Code CLI with a web UI)
- Sandboxed execution (runs with full user permissions, like Claude Code CLI)

## Reference Projects

This project synthesizes the best ideas from:

| Project | Path | What We Take |
|---------|------|--------------|
| **Claude Code CLI** | `/Users/nocoo/workspace/reference/claude-code` | Tool system prompts, permission model, Skill concept |
| **open-agent-sdk** | `/Users/nocoo/workspace/reference/open-agent-sdk-typescript` | Agentic loop structure, context compression, MCP client |
| **Raven Proxy** | `/Users/nocoo/workspace/personal/raven` | LLM API proxy, Anthropic↔OpenAI format translation |

### Code Inheritance Strategy

**Principle**: Core modules (prompts, agentic loop, tools) should be **directly inherited** from reference projects — no reinventing wheels. Our focus is on:

1. **6DQ Compliance**: Add comprehensive tests to inherited code
2. **Integration**: Wire everything together with proper architecture
3. **UI/UX**: Build excellent browser-based experience

#### From Claude Code CLI (Direct Inheritance)

| Module | Source | Notes |
|--------|--------|-------|
| **Tool Prompts** | `src/tools/*.ts` | Core value, inherit as-is |
| **Tool Definitions** | `src/tools/*.ts` | Schemas + execution logic |
| **Context Compression** | `src/context/` | Proven compaction algorithm |
| Permission Model | `src/permissions/` | Adapt for web |
| Skill System | `src/skills/` | Future phase |

#### From open-agent-sdk-typescript (Direct Inheritance)

| Module | Source | Notes |
|--------|--------|-------|
| **Agentic Loop** | `src/agent.ts` | Core loop logic |
| **MCP Client** | `src/mcp/` | All transports |
| **Message Types** | `src/types/` | Type definitions |
| Streaming Handler | `src/streaming/` | SSE parsing |

#### Our Value-Add (Frogie's Focus)

| Area | What We Build |
|------|---------------|
| **6DQ** | L1/L2/L3 tests, G1/G2 gates, D1 isolation for all modules |
| **Integration** | Hono server, WebSocket protocol, SQLite persistence |
| **UI/UX** | Basalt Gen 2 MVVM, chat experience, tool visualization |

## Development Environment

### Port Allocation

Following the family project port convention (ascending from 7002):

| Port | Component | Domain | Notes |
|------|-----------|--------|-------|
| 7033 | frogie-web | `frogie.dev.hexly.ai` | Web UI (Vite dev server) |
| 7034 | frogie-server | — | Agent Server (Hono), no Caddy |
| 17033 | — | — | Reserved for L2 API E2E tests |
| 27033 | — | — | Reserved for L3 Playwright E2E |

### Local Development

```bash
# Start both packages in parallel
bun run dev

# Or start individually
bun run dev:web      # Web UI at https://frogie.dev.hexly.ai (via Caddy)
bun run dev:server   # Agent Server at http://localhost:7034
```

### Domain Setup

Uses the standard `*.dev.hexly.ai` Caddy + mkcert setup:

```
https://frogie.dev.hexly.ai → Caddy TLS → localhost:7033
```

Add to `/opt/homebrew/etc/Caddyfile`:

```caddyfile
frogie.dev.hexly.ai {
    reverse_proxy localhost:7033
    tls /Users/nocoo/workspace/personal/workflow/certs/cert.pem /Users/nocoo/workspace/personal/workflow/certs/key.pem
}
```

## LLM API Configuration

Frogie connects to LLM APIs through **Raven Proxy** (or any OpenAI-compatible endpoint).

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Frogie Server  │────▶│  Raven Proxy    │────▶│  Copilot API    │
│  :7034          │     │  :7024          │     │  (Claude/GPT)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### User Configuration

Settings are configured in the Frogie web UI Settings page:

| Setting | Description | Example |
|---------|-------------|---------|
| **API URL** | OpenAI-compatible base URL | `http://localhost:7024/v1` |
| **API Key** | Bearer token for authentication | (from Raven or provider) |
| **Model** | Default model for new sessions | `claude-sonnet-4-6` |

These settings are persisted in SQLite (`~/.frogie/frogie.db`).

## Target Architecture

```
┌─────────────────────────────────────────────────────┐
│           Browser (frogie.dev.hexly.ai)             │
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
│   Raven Proxy (:7024) │   │   MCP Servers   │
│   Anthropic↔OpenAI    │   │   (local spawn) │
└───────────┬───────────┘   └─────────────────┘
            │
┌───────────▼───────────┐
│    Copilot / Claude   │
│    (upstream API)     │
└───────────────────────┘
```

**Key Points**:
- Everything runs locally on user's machine (like Claude Code CLI)
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
| API Format | OpenAI-compatible | Works with many providers, well-documented |
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
