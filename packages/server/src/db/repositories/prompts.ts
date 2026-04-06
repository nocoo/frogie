/**
 * Prompts Repository
 *
 * Manages global and workspace-level prompt configurations for System Prompt Builder.
 * Supports 7 layers: identity, system_rules, tool_descriptions, git_context,
 * project_instructions, working_directory, date_context.
 */

import type { DatabaseLike } from '../connection'

/**
 * Valid prompt layer identifiers
 */
export const PROMPT_LAYERS = [
  'identity',
  'system_rules',
  'tool_descriptions',
  'git_context',
  'project_instructions',
  'working_directory',
  'date_context',
] as const

export type PromptLayer = (typeof PROMPT_LAYERS)[number]

/**
 * Global prompt configuration (from global_prompts table)
 */
export interface GlobalPrompt {
  layer: PromptLayer
  content: string
  enabled: boolean
  created_at: number
  updated_at: number
}

/**
 * Workspace prompt override (from workspace_prompts table)
 */
export interface WorkspacePrompt {
  id: string
  workspace_id: string
  layer: PromptLayer
  content: string
  enabled: boolean
  created_at: number
  updated_at: number
}

/**
 * Merged prompt layer config (used by API responses)
 */
export interface PromptLayerConfig {
  layer: PromptLayer
  content: string
  enabled: boolean
  isGlobal: boolean // true = from global, false = workspace override
  isTemplate: boolean // true = contains {{variables}}
}

/**
 * Raw row from global_prompts table
 */
interface GlobalPromptRow {
  layer: string
  content: string
  enabled: number
  created_at: number
  updated_at: number
}

/**
 * Raw row from workspace_prompts table
 */
interface WorkspacePromptRow {
  id: string
  workspace_id: string
  layer: string
  content: string
  enabled: number
  created_at: number
  updated_at: number
}

/**
 * Check if a string is a valid prompt layer
 */
export function isValidLayer(layer: string): layer is PromptLayer {
  return PROMPT_LAYERS.includes(layer as PromptLayer)
}

/**
 * Check if content contains template variables
 */
function hasTemplateVariables(content: string): boolean {
  return /\{\{(cwd|date|git_status|tools)\}\}/.test(content)
}

/**
 * Parse global prompt row from database
 */
