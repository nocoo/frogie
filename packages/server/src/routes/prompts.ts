/**
 * Prompts Routes
 *
 * GET /api/prompts/global              - Get all global prompt layers
 * PUT /api/prompts/global/:layer       - Update global prompt layer
 * GET /api/prompts/:workspaceId        - Get workspace prompts (merged with global)
 * PUT /api/prompts/:workspaceId/:layer - Update workspace prompt layer
 * DELETE /api/prompts/:workspaceId/:layer - Remove workspace override
 * POST /api/prompts/preview            - Preview assembled prompt
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { DatabaseLike } from '../db/connection'
import {
  PROMPT_LAYERS,
  isValidLayer,
  getAllGlobalPrompts,
  updateGlobalPrompt,
  getMergedPrompts,
  upsertWorkspacePrompt,
  deleteWorkspacePrompt,
  getWorkspace,
  type PromptLayerConfig,
} from '../db'
import { validationError, notFound, ErrorCodes } from '../middleware'
import { estimateTokens } from '../engine/prompt-builder'
import { getGitStatus, getCurrentDate } from '../engine/prompt-context'
import { BUILTIN_TOOLS } from '../engine/builtin-tools'

/**
 * Size limits
 */
const MAX_LAYER_SIZE = 10 * 1024 // 10KB per layer
const MAX_TOTAL_SIZE = 50 * 1024 // 50KB total

/**
 * Update prompt layer request schema
 */
const updatePromptSchema = z.object({
  content: z.string().max(MAX_LAYER_SIZE).optional(),
  enabled: z.boolean().optional(),
})

/**
 * Preview request schema
 * Note: We use a looser schema for overrides and validate keys manually
 */
const previewOverrideSchema = z.object({
  content: z.string().max(MAX_LAYER_SIZE).optional(),
  enabled: z.boolean().optional(),
})

const previewRequestSchema = z.object({
  workspaceId: z.string().min(1),
  overrides: z.record(z.string(), previewOverrideSchema).optional(),
})

/**
 * Transform prompt layer config for API response
 */
function toApiPromptLayer(config: PromptLayerConfig) {
  return {
    layer: config.layer,
    content: config.content,
    enabled: config.enabled,
    isGlobal: config.isGlobal,
    isTemplate: config.isTemplate,
  }
}

/**
 * Create prompts router
 */
