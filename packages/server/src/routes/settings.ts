/**
 * Settings Routes
 *
 * GET /api/settings - Get global settings
 * PATCH /api/settings - Update settings
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { DatabaseLike } from '../db/connection'
import { getSettings, updateSettings } from '../db'
import type { SettingsUpdate as DbSettingsUpdate } from '../db'
import { validationError } from '../middleware'

/**
 * Settings update schema
 */
const settingsUpdateSchema = z.object({
  llm_base_url: z.url().optional(),
  llm_api_key: z.string().optional(),
  llm_model: z.string().optional(),
  max_turns: z.number().int().positive().optional(),
  max_budget_usd: z.number().positive().optional(),
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
