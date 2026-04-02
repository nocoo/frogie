import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../connection'
import { runMigrations } from '../migrate'
import { createWorkspace } from './workspaces'
import {
  createSession,
  getSession,
  listSessions,
  updateSessionName,
  updateSessionStats,
  incrementSessionStats,
  touchSession,
  deleteSession,
  deleteWorkspaceSessions,
  countSessions,
} from './sessions'
import { getTestDbPath, cleanupTestDb } from '../../test/db-utils'

describe('repositories/sessions', () => {
  let testDbPath: string
  let workspaceId: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
    const db = initDb(testDbPath)
    runMigrations(db)
    // Create a workspace for session tests
    const ws = createWorkspace(db, { name: 'Test', path: `/test/${String(Date.now())}` })
    workspaceId = ws.id
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('createSession', () => {
    it('should create session with auto-generated ID', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
      })

      expect(session.id).toBeDefined()
      expect(session.id).toMatch(/^[0-9A-Z]{26}$/) // ULID format
      expect(session.workspace_id).toBe(workspaceId)
      expect(session.model).toBe('claude-sonnet-4-6')
      expect(session.name).toBeNull()
      expect(session.message_count).toBe(0)
      expect(session.total_input_tokens).toBe(0)
      expect(session.total_output_tokens).toBe(0)
      expect(session.total_cost_usd).toBe(0)
    })

    it('should create session with provided ID', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        id: 'custom-session-id',
        workspace_id: workspaceId,
        model: 'claude-opus-4',
      })

      expect(session.id).toBe('custom-session-id')
    })

    it('should create session with name', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
        name: 'My Session',
      })

      expect(session.name).toBe('My Session')
    })

    it('should fail with non-existent workspace', () => {
      const db = initDb(testDbPath)

      expect(() => {
        createSession(db, {
          workspace_id: 'nonexistent',
          model: 'claude-sonnet-4-6',
        })
      }).toThrow(/FOREIGN KEY constraint failed/)
    })
  })

  describe('getSession', () => {
    it('should return session by ID', () => {
      const db = initDb(testDbPath)

      const created = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
      })
      const fetched = getSession(db, created.id)

      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe(created.id)
    })

    it('should return null for non-existent ID', () => {
      const db = initDb(testDbPath)

      const result = getSession(db, 'nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('listSessions', () => {
    it('should return empty array for workspace with no sessions', () => {
      const db = initDb(testDbPath)

      const list = listSessions(db, workspaceId)
      expect(list).toEqual([])
    })

    it('should return sessions ordered by updated_at DESC', () => {
      const db = initDb(testDbPath)

      const sess1 = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
        name: 'First',
      })
      createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
        name: 'Second',
      })

      // Touch first session to make it most recent
      touchSession(db, sess1.id)

      const list = listSessions(db, workspaceId)

      expect(list).toHaveLength(2)
      expect(list[0]?.name).toBe('First')
      expect(list[1]?.name).toBe('Second')
    })

    it('should only return sessions for specified workspace', () => {
      const db = initDb(testDbPath)

      const ws2 = createWorkspace(db, { name: 'Other', path: '/other' })

      createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
      })
      createSession(db, {
        workspace_id: ws2.id,
        model: 'claude-sonnet-4-6',
      })

      const list = listSessions(db, workspaceId)
      expect(list).toHaveLength(1)
    })
  })

  describe('updateSessionName', () => {
    it('should update session name', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
      })

      const updated = updateSessionName(db, session.id, 'New Name')

      expect(updated?.name).toBe('New Name')
    })

    it('should clear name with null', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
        name: 'Original Name',
      })

      const updated = updateSessionName(db, session.id, null)

      expect(updated?.name).toBeNull()
    })

    it('should return null for non-existent session', () => {
      const db = initDb(testDbPath)

      const result = updateSessionName(db, 'nonexistent', 'Name')
      expect(result).toBeNull()
    })
  })

  describe('updateSessionStats', () => {
    it('should update all statistics', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
      })

      updateSessionStats(db, session.id, {
        message_count: 10,
        total_input_tokens: 1000,
        total_output_tokens: 500,
        total_cost_usd: 0.05,
      })

      const updated = getSession(db, session.id)

      expect(updated?.message_count).toBe(10)
      expect(updated?.total_input_tokens).toBe(1000)
      expect(updated?.total_output_tokens).toBe(500)
      expect(updated?.total_cost_usd).toBe(0.05)
    })
  })

  describe('incrementSessionStats', () => {
    it('should increment statistics by delta', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
      })

      incrementSessionStats(db, session.id, {
        message_count: 2,
        total_input_tokens: 100,
      })

      incrementSessionStats(db, session.id, {
        message_count: 3,
        total_output_tokens: 200,
      })

      const updated = getSession(db, session.id)

      expect(updated?.message_count).toBe(5)
      expect(updated?.total_input_tokens).toBe(100)
      expect(updated?.total_output_tokens).toBe(200)
    })
  })

  describe('touchSession', () => {
    it('should update updated_at timestamp', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
      })
      const original = getSession(db, session.id)

      touchSession(db, session.id)

      const updated = getSession(db, session.id)
      expect(updated?.updated_at).toBeGreaterThanOrEqual(original?.updated_at ?? 0)
    })
  })

  describe('deleteSession', () => {
    it('should delete session and return true', () => {
      const db = initDb(testDbPath)

      const session = createSession(db, {
        workspace_id: workspaceId,
        model: 'claude-sonnet-4-6',
      })

      const result = deleteSession(db, session.id)

      expect(result).toBe(true)
      expect(getSession(db, session.id)).toBeNull()
    })

    it('should return false for non-existent session', () => {
      const db = initDb(testDbPath)

      const result = deleteSession(db, 'nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('deleteWorkspaceSessions', () => {
    it('should delete all sessions for workspace', () => {
      const db = initDb(testDbPath)

      createSession(db, { workspace_id: workspaceId, model: 'claude-sonnet-4-6' })
      createSession(db, { workspace_id: workspaceId, model: 'claude-sonnet-4-6' })
      createSession(db, { workspace_id: workspaceId, model: 'claude-sonnet-4-6' })

      const deleted = deleteWorkspaceSessions(db, workspaceId)

      expect(deleted).toBe(3)
      expect(listSessions(db, workspaceId)).toHaveLength(0)
    })
  })

  describe('countSessions', () => {
    it('should return 0 for workspace with no sessions', () => {
      const db = initDb(testDbPath)

      const count = countSessions(db, workspaceId)
      expect(count).toBe(0)
    })

    it('should return correct count', () => {
      const db = initDb(testDbPath)

      createSession(db, { workspace_id: workspaceId, model: 'claude-sonnet-4-6' })
      createSession(db, { workspace_id: workspaceId, model: 'claude-sonnet-4-6' })

      const count = countSessions(db, workspaceId)
      expect(count).toBe(2)
    })
  })
})
