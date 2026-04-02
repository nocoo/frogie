import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb, runMigrations, createWorkspace } from '../db'
import {
  SessionSync,
  InMemoryMessageStore,
} from './session-sync'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import type { Message } from './types'

describe('engine/session-sync', () => {
  let testDbPath: string
  let workspaceId: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
    const db = initDb(testDbPath)
    runMigrations(db)
    const ws = createWorkspace(db, {
      name: 'Test',
      path: `/test/${String(Date.now())}`,
    })
    workspaceId = ws.id
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('createSession', () => {
    it('should create session and return ID', () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessionId = sync.createSession(
        workspaceId,
        'Test Session',
        'claude-sonnet-4-6'
      )

      expect(sessionId).toBeDefined()
      expect(sessionId).toMatch(/^[0-9A-Z]{26}$/) // ULID format
    })

    it('should create session retrievable from index', () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessionId = sync.createSession(
        workspaceId,
        'My Session',
        'claude-opus-4'
      )

      const session = sync.getSession(sessionId)

      expect(session).not.toBeNull()
      expect(session?.name).toBe('My Session')
      expect(session?.model).toBe('claude-opus-4')
      expect(session?.workspace_id).toBe(workspaceId)
    })
  })

  describe('getSession', () => {
    it('should return null for non-existent session', () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const session = sync.getSession('nonexistent')

      expect(session).toBeNull()
    })
  })

  describe('listSessions', () => {
    it('should list sessions for workspace', () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      sync.createSession(workspaceId, 'Session 1', 'claude-sonnet-4-6')
      sync.createSession(workspaceId, 'Session 2', 'claude-sonnet-4-6')

      const sessions = sync.listSessions(workspaceId)

      expect(sessions).toHaveLength(2)
    })

    it('should return empty array for workspace with no sessions', () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessions = sync.listSessions(workspaceId)

      expect(sessions).toEqual([])
    })
  })

  describe('getSessionWithMessages', () => {
    it('should return session index and messages', async () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessionId = sync.createSession(
        workspaceId,
        'Test',
        'claude-sonnet-4-6'
      )

      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
      ]

      await sync.saveMessages(sessionId, messages)

      const result = await sync.getSessionWithMessages(sessionId)

      expect(result).not.toBeNull()
      expect(result?.index.id).toBe(sessionId)
      expect(result?.messages).toHaveLength(2)
    })

    it('should return null for non-existent session', async () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const result = await sync.getSessionWithMessages('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('saveMessages', () => {
    it('should save messages to store', async () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessionId = sync.createSession(
        workspaceId,
        'Test',
        'claude-sonnet-4-6'
      )

      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ]

      await sync.saveMessages(sessionId, messages)

      const loaded = await messageStore.loadMessages(sessionId)
      expect(loaded).toHaveLength(1)
    })

    it('should touch session after save', async () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessionId = sync.createSession(
        workspaceId,
        'Test',
        'claude-sonnet-4-6'
      )

      const before = sync.getSession(sessionId)

      await sync.saveMessages(sessionId, [{ role: 'user', content: 'Hi' }])

      const after = sync.getSession(sessionId)

      expect(after?.updated_at).toBeGreaterThanOrEqual(before?.updated_at ?? 0)
    })
  })

  describe('updateSessionStats', () => {
    it('should update session statistics', () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessionId = sync.createSession(
        workspaceId,
        'Test',
        'claude-sonnet-4-6'
      )

      sync.updateSessionStats(sessionId, {
        message_count: 10,
        total_input_tokens: 1000,
        total_output_tokens: 500,
        total_cost_usd: 0.05,
      })

      const session = sync.getSession(sessionId)

      expect(session?.message_count).toBe(10)
      expect(session?.total_input_tokens).toBe(1000)
      expect(session?.total_output_tokens).toBe(500)
      expect(session?.total_cost_usd).toBe(0.05)
    })
  })

  describe('incrementSessionStats', () => {
    it('should increment session statistics', () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessionId = sync.createSession(
        workspaceId,
        'Test',
        'claude-sonnet-4-6'
      )

      sync.incrementSessionStats(sessionId, {
        message_count: 2,
        total_input_tokens: 100,
      })

      sync.incrementSessionStats(sessionId, {
        message_count: 3,
        total_output_tokens: 200,
      })

      const session = sync.getSession(sessionId)

      expect(session?.message_count).toBe(5)
      expect(session?.total_input_tokens).toBe(100)
      expect(session?.total_output_tokens).toBe(200)
    })
  })

  describe('deleteSession', () => {
    it('should delete session from both index and message store', async () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const sessionId = sync.createSession(
        workspaceId,
        'Test',
        'claude-sonnet-4-6'
      )

      await sync.saveMessages(sessionId, [{ role: 'user', content: 'Hi' }])

      const deleted = await sync.deleteSession(sessionId)

      expect(deleted).toBe(true)
      expect(sync.getSession(sessionId)).toBeNull()
      expect(await messageStore.loadMessages(sessionId)).toEqual([])
    })

    it('should return false for non-existent session', async () => {
      const db = initDb(testDbPath)
      const messageStore = new InMemoryMessageStore()
      const sync = new SessionSync(db, messageStore)

      const deleted = await sync.deleteSession('nonexistent')

      expect(deleted).toBe(false)
    })
  })

  describe('InMemoryMessageStore', () => {
    it('should store and retrieve messages', async () => {
      const store = new InMemoryMessageStore()

      const messages: Message[] = [
        { role: 'user', content: 'Test' },
      ]

      await store.saveMessages('session1', messages)

      const loaded = await store.loadMessages('session1')
      expect(loaded).toEqual(messages)
    })

    it('should return empty array for unknown session', async () => {
      const store = new InMemoryMessageStore()

      const loaded = await store.loadMessages('unknown')
      expect(loaded).toEqual([])
    })

    it('should delete session messages', async () => {
      const store = new InMemoryMessageStore()

      await store.saveMessages('session1', [{ role: 'user', content: 'Hi' }])
      await store.deleteSession('session1')

      const loaded = await store.loadMessages('session1')
      expect(loaded).toEqual([])
    })

    it('should clear all messages', async () => {
      const store = new InMemoryMessageStore()

      await store.saveMessages('session1', [{ role: 'user', content: 'Hi' }])
      await store.saveMessages('session2', [{ role: 'user', content: 'Hello' }])

      store.clear()

      expect(await store.loadMessages('session1')).toEqual([])
      expect(await store.loadMessages('session2')).toEqual([])
    })
  })
})
