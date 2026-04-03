import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from './connection'
import { runMigrations, tableExists, getTables } from './migrate'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'

describe('db/migrate', () => {
  let testDbPath: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('runMigrations', () => {
    it('should create all expected tables on fresh database', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const tables = getTables(db)

      expect(tables).toContain('_migrations')
      expect(tables).toContain('settings')
      expect(tables).toContain('workspaces')
      expect(tables).toContain('sessions')
      expect(tables).toContain('mcp_configs')
      expect(tables).toContain('users')
    })

    it('should be idempotent - running twice applies same migrations', () => {
      const db = initDb(testDbPath)

      const firstRun = runMigrations(db)
      const secondRun = runMigrations(db)

      expect(firstRun).toBe(3) // Three migration files (initial + users + workspace_color)
      expect(secondRun).toBe(0) // No new migrations

      const tables = getTables(db)
      expect(tables).toContain('settings')
    })

    it('should track applied migrations in _migrations table', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const migrations = db
        .prepare('SELECT * FROM _migrations ORDER BY id')
        .all() as { id: number; name: string; applied_at: number }[]

      expect(migrations).toHaveLength(3)
      expect(migrations[0]?.id).toBe(1)
      expect(migrations[0]?.name).toBe('initial')
      expect(migrations[0]?.applied_at).toBeGreaterThan(0)
      expect(migrations[1]?.id).toBe(2)
      expect(migrations[1]?.name).toBe('users')
      expect(migrations[2]?.id).toBe(3)
      expect(migrations[2]?.name).toBe('workspace_color')
    })

    it('should initialize settings with default values', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const settings = db.prepare('SELECT * FROM settings WHERE id = ?').get('global') as {
        id: string
        llm_base_url: string
        llm_api_key: string
        llm_model: string
        max_turns: number
        max_budget_usd: number
      }

      expect(settings).toBeDefined()
      expect(settings.llm_base_url).toBe('http://localhost:7024/v1')
      expect(settings.llm_api_key).toBe('')
      expect(settings.llm_model).toBe('claude-sonnet-4-6')
      expect(settings.max_turns).toBe(50)
      expect(settings.max_budget_usd).toBe(10.0)
    })
  })

  describe('tableExists', () => {
    it('should return false for non-existent table', () => {
      const db = initDb(testDbPath)
      expect(tableExists(db, 'nonexistent')).toBe(false)
    })

    it('should return true for existing table', () => {
      const db = initDb(testDbPath)
      runMigrations(db)
      expect(tableExists(db, 'settings')).toBe(true)
    })
  })

  describe('getTables', () => {
    it('should return empty array for fresh database', () => {
      const db = initDb(testDbPath)
      expect(getTables(db)).toEqual([])
    })

    it('should exclude sqlite internal tables', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const tables = getTables(db)
      const internalTables = tables.filter((t) => t.startsWith('sqlite_'))
      expect(internalTables).toHaveLength(0)
    })
  })

  describe('schema structure', () => {
    it('should enforce foreign key constraint on sessions.workspace_id', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      // Try to insert session with non-existent workspace
      expect(() => {
        db.prepare(`
          INSERT INTO sessions (id, workspace_id, model, created_at, updated_at)
          VALUES ('sess1', 'nonexistent', 'claude-sonnet-4-6', 0, 0)
        `).run()
      }).toThrow(/FOREIGN KEY constraint failed/)
    })

    it('should cascade delete sessions when workspace is deleted', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      // Create workspace and session
      db.prepare(`
        INSERT INTO workspaces (id, name, path, created_at)
        VALUES ('ws1', 'Test', '/test', 0)
      `).run()

      db.prepare(`
        INSERT INTO sessions (id, workspace_id, model, created_at, updated_at)
        VALUES ('sess1', 'ws1', 'claude-sonnet-4-6', 0, 0)
      `).run()

      // Delete workspace
      db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws1')

      // Session should be deleted
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess1')
      expect(session).toBeUndefined()
    })

    it('should enforce unique constraint on mcp_configs(workspace_id, name)', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      // Create workspace
      db.prepare(`
        INSERT INTO workspaces (id, name, path, created_at)
        VALUES ('ws1', 'Test', '/test', 0)
      `).run()

      // Insert first MCP config
      db.prepare(`
        INSERT INTO mcp_configs (id, workspace_id, name, type, config, created_at, updated_at)
        VALUES ('mcp1', 'ws1', 'server1', 'stdio', '{}', 0, 0)
      `).run()

      // Try to insert duplicate
      expect(() => {
        db.prepare(`
          INSERT INTO mcp_configs (id, workspace_id, name, type, config, created_at, updated_at)
          VALUES ('mcp2', 'ws1', 'server1', 'stdio', '{}', 0, 0)
        `).run()
      }).toThrow(/UNIQUE constraint failed/)
    })
  })
})
