# 06 - Data Model

## Overview

Frogie uses a **dual persistence model**:

1. **open-agent-sdk** handles message history (file-based, managed by SDK)
2. **SQLite** handles session index, workspace config, MCP config, and global settings

This separation respects open-agent-sdk's built-in persistence while adding the multi-workspace indexing Frogie needs.

## Data Ownership

```
┌─────────────────────────────────────────────────────────────────┐
│                    open-agent-sdk (file-based)                   │
│  Location: ~/.open-agent-sdk/sessions/<id>/transcript.json      │
│  Contents: { metadata, messages }                                │
│  Managed by SDK, not directly accessed by Frogie                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    SQLite (~/.frogie/frogie.db)                  │
│  - Session INDEX (id, workspace_id, name, model, timestamps)    │
│  - Workspace registry                                            │
│  - MCP configurations                                            │
│  - Global settings                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Entity Relationship

```
┌─────────────┐       ┌─────────────┐
│  Workspace  │──1:N──│   Session   │ ← Index only, messages in SDK files
└─────────────┘       │   (index)   │
       │              └─────────────┘
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

### Sessions (Index Only)

```sql
-- Session index for fast discovery and workspace association
-- Actual message history is stored by open-agent-sdk in files
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                    -- Session ID (matches open-agent-sdk)
  workspace_id TEXT NOT NULL,             -- FK to workspaces
  name TEXT,                              -- User-assigned name (nullable)
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  created_at INTEGER NOT NULL,            -- Unix timestamp ms
  updated_at INTEGER NOT NULL,            -- Unix timestamp ms
  
  -- Aggregated stats (updated after each query)
  message_count INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
```

**Note**: To retrieve actual message history, use `open-agent-sdk`'s `getSessionMessages(id)` function.

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

**Note**: Message history is managed by open-agent-sdk, not Frogie's SQLite database. The format below is for reference only (matches Anthropic API format):

- `user` messages: `{ role: 'user', content: [{ type: 'text', text: '...' }] }`
- `assistant` messages: `{ role: 'assistant', content: [TextBlock | ThinkingBlock | ToolUseBlock] }`
- `tool_result`: `{ type: 'tool_result', tool_use_id: '...', content: '...' }`

For detailed format, see [open-agent-sdk types](https://github.com/codeany-ai/open-agent-sdk-typescript/blob/main/src/types.ts).

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
  
  /**
   * Delete session from SQLite index only.
   * IMPORTANT: Caller must also call open-agent-sdk's deleteSession(id) 
   * to remove the transcript.json file from disk.
   */
  deleteSessionIndex(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
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

// Note: Message type is defined by open-agent-sdk, not Frogie
// Use getSessionMessages(id) from open-agent-sdk to retrieve messages

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
