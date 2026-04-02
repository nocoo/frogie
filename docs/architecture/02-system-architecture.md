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
│                            useChatStream hook                             │
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
                     │   mcp_configs)       │
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
6. WebSocket sends { type: 'turn_complete', stats }
```

### Event Flow (WebSocket)

```
Browser                          Server
   │                               │
   │──── { type: 'chat', ... } ───▶│
   │                               │
   │◀─── { type: 'text', ... } ────│  (streaming)
   │◀─── { type: 'text', ... } ────│
   │◀─── { type: 'thinking', ...}──│
   │◀─── { type: 'tool_use', ... }─│
   │                               │  (tool execution)
   │◀─ { type: 'tool_result', ... }│
   │◀─── { type: 'text', ... } ────│
   │◀─ { type: 'turn_complete', ..}│
   │                               │
```

## Configuration

### Server Configuration

```typescript
// config.ts
interface ServerConfig {
  // Server
  port: number                    // Default: 7025
  host: string                    // Default: '0.0.0.0'
  
  // LLM API
  llmBaseUrl: string              // e.g., 'http://localhost:7024/v1'
  llmApiKey: string               // API key for LLM provider
  llmModel: string                // Default: 'claude-sonnet-4-6'
  
  // Limits
  maxTurns: number                // Default: 50
  maxBudgetUsd: number            // Default: 10.0
  
  // Database
  dbPath: string                  // Default: './data/frogie.db'
}
```

### Environment Variables

```bash
# Server
FROGIE_PORT=7025
FROGIE_HOST=0.0.0.0

# LLM API (required)
FROGIE_LLM_BASE_URL=http://localhost:7024/v1
FROGIE_LLM_API_KEY=your-api-key
FROGIE_LLM_MODEL=claude-sonnet-4-6

# Limits
FROGIE_MAX_TURNS=50
FROGIE_MAX_BUDGET_USD=10.0

# Database
FROGIE_DB_PATH=./data/frogie.db
```

## Security Considerations

1. **Tool Execution Sandbox**
   - Bash commands run with configurable restrictions
   - File operations limited to workspace directory
   - Network access can be restricted

2. **Permission Levels**
   - `auto`: All operations allowed (trust mode)
   - `confirm`: Dangerous operations require user confirmation
   - `readonly`: Only read operations allowed

3. **API Key Protection**
   - Keys stored in environment, never in database
   - Never logged or exposed to frontend
