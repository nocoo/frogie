/**
 * Database connection module
 *
 * Provides a singleton database connection with WAL mode and foreign keys enabled.
 */

import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'

let db: DatabaseType | null = null

/**
 * Initialize database connection
 */
export function initDb(dbPath: string): DatabaseType {
  if (db) {
    return db
  }

  db = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')

  // Enable foreign key constraints
  db.pragma('foreign_keys = ON')

  return db
}

/**
 * Get the database instance
 * Throws if database hasn't been initialized
 */
export function getDb(): DatabaseType {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * Check if database is initialized
 */
export function isDbInitialized(): boolean {
  return db !== null
}
