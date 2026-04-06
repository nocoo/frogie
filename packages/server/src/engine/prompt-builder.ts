/**
 * Prompt Builder
 *
 * Assembles the complete system prompt from configured layers.
 * Resolves template variables with runtime context.
 */

import type { DatabaseLike } from '../db/connection'
import type { Workspace } from '../db/types'
import type { PromptLayerConfig } from '../db/repositories/prompts'
import { getMergedPrompts } from '../db'
import type { ToolDefinition } from './frogie-agent'

/**
 * Context for building the system prompt
 */
export interface PromptContext {
  /** Current workspace */
  workspace: Workspace
  /** Complete list of available tools (builtin + MCP) */
  tools: ToolDefinition[]
  /** Git status output (optional) */
  gitStatus?: string
  /** Current date in YYYY-MM-DD format */
  date: string
}

/**
 * Build the complete system prompt from configured layers
 *
 * IMPORTANT: This must be called AFTER all tools (builtin + MCP) are loaded,
 * so that {{tools}} template can be resolved with the complete tool list.
 *
 * @param db - Database connection
 * @param context - Runtime context for template resolution
 * @returns Assembled system prompt string
 */
export function buildSystemPrompt(
  db: DatabaseLike,
  context: PromptContext
): string {
  // 1. Load layer configs (workspace override → global → defaults)
  const layers = getMergedPrompts(db, context.workspace.id)

  // 2. Resolve templates with runtime values
  const resolved = layers
    .filter((l) => l.enabled)
    .map((l) => resolveTemplate(l, context))
    .filter((content) => hasSubstantiveContent(content))

  // 3. Join all layers with double newline separator
  return resolved.join('\n\n')
}

/**
 * Check if content has substantive text (not just whitespace or markdown headers)
 */
function hasSubstantiveContent(content: string): boolean {
  // Remove markdown headers (lines starting with #)
  const withoutHeaders = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')

  return withoutHeaders.trim().length > 0
}

/**
 * Resolve template variables in a layer
 *
 * Supported variables:
 * - {{cwd}} - Workspace path
 * - {{date}} - Current date
 * - {{git_status}} - Git status output
 * - {{tools}} - Formatted tool descriptions
 *
 * NOTE: Template variables are simple string replacement.
 * User-provided content is NOT sanitized - the user has full control
 * over their own prompts. This is intentional as prompt content
 * is trusted user input (similar to CLAUDE.md files).
 */
export function resolveTemplate(
  layer: PromptLayerConfig,
  context: PromptContext
): string {
  let content = layer.content

  // Replace template variables
  content = content.replace(/\{\{cwd\}\}/g, context.workspace.path)
  content = content.replace(/\{\{date\}\}/g, context.date)
  content = content.replace(/\{\{git_status\}\}/g, context.gitStatus ?? '')
  content = content.replace(
    /\{\{tools\}\}/g,
    formatToolDescriptions(context.tools)
  )

  return content
}

/**
 * Format tool definitions for system prompt
 *
 * @param tools - Array of tool definitions
 * @returns Formatted markdown list of tools
 */
export function formatToolDescriptions(tools: ToolDefinition[]): string {
  if (tools.length === 0) {
    return '(No tools available)'
  }

  return tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
}

/**
 * Estimate token count for a string (rough approximation)
 *
 * Uses ~4 chars per token as a rough estimate for English text.
 * This is not accurate for all languages or content types.
 *
 * @param text - Text to estimate
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4)
}
