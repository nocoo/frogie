/**
 * Database connection module
 *
 * Provides a singleton database connection with WAL mode and foreign keys enabled.
 * Uses bun:sqlite in Bun runtime, better-sqlite3 in Node.js (for tests).
 */

import type BetterSqlite3 from 'better-sqlite3'

// Check if we're running in Bun
const isBun = typeof Bun !== 'undefined'

// Database interface that both bun:sqlite and better-sqlite3 implement
export interface DatabaseLike {
  /** Execute SQL that modifies data, returns metadata */
  run(sql: string, ...params: unknown[]): { lastInsertRowid: number | bigint; changes: number }
  /** Execute SQL (including multi-statement), no return value */
  exec(sql: string): void
  /** Prepare a statement for repeated execution */
  prepare(sql: string): StatementLike
  /** Create a transaction function */
  transaction<T>(fn: () => T): () => T
  /** Close the database */
  close(): void
}

export interface StatementLike {
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

let db: DatabaseLike | null = null

/**
 * Initialize database connection
 */
export function initDb(dbPath: string): DatabaseLike {
  if (db) {
    return db
  }

  if (isBun) {
    // Use bun:sqlite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite')
    const bunDb = new Database(dbPath)

    // Enable WAL mode for better concurrent read performance
    bunDb.run('PRAGMA journal_mode = WAL')

    // Enable foreign key constraints
    bunDb.run('PRAGMA foreign_keys = ON')

    // Wrap bun:sqlite to provide exec method (bun:sqlite uses run for both)
    db = {
      run: (sql: string, ...params: unknown[]) =>
        bunDb.run(sql, ...(params as Parameters<typeof bunDb.run>[1][])),
      exec: (sql: string) => {
        bunDb.run(sql)
      },
      prepare: (sql: string) => bunDb.prepare(sql),
      transaction: <T>(fn: () => T) => bunDb.transaction(fn),
      close: () => {
        bunDb.close()
      },
    }
  } else {
    // Use better-sqlite3 for Node.js (vitest)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as typeof BetterSqlite3
    const nodeDb: BetterSqlite3.Database = new Database(dbPath)

    // Enable WAL mode for better concurrent read performance
    nodeDb.pragma('journal_mode = WAL')

    // Enable foreign key constraints
    nodeDb.pragma('foreign_keys = ON')

    // Wrap better-sqlite3 to provide consistent interface
    db = {
      run: (sql: string, ...params: unknown[]) => {
        const stmt = nodeDb.prepare(sql)
        return stmt.run(...params)
      },
      exec: (sql: string) => {
        nodeDb.exec(sql)
      },
      prepare: (sql: string) => nodeDb.prepare(sql),
      transaction: <T>(fn: () => T) => nodeDb.transaction(fn),
      close: () => {
        nodeDb.close()
      },
    }
  }

  return db
}

/**
 * Get the database instance
 * Throws if database hasn't been initialized
 */
export function getDb(): DatabaseLike {
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

// Re-export for backward compatibility
export type Database = DatabaseLike
