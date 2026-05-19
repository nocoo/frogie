/**
 * Session Routes Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import {
  initDb,
  closeDb,
  runMigrations,
  createWorkspace,
} from '../db'
import { createSessionsRouter } from './sessions'
import { InMemoryMessageStore } from '../engine/session-sync'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import { ApiError, ErrorCodes } from '../middleware'

/**
 * Session API response type
 */
interface SessionResponse {
  id: string
  workspaceId: string
  name: string | null
  model: string
  createdAt: number
  updatedAt: number
  messageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
}

/**
 * Session with messages response type (per 07-api-protocol.md)
 */
interface SessionWithMessagesResponse {
  session: SessionResponse
  messages: unknown[]
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

describe('routes/sessions', () => {
  let testDbPath: string
  let app: Hono
  let tempDirs: string[] = []
  let db: ReturnType<typeof initDb>
  let messageStore: InMemoryMessageStore
  let workspaceId: string
  let workspaceDir: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
    db = initDb(testDbPath)
    runMigrations(db)

    messageStore = new InMemoryMessageStore()

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

    // Mount sessions router under workspace path
    app.route('/api/workspaces/:wid/sessions', createSessionsRouter(db, messageStore))
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
    messageStore.clear()

    // Clean up temp directories
    for (const dir of tempDirs) {
      removeTempDir(dir)
    }
    tempDirs = []
  })

