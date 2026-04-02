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
   - Isolated sessions, MCP configs, and tool execution contexts per workspace

## Non-Goals (v1)

- Mobile-first design (desktop browser is primary target)
- Collaborative editing (single-user focus)
- Cloud-hosted agent execution (local proxy required)

## Reference Projects

This project synthesizes the best ideas from:

| Project | What We Take |
|---------|--------------|
| **Claude Code CLI** | Tool system prompts, permission model, Skill concept |
| **open-agent-sdk** | Agentic loop structure, context compression, MCP client |
| **Raven Proxy** | Proven API forwarding, token management patterns |

## Target Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Browser (Frogie UI)                 │
│  React + Tailwind + shadcn/ui                       │
│  - Chat interface                                    │
│  - Tool visualization                                │
│  - Session management                                │
│  - Workspace selector                                │
└─────────────────────────┬───────────────────────────┘
                          │ WebSocket
┌─────────────────────────▼───────────────────────────┐
│                  Frogie Agent Server                 │
│  Bun/Node.js + Hono                                 │
│  - Agentic loop engine                              │
│  - Tool executor (with sandbox)                     │
│  - MCP connection manager                           │
│  - Session persistence (SQLite)                     │
└─────────────────────────┬───────────────────────────┘
                          │ HTTP (OpenAI-compatible)
┌─────────────────────────▼───────────────────────────┐
│              LLM API Provider                        │
│  (Raven Proxy / Anthropic API / Other)              │
└─────────────────────────────────────────────────────┘
```

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
