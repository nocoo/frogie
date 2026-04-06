-- Migration: 004_prompts.sql
-- Description: Add prompt configuration tables for System Prompt Builder

-- Global prompt layers (single source of truth for defaults)
CREATE TABLE global_prompts (
  layer TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Workspace-level prompt overrides
CREATE TABLE workspace_prompts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  layer TEXT NOT NULL,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

  UNIQUE(workspace_id, layer)
);

CREATE INDEX idx_workspace_prompts_workspace ON workspace_prompts(workspace_id);

-- Insert default values for all 7 layers
INSERT INTO global_prompts (layer, content) VALUES
  ('identity', 'You are an AI assistant with access to tools. Use the tools provided to help the user accomplish their tasks.

You should use tools when they would help you complete the task more accurately or efficiently.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming.'),

  ('system_rules', '# System

- All text you output outside of tool use is displayed to the user. Use Github-flavored markdown for formatting.
- Tools are executed based on user''s permission settings. If the user denies a tool call, do not re-attempt the exact same call.
- Tool results may include <system-reminder> tags containing useful information from the system.
- The conversation has unlimited context through automatic summarization.'),

  ('tool_descriptions', '# Available Tools

{{tools}}'),

  ('git_context', '# Git Status

{{git_status}}'),

  ('project_instructions', ''),

  ('working_directory', '# Working Directory

{{cwd}}'),

  ('date_context', 'Today''s date is {{date}}.');
