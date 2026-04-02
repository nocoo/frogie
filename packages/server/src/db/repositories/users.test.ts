import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../connection'
import { runMigrations } from '../migrate'
import {
  upsertUser,
  getUserById,
  getUserByEmail,
  getUserByGoogleId,
  listUsers,
  deleteUser,
} from './users'
import { getTestDbPath, cleanupTestDb } from '../../test/db-utils'
import type { Database as DatabaseType } from 'better-sqlite3'

describe('repositories/users', () => {
  let testDbPath: string
  let db: DatabaseType

  beforeEach(() => {
    testDbPath = getTestDbPath()
    db = initDb(testDbPath)
    runMigrations(db)
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('upsertUser', () => {
    it('should create a new user', () => {
      const user = upsertUser(db, {
        email: 'test@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.png',
        google_id: 'google-123',
      })

      expect(user.id).toBeDefined()
      expect(user.email).toBe('test@example.com')
      expect(user.name).toBe('Test User')
      expect(user.image).toBe('https://example.com/avatar.png')
      expect(user.google_id).toBe('google-123')
      expect(user.created_at).toBeGreaterThan(0)
      expect(user.updated_at).toBeGreaterThan(0)
    })

    it('should update existing user by google_id', () => {
      // Create user
      const created = upsertUser(db, {
        email: 'test@example.com',
        name: 'Test User',
        google_id: 'google-123',
      })

      // Update same user
      const updated = upsertUser(db, {
        email: 'newemail@example.com',
        name: 'Updated Name',
        image: 'https://example.com/new-avatar.png',
        google_id: 'google-123',
      })

      expect(updated.id).toBe(created.id)
      expect(updated.email).toBe('newemail@example.com')
      expect(updated.name).toBe('Updated Name')
      expect(updated.image).toBe('https://example.com/new-avatar.png')
      expect(updated.created_at).toBe(created.created_at)
      expect(updated.updated_at).toBeGreaterThanOrEqual(created.updated_at)
    })

    it('should handle null name and image', () => {
      const user = upsertUser(db, {
        email: 'test@example.com',
        google_id: 'google-456',
      })

      expect(user.name).toBeNull()
      expect(user.image).toBeNull()
    })
  })

  describe('getUserById', () => {
    it('should return user by id', () => {
      const created = upsertUser(db, {
        email: 'test@example.com',
        name: 'Test User',
        google_id: 'google-123',
      })

      const found = getUserById(db, created.id)

      expect(found).not.toBeNull()
      expect(found?.email).toBe('test@example.com')
    })

    it('should return null for non-existent id', () => {
      const found = getUserById(db, 'non-existent-id')
      expect(found).toBeNull()
    })
  })

  describe('getUserByEmail', () => {
    it('should return user by email', () => {
      upsertUser(db, {
        email: 'test@example.com',
        name: 'Test User',
        google_id: 'google-123',
      })

      const found = getUserByEmail(db, 'test@example.com')

      expect(found).not.toBeNull()
      expect(found?.google_id).toBe('google-123')
    })

    it('should return null for non-existent email', () => {
      const found = getUserByEmail(db, 'notfound@example.com')
      expect(found).toBeNull()
    })
  })

  describe('getUserByGoogleId', () => {
    it('should return user by google_id', () => {
      upsertUser(db, {
        email: 'test@example.com',
        name: 'Test User',
        google_id: 'google-123',
      })

      const found = getUserByGoogleId(db, 'google-123')

      expect(found).not.toBeNull()
      expect(found?.email).toBe('test@example.com')
    })

    it('should return null for non-existent google_id', () => {
      const found = getUserByGoogleId(db, 'not-found')
      expect(found).toBeNull()
    })
  })

  describe('listUsers', () => {
    it('should return empty array when no users', () => {
      const users = listUsers(db)
      expect(users).toEqual([])
    })

    it('should return all users', () => {
      upsertUser(db, { email: 'first@example.com', google_id: 'g-1' })
      upsertUser(db, { email: 'second@example.com', google_id: 'g-2' })
      upsertUser(db, { email: 'third@example.com', google_id: 'g-3' })

      const users = listUsers(db)

      expect(users).toHaveLength(3)
      // Users are returned ordered by created_at desc
      const emails = users.map((u) => u.email)
      expect(emails).toContain('first@example.com')
      expect(emails).toContain('second@example.com')
      expect(emails).toContain('third@example.com')
    })
  })

  describe('deleteUser', () => {
    it('should delete existing user', () => {
      const user = upsertUser(db, {
        email: 'test@example.com',
        google_id: 'google-123',
      })

      const deleted = deleteUser(db, user.id)

      expect(deleted).toBe(true)
      expect(getUserById(db, user.id)).toBeNull()
    })

    it('should return false for non-existent user', () => {
      const deleted = deleteUser(db, 'non-existent-id')
      expect(deleted).toBe(false)
    })
  })
})
