# 07 - API Protocol

## Overview

Frogie uses a combination of WebSocket (for real-time chat) and REST (for CRUD operations) APIs.

**This document is the single source of truth for the WebSocket protocol.**

## WebSocket Protocol

### Connection

```
ws://localhost:7034/ws
```

### Client → Server Messages

```typescript
// Start a chat turn
interface ChatMessage {
  type: 'chat'
  sessionId: string
  workspaceId: string
  prompt: string
}

// Interrupt current execution
interface InterruptMessage {
  type: 'interrupt'
  sessionId: string
}

// Ping for keepalive
interface PingMessage {
  type: 'ping'
}
```

### Server → Client Events

```typescript
// Session started (first event after chat message)
interface SessionStartEvent {
  type: 'session_start'
  sessionId: string
  model: string
}

// Text content (streaming)
interface TextEvent {
  type: 'text'
  text: string
}

// Thinking content
interface ThinkingEvent {
  type: 'thinking'
  content: string
}

// Tool use started
interface ToolUseEvent {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

// Tool execution result
interface ToolResultEvent {
  type: 'tool_result'
  id: string
  output: string
  isError: boolean
}

// Context compression started
interface CompactStartEvent {
  type: 'compact_start'
}

// Context compression completed
interface CompactDoneEvent {
  type: 'compact_done'
  summary: string
}

// Turn completed successfully
interface TurnCompleteEvent {
  type: 'turn_complete'
  turns: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
}

// Budget limit reached
interface BudgetExceededEvent {
  type: 'budget_exceeded'
  costUsd: number
}

// Session saved to database
interface SessionSavedEvent {
  type: 'session_saved'
}

// Error occurred
interface ErrorEvent {
  type: 'error'
  message: string
  code?: string
}

// Execution interrupted by user
interface InterruptedEvent {
  type: 'interrupted'
}

// Pong response
interface PongEvent {
  type: 'pong'
}
```

### Message Flow Example

```
Client                                Server
   │                                    │
   │─── { type: 'chat', ... } ─────────▶│
   │                                    │
   │◀── { type: 'session_start', ... } ─│
   │◀─── { type: 'thinking', ... } ─────│
   │◀─── { type: 'text', ... } ─────────│
   │◀─── { type: 'tool_use', ... } ─────│
   │                                    │  (tool execution)
   │◀─── { type: 'tool_result', ... } ──│
   │                                    │
   │◀─── { type: 'text', ... } ─────────│
   │◀─── { type: 'turn_complete', ... }─│
   │◀─── { type: 'session_saved' } ─────│
   │                                    │
```

## REST API

### Workspaces

```
GET    /api/workspaces              List all workspaces
POST   /api/workspaces              Create workspace
GET    /api/workspaces/:id          Get workspace details
DELETE /api/workspaces/:id          Delete workspace
```

#### Create Workspace

```http
POST /api/workspaces
Content-Type: application/json

{
  "name": "My Project",
  "path": "/Users/me/workspace/my-project"
}
```

Response:

```json
{
  "id": "01HXYZ...",
  "name": "My Project",
  "path": "/Users/me/workspace/my-project",
  "created_at": 1712000000000,
  "last_accessed": 1712000000000
}
```

### Sessions

```
GET    /api/workspaces/:workspaceId/sessions          List sessions
POST   /api/workspaces/:workspaceId/sessions          Create session
GET    /api/workspaces/:workspaceId/sessions/:id      Get session + messages
DELETE /api/workspaces/:workspaceId/sessions/:id      Delete session (index + files)
POST   /api/workspaces/:workspaceId/sessions/:id/fork Fork session
```

#### Create Session

```http
POST /api/workspaces/01HXYZ.../sessions
Content-Type: application/json

{
  "name": "Debug auth issue",
  "model": "claude-sonnet-4-6"
}
```

#### Get Session with Messages

Messages are retrieved from open-agent-sdk's file storage via `getSessionMessages(id)`:

```http
GET /api/workspaces/01HXYZ.../sessions/01HABC...
```

Response:

```json
{
  "session": {
    "id": "01HABC...",
    "workspace_id": "01HXYZ...",
    "name": "Debug auth issue",
    "model": "claude-sonnet-4-6",
    "message_count": 12,
    "total_cost_usd": 0.05
  },
  "messages": [...]  // From open-agent-sdk getSessionMessages()
}
```

#### Delete Session

Deletes both the SQLite index and open-agent-sdk's transcript file:

```http
DELETE /api/workspaces/01HXYZ.../sessions/01HABC...
```

Implementation must call both:
1. `db.deleteSessionIndex(id)` — remove SQLite index
2. `deleteSession(id)` from open-agent-sdk — remove `~/.open-agent-sdk/sessions/<id>/`

### MCP

```
GET    /api/workspaces/:workspaceId/mcp              List MCP configs + status
POST   /api/workspaces/:workspaceId/mcp              Add MCP server
DELETE /api/workspaces/:workspaceId/mcp/:name        Remove MCP server
POST   /api/workspaces/:workspaceId/mcp/:name/reconnect  Reconnect server
```

#### Add MCP Server (stdio)

```http
POST /api/workspaces/01HXYZ.../mcp
Content-Type: application/json

{
  "name": "memory",
  "type": "stdio",
  "config": {
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-server-memory"]
  }
}
```

#### Add MCP Server (SSE)

```http
POST /api/workspaces/01HXYZ.../mcp
Content-Type: application/json

{
  "name": "remote-tools",
  "type": "sse",
  "config": {
    "url": "https://mcp.example.com/sse",
    "headers": {
      "Authorization": "Bearer xxx"
    }
  }
}
```

### Settings

```
GET    /api/settings                Get global settings
PATCH  /api/settings                Update settings
```

#### Get Settings Response

```json
{
  "llmBaseUrl": "http://localhost:7024/v1",
  "llmApiKey": "sk-***",           // Masked in response
  "llmModel": "claude-sonnet-4-6",
  "maxTurns": 50,
  "maxBudgetUsd": 10.0
}
```

#### Update Settings Request

```http
PATCH /api/settings
Content-Type: application/json

{
  "llmBaseUrl": "http://localhost:7024/v1",
  "llmApiKey": "sk-new-key",
  "llmModel": "claude-opus-4"
}
```

Note: All fields are optional in PATCH. Only provided fields are updated.

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "WORKSPACE_NOT_FOUND",
    "message": "Workspace not found: 01HXYZ..."
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `WORKSPACE_NOT_FOUND` | 404 | Workspace does not exist |
| `SESSION_NOT_FOUND` | 404 | Session does not exist |
| `MCP_CONNECTION_FAILED` | 500 | Failed to connect MCP server |
| `LLM_API_ERROR` | 502 | Error from LLM API |
| `BUDGET_EXCEEDED` | 402 | Cost budget exceeded |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Server Implementation

```typescript
// packages/server/src/routes/index.ts

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { upgradeWebSocket } from 'hono/bun'

const app = new Hono()

// CORS for web UI
app.use('*', cors({
  origin: ['http://localhost:5173'],  // Vite dev server
  credentials: true,
}))

// REST routes
app.route('/api/workspaces', workspacesRouter)
app.route('/api/settings', settingsRouter)

// WebSocket
app.get('/ws', upgradeWebSocket((c) => ({
  onMessage(event, ws) {
    const msg = JSON.parse(event.data.toString())
    handleWebSocketMessage(msg, ws)
  },
  onClose(event, ws) {
    cleanupSession(ws)
  },
})))

export default app
```
