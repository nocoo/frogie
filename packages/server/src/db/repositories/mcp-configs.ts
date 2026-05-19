/**
 * MCP Config Repository
 *
 * Manages MCP server configurations for workspaces
 */

import type { DatabaseLike } from '../connection'
import type {
  MCPConfig,
  MCPConfigRow,
  CreateMCPConfig,
  MCPServerConfig,
} from '../types'
import { ulid } from 'ulid'

/**
 * Parse MCP config row from database
 */
function parseConfigRow(row: MCPConfigRow): MCPConfig {
  return {
    ...row,
    config: JSON.parse(row.config) as MCPServerConfig,
    enabled: row.enabled === 1,
  }
}

/**
 * Create or update an MCP configuration
 *
 * Uses upsert semantics - if a config with same workspace_id + name exists, update it
 *
 * @param workspaceId - Workspace ID
 * @param input - MCP config input
 * @returns Created or updated config
 */
export function saveMCPConfig(
  db: DatabaseLike,
  workspaceId: string,
  input: CreateMCPConfig
): MCPConfig {
  const now = Date.now()
  const enabled = input.enabled !== false ? 1 : 0

  // Check if config already exists
  const existing = getMCPConfig(db, workspaceId, input.name)

  if (existing) {
    // Update existing config
    db.prepare(
      `
      UPDATE mcp_configs
      SET type = ?, config = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `
    ).run(input.type, JSON.stringify(input.config), enabled, now, existing.id)

    const updated = getMCPConfig(db, workspaceId, input.name)
    if (!updated) {
      throw new Error('Failed to update MCP config')
    }
    return updated
  }

  // Create new config
  const id = ulid()
  db.prepare(
    `
    INSERT INTO mcp_configs (id, workspace_id, name, type, config, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(id, workspaceId, input.name, input.type, JSON.stringify(input.config), enabled, now, now)

  const created = getMCPConfig(db, workspaceId, input.name)
  if (!created) {
    throw new Error('Failed to create MCP config')
  }
  return created
}

/**
 * Get MCP config by workspace and name
 *
 * @param workspaceId - Workspace ID
 * @param name - Server name
 * @returns MCP config or null
 */
export function getMCPConfig(
  db: DatabaseLike,
  workspaceId: string,
  name: string
): MCPConfig | null {
  const row = db
    .prepare('SELECT * FROM mcp_configs WHERE workspace_id = ? AND name = ?')
    .get(workspaceId, name) as MCPConfigRow | undefined

  if (!row) {
    return null
  }
  return parseConfigRow(row)
}

/**
 * Get MCP config by ID
 *
 * @param id - Config ID
 * @returns MCP config or null
 */
export function getMCPConfigById(
  db: DatabaseLike,
  id: string
): MCPConfig | null {
  const row = db
    .prepare('SELECT * FROM mcp_configs WHERE id = ?')
    .get(id) as MCPConfigRow | undefined

  if (!row) {
    return null
  }
  return parseConfigRow(row)
}

/**
 * List all enabled MCP configs for a workspace
 *
 * @param workspaceId - Workspace ID
 * @returns Array of enabled MCP configs
 */
export function listEnabledMCPConfigs(
  db: DatabaseLike,
  workspaceId: string
): MCPConfig[] {
  const rows = db
    .prepare(
      'SELECT * FROM mcp_configs WHERE workspace_id = ? AND enabled = 1 ORDER BY name'
    )
    .all(workspaceId) as MCPConfigRow[]

  return rows.map(parseConfigRow)
}

/**
 * List all MCP configs for a workspace (including disabled)
 *
 * @param workspaceId - Workspace ID
 * @returns Array of MCP configs
 */
export function listAllMCPConfigs(
  db: DatabaseLike,
  workspaceId: string
): MCPConfig[] {
  const rows = db
    .prepare('SELECT * FROM mcp_configs WHERE workspace_id = ? ORDER BY name')
    .all(workspaceId) as MCPConfigRow[]

  return rows.map(parseConfigRow)
}

/**
 * Enable or disable an MCP config
 *
 * @param id - Config ID
 * @param enabled - New enabled state
 * @returns Updated config or null if not found
 */
export function setMCPConfigEnabled(
  db: DatabaseLike,
  id: string,
  enabled: boolean
): MCPConfig | null {
  const result = db
    .prepare('UPDATE mcp_configs SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, Date.now(), id)

  if (result.changes === 0) {
    return null
  }
  return getMCPConfigById(db, id)
}

/**
 * Delete MCP config by workspace and name
 *
 * @param workspaceId - Workspace ID
 * @param name - Server name
 * @returns true if deleted, false if not found
 */
export function deleteMCPConfig(
  db: DatabaseLike,
  workspaceId: string,
  name: string
): boolean {
  const result = db
    .prepare('DELETE FROM mcp_configs WHERE workspace_id = ? AND name = ?')
    .run(workspaceId, name)
  return result.changes > 0
}

/**
 * Delete MCP config by ID
 *
 * @param id - Config ID
 * @returns true if deleted, false if not found
 */
export function deleteMCPConfigById(db: DatabaseLike, id: string): boolean {
  const result = db.prepare('DELETE FROM mcp_configs WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Delete all MCP configs for a workspace
 *
 * @param workspaceId - Workspace ID
 * @returns Number of configs deleted
 */
export function deleteWorkspaceMCPConfigs(
  db: DatabaseLike,
  workspaceId: string
): number {
  const result = db
    .prepare('DELETE FROM mcp_configs WHERE workspace_id = ?')
    .run(workspaceId)
  return result.changes
}
