/**
 * MCP Manager
 *
 * Manages MCP connections for a single workspace.
 * Handles connect/disconnect/reconnect lifecycle.
 */

import type { ToolDefinition } from '../engine/frogie-agent'
import { createMCPConnection } from './client'
import type { MCPConnection, MCPServerConfig, MCPConnectionStatus } from './types'

/**
 * Connection info for status reporting
 */
export interface MCPConnectionInfo {
  name: string
  status: MCPConnectionStatus
  toolCount: number
  error?: string | undefined
}

/**
 * MCP Manager for a single workspace
 */
export class MCPManager {
  private connections = new Map<string, MCPConnection>()
  private connectionErrors = new Map<string, string>()

  /**
   * Connect to an MCP server
   */
  async connect(name: string, config: MCPServerConfig): Promise<MCPConnection> {
    // Close existing connection if any
    if (this.connections.has(name)) {
      await this.disconnect(name)
    }

    this.connectionErrors.delete(name)

    try {
      const connection = await createMCPConnection(name, config)
      this.connections.set(name, connection)
      return connection
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      this.connectionErrors.set(name, errorMsg)
      throw err
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (conn) {
      await conn.close()
      this.connections.delete(name)
    }
    this.connectionErrors.delete(name)
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.connections.keys()).map((name) => this.disconnect(name))
    )
  }

  /**
   * Reconnect to an MCP server
   */
  async reconnect(name: string, config: MCPServerConfig): Promise<MCPConnection> {
    await this.disconnect(name)
    return this.connect(name, config)
  }

  /**
   * Get a specific connection
   */
  getConnection(name: string): MCPConnection | undefined {
    return this.connections.get(name)
  }

  /**
   * Get all connections
   */
  getAllConnections(): MCPConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * Get all tools from all connected servers
   */
  getAllTools(): ToolDefinition[] {
    return this.getAllConnections().flatMap((conn) => conn.tools)
  }

  /**
   * Get connection status info
   */
  getConnectionInfo(name: string): MCPConnectionInfo {
    const conn = this.connections.get(name)
    const error = this.connectionErrors.get(name)

    if (conn) {
      return {
        name,
        status: conn.status,
        toolCount: conn.tools.length,
      }
    }

    return {
      name,
      status: error ? 'error' : 'disconnected',
      toolCount: 0,
      error,
    }
  }

  /**
   * Get all connection info
   */
  getAllConnectionInfo(): MCPConnectionInfo[] {
    const names = new Set([
      ...this.connections.keys(),
      ...this.connectionErrors.keys(),
    ])
    return Array.from(names).map((name) => this.getConnectionInfo(name))
  }
}

/**
 * Workspace-scoped MCP Manager
 *
 * Manages MCP connections per workspace.
 */
export class WorkspaceMCPManager {
  private managers = new Map<string, MCPManager>()

  /**
   * Get or create manager for a workspace
   */
  getManager(workspaceId: string): MCPManager {
    let manager = this.managers.get(workspaceId)
    if (!manager) {
      manager = new MCPManager()
      this.managers.set(workspaceId, manager)
    }
    return manager
  }

  /**
   * Connect all configured MCP servers for a workspace
   */
  async connectForWorkspace(
    workspaceId: string,
    configs: { name: string; config: MCPServerConfig; enabled: boolean }[]
  ): Promise<void> {
    const manager = this.getManager(workspaceId)

    for (const { name, config, enabled } of configs) {
      if (!enabled) continue

      try {
        await manager.connect(name, config)
      } catch (err) {
        console.error(
          `Failed to connect MCP server ${name}:`,
          err instanceof Error ? err.message : 'Unknown error'
        )
        // Continue with other servers
      }
    }
  }

  /**
   * Disconnect all MCP servers for a workspace
   */
  async disconnectWorkspace(workspaceId: string): Promise<void> {
    const manager = this.managers.get(workspaceId)
    if (manager) {
      await manager.disconnectAll()
      this.managers.delete(workspaceId)
    }
  }

  /**
   * Get all tools for a workspace
   */
  getToolsForWorkspace(workspaceId: string): ToolDefinition[] {
    const manager = this.managers.get(workspaceId)
    return manager?.getAllTools() ?? []
  }
}
