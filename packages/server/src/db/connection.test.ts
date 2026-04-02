import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { initDb, getDb, closeDb, isDbInitialized } from './connection'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'

describe('db/connection', () => {
  let testDbPath: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('initDb', () => {
    it('should create database file at specified path', () => {
      initDb(testDbPath)
      expect(existsSync(testDbPath)).toBe(true)
    })

    it('should enable WAL mode', () => {
      const db = initDb(testDbPath)
      const result = db.pragma('journal_mode') as { journal_mode: string }[]
      expect(result[0]?.journal_mode).toBe('wal')
    })

    it('should enable foreign keys', () => {
      const db = initDb(testDbPath)
      const result = db.pragma('foreign_keys') as { foreign_keys: number }[]
      expect(result[0]?.foreign_keys).toBe(1)
    })

    it('should return same instance on subsequent calls', () => {
      const db1 = initDb(testDbPath)
      const db2 = initDb(testDbPath)
      expect(db1).toBe(db2)
    })
  })

  describe('getDb', () => {
    it('should throw if database not initialized', () => {
      expect(() => getDb()).toThrow('Database not initialized')
    })

    it('should return database instance after init', () => {
      initDb(testDbPath)
      const db = getDb()
      expect(db).toBeDefined()
    })
  })

  describe('closeDb', () => {
    it('should close database connection', () => {
      initDb(testDbPath)
      expect(isDbInitialized()).toBe(true)
      closeDb()
      expect(isDbInitialized()).toBe(false)
    })

    it('should handle closing when not initialized', () => {
      expect(() => {
        closeDb()
      }).not.toThrow()
    })
  })

  describe('isDbInitialized', () => {
    it('should return false before init', () => {
      expect(isDbInitialized()).toBe(false)
    })

    it('should return true after init', () => {
      initDb(testDbPath)
      expect(isDbInitialized()).toBe(true)
    })
  })
})
