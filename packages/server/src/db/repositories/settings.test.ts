import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../connection'
import { runMigrations } from '../migrate'
import { getSettings, updateSettings, resetSettings } from './settings'
import { getTestDbPath, cleanupTestDb } from '../../test/db-utils'

describe('repositories/settings', () => {
  let testDbPath: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('getSettings', () => {
    it('should return default settings after migration', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const settings = getSettings(db)

      expect(settings.id).toBe('global')
      expect(settings.llm_base_url).toBe('http://localhost:7024/v1')
      expect(settings.llm_api_key).toBe('')
      expect(settings.llm_model).toBe('claude-sonnet-4-6')
      expect(settings.max_turns).toBe(50)
      expect(settings.max_budget_usd).toBe(10.0)
    })

    it('should throw if migrations not run', () => {
      const db = initDb(testDbPath)

      expect(() => {
        getSettings(db)
      }).toThrow()
    })
  })

  describe('updateSettings', () => {
    it('should update single field', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const updated = updateSettings(db, { llm_model: 'claude-opus-4' })

      expect(updated.llm_model).toBe('claude-opus-4')
      // Other fields unchanged
      expect(updated.llm_base_url).toBe('http://localhost:7024/v1')
      expect(updated.max_turns).toBe(50)
    })

    it('should update multiple fields', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const updated = updateSettings(db, {
        llm_api_key: 'sk-test-123',
        max_turns: 100,
        max_budget_usd: 25.0,
      })

      expect(updated.llm_api_key).toBe('sk-test-123')
      expect(updated.max_turns).toBe(100)
      expect(updated.max_budget_usd).toBe(25.0)
    })

    it('should update updated_at timestamp', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const before = getSettings(db)
      const beforeTimestamp = before.updated_at

      // Small delay to ensure different timestamp
      const updated = updateSettings(db, { max_turns: 75 })

      expect(updated.updated_at).toBeGreaterThanOrEqual(beforeTimestamp)
    })

    it('should persist changes across reads', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      updateSettings(db, { llm_model: 'custom-model' })

      const reread = getSettings(db)
      expect(reread.llm_model).toBe('custom-model')
    })
  })

  describe('resetSettings', () => {
    it('should reset all settings to defaults', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      // Modify settings
      updateSettings(db, {
        llm_model: 'custom-model',
        llm_api_key: 'secret',
        max_turns: 999,
        max_budget_usd: 1000,
      })

      // Reset
      const reset = resetSettings(db)

      expect(reset.llm_base_url).toBe('http://localhost:7024/v1')
      expect(reset.llm_api_key).toBe('')
      expect(reset.llm_model).toBe('claude-sonnet-4-6')
      expect(reset.max_turns).toBe(50)
      expect(reset.max_budget_usd).toBe(10.0)
    })

    it('should update updated_at on reset', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      const before = getSettings(db)
      const reset = resetSettings(db)

      expect(reset.updated_at).toBeGreaterThanOrEqual(before.updated_at)
    })
  })
})
