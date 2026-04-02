/**
 * MCP Routes
 *
 * GET /api/workspaces/:wid/mcp - List MCP configs
 * POST /api/workspaces/:wid/mcp - Add MCP server config
 * DELETE /api/workspaces/:wid/mcp/:name - Remove MCP config
 * PATCH /api/workspaces/:wid/mcp/:name - Enable/disable MCP config
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { MCPConfig, MCPServerConfig, CreateMCPConfig } from '../db'
import {
  getWorkspace,
  saveMCPConfig,
  getMCPConfig,
  listAllMCPConfigs,
  deleteMCPConfig,
  setMCPConfigEnabled,
} from '../db'
import { validationError, notFound, ErrorCodes } from '../middleware'

/**
 * Create MCP config schema
 */
const createMCPConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['stdio', 'sse', 'http']),
  config: z.object({
    // stdio transport
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    // SSE/HTTP transport
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  enabled: z.boolean().optional(),
})

type MCPConfigInput = z.infer<typeof createMCPConfigSchema>

/**
 * Update MCP config schema
 */
const updateMCPConfigSchema = z.object({
  enabled: z.boolean(),
})

/**
 * Transform MCP config for API response
 */
function toApiMCPConfig(config: MCPConfig) {
  return {
    id: config.id,
    workspaceId: config.workspace_id,
    name: config.name,
    type: config.type,
    config: config.config,
    enabled: config.enabled,
    createdAt: config.created_at,
    updatedAt: config.updated_at,
  }
}

/**
 * Build MCPServerConfig from validated input, excluding undefined values
 */
function buildMCPServerConfig(input: MCPConfigInput['config']): MCPServerConfig {
  const result: MCPServerConfig = {}

  if (input.command !== undefined) result.command = input.command
  if (input.args !== undefined) result.args = input.args
  if (input.env !== undefined) result.env = input.env
  if (input.url !== undefined) result.url = input.url
  if (input.headers !== undefined) result.headers = input.headers

  return result
}

/**
 * Build CreateMCPConfig from validated input
 */
function buildCreateMCPConfig(input: MCPConfigInput): CreateMCPConfig {
  const result: CreateMCPConfig = {
    name: input.name,
    type: input.type,
    config: buildMCPServerConfig(input.config),
  }

  if (input.enabled !== undefined) {
    result.enabled = input.enabled
  }

  return result
}

/**
 * Create MCP router
 */
export function createMCPRouter(db: DatabaseType): Hono {
  const router = new Hono()

  /**
   * GET /api/workspaces/:wid/mcp - List MCP configs
   */
  router.get('/', (c) => {
    const wid = c.req.param('wid') ?? ''

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    const configs = listAllMCPConfigs(db, wid)
    return c.json(configs.map(toApiMCPConfig))
  })

  /**
   * POST /api/workspaces/:wid/mcp - Add MCP server config
   */
  router.post('/', async (c) => {
    const wid = c.req.param('wid') ?? ''

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    const body: unknown = await c.req.json()

    // Validate request body
    const result = createMCPConfigSchema.safeParse(body)
    if (!result.success) {
      throw validationError(result.error.issues[0]?.message ?? 'Invalid input')
    }

    const { type, config } = result.data

    // Validate transport-specific config
    if (type === 'stdio') {
      if (!config.command) {
        throw validationError('stdio transport requires command')
      }
    } else {
      // sse or http transport
      if (!config.url) {
        throw validationError(`${type} transport requires url`)
      }
    }

    // Build clean config without undefined values
    const createInput = buildCreateMCPConfig(result.data)

    // Save config (creates or updates)
    const mcpConfig = saveMCPConfig(db, wid, createInput)

    return c.json(toApiMCPConfig(mcpConfig), 201)
  })

  /**
   * DELETE /api/workspaces/:wid/mcp/:name - Remove MCP config
   */
  router.delete('/:name', (c) => {
    const wid = c.req.param('wid') ?? ''
    const name = c.req.param('name')

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    const deleted = deleteMCPConfig(db, wid, name)
    if (!deleted) {
      throw notFound(ErrorCodes.MCP_NOT_FOUND, `MCP config not found: ${name}`)
    }

    return c.json({ success: true })
  })

  /**
   * PATCH /api/workspaces/:wid/mcp/:name - Enable/disable MCP config
   */
  router.patch('/:name', async (c) => {
    const wid = c.req.param('wid') ?? ''
    const name = c.req.param('name')

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    const body: unknown = await c.req.json()

    // Validate request body
    const result = updateMCPConfigSchema.safeParse(body)
    if (!result.success) {
      throw validationError(result.error.issues[0]?.message ?? 'Invalid input')
    }

    // Get existing config
    const existing = getMCPConfig(db, wid, name)
    if (!existing) {
      throw notFound(ErrorCodes.MCP_NOT_FOUND, `MCP config not found: ${name}`)
    }

    // Update enabled state
    const updated = setMCPConfigEnabled(db, existing.id, result.data.enabled)
    if (!updated) {
      throw new Error('Failed to update MCP config')
    }

    return c.json(toApiMCPConfig(updated))
  })

  /**
   * POST /api/workspaces/:wid/mcp/:name/reconnect - Reconnect MCP server
   *
   * Attempts to reconnect to an MCP server. In a full implementation,
   * this would kill any existing connection and establish a new one.
   * Currently returns success as MCP connections are established on-demand.
   */
  router.post('/:name/reconnect', (c) => {
    const wid = c.req.param('wid') ?? ''
    const name = c.req.param('name')

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    // Get existing config
    const existing = getMCPConfig(db, wid, name)
    if (!existing) {
      throw notFound(ErrorCodes.MCP_NOT_FOUND, `MCP config not found: ${name}`)
    }

    // MCP connections are currently established on-demand when a session starts.
    // A full implementation would maintain persistent connections and reconnect here.
    // For now, return success indicating the server will reconnect on next use.
    return c.json({
      success: true,
      message: `MCP server '${name}' will reconnect on next session`,
    })
  })

  return router
}
