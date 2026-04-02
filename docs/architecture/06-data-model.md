# 06 - Data Model

## Overview

Frogie uses SQLite for persistence, keeping all data local and simple. The schema supports multi-workspace, multi-session operation with full message history.

## Entity Relationship

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  Workspace  │──1:N──│   Session   │──1:N──│   Message   │
└─────────────┘       └─────────────┘       └─────────────┘
       │
       │ 1:N
       ▼
┌─────────────┐
│  MCPConfig  │
└─────────────┘

┌─────────────┐
│  Settings   │  (Global, single row)
└─────────────┘
```

## Schema

### Settings (Global)

```sql
-- Global application settings (single row, id always 'global')
CREATE TABLE settings (
  id TEXT PRIMARY KEY DEFAULT 'global',     -- Always 'global'
  llm_base_url TEXT NOT NULL,               -- e.g., 'http://localhost:7024/v1'
  llm_api_key TEXT NOT NULL,                -- API key (stored locally)
  llm_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  max_turns INTEGER NOT NULL DEFAULT 50,
  max_budget_usd REAL NOT NULL DEFAULT 10.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Initialize with defaults
INSERT INTO settings (id, llm_base_url, llm_api_key, llm_model, created_at, updated_at)
VALUES ('global', 'http://localhost:7024/v1', '', 'claude-sonnet-4-6', 0, 0);
```

### Workspaces

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,                    -- ULID
  name TEXT NOT NULL,                     -- Display name
  path TEXT NOT NULL UNIQUE,              -- Absolute path to workspace root
  created_at INTEGER NOT NULL,            -- Unix timestamp ms
  last_accessed INTEGER,                  -- Unix timestamp ms
  settings TEXT DEFAULT '{}'              -- JSON: workspace-specific settings
);

CREATE INDEX idx_workspaces_path ON workspaces(path);
CREATE INDEX idx_workspaces_last_accessed ON workspaces(last_accessed DESC);
```

### Sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                    -- ULID
  workspace_id TEXT NOT NULL,             -- FK to workspaces
  name TEXT,                              -- User-assigned name (nullable)
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  created_at INTEGER NOT NULL,            -- Unix timestamp ms
  updated_at INTEGER NOT NULL,            -- Unix timestamp ms
  message_count INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
```

### Messages

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                    -- ULID
  session_id TEXT NOT NULL,               -- FK to sessions
  sequence INTEGER NOT NULL,              -- Order within session
  role TEXT NOT NULL,                     -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,                  -- JSON: content blocks
  created_at INTEGER NOT NULL,            -- Unix timestamp ms
  
  -- Metadata
  input_tokens INTEGER,                   -- For assistant messages
  output_tokens INTEGER,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, sequence)
);

CREATE INDEX idx_messages_session ON messages(session_id, sequence);
```

### MCP Configurations

```sql
CREATE TABLE mcp_configs (
  id TEXT PRIMARY KEY,                    -- ULID
  workspace_id TEXT NOT NULL,             -- FK to workspaces
  name TEXT NOT NULL,                     -- Server name (unique per workspace)
  type TEXT NOT NULL DEFAULT 'stdio',     -- 'stdio' | 'sse' | 'http'
  config TEXT NOT NULL,                   -- JSON: transport config
  enabled INTEGER DEFAULT 1,              -- Boolean
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, name)
);

CREATE INDEX idx_mcp_workspace ON mcp_configs(workspace_id);
```

## Message Content Format

Messages store content as JSON arrays of content blocks:

### User Message

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Read the package.json file" }
  ]
}
```

### User Message with Tool Results

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_123",
      "content": "{ \"name\": \"frogie\", \"version\": \"0.1.0\" }"
    }
  ]
}
```

### Assistant Message

```json
{
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "I need to read the package.json..." },
    { "type": "text", "text": "I'll read the package.json file for you." },
    {
      "type": "tool_use",
      "id": "toolu_123",
      "name": "Read",
      "input": { "file_path": "/workspace/package.json" }
    }
  ]
}
```

### System Message (Compact Boundary)

```json
{
  "role": "system",
  "content": [
    {
      "type": "compact_boundary",
      "summary": "Previous conversation summary...",
      "compacted_at": 1712000000000,
      "original_message_count": 42
    }
  ]
}
```

## Database Access Layer

