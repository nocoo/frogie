/**
 * Database migration system
 *
 * Executes SQL migrations in order and tracks applied migrations.
 */

import type { Database as DatabaseType } from 'better-sqlite3'
import { readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Migration {
  id: number
  name: string
  applied_at: number
}

/**
 * Initialize migrations tracking table
 */
function initMigrationsTable(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `)
}

/**
 * Get list of applied migration IDs
 */
function getAppliedMigrations(db: DatabaseType): Set<number> {
  const rows = db.prepare('SELECT id FROM _migrations').all() as Migration[]
  return new Set(rows.map((r) => r.id))
}

/**
 * Get all migration files sorted by ID
 */
function getMigrationFiles(): { id: number; name: string; path: string }[] {
  const migrationsDir = join(__dirname, 'migrations')
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))

  return files
    .map((filename) => {
      const match = /^(\d+)_(.+)\.sql$/.exec(filename)
      if (!match?.[1] || !match[2]) {
        throw new Error(`Invalid migration filename: ${filename}`)
      }
      return {
        id: parseInt(match[1], 10),
        name: match[2],
        path: join(migrationsDir, filename),
      }
    })
    .sort((a, b) => a.id - b.id)
}

/**
 * Run all pending migrations
 *
 * @returns Number of migrations applied
 */
export function runMigrations(db: DatabaseType): number {
  initMigrationsTable(db)

  const applied = getAppliedMigrations(db)
  const migrations = getMigrationFiles()

  let count = 0

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue
    }

    const sql = readFileSync(migration.path, 'utf-8')

    // Run migration in a transaction
    db.transaction(() => {
      db.exec(sql)
      db.prepare(
        'INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)'
      ).run(migration.id, migration.name, Date.now())
    })()

    count++
  }

  return count
}

/**
 * Check if a table exists in the database
 */
export function tableExists(db: DatabaseType, tableName: string): boolean {
  const result = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName) as { name: string } | undefined
  return result !== undefined
}

/**
 * Get list of all tables in the database (excluding internal tables)
 */
export function getTables(db: DatabaseType): string[] {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as { name: string }[]
  return rows.map((r) => r.name)
}
