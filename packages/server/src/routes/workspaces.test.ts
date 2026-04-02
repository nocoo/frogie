/**
 * Workspace Routes Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { initDb, closeDb, runMigrations, createWorkspace } from '../db'
import { createWorkspacesRouter } from './workspaces'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import { ApiError, ErrorCodes } from '../middleware'

/**
 * Workspace API response type
 */
interface WorkspaceResponse {
  id: string
  name: string
  path: string
  createdAt: number
  lastAccessed: number | null
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

describe('routes/workspaces', () => {
  let testDbPath: string
  let app: Hono
  let tempDirs: string[] = []
  let db: ReturnType<typeof initDb>

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

    app.route('/api/workspaces', createWorkspacesRouter(db))
    tempDirs = []
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)

    // Clean up temp directories
    for (const dir of tempDirs) {
      removeTempDir(dir)
    }
  })

  describe('GET /api/workspaces', () => {
    it('should return empty array when no workspaces', async () => {
      const res = await app.request('/api/workspaces')

      expect(res.status).toBe(200)
      const body = (await res.json()) as WorkspaceResponse[]
      expect(body).toEqual([])
    })

    it('should return all workspaces', async () => {
      // Create test workspaces directly
      const dir1 = createTempDir('ws1')
      const dir2 = createTempDir('ws2')
      tempDirs.push(dir1, dir2)

      createWorkspace(db, { name: 'Workspace 1', path: dir1 })
      createWorkspace(db, { name: 'Workspace 2', path: dir2 })

      const res = await app.request('/api/workspaces')

      expect(res.status).toBe(200)
      const body = (await res.json()) as WorkspaceResponse[]
      expect(body).toHaveLength(2)
      // Both workspaces should be present
      const names = body.map((w) => w.name)
      expect(names).toContain('Workspace 1')
      expect(names).toContain('Workspace 2')
    })
  })

  describe('POST /api/workspaces', () => {
    it('should create workspace with valid path', async () => {
      const dir = createTempDir('new-ws')
      tempDirs.push(dir)

      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Project', path: dir }),
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as WorkspaceResponse
      expect(body.name).toBe('My Project')
      expect(body.path).toBe(dir)
      expect(body.id).toBeDefined()
      expect(body.createdAt).toBeDefined()
    })

    it('should reject missing name', async () => {
      const dir = createTempDir('no-name')
      tempDirs.push(dir)

      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      })

      expect(res.status).toBe(400)
    })

    it('should reject missing path', async () => {
      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })

      expect(res.status).toBe(400)
    })

    it('should reject non-existent path', async () => {
      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          path: '/non/existent/path/1234567890',
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.message).toContain('does not exist')
    })

    it('should reject file path (not directory)', async () => {
      // Create a file, not directory
      const dir = createTempDir('file-test')
      tempDirs.push(dir)
      const filePath = join(dir, 'file.txt')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(filePath, 'test')

      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', path: filePath }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.message).toContain('not a directory')
    })
  })

  describe('GET /api/workspaces/:id', () => {
    it('should return workspace by ID', async () => {
      const dir = createTempDir('get-ws')
      tempDirs.push(dir)

      const workspace = createWorkspace(db, { name: 'Test', path: dir })

      const res = await app.request(`/api/workspaces/${workspace.id}`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as WorkspaceResponse
      expect(body.id).toBe(workspace.id)
      expect(body.name).toBe('Test')
      expect(body.path).toBe(dir)
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent123')

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('WORKSPACE_NOT_FOUND')
    })
  })

  describe('DELETE /api/workspaces/:id', () => {
    it('should delete workspace', async () => {
      const dir = createTempDir('delete-ws')
      tempDirs.push(dir)

      const workspace = createWorkspace(db, { name: 'ToDelete', path: dir })

      const res = await app.request(`/api/workspaces/${workspace.id}`, {
        method: 'DELETE',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean }
      expect(body.success).toBe(true)

      // Verify deleted
      const getRes = await app.request(`/api/workspaces/${workspace.id}`)
      expect(getRes.status).toBe(404)
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent456', {
        method: 'DELETE',
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('WORKSPACE_NOT_FOUND')
    })
  })
})
