/**
 * Settings Routes
 *
 * GET /api/settings - Get global settings
 * PATCH /api/settings - Update settings
 * POST /api/settings/test-api - Test API connection and list models
 */

import { Hono } from 'hono'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import type { DatabaseLike } from '../db/connection'
import { getSettings, updateSettings } from '../db'
import type { SettingsUpdate as DbSettingsUpdate } from '../db'
import { validationError } from '../middleware'

/**
 * Settings update schema
 */
const settingsUpdateSchema = z.object({
  llm_base_url: z
    .string()
    .optional()
    .refine(
      (url) => {
        if (!url) return true
        // Must be a valid URL
        try {
          new URL(url)
          return true
        } catch {
          return false
        }
      },
      { message: 'Invalid URL format' }
    )
    .refine(
      (url) => {
        if (!url) return true
        // Must not end with /v1 or /v1/
        return !/\/v1\/?$/.exec(url)
      },
      { message: 'Base URL should not end with /v1 (SDK adds it automatically)' }
    ),
  llm_api_key: z.string().optional(),
  llm_model: z.string().min(1, 'Model is required').optional(),
  max_turns: z.number().int().positive().optional(),
  max_budget_usd: z.number().positive().optional(),
})

/**
 * Test API schema
 */
const testApiSchema = z.object({
  base_url: z
    .string()
    .optional()
    .refine(
      (url) => {
        if (!url) return true
        try {
          new URL(url)
          return true
        } catch {
          return false
        }
      },
      { message: 'Invalid URL format' }
    )
    .refine(
      (url) => {
        if (!url) return true
        return !/\/v1\/?$/.exec(url)
      },
      { message: 'Base URL should not end with /v1' }
    ),
  api_key: z.string().optional(),
})

type SettingsInput = z.infer<typeof settingsUpdateSchema>

/**
 * Mask API key for response (show last 4 chars)
 */
function maskApiKey(key: string): string {
  if (key.length <= 4) {
    return '****'
  }
  return '***' + key.slice(-4)
}

/**
 * Filter out undefined values from an object
 */
function filterUndefined(obj: Record<string, unknown>): DbSettingsUpdate {
  const result: DbSettingsUpdate = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      ;(result as Record<string, unknown>)[key] = value
    }
  }
  return result
}

/**
 * Create settings router
 */
export function createSettingsRouter(db: DatabaseLike): Hono {
  const router = new Hono()

  /**
   * GET /api/settings - Get global settings
   */
  router.get('/', (c) => {
    const settings = getSettings(db)

    // Transform to API format with masked key
    return c.json({
      llmBaseUrl: settings.llm_base_url,
      llmApiKey: maskApiKey(settings.llm_api_key),
      llmModel: settings.llm_model,
      maxTurns: settings.max_turns,
      maxBudgetUsd: settings.max_budget_usd,
    })
  })

  /**
   * POST /api/settings/test-api - Test API connection and list models
   */
  router.post('/test-api', async (c) => {
    const body = await c.req.json<{ base_url?: string; api_key?: string }>()

    // Validate
    const result = testApiSchema.safeParse(body)
    if (!result.success) {
      throw validationError(result.error.issues[0]?.message ?? 'Invalid input')
    }

    // Get current settings as fallback
    const currentSettings = getSettings(db)
    const baseUrl = result.data.base_url ?? currentSettings.llm_base_url
    const apiKey = result.data.api_key ?? currentSettings.llm_api_key

    if (!apiKey) {
      return c.json(
        { success: false, error: 'API key is required' },
        400
      )
    }

    try {
      // Create Anthropic client
      const client = new Anthropic({
        apiKey,
        baseURL: baseUrl || undefined,
      })

      // List available models
      const modelsResponse = await client.models.list()
      const models = modelsResponse.data
        .map((m) => ({
          id: m.id,
          name: m.display_name,
          createdAt: m.created_at,
        }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      return c.json({
        success: true,
        models,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json(
        { success: false, error: message },
        400
      )
    }
  })

  /**
   * PATCH /api/settings - Update settings
   */
  router.patch('/', async (c) => {
    const body = await c.req.json<SettingsInput>()

    // Validate
    const result = settingsUpdateSchema.safeParse(body)
    if (!result.success) {
      throw validationError(result.error.issues[0]?.message ?? 'Invalid input')
    }

    // Filter out undefined values to match SettingsUpdate type
    const update = filterUndefined(result.data)

    // Update settings
    const settings = updateSettings(db, update)

    // Transform to API format with masked key
    return c.json({
      llmBaseUrl: settings.llm_base_url,
      llmApiKey: maskApiKey(settings.llm_api_key),
      llmModel: settings.llm_model,
      maxTurns: settings.max_turns,
      maxBudgetUsd: settings.max_budget_usd,
    })
  })

  return router
}
