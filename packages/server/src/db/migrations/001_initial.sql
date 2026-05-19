-- Migration 001: Initial schema
-- Creates all core tables for Frogie

-- Global application settings (single row, id always 'global')
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  llm_base_url TEXT NOT NULL,
  llm_api_key TEXT NOT NULL,
  llm_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  max_turns INTEGER NOT NULL DEFAULT 50,
  max_budget_usd REAL NOT NULL DEFAULT 10.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Initialize with defaults if not exists
INSERT OR IGNORE INTO settings (id, llm_base_url, llm_api_key, llm_model, created_at, updated_at)
VALUES ('global', 'http://localhost:7024/v1', '', 'claude-sonnet-4-6', 0, 0);

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER,
  settings TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_workspaces_path ON workspaces(path);
CREATE INDEX IF NOT EXISTS idx_workspaces_last_accessed ON workspaces(last_accessed DESC);

-- Session index for fast discovery and workspace association
-- Actual message history is stored by open-agent-sdk in files
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT,
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

-- MCP server configurations
CREATE TABLE IF NOT EXISTS mcp_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'stdio',
  config TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mcp_workspace ON mcp_configs(workspace_id);
