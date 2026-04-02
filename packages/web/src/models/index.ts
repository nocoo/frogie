/**
 * Model Types
 *
 * TypeScript interfaces matching API responses from the server.
 */

/**
 * Global application settings
 */
export interface Settings {
  llmBaseUrl: string
  llmApiKey: string // Masked from server
  llmModel: string
  maxTurns: number
  maxBudgetUsd: number
}

/**
 * Settings update input
 */
export interface SettingsUpdate {
  llm_base_url?: string | undefined
  llm_api_key?: string | undefined
  llm_model?: string | undefined
  max_turns?: number | undefined
  max_budget_usd?: number | undefined
}

/**
 * Workspace - project root for organizing sessions
 */
export interface Workspace {
  id: string
  name: string
  path: string
  createdAt: number
  lastAccessed: number | null
}

/**
 * Create workspace input
 */
export interface CreateWorkspace {
  name: string
  path: string
}

/**
 * Session - conversation with an AI agent
 */
export interface Session {
  id: string
  workspaceId: string
  name: string | null
  model: string
  createdAt: number
  updatedAt: number
  messageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
}

/**
 * Create session input
 */
export interface CreateSession {
  name?: string | null
  model: string
}

/**
 * MCP server configuration
 */
export interface MCPConfig {
  id: string
  workspaceId: string
  name: string
  type: 'stdio' | 'sse' | 'http'
  config: MCPServerConfig
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/**
 * MCP server transport configuration
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
 * Create MCP config input
 */
export interface CreateMCPConfig {
  name: string
  type: 'stdio' | 'sse' | 'http'
  config: MCPServerConfig
  enabled?: boolean
}

/**
 * API error response
 */
export interface ApiError {
  error: {
    code: string
    message: string
  }
}