export function createPromptsRouter(db: DatabaseLike) {
  const router = new Hono()

  // =========================================================================
  // Global Prompts
  // =========================================================================

  /**
   * GET /api/prompts/global
   * Get all global prompt layers
   */
  router.get('/global', (c) => {
    const prompts = getAllGlobalPrompts(db)
    return c.json({
      layers: prompts.map((p) => ({
        layer: p.layer,
        content: p.content,
        enabled: p.enabled,
        isTemplate: /\{\{(cwd|date|git_status|tools)\}\}/.test(p.content),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    })
  })

  /**
   * PUT /api/prompts/global/:layer
   * Update a global prompt layer
   */
  router.put('/global/:layer', async (c) => {
    const { layer } = c.req.param()

    // Validate layer name
    if (!isValidLayer(layer)) {
      throw validationError(
        `Invalid layer: ${layer}. Valid layers: ${PROMPT_LAYERS.join(', ')}`
      )
    }

    // Parse and validate body
    const body: unknown = await c.req.json().catch(() => ({}))
    const parsed = updatePromptSchema.safeParse(body)
    if (!parsed.success) {
      throw validationError(parsed.error.issues[0]?.message ?? 'Invalid input')
    }

    const { content, enabled } = parsed.data

    // Must provide at least one field
    if (content === undefined && enabled === undefined) {
      throw validationError('Must provide content or enabled')
    }

    // Build update object with only defined fields
    const updateData: { content?: string; enabled?: boolean } = {}
    if (content !== undefined) updateData.content = content
    if (enabled !== undefined) updateData.enabled = enabled

    // Update
    const updated = updateGlobalPrompt(db, layer, updateData)

    return c.json({
      layer: updated.layer,
      content: updated.content,
      enabled: updated.enabled,
      isTemplate: /\{\{(cwd|date|git_status|tools)\}\}/.test(updated.content),
      updatedAt: updated.updated_at,
    })
  })

  // =========================================================================
  // Workspace Prompts
  // =========================================================================

  /**
   * GET /api/prompts/:workspaceId
   * Get merged prompts for a workspace
   */
  router.get('/:workspaceId', (c) => {
    const { workspaceId } = c.req.param()

    // Verify workspace exists
    const workspace = getWorkspace(db, workspaceId)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${workspaceId}`)
    }

    const merged = getMergedPrompts(db, workspaceId)

    return c.json({
      workspaceId,
      layers: merged.map(toApiPromptLayer),
    })
  })

  /**
   * PUT /api/prompts/:workspaceId/:layer
   * Update or create a workspace prompt override
   */
  router.put('/:workspaceId/:layer', async (c) => {
    const { workspaceId, layer } = c.req.param()

    // Verify workspace exists
    const workspace = getWorkspace(db, workspaceId)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${workspaceId}`)
    }

    // Validate layer name
    if (!isValidLayer(layer)) {
      throw validationError(
        `Invalid layer: ${layer}. Valid layers: ${PROMPT_LAYERS.join(', ')}`
      )
    }

    // Parse and validate body
    const body: unknown = await c.req.json().catch(() => ({}))
    const parsed = updatePromptSchema.safeParse(body)
    if (!parsed.success) {
      throw validationError(parsed.error.issues[0]?.message ?? 'Invalid input')
    }

    const { content, enabled } = parsed.data

    // Must provide at least one field
    if (content === undefined && enabled === undefined) {
      throw validationError('Must provide content or enabled')
    }

    // Build update object with only defined fields
    const updateData: { content?: string; enabled?: boolean } = {}
    if (content !== undefined) updateData.content = content
    if (enabled !== undefined) updateData.enabled = enabled

    // Upsert
    const updated = upsertWorkspacePrompt(db, workspaceId, layer, updateData)

    return c.json({
      id: updated.id,
      workspaceId: updated.workspace_id,
      layer: updated.layer,
      content: updated.content,
      enabled: updated.enabled,
      isTemplate: /\{\{(cwd|date|git_status|tools)\}\}/.test(updated.content),
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    })
  })

  /**
   * DELETE /api/prompts/:workspaceId/:layer
   * Remove workspace prompt override (falls back to global)
   */
  router.delete('/:workspaceId/:layer', (c) => {
    const { workspaceId, layer } = c.req.param()

    // Verify workspace exists
    const workspace = getWorkspace(db, workspaceId)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${workspaceId}`)
    }

    // Validate layer name
    if (!isValidLayer(layer)) {
      throw validationError(
        `Invalid layer: ${layer}. Valid layers: ${PROMPT_LAYERS.join(', ')}`
      )
    }

    const deleted = deleteWorkspacePrompt(db, workspaceId, layer)

    if (!deleted) {
      throw notFound('PROMPT_OVERRIDE_NOT_FOUND', `Workspace prompt override not found: ${layer}`)
    }

    return c.json({ success: true, layer })
  })

  // =========================================================================
  // Preview
  // =========================================================================

  /**
   * POST /api/prompts/preview
   * Preview assembled prompt with optional overrides
   */
  router.post('/preview', async (c) => {
    // Parse and validate body
    const body: unknown = await c.req.json().catch(() => ({}))
    const parsed = previewRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw validationError(parsed.error.issues[0]?.message ?? 'Invalid input')
    }

    const { workspaceId, overrides } = parsed.data

    // Verify workspace exists
    const workspace = getWorkspace(db, workspaceId)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${workspaceId}`)
    }

    // Get merged prompts
    let layers = getMergedPrompts(db, workspaceId)

    // Apply overrides if provided
    if (overrides) {
      layers = layers.map((layer) => {
        const override = overrides[layer.layer]
        if (override) {
          return {
            ...layer,
            content: override.content ?? layer.content,
            enabled: override.enabled ?? layer.enabled,
          }
        }
        return layer
      })
    }

    // Build context for preview
    // Note: Using builtin tools only for preview (MCP tools require async connection)
    const gitStatus = getGitStatus(workspace.path)
    const date = getCurrentDate()

    // Build prompt manually with overridden layers
    const enabledLayers = layers.filter((l) => l.enabled)
    const resolvedParts: string[] = []

    for (const layer of enabledLayers) {
      let content = layer.content

      // Resolve templates
      content = content.replace(/\{\{cwd\}\}/g, workspace.path)
      content = content.replace(/\{\{date\}\}/g, date)
      content = content.replace(/\{\{git_status\}\}/g, gitStatus)
      content = content.replace(
        /\{\{tools\}\}/g,
        BUILTIN_TOOLS.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
      )

      // Skip if only whitespace/headers remain
      const withoutHeaders = content
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n')
      if (withoutHeaders.trim().length > 0) {
        resolvedParts.push(content)
      }
    }

    const assembledPrompt = resolvedParts.join('\n\n')
    const tokenEstimate = estimateTokens(assembledPrompt)

    // Check size limit
    if (assembledPrompt.length > MAX_TOTAL_SIZE) {
      throw validationError(
        `Assembled prompt exceeds maximum size of ${String(MAX_TOTAL_SIZE)} bytes`
      )
    }

    return c.json({
      assembledPrompt,
      tokenEstimate,
      layers: layers.map((l) => ({
        layer: l.layer,
        content: l.content,
        enabled: l.enabled,
      })),
    })
  })

  return router
}
