/**
 * MCP Types
 *
 * Type definitions for MCP (Model Context Protocol) integration.
 */

import type { ToolDefinition } from '../engine/frogie-agent'

/**
 * MCP transport type
 */
export type MCPTransportType = 'stdio' | 'sse' | 'http'

/**
 * MCP stdio configuration
 */
export interface MCPStdioConfig {
  type?: 'stdio' | undefined
  command: string
  args?: string[] | undefined
  env?: Record<string, string> | undefined
}

/**
 * MCP SSE configuration
 */
export interface MCPSSEConfig {
  type: 'sse'
  url: string
  headers?: Record<string, string> | undefined
}

/**
 * MCP HTTP configuration
 */
export interface MCPHTTPConfig {
  type: 'http'
  url: string
  headers?: Record<string, string> | undefined
}

/**
 * MCP server configuration union
 */
export type MCPServerConfig = MCPStdioConfig | MCPSSEConfig | MCPHTTPConfig

/**
 * MCP connection status
 */
export type MCPConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

/**
 * MCP connection interface
 */
export interface MCPConnection {
  name: string
  status: MCPConnectionStatus
  tools: ToolDefinition[]
  error?: string
  close(): Promise<void>
}

/**
 * MCP tool definition from server
 */
export interface MCPToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}
