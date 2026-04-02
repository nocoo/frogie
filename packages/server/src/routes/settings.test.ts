import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { initDb, closeDb, runMigrations } from '../db'
import { createSettingsRouter } from './settings'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import { ApiError, ErrorCodes } from '../middleware'

/**
 * Settings API response type
 */
interface SettingsResponse {
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  maxTurns: number
  maxBudgetUsd: number
}

/**
 * Error response type
 */
interface ErrorResponse {
  error: {
    code: string
    message: string
  }
}

describe('routes/settings', () => {
  let testDbPath: string
  let app: Hono

  beforeEach(() => {
    testDbPath = getTestDbPath()
    const db = initDb(testDbPath)
    runMigrations(db)

    app = new Hono()

    // Use app.onError for proper error handling
    app.onError((err, c) => {
      if (err instanceof ApiError) {
        return c.json(
          { error: { code: err.code, message: err.message } },
          err.status
        )
      }

      return c.json(
        {
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : 'Internal server error',
          },
        },
        500
      )
    })

    app.route('/api/settings', createSettingsRouter(db))
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('GET /api/settings', () => {
    it('should return settings with masked API key', async () => {
      const res = await app.request('/api/settings')

      expect(res.status).toBe(200)
      const body = (await res.json()) as SettingsResponse
      expect(body.llmBaseUrl).toBe('http://localhost:7024/v1')
      expect(body.llmApiKey).toBe('****') // Empty key shows ****
      expect(body.llmModel).toBe('claude-sonnet-4-6')
      expect(body.maxTurns).toBe(50)
      expect(body.maxBudgetUsd).toBe(10.0)
    })
  })

  describe('PATCH /api/settings', () => {
    it('should update single field', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_model: 'claude-opus-4' }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as SettingsResponse
      expect(body.llmModel).toBe('claude-opus-4')
      // Other fields unchanged
      expect(body.maxTurns).toBe(50)
    })

    it('should update multiple fields', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llm_api_key: 'sk-new-key-12345',
          max_turns: 100,
          max_budget_usd: 25.0,
        }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as SettingsResponse
      expect(body.llmApiKey).toBe('***2345') // Last 4 chars visible
      expect(body.maxTurns).toBe(100)
      expect(body.maxBudgetUsd).toBe(25.0)
    })

    it('should reject invalid URL', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_base_url: 'not-a-url' }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject negative max_turns', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_turns: -1 }),
      })

      expect(res.status).toBe(400)
    })

    it('should reject negative budget', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_budget_usd: -10 }),
      })

      expect(res.status).toBe(400)
    })
  })
})