  describe('GET /api/workspaces/:wid/sessions', () => {
    it('should return empty array when no sessions', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/sessions`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as SessionResponse[]
      expect(body).toEqual([])
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/sessions')

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('WORKSPACE_NOT_FOUND')
    })
  })

  describe('POST /api/workspaces/:wid/sessions', () => {
    it('should create session with name', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Session', model: 'claude-sonnet-4-6' }),
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as SessionResponse
      expect(body.name).toBe('My Session')
      expect(body.model).toBe('claude-sonnet-4-6')
      expect(body.workspaceId).toBe(workspaceId)
      expect(body.id).toBeDefined()
      expect(body.messageCount).toBe(0)
      expect(body.totalCostUsd).toBe(0)
    })

    it('should create session without name', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus-4' }),
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as SessionResponse
      expect(body.name).toBeNull()
      expect(body.model).toBe('claude-opus-4')
    })

    it('should reject missing model', async () => {
      const res = await app.request(`/api/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })

      expect(res.status).toBe(400)
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request('/api/workspaces/nonexistent/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('WORKSPACE_NOT_FOUND')
    })
  })

  describe('GET /api/workspaces/:wid/sessions/:id', () => {
    it('should return session with messages', async () => {
      // Create a session first
      const createRes = await app.request(
        `/api/workspaces/${workspaceId}/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test', model: 'claude-sonnet-4-6' }),
        }
      )
      const created = (await createRes.json()) as SessionResponse

      // Add some messages to the store
      const testMessages: { role: 'user' | 'assistant'; content: string }[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]
      await messageStore.saveMessages(created.id, testMessages as Parameters<typeof messageStore.saveMessages>[1])

      // Get session with messages
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}`
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as SessionWithMessagesResponse
      expect(body.session.id).toBe(created.id)
      expect(body.messages).toHaveLength(2)
    })

    it('should return 404 for non-existent session', async () => {
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/nonexistent`
      )

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('SESSION_NOT_FOUND')
    })

    it('should return 404 for session in different workspace', async () => {
      // Create a session in our workspace
      const createRes = await app.request(
        `/api/workspaces/${workspaceId}/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
        }
      )
      const created = (await createRes.json()) as SessionResponse

      // Create another workspace
      const dir2 = createTempDir('ws2')
      tempDirs.push(dir2)
      const ws2 = createWorkspace(db, { name: 'WS2', path: dir2 })

      // Try to get session from wrong workspace
      const res = await app.request(
        `/api/workspaces/${ws2.id}/sessions/${created.id}`
      )

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('SESSION_NOT_FOUND')
    })
  })

  describe('DELETE /api/workspaces/:wid/sessions/:id', () => {
    it('should delete session', async () => {
      // Create a session first
      const createRes = await app.request(
        `/api/workspaces/${workspaceId}/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
        }
      )
      const created = (await createRes.json()) as SessionResponse

      // Add messages
      await messageStore.saveMessages(created.id, [{ role: 'user', content: 'Test' }])

      // Delete session
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}`,
        { method: 'DELETE' }
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean }
      expect(body.success).toBe(true)

      // Verify deleted
      const getRes = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}`
      )
      expect(getRes.status).toBe(404)

      // Verify messages deleted
      const messages = await messageStore.loadMessages(created.id)
      expect(messages).toEqual([])
    })

    it('should return 404 for non-existent session', async () => {
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/nonexistent`,
        { method: 'DELETE' }
      )

      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error.code).toBe('SESSION_NOT_FOUND')
    })

    it('should return 404 for session in different workspace', async () => {
      // Create a session in our workspace
      const createRes = await app.request(
        `/api/workspaces/${workspaceId}/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
        }
      )
      const created = (await createRes.json()) as SessionResponse

      // Create another workspace
      const dir2 = createTempDir('ws3')
      tempDirs.push(dir2)
      const ws2 = createWorkspace(db, { name: 'WS3', path: dir2 })

      // Try to delete session from wrong workspace
      const res = await app.request(
        `/api/workspaces/${ws2.id}/sessions/${created.id}`,
        { method: 'DELETE' }
      )

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/workspaces/:wid/sessions/:id', () => {
    async function createTestSession(name: string | null = 'Original'): Promise<SessionResponse> {
      const res = await app.request(`/api/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, model: 'claude-sonnet-4-6' }),
      })
      return (await res.json()) as SessionResponse
    }

    it('should update session name', async () => {
      const created = await createTestSession()
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as SessionResponse
      expect(body.name).toBe('Renamed')
    })

    it('should clear session name with null', async () => {
      const created = await createTestSession()
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: null }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as SessionResponse
      expect(body.name).toBeNull()
    })

    it('should update model', async () => {
      const created = await createTestSession()
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-opus-4' }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as SessionResponse
      expect(body.model).toBe('claude-opus-4')
    })

    it('should accept empty body without changes', async () => {
      const created = await createTestSession()
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )
      expect(res.status).toBe(200)
    })

    it('should reject empty model string', async () => {
      const created = await createTestSession()
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: '' }),
        }
      )
      expect(res.status).toBe(400)
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request(
        '/api/workspaces/missing/sessions/anything',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'X' }),
        }
      )
      expect(res.status).toBe(404)
    })

    it('should return 404 for session in different workspace', async () => {
      const created = await createTestSession()
      const dir2 = createTempDir('ws-patch')
      tempDirs.push(dir2)
      const ws2 = createWorkspace(db, { name: 'WS2', path: dir2 })

      const res = await app.request(
        `/api/workspaces/${ws2.id}/sessions/${created.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'X' }),
        }
      )
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/workspaces/:wid/sessions/:id/fork', () => {
    it('should fork session preserving messages', async () => {
      const createRes = await app.request(`/api/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Source', model: 'claude-sonnet-4-6' }),
      })
      const created = (await createRes.json()) as SessionResponse

      await messageStore.saveMessages(created.id, [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ] as Parameters<typeof messageStore.saveMessages>[1])

      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}/fork`,
        { method: 'POST' }
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as SessionResponse
      expect(body.name).toBe('Source (fork)')
      expect(body.id).not.toBe(created.id)

      const messages = await messageStore.loadMessages(body.id)
      expect(messages).toHaveLength(2)
    })

    it('should fork session without messages', async () => {
      const createRes = await app.request(`/api/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
      })
      const created = (await createRes.json()) as SessionResponse

      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/${created.id}/fork`,
        { method: 'POST' }
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as SessionResponse
      expect(body.name).toBe('Session (fork)')
    })

    it('should return 404 for non-existent workspace', async () => {
      const res = await app.request(
        '/api/workspaces/missing/sessions/anything/fork',
        { method: 'POST' }
      )
      expect(res.status).toBe(404)
    })

    it('should return 404 for non-existent session', async () => {
      const res = await app.request(
        `/api/workspaces/${workspaceId}/sessions/missing/fork`,
        { method: 'POST' }
      )
      expect(res.status).toBe(404)
    })

    it('should return 404 for session in different workspace', async () => {
      const createRes = await app.request(`/api/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
      })
      const created = (await createRes.json()) as SessionResponse

      const dir2 = createTempDir('ws-fork')
      tempDirs.push(dir2)
      const ws2 = createWorkspace(db, { name: 'Other', path: dir2 })

      const res = await app.request(
        `/api/workspaces/${ws2.id}/sessions/${created.id}/fork`,
        { method: 'POST' }
      )
      expect(res.status).toBe(404)
    })
  })
})
