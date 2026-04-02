# 02 - System Architecture

## Overview

Frogie consists of two main components:

1. **Agent Server** - Backend that runs the agentic loop and executes tools
2. **Web UI** - Frontend that provides the chat interface

```
frogie/
├── packages/
│   ├── server/          # Agent Server (Bun + Hono)
│   │   ├── src/
│   │   │   ├── engine/      # Agentic loop
│   │   │   ├── tools/       # Tool definitions
│   │   │   ├── mcp/         # MCP client
│   │   │   ├── workspace/   # Workspace management
│   │   │   ├── session/     # Session persistence
│   │   │   ├── routes/      # API routes
│   │   │   └── db/          # SQLite schemas
│   │   └── package.json
│   │
│   └── web/             # Web UI (React + Vite)
│       ├── src/
│       │   ├── components/  # UI components
│       │   ├── hooks/       # Custom hooks
│       │   ├── pages/       # Page components
│       │   └── lib/         # Utilities
│       └── package.json
│
├── docs/                # Documentation
├── package.json         # Workspace root
└── bun.lock
```

## Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Web UI (React)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  ChatPanel   │  │ SessionList  │  │  Workspace   │  │   Settings   │ │
│  │              │  │              │  │  Selector    │  │              │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         └──────────────────┴─────────────────┴─────────────────┘         │
│                                    │                                      │
│                           useChatWebSocket hook                            │
└────────────────────────────────────┼──────────────────────────────────────┘
                                     │ WebSocket / REST
┌────────────────────────────────────▼──────────────────────────────────────┐
│                           Agent Server (Hono)                              │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                         Routes Layer                                 │  │
│  │   WS /ws/chat │ GET /api/sessions │ POST /api/workspaces │ ...     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                    │                                       │
│  ┌─────────────────────────────────▼───────────────────────────────────┐  │
│  │                        Agent Engine                                  │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │  │
│  │  │ AgenticLoop  │  │   Context    │  │   System     │              │  │
│  │  │              │──│  Compressor  │──│   Prompt     │              │  │
│  │  │   query()    │  │              │  │   Builder    │              │  │
│  │  └──────┬───────┘  └──────────────┘  └──────────────┘              │  │
│  │         │                                                           │  │
│  │  ┌──────▼────────────────────────────────────────────────────────┐ │  │
│  │  │                    Tool Executor                               │ │  │
│  │  │   Bash │ Read │ Write │ Edit │ Glob │ Grep │ MCP Tools        │ │  │
│  │  └───────────────────────────────────────────────────────────────┘ │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                    │                                       │
│  ┌──────────────┐  ┌──────────────┐│  ┌──────────────┐                   │
│  │  MCP Manager │  │   Session    ││  │  Workspace   │                   │
│  │              │  │   Store      ││  │   Manager    │                   │
│  └──────────────┘  └──────┬───────┘│  └──────────────┘                   │
│                           │        │                                      │
└───────────────────────────┼────────┼──────────────────────────────────────┘
                            │        │
                     ┌──────▼────────▼──────┐
                     │       SQLite         │
                     │  (workspaces,        │
                     │   sessions,          │
                     │   messages,          │
                     │   mcp_configs,       │
                     │   settings)          │
                     └──────────────────────┘
```

## Data Flow

### Chat Request Flow

```
1. User types message in ChatPanel
                │
2. WebSocket sends { type: 'chat', sessionId, prompt, workspaceId }
                │
3. Agent Server receives, loads session context
                │
4. AgenticLoop.query() starts
                │
   ┌────────────▼────────────────────────────────────────┐
   │  Loop Iteration                                      │
   │  a. Check context size → compress if needed          │
   │  b. Build system prompt (tools, workspace context)   │
   │  c. Call LLM API (streaming)                         │
   │  d. Parse response → yield events to WebSocket       │
   │  e. If tool_use → execute tools → yield results      │
   │  f. Continue or break                                │
   └────────────┬────────────────────────────────────────┘
                │
5. Save session to SQLite
                │
6. WebSocket sends { type: 'turn_complete', turns, inputTokens, outputTokens, costUsd, durationMs }
```

### Event Flow (WebSocket)

See `07-api-protocol.md` for the complete WebSocket protocol specification.

```
Browser                          Server
   │                               │
   │──── { type: 'chat', ... } ───▶│
   │                               │
   │◀── { type: 'session_start' }──│
   │◀─── { type: 'thinking', ...}──│
   │◀─── { type: 'text', ... } ────│  (streaming)
   │◀─── { type: 'tool_use', ... }─│
   │                               │  (tool execution)
   │◀─ { type: 'tool_result', ... }│
   │◀─── { type: 'text', ... } ────│
   │◀─ { type: 'turn_complete' } ──│  (flat fields, not nested stats)
   │◀─ { type: 'session_saved' } ──│
   │                               │
```

## Configuration

### Server Configuration

```typescript
// config.ts
interface ServerConfig {
  // Server (from env or defaults)
  port: number                    // Default: 7034
  host: string                    // Default: '0.0.0.0'
  
  // Database (from env or defaults)
  dbPath: string                  // Default: '~/.frogie/frogie.db'
}

// LLM settings are stored in SQLite settings table, not env vars
// See 06-data-model.md for schema
```

### Environment Variables

Only server-level config uses environment variables:

```bash
# Server
FROGIE_PORT=7034
FROGIE_HOST=0.0.0.0

# Database
FROGIE_DB_PATH=~/.frogie/frogie.db
```

### User Settings (SQLite)

LLM configuration is stored in the `settings` table and managed via the web UI:

| Setting | Description | Default |
|---------|-------------|---------|
| `llm_base_url` | Anthropic API URL | `http://localhost:7024/v1` |
| `llm_api_key` | API key for LLM provider | (empty) |
| `llm_model` | Default model for new sessions | `claude-sonnet-4-6` |
| `max_turns` | Maximum turns per session | 50 |
| `max_budget_usd` | Cost limit per session | 10.0 |

## Security Model

Frogie runs locally with **full user permissions**. There is no sandbox.

1. **No Sandbox**
   - Tools execute with the same permissions as the user running Frogie
   - File operations can access any path the user can access
   - Bash commands run unrestricted in the workspace directory

2. **Trust Model**
   - User trusts the AI agent
   - No permission confirmation dialogs - operations execute immediately
   - This is intentional: Frogie is a power-user tool, not a restricted environment

3. **API Key Protection**
   - Keys stored in SQLite settings table (local file)
   - Never logged or exposed in responses
