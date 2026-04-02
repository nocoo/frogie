/**
 * MCP Routes Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { initDb, closeDb, runMigrations, createWorkspace } from '../db'
import { createMCPRouter } from './mcp'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import { ApiError, ErrorCodes } from '../middleware'

/**
 * MCP Config API response type
 */
interface MCPConfigResponse {
  id: string
  workspaceId: string
  name: string
  type: 'stdio' | 'sse' | 'http'
  config: {
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
  }
  enabled: boolean
  createdAt: number
  updatedAt: number
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

describe('routes/mcp', () => {
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

    // Create a test workspace
    workspaceDir = createTempDir('workspace')
    tempDirs.push(workspaceDir)
    const workspace = createWorkspace(db, { name: 'Test', path: workspaceDir })
    workspaceId = workspace.id

    // Mount MCP router under workspace path
    app.route('/api/workspaces/:wid/mcp', createMCPRouter(db))
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)

    // Clean up temp directories
    for (const dir of tempDirs) {
      removeTempDir(dir)
    }
    tempDirs = []
  })

  describe('GET /api/workspaces/:wid/mcp', () => {
    it('should return empty array when no configs', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/mcp`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as MCPConfigResponse[]
      expect(body).toEqual([])
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/mcp')

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('WORKSPACE_NOT_FOUND')
    })
  })

  describe('POST /api/workspaces/:wid/mcp', () => {
    it('should create stdio MCP config', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-mcp',
          type: 'stdio',
          config: {
            command: 'node',
            args: ['server.js'],
            env: { DEBUG: '1' },
          },
        }),
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as MCPConfigResponse
      expect(body.name).toBe('test-mcp')
      expect(body.type).toBe('stdio')
      expect(body.config.command).toBe('node')
      expect(body.config.args).toEqual(['server.js'])
      expect(body.enabled).toBe(true) // Default enabled
    })

    it('should create SSE MCP config', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sse-server',
          type: 'sse',
          config: {
            url: 'http://localhost:8080/sse',
          },
          enabled: false,
        }),
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as MCPConfigResponse
      expect(body.name).toBe('sse-server')
      expect(body.type).toBe('sse')
      expect(body.config.url).toBe('http://localhost:8080/sse')
      expect(body.enabled).toBe(false)
    })

    it('should reject stdio without command', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bad-config',
          type: 'stdio',
          config: {},
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.message).toContain('command')
    })

    it('should reject sse without url', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bad-sse',
          type: 'sse',
          config: {},
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.message).toContain('url')
    })

    it('should reject invalid type', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'invalid',
          type: 'invalid-type',
          config: {},
        }),
      })

      expect(res.status).toBe(400)
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test',
          type: 'stdio',
          config: { command: 'node' },
        }),
      })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/workspaces/:wid/mcp/:name', () => {
    it('should delete MCP config', async () => {
      // Create a config first
      await app.request(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'to-delete',
          type: 'stdio',
          config: { command: 'node' },
        }),
      })

      // Delete it
      const res = await app.request(
        `/api/workspaces/${workspaceId}/mcp/to-delete`,
        { method: 'DELETE' }
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean }
      expect(body.success).toBe(true)

      // Verify deleted
      const listRes = await app.request(`/api/workspaces/${workspaceId}/mcp`)
      const configs = (await listRes.json()) as MCPConfigResponse[]
      expect(configs).toEqual([])
    })

    it('should return 404 for non-existent config', async () => {
      const res = await app.request(
        `/api/workspaces/${workspaceId}/mcp/nonexistent`,
        { method: 'DELETE' }
      )

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('MCP_NOT_FOUND')
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/mcp/test', {
        method: 'DELETE',
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('WORKSPACE_NOT_FOUND')
    })
  })

  describe('PATCH /api/workspaces/:wid/mcp/:name', () => {
    it('should enable/disable MCP config', async () => {
      // Create a config first (defaults to enabled)
      await app.request(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'toggle-me',
          type: 'stdio',
          config: { command: 'node' },
        }),
      })

      // Disable it
      const res = await app.request(
        `/api/workspaces/${workspaceId}/mcp/toggle-me`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        }
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as MCPConfigResponse
      expect(body.name).toBe('toggle-me')
      expect(body.enabled).toBe(false)

      // Enable it again
      const res2 = await app.request(
        `/api/workspaces/${workspaceId}/mcp/toggle-me`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }
      )

      expect(res2.status).toBe(200)
      const body2 = (await res2.json()) as MCPConfigResponse
      expect(body2.enabled).toBe(true)
    })

    it('should return 404 for non-existent config', async () => {
      const res = await app.request(
        `/api/workspaces/${workspaceId}/mcp/nonexistent`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }
      )

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('MCP_NOT_FOUND')
    })

    it('should reject invalid body', async () => {
      // Create a config first
      await app.request(`/api/workspaces/${workspaceId}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-patch',
          type: 'stdio',
          config: { command: 'node' },
        }),
      })

      const res = await app.request(
        `/api/workspaces/${workspaceId}/mcp/test-patch`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: 'not-a-boolean' }),
        }
      )

      expect(res.status).toBe(400)
    })
  })
})
