import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, writeFileSync } from 'fs'
import { getTestDbPath, cleanupTestDb } from './db-utils'

describe('D1: Test Database Isolation', () => {
  const testDbPaths: string[] = []

  afterEach(() => {
    // Clean up any test databases created in this test
    for (const path of testDbPaths) {
      cleanupTestDb(path)
    }
    testDbPaths.length = 0
  })

  it('should generate unique database paths', () => {
    const path1 = getTestDbPath()
    const path2 = getTestDbPath()

    testDbPaths.push(path1, path2)

    expect(path1).not.toBe(path2)
    expect(path1).toContain('frogie-test-')
    expect(path2).toContain('frogie-test-')
  })

  it('should clean up test database files', () => {
    const dbPath = getTestDbPath()
    testDbPaths.push(dbPath)

    // Simulate creating a database file
    writeFileSync(dbPath, 'test')
    expect(existsSync(dbPath)).toBe(true)

    cleanupTestDb(dbPath)
    expect(existsSync(dbPath)).toBe(false)
  })

  it('should handle non-existent files gracefully', () => {
    const dbPath = getTestDbPath()
    // Don't create the file, just try to clean it up
    expect(() => { cleanupTestDb(dbPath) }).not.toThrow()
  })
})
