import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../connection'
import { runMigrations } from '../migrate'
import {
  createWorkspace,
  getWorkspace,
  getWorkspaceByPath,
  listWorkspaces,
  touchWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getOrCreateWorkspace,
} from './workspaces'
import { getTestDbPath, cleanupTestDb } from '../../test/db-utils'

describe('repositories/workspaces', () => {
  let testDbPath: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('createWorkspace', () => {
    it('should create workspace with name and path', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws = createWorkspace(db, { name: 'My Project', path: '/home/user/project' })

      expect(ws.id).toBeDefined()
      expect(ws.name).toBe('My Project')
      expect(ws.path).toBe('/home/user/project')
      expect(ws.created_at).toBeGreaterThan(0)
      expect(ws.last_accessed).toBeGreaterThan(0)
      expect(ws.settings).toBe('{}')
    })

    it('should generate unique ULID IDs', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws1 = createWorkspace(db, { name: 'Project 1', path: '/path/1' })
      const ws2 = createWorkspace(db, { name: 'Project 2', path: '/path/2' })

      expect(ws1.id).not.toBe(ws2.id)
      expect(ws1.id).toMatch(/^[0-9A-Z]{26}$/) // ULID format
    })

    it('should fail on duplicate path', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      createWorkspace(db, { name: 'First', path: '/same/path' })

      expect(() => {
        createWorkspace(db, { name: 'Second', path: '/same/path' })
      }).toThrow(/UNIQUE constraint failed/)
    })
  })

  describe('getWorkspace', () => {
    it('should return workspace by ID', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const created = createWorkspace(db, { name: 'Test', path: '/test' })
      const fetched = getWorkspace(db, created.id)

      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe(created.id)
      expect(fetched?.name).toBe('Test')
    })

    it('should return null for non-existent ID', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const result = getWorkspace(db, 'nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('getWorkspaceByPath', () => {
    it('should return workspace by path', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      createWorkspace(db, { name: 'Test', path: '/my/project' })
      const fetched = getWorkspaceByPath(db, '/my/project')

      expect(fetched).not.toBeNull()
      expect(fetched?.name).toBe('Test')
    })

    it('should return null for non-existent path', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const result = getWorkspaceByPath(db, '/nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('listWorkspaces', () => {
    it('should return empty array when no workspaces', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const list = listWorkspaces(db)
      expect(list).toEqual([])
    })

    it('should return workspaces ordered by last_accessed DESC', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws1 = createWorkspace(db, { name: 'First', path: '/first' })
      createWorkspace(db, { name: 'Second', path: '/second' })

      // Touch first workspace to make it most recent
      touchWorkspace(db, ws1.id)

      const list = listWorkspaces(db)

      expect(list).toHaveLength(2)
      expect(list[0]?.name).toBe('First')
      expect(list[1]?.name).toBe('Second')
    })
  })

  describe('touchWorkspace', () => {
    it('should update last_accessed timestamp', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws = createWorkspace(db, { name: 'Test', path: '/test' })
      const originalAccess = ws.last_accessed ?? 0

      // Small delay
      touchWorkspace(db, ws.id)

      const updated = getWorkspace(db, ws.id)
      expect(updated?.last_accessed).toBeGreaterThanOrEqual(originalAccess)
    })
  })

  describe('updateWorkspace', () => {
    it('should update name', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws = createWorkspace(db, { name: 'Old Name', path: '/test' })
      const updated = updateWorkspace(db, ws.id, { name: 'New Name' })

      expect(updated?.name).toBe('New Name')
      expect(updated?.path).toBe('/test') // Unchanged
    })

    it('should update path', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws = createWorkspace(db, { name: 'Test', path: '/old/path' })
      const updated = updateWorkspace(db, ws.id, { path: '/new/path' })

      expect(updated?.path).toBe('/new/path')
      expect(updated?.name).toBe('Test') // Unchanged
    })

    it('should update settings', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws = createWorkspace(db, { name: 'Test', path: '/test' })
      const updated = updateWorkspace(db, ws.id, {
        settings: JSON.stringify({ custom: true }),
      })

      expect(updated?.settings).toBe('{"custom":true}')
    })

    it('should return null for non-existent workspace', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const result = updateWorkspace(db, 'nonexistent', { name: 'New' })
      expect(result).toBeNull()
    })
  })

  describe('deleteWorkspace', () => {
    it('should delete workspace and return true', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws = createWorkspace(db, { name: 'Test', path: '/test' })
      const result = deleteWorkspace(db, ws.id)

      expect(result).toBe(true)
      expect(getWorkspace(db, ws.id)).toBeNull()
    })

    it('should return false for non-existent workspace', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const result = deleteWorkspace(db, 'nonexistent')
      expect(result).toBe(false)
    })

    it('should cascade delete sessions', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws = createWorkspace(db, { name: 'Test', path: '/test' })

      // Create a session
      db.prepare(`
        INSERT INTO sessions (id, workspace_id, model, created_at, updated_at)
        VALUES ('sess1', ?, 'claude-sonnet-4-6', 0, 0)
      `).run(ws.id)

      // Delete workspace
      deleteWorkspace(db, ws.id)

      // Session should be gone
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess1')
      expect(session).toBeUndefined()
    })
  })

  describe('getOrCreateWorkspace', () => {
    it('should create new workspace if path does not exist', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const ws = getOrCreateWorkspace(db, '/new/project/myapp')

      expect(ws.path).toBe('/new/project/myapp')
      expect(ws.name).toBe('myapp') // Basename extracted
    })

    it('should return existing workspace if path exists', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const original = createWorkspace(db, { name: 'Custom Name', path: '/existing' })
      const fetched = getOrCreateWorkspace(db, '/existing')

      expect(fetched.id).toBe(original.id)
      expect(fetched.name).toBe('Custom Name') // Original name preserved
    })

    it('should touch existing workspace on access', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const original = createWorkspace(db, { name: 'Test', path: '/existing' })
      const originalAccess = original.last_accessed ?? 0

      const fetched = getOrCreateWorkspace(db, '/existing')

      expect(fetched.last_accessed).toBeGreaterThanOrEqual(originalAccess)
    })
  })
})