```typescript
// packages/server/src/db/index.ts

import Database from 'better-sqlite3'

export class DB {
  private db: Database.Database
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }
  
  private migrate() {
    // Run migrations...
  }
  
  // Workspaces
  
  createWorkspace(workspace: CreateWorkspace): Workspace {
    const id = ulid()
    const now = Date.now()
    
    this.db.prepare(`
      INSERT INTO workspaces (id, name, path, created_at, last_accessed)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, workspace.name, workspace.path, now, now)
    
    return this.getWorkspace(id)!
  }
  
  getWorkspace(id: string): Workspace | null {
    return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | null
  }
  
  getWorkspaceByPath(path: string): Workspace | null {
    return this.db.prepare('SELECT * FROM workspaces WHERE path = ?').get(path) as Workspace | null
  }
  
  listWorkspaces(): Workspace[] {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY last_accessed DESC').all() as Workspace[]
  }
  
  touchWorkspace(id: string): void {
    this.db.prepare('UPDATE workspaces SET last_accessed = ? WHERE id = ?').run(Date.now(), id)
  }
  
  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  }
  
  // Sessions
  
  createSession(session: CreateSession): Session {
    const id = ulid()
    const now = Date.now()
    
    this.db.prepare(`
      INSERT INTO sessions (id, workspace_id, name, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, session.workspaceId, session.name ?? null, session.model, now, now)
    
    return this.getSession(id)!
  }
  
  getSession(id: string): Session | null {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | null
  }
  
  listSessions(workspaceId: string): Session[] {
    return this.db.prepare(
      'SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC'
    ).all(workspaceId) as Session[]
  }
  
  updateSessionStats(id: string, stats: SessionStats): void {
    this.db.prepare(`
      UPDATE sessions 
      SET message_count = ?, total_input_tokens = ?, total_output_tokens = ?, 
          total_cost_usd = ?, updated_at = ?
      WHERE id = ?
    `).run(
      stats.messageCount, stats.inputTokens, stats.outputTokens,
      stats.costUsd, Date.now(), id
    )
  }
  
  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }
  
  // Messages
  
  appendMessages(sessionId: string, messages: CreateMessage[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, sequence, role, content, created_at, input_tokens, output_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    const maxSeq = this.db.prepare(
      'SELECT COALESCE(MAX(sequence), -1) as max FROM messages WHERE session_id = ?'
    ).get(sessionId) as { max: number }
    
    let seq = maxSeq.max + 1
    
    const insertMany = this.db.transaction((msgs: CreateMessage[]) => {
      for (const msg of msgs) {
        stmt.run(
          ulid(), sessionId, seq++, msg.role,
          JSON.stringify(msg.content), Date.now(),
          msg.inputTokens ?? null, msg.outputTokens ?? null
        )
      }
    })
    
    insertMany(messages)
  }
  
  getMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY sequence'
    ).all(sessionId) as MessageRow[]
    
    return rows.map(row => ({
      ...row,
      content: JSON.parse(row.content),
    }))
  }
  
  clearMessages(sessionId: string): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  }
  
  // MCP Configs
  
  saveMCPConfig(workspaceId: string, config: CreateMCPConfig): MCPConfig {
    const id = ulid()
    const now = Date.now()
    
    this.db.prepare(`
      INSERT OR REPLACE INTO mcp_configs (id, workspace_id, name, type, config, created_at, updated_at)
      VALUES (
        COALESCE((SELECT id FROM mcp_configs WHERE workspace_id = ? AND name = ?), ?),
        ?, ?, ?, ?, 
        COALESCE((SELECT created_at FROM mcp_configs WHERE workspace_id = ? AND name = ?), ?),
        ?
      )
    `).run(
      workspaceId, config.name, id,
      workspaceId, config.name, config.type, JSON.stringify(config.config),
      workspaceId, config.name, now,
      now
    )
    
    return this.getMCPConfig(workspaceId, config.name)!
  }
  
  getMCPConfig(workspaceId: string, name: string): MCPConfig | null {
    const row = this.db.prepare(
      'SELECT * FROM mcp_configs WHERE workspace_id = ? AND name = ?'
    ).get(workspaceId, name) as MCPConfigRow | null
    
    if (!row) return null
    return { ...row, config: JSON.parse(row.config) }
  }
  
  getMCPConfigs(workspaceId: string): MCPConfig[] {
    const rows = this.db.prepare(
      'SELECT * FROM mcp_configs WHERE workspace_id = ? AND enabled = 1'
    ).all(workspaceId) as MCPConfigRow[]
    
    return rows.map(row => ({ ...row, config: JSON.parse(row.config) }))
  }
  
  deleteMCPConfig(workspaceId: string, name: string): void {
    this.db.prepare(
      'DELETE FROM mcp_configs WHERE workspace_id = ? AND name = ?'
    ).run(workspaceId, name)
  }
}
```

## Types

```typescript
// packages/server/src/db/types.ts

export interface Workspace {
  id: string
  name: string
  path: string
  created_at: number
  last_accessed: number | null
  settings: string
}

export interface Session {
  id: string
  workspace_id: string
  name: string | null
  model: string
  created_at: number
  updated_at: number
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cost_usd: number
}

export interface Message {
  id: string
  session_id: string
  sequence: number
  role: 'user' | 'assistant' | 'system'
  content: ContentBlock[]
  created_at: number
  input_tokens: number | null
  output_tokens: number | null
}

export interface MCPConfig {
  id: string
  workspace_id: string
  name: string
  type: 'stdio' | 'sse' | 'http'
  config: MCPServerConfig
  enabled: boolean
  created_at: number
  updated_at: number
}
```
