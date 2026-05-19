/**
 * Database types
 *
 * Type definitions for all database entities
 */

/**
 * Global application settings (single row)
 */
export interface Settings {
  id: string
  llm_base_url: string
  llm_api_key: string
  llm_model: string
  max_turns: number
  max_budget_usd: number
  created_at: number
  updated_at: number
}

/**
 * Partial settings for updates
 */
export type SettingsUpdate = Partial<
  Omit<Settings, 'id' | 'created_at' | 'updated_at'>
>

/**
 * Workspace entity
 */
export interface Workspace {
  id: string
  name: string
  path: string
  color: string | null
  created_at: number
  last_accessed: number | null
  settings: string // JSON string
}

/**
 * Create workspace input
 */
export interface CreateWorkspace {
  name: string
  path: string
  color?: string | null
}

/**
 * Update workspace input
 */
export type WorkspaceUpdate = Partial<Omit<Workspace, 'id' | 'created_at'>>

/**
 * Session index entry (messages stored by open-agent-sdk)
 */
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

/**
 * Create session input
 */
export interface CreateSession {
  id?: string // Optional - use provided ID or generate new one
  workspace_id: string
  name?: string | null
  model: string
}

/**
 * Session statistics update
 */
export interface SessionStats {
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cost_usd: number
}

/**
 * MCP server configuration
 */
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

/**
 * Raw MCP config row (config as JSON string)
 */
export interface MCPConfigRow {
  id: string
  workspace_id: string
  name: string
  type: 'stdio' | 'sse' | 'http'
  config: string // JSON string
  enabled: number // SQLite boolean
  created_at: number
  updated_at: number
}

/**
 * Create/update MCP config input
 */
export interface CreateMCPConfig {
  name: string
  type: 'stdio' | 'sse' | 'http'
  config: MCPServerConfig
  enabled?: boolean
}

/**
 * MCP server configuration (transport-specific)
 */
export interface MCPServerConfig {
  // stdio transport
  command?: string
  args?: string[]
  env?: Record<string, string>

  // SSE/HTTP transport
  url?: string
  headers?: Record<string, string>
}

/**
 * User entity (Google OAuth)
 */
export interface User {
  id: string
  email: string
  name: string | null
  image: string | null
  google_id: string
  created_at: number
  updated_at: number
}

/**
 * Create user input (from OAuth callback)
 */
export interface CreateUser {
  email: string
  name?: string | null
  image?: string | null
  google_id: string
}
