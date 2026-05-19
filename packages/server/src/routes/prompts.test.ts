/**
 * Prompts Routes Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { initDb, closeDb, runMigrations, createWorkspace } from '../db'
import { createPromptsRouter } from './prompts'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import { ApiError, ErrorCodes } from '../middleware'

/**
 * Prompt layer API response type
 */
interface PromptLayerResponse {
  layer: string
  content: string
  enabled: boolean
  isGlobal?: boolean
  isTemplate: boolean
  createdAt?: number
  updatedAt?: number
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

/**
 * Create a temporary test directory
 */
function createTempDir(suffix: string): string {
  const dir = join('/tmp', `frogie-test-${suffix}-${String(Date.now())}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Remove temporary test directory
 */
function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore errors
  }
}

describe('routes/prompts', () => {
  let testDbPath: string
  let app: Hono
  let tempDirs: string[] = []
  let db: ReturnType<typeof initDb>
  let workspaceId: string
  let workspaceDir: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
    db = initDb(testDbPath)
    runMigrations(db)

    app = new Hono()
    app.route('/api/prompts', createPromptsRouter(db))

    // Error handler callback (not middleware)
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

    // Create a workspace
    workspaceDir = createTempDir('prompts')
    tempDirs.push(workspaceDir)
    const ws = createWorkspace(db, { name: 'Test', path: workspaceDir })
    workspaceId = ws.id
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
    for (const dir of tempDirs) {
      removeTempDir(dir)
    }
    tempDirs = []
  })

  // ===========================================================================
  // Global Prompts
  // ===========================================================================

  describe('GET /api/prompts/global', () => {
    it('should return all 7 global prompt layers', async () => {
      const res = await app.request('/api/prompts/global')
      expect(res.status).toBe(200)

      const data = (await res.json()) as { layers: PromptLayerResponse[] }
      expect(data.layers).toHaveLength(7)

      const layerNames = data.layers.map((l) => l.layer)
      expect(layerNames).toContain('identity')
      expect(layerNames).toContain('system_rules')
      expect(layerNames).toContain('tool_descriptions')
      expect(layerNames).toContain('git_context')
      expect(layerNames).toContain('project_instructions')
      expect(layerNames).toContain('working_directory')
      expect(layerNames).toContain('date_context')
    })

    it('should have all layers enabled by default', async () => {
      const res = await app.request('/api/prompts/global')
      const data = (await res.json()) as { layers: PromptLayerResponse[] }

      for (const layer of data.layers) {
        expect(layer.enabled).toBe(true)
      }
    })

    it('should mark template layers correctly', async () => {
      const res = await app.request('/api/prompts/global')
      const data = (await res.json()) as { layers: PromptLayerResponse[] }

      const toolDescriptions = data.layers.find((l) => l.layer === 'tool_descriptions')
      const dateContext = data.layers.find((l) => l.layer === 'date_context')
      const identity = data.layers.find((l) => l.layer === 'identity')

      expect(toolDescriptions?.isTemplate).toBe(true)
      expect(dateContext?.isTemplate).toBe(true)
      expect(identity?.isTemplate).toBe(false)
    })
  })

  describe('PUT /api/prompts/global/:layer', () => {
    it('should update content', async () => {
      const res = await app.request('/api/prompts/global/identity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'You are a TypeScript expert.' }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as PromptLayerResponse
      expect(data.content).toBe('You are a TypeScript expert.')
      expect(data.enabled).toBe(true)
    })

    it('should update enabled status', async () => {
      const res = await app.request('/api/prompts/global/git_context', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as PromptLayerResponse
      expect(data.enabled).toBe(false)
    })

    it('should update both content and enabled', async () => {
      const res = await app.request('/api/prompts/global/project_instructions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Use TDD.', enabled: true }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as PromptLayerResponse
      expect(data.content).toBe('Use TDD.')
      expect(data.enabled).toBe(true)
    })

    it('should reject invalid layer name', async () => {
      const res = await app.request('/api/prompts/global/invalid_layer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'test' }),
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as ErrorResponse
      expect(data.error.code).toBe(ErrorCodes.VALIDATION_ERROR)
    })

    it('should reject empty update', async () => {
      const res = await app.request('/api/prompts/global/identity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as ErrorResponse
      expect(data.error.message).toContain('content or enabled')
    })
  })

  // ===========================================================================
  // Workspace Prompts
  // ===========================================================================

  describe('GET /api/prompts/:workspaceId', () => {
    it('should return merged prompts for workspace', async () => {
      const res = await app.request(`/api/prompts/${workspaceId}`)
      expect(res.status).toBe(200)

      const data = (await res.json()) as { workspaceId: string; layers: PromptLayerResponse[] }
      expect(data.workspaceId).toBe(workspaceId)
      expect(data.layers).toHaveLength(7)
    })

    it('should mark all as global when no overrides', async () => {
      const res = await app.request(`/api/prompts/${workspaceId}`)
      const data = (await res.json()) as { layers: PromptLayerResponse[] }

      for (const layer of data.layers) {
        expect(layer.isGlobal).toBe(true)
      }
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/prompts/nonexistent')
      expect(res.status).toBe(404)
    })
  })

  describe('PUT /api/prompts/:workspaceId/:layer', () => {
    it('should create workspace override', async () => {
      const res = await app.request(`/api/prompts/${workspaceId}/identity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Workspace-specific identity.' }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { content: string; workspaceId: string }
      expect(data.content).toBe('Workspace-specific identity.')
      expect(data.workspaceId).toBe(workspaceId)
    })

