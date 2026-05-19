import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { initDb, closeDb, runMigrations, updateSettings } from '../db'
import { createSettingsRouter } from './settings'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import { ApiError, ErrorCodes } from '../middleware'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

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

    it('should reject base URL ending with /v1', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_base_url: 'https://api.example.com/v1' }),
      })
      expect(res.status).toBe(400)
    })

    it('should reject empty model string', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_model: '' }),
      })
      expect(res.status).toBe(400)
    })

    it('should accept empty base URL (clears it)', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_base_url: '' }),
      })
      expect(res.status).toBe(200)
    })
  })

  describe('POST /api/settings/test-api', () => {
    let db: ReturnType<typeof initDb>

    beforeEach(() => {
      mockFetch.mockReset()
      // Re-acquire db reference for in-test mutations
      db = initDb(testDbPath)
    })

    it('should reject when no API key provided and none stored', async () => {
      const res = await app.request('/api/settings/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { success: boolean; error: string }
      expect(body.success).toBe(false)
      expect(body.error).toContain('API key')
    })

    it('should reject invalid base URL', async () => {
      const res = await app.request('/api/settings/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: 'not-a-url', api_key: 'sk-test' }),
      })
      expect(res.status).toBe(400)
    })

    it('should reject base URL ending with /v1', async () => {
      const res = await app.request('/api/settings/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: 'https://api.example.com/v1/', api_key: 'sk-test' }),
      })
      expect(res.status).toBe(400)
    })

    it('should return models on successful API call', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'claude-opus-4', display_name: 'Claude Opus 4', created_at: '2026-01-15' },
              { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2026-03-20' },
            ],
            has_more: false,
            first_id: 'claude-opus-4',
            last_id: 'claude-sonnet-4-6',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

      const res = await app.request('/api/settings/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: 'https://api.example.com',
          api_key: 'sk-test-key',
        }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        success: boolean
        models: { id: string; name: string; createdAt: string }[]
      }
      expect(body.success).toBe(true)
      expect(body.models).toHaveLength(2)
      // Sorted by createdAt desc — Sonnet 4.6 (2026-03-20) first
      expect(body.models[0]?.id).toBe('claude-sonnet-4-6')
    })

    it('should fall back to stored credentials when none provided in body', async () => {
      updateSettings(db, { llm_api_key: 'sk-stored', llm_base_url: 'https://stored.example.com' })

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const res = await app.request('/api/settings/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(200)
    })

    it('should return 400 with error message when API call throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network down'))

      const res = await app.request('/api/settings/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: 'https://api.example.com',
          api_key: 'sk-test',
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { success: boolean; error: string }
      expect(body.success).toBe(false)
      expect(body.error).toBeDefined()
    })
  })
})
