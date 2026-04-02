/**
 * D1: Test Database Isolation
 *
 * Provides utilities to create isolated test databases.
 * Each test file gets a unique database file that is cleaned up after tests.
 */

import { randomUUID } from 'crypto'
import { existsSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const TEST_DB_DIR = join(tmpdir(), 'frogie-test-dbs')

/**
 * Ensure test DB directory exists
 */
function ensureTestDbDir(): void {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true })
  }
}

/**
 * Generate a unique test database path
 */
export function getTestDbPath(): string {
  ensureTestDbDir()
  const id = randomUUID()
  return join(TEST_DB_DIR, `frogie-test-${id}.db`)
}

/**
 * Clean up a test database file
 */
export function cleanupTestDb(dbPath: string): void {
  if (existsSync(dbPath)) {
    rmSync(dbPath, { force: true })
  }
  // Also clean up WAL and SHM files
  const walPath = `${dbPath}-wal`
  const shmPath = `${dbPath}-shm`
  if (existsSync(walPath)) {
    rmSync(walPath, { force: true })
  }
  if (existsSync(shmPath)) {
    rmSync(shmPath, { force: true })
  }
}

/**
 * Clean up all test databases (for CI cleanup)
 */
export function cleanupAllTestDbs(): void {
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true, force: true })
  }
}