    it('should mark overridden layer as not global', async () => {
      // Create override
      await app.request(`/api/prompts/${workspaceId}/identity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Custom' }),
      })

      // Fetch merged
      const res = await app.request(`/api/prompts/${workspaceId}`)
      const data = (await res.json()) as { layers: PromptLayerResponse[] }

      const identity = data.layers.find((l) => l.layer === 'identity')
      expect(identity?.isGlobal).toBe(false)
      expect(identity?.content).toBe('Custom')
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/prompts/nonexistent/identity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'test' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/prompts/:workspaceId/:layer edge cases', () => {
    it('should return 400 for invalid layer name', async () => {
      const res = await app.request(`/api/prompts/${workspaceId}/bogus_layer`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(400)
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/prompts/missing-ws/identity', {
        method: 'DELETE',
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/prompts/:workspaceId/:layer', () => {
    it('should delete workspace override', async () => {
      // Create override
      await app.request(`/api/prompts/${workspaceId}/identity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Custom' }),
      })

      // Delete
      const res = await app.request(`/api/prompts/${workspaceId}/identity`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(200)

      // Verify falls back to global
      const fetchRes = await app.request(`/api/prompts/${workspaceId}`)
      const data = (await fetchRes.json()) as { layers: PromptLayerResponse[] }
      const identity = data.layers.find((l) => l.layer === 'identity')
      expect(identity?.isGlobal).toBe(true)
    })

    it('should return 404 when no override exists', async () => {
      const res = await app.request(`/api/prompts/${workspaceId}/identity`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(404)
    })
  })

  // ===========================================================================
  // Preview
  // ===========================================================================

  describe('POST /api/prompts/preview', () => {
    it('should return assembled prompt', async () => {
      const res = await app.request('/api/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as {
        assembledPrompt: string
        tokenEstimate: number
        layers: PromptLayerResponse[]
      }

      expect(data.assembledPrompt).toContain('interactive agent')
      expect(data.tokenEstimate).toBeGreaterThan(0)
      expect(data.layers).toHaveLength(7)
    })

    it('should apply content overrides', async () => {
      const res = await app.request('/api/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          overrides: {
            identity: { content: 'Custom preview identity.' },
          },
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { assembledPrompt: string }
      expect(data.assembledPrompt).toContain('Custom preview identity.')
    })

    it('should apply enabled overrides', async () => {
      const res = await app.request('/api/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          overrides: {
            identity: { enabled: false },
          },
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { assembledPrompt: string }
      // Identity is disabled, should not contain its content
      expect(data.assembledPrompt).not.toContain('AI assistant with access to tools')
    })

    it('should resolve template variables', async () => {
      const res = await app.request('/api/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { assembledPrompt: string }

      // Should have resolved {{cwd}} to workspace path
      expect(data.assembledPrompt).toContain(workspaceDir)

      // Should have resolved {{date}} to a date
      expect(data.assembledPrompt).toMatch(/\d{4}-\d{2}-\d{2}/)

      // Should NOT contain unresolved templates
      expect(data.assembledPrompt).not.toContain('{{cwd}}')
      expect(data.assembledPrompt).not.toContain('{{date}}')
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'nonexistent' }),
      })
      expect(res.status).toBe(404)
    })

    it('should return 400 when workspaceId is missing', async () => {
      const res = await app.request('/api/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('should return 400 when body is invalid JSON', async () => {
      const res = await app.request('/api/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      })
      expect(res.status).toBe(400)
    })

    it('should reject overrides that exceed per-layer schema limits', async () => {
      // Schema rejects override content > 10240 chars
      const huge = 'x'.repeat(11_000)

      const res = await app.request('/api/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          overrides: { identity: { content: huge } },
        }),
      })
      expect(res.status).toBe(400)
    })
  })
})
