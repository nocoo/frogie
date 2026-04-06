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
  color: string | null
  createdAt: number
  lastAccessed: number | null
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
export interface UpdateWorkspace {
  name?: string
  path?: string
  color?: string | null
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

// =============================================================================
// Prompt Types
// =============================================================================

/**
 * Valid prompt layer names
 */
export type PromptLayerName =
  | 'identity'
  | 'system_rules'
  | 'tool_descriptions'
  | 'git_context'
  | 'project_instructions'
  | 'working_directory'
  | 'date_context'

/**
 * Prompt layer display information
 */
export interface PromptLayerInfo {
  name: PromptLayerName
  title: string
  description: string
}

/**
 * All prompt layers with metadata
 */
export const PROMPT_LAYERS: PromptLayerInfo[] = [
  {
    name: 'identity',
    title: 'Identity',
    description: 'AI basic identity and behavior rules',
  },
  {
    name: 'system_rules',
    title: 'System Rules',
    description: 'Tool usage rules, permission settings, output format',
  },
  {
    name: 'tool_descriptions',
    title: 'Tool Descriptions',
    description: 'Available tools list (auto-generated from {{tools}})',
  },
  {
    name: 'git_context',
    title: 'Git Context',
    description: 'Git status: branch, recent commits, working tree',
  },
  {
    name: 'project_instructions',
    title: 'Project Instructions',
    description: 'Project-specific instructions (CLAUDE.md style)',
  },
  {
    name: 'working_directory',
    title: 'Working Directory',
    description: 'Current working directory path',
  },
  {
    name: 'date_context',
    title: 'Date Context',
    description: 'Current date information',
  },
]

/**
 * Global prompt layer data
 */
export interface GlobalPrompt {
  layer: PromptLayerName
  content: string
  enabled: boolean
  isTemplate: boolean
  updatedAt: number
}

/**
 * Workspace prompt override data
 */
export interface WorkspacePrompt {
  id: string
  workspaceId: string
  layer: PromptLayerName
  content: string
  enabled: boolean
  isTemplate: boolean
  createdAt: number
  updatedAt: number
}

/**
 * Merged prompt layer (global + workspace override)
 */
export interface MergedPromptLayer {
  layer: PromptLayerName
  content: string
  enabled: boolean
  isTemplate: boolean
  isGlobal: boolean
}

/**
 * Prompt preview response
 */
export interface PromptPreviewResponse {
  assembledPrompt: string
  tokenEstimate: number
  /**
   * If true, only builtin tools are included in {{tools}}.
   * MCP tools require async connection and are not available in preview.
   * The actual chat prompt will include MCP tools if enabled for the workspace.
   */
  builtinToolsOnly: boolean
  layers: {
    layer: PromptLayerName
    content: string
    enabled: boolean
  }[]
}