function parseGlobalPromptRow(row: GlobalPromptRow): GlobalPrompt {
  return {
    layer: row.layer as PromptLayer,
    content: row.content,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * Parse workspace prompt row from database
 */
function parseWorkspacePromptRow(row: WorkspacePromptRow): WorkspacePrompt {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    layer: row.layer as PromptLayer,
    content: row.content,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// =============================================================================
// Global Prompts
// =============================================================================

/**
 * Get a single global prompt by layer
 */
export function getGlobalPrompt(
  db: DatabaseLike,
  layer: PromptLayer
): GlobalPrompt | null {
  const row = db
    .prepare('SELECT * FROM global_prompts WHERE layer = ?')
    .get(layer) as GlobalPromptRow | undefined

  return row ? parseGlobalPromptRow(row) : null
}

/**
 * Get all global prompts
 */
export function getAllGlobalPrompts(db: DatabaseLike): GlobalPrompt[] {
  const rows = db
    .prepare('SELECT * FROM global_prompts ORDER BY layer')
    .all() as GlobalPromptRow[]

  return rows.map(parseGlobalPromptRow)
}

/**
 * Update a global prompt
 */
export function updateGlobalPrompt(
  db: DatabaseLike,
  layer: PromptLayer,
  update: { content?: string; enabled?: boolean }
): GlobalPrompt {
  const current = getGlobalPrompt(db, layer)
  if (!current) {
    throw new Error(`Global prompt layer not found: ${layer}`)
  }

  const now = Date.now()
  const newContent = update.content ?? current.content
  const newEnabled = update.enabled ?? current.enabled

  db.prepare(
    `
    UPDATE global_prompts
    SET content = ?, enabled = ?, updated_at = ?
    WHERE layer = ?
  `
  ).run(newContent, newEnabled ? 1 : 0, now, layer)

  const updated = getGlobalPrompt(db, layer)
  if (!updated) {
    throw new Error('Failed to update global prompt')
  }
  return updated
}

// =============================================================================
// Workspace Prompts
// =============================================================================

/**
 * Get a single workspace prompt by layer
 */
export function getWorkspacePrompt(
  db: DatabaseLike,
  workspaceId: string,
  layer: PromptLayer
): WorkspacePrompt | null {
  const row = db
    .prepare(
      'SELECT * FROM workspace_prompts WHERE workspace_id = ? AND layer = ?'
    )
    .get(workspaceId, layer) as WorkspacePromptRow | undefined

  return row ? parseWorkspacePromptRow(row) : null
}

/**
 * Get all workspace prompts for a workspace
 */
export function getAllWorkspacePrompts(
  db: DatabaseLike,
  workspaceId: string
): WorkspacePrompt[] {
  const rows = db
    .prepare(
      'SELECT * FROM workspace_prompts WHERE workspace_id = ? ORDER BY layer'
    )
    .all(workspaceId) as WorkspacePromptRow[]

  return rows.map(parseWorkspacePromptRow)
}

/**
 * Create or update a workspace prompt (upsert)
 */
export function upsertWorkspacePrompt(
  db: DatabaseLike,
  workspaceId: string,
  layer: PromptLayer,
  update: { content?: string; enabled?: boolean }
): WorkspacePrompt {
  const existing = getWorkspacePrompt(db, workspaceId, layer)
  const now = Date.now()

  if (existing) {
    // Update existing
    const newContent = update.content ?? existing.content
    const newEnabled = update.enabled ?? existing.enabled

    db.prepare(
      `
      UPDATE workspace_prompts
      SET content = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `
    ).run(newContent, newEnabled ? 1 : 0, now, existing.id)
  } else {
    // Insert new - need content for insert
    const globalDefault = getGlobalPrompt(db, layer)
    const content = update.content ?? globalDefault?.content ?? ''
    const enabled = update.enabled ?? true
    const id = crypto.randomUUID().replace(/-/g, '')

    db.prepare(
      `
      INSERT INTO workspace_prompts (id, workspace_id, layer, content, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(id, workspaceId, layer, content, enabled ? 1 : 0, now, now)
  }

  const result = getWorkspacePrompt(db, workspaceId, layer)
  if (!result) {
    throw new Error('Failed to upsert workspace prompt')
  }
  return result
}

/**
 * Delete a workspace prompt (falls back to global)
 */
export function deleteWorkspacePrompt(
  db: DatabaseLike,
  workspaceId: string,
  layer: PromptLayer
): boolean {
  const result = db
    .prepare('DELETE FROM workspace_prompts WHERE workspace_id = ? AND layer = ?')
    .run(workspaceId, layer)

  return result.changes > 0
}

/**
 * Delete all workspace prompts for a workspace
 */
export function deleteAllWorkspacePrompts(
  db: DatabaseLike,
  workspaceId: string
): number {
  const result = db
    .prepare('DELETE FROM workspace_prompts WHERE workspace_id = ?')
    .run(workspaceId)

  return result.changes
}

// =============================================================================
// Merged View
// =============================================================================

/**
 * Get merged prompt layers for a workspace
 *
 * Returns all 7 layers, using workspace override if exists, otherwise global.
 * Layers are returned in order: identity, system_rules, tool_descriptions,
 * git_context, project_instructions, working_directory, date_context.
 */
export function getMergedPrompts(
  db: DatabaseLike,
  workspaceId: string
): PromptLayerConfig[] {
  const globalPrompts = getAllGlobalPrompts(db)
  const workspacePrompts = getAllWorkspacePrompts(db, workspaceId)

  // Build map of workspace overrides
  const workspaceMap = new Map<PromptLayer, WorkspacePrompt>()
  for (const wp of workspacePrompts) {
    workspaceMap.set(wp.layer, wp)
  }

  // Merge: workspace override takes precedence
  const merged: PromptLayerConfig[] = []

  for (const layer of PROMPT_LAYERS) {
    const wsPrompt = workspaceMap.get(layer)
    const globalPrompt = globalPrompts.find((g) => g.layer === layer)

    if (wsPrompt) {
      merged.push({
        layer,
        content: wsPrompt.content,
        enabled: wsPrompt.enabled,
        isGlobal: false,
        isTemplate: hasTemplateVariables(wsPrompt.content),
      })
    } else if (globalPrompt) {
      merged.push({
        layer,
        content: globalPrompt.content,
        enabled: globalPrompt.enabled,
        isGlobal: true,
        isTemplate: hasTemplateVariables(globalPrompt.content),
      })
    } else {
      // Fallback for missing layer (shouldn't happen with proper migration)
      merged.push({
        layer,
        content: '',
        enabled: true,
        isGlobal: true,
        isTemplate: false,
      })
    }
  }

  return merged
}
