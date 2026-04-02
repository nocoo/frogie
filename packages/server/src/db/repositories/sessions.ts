/**
 * Session Repository
 *
 * Manages session index entries. Actual message history is stored by open-agent-sdk.
 */

import type { Database as DatabaseType } from 'better-sqlite3'
import type { Session, CreateSession, SessionStats } from '../types'
import { ulid } from 'ulid'

/**
 * Create a new session index entry
 *
 * @param input - Session creation input
 * @returns Created session
 */
export function createSession(
  db: DatabaseType,
  input: CreateSession
): Session {
  const id = input.id ?? ulid()
  const now = Date.now()

  db.prepare(
    `
    INSERT INTO sessions (id, workspace_id, name, model, created_at, updated_at,
                          message_count, total_input_tokens, total_output_tokens, total_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0)
  `
  ).run(id, input.workspace_id, input.name ?? null, input.model, now, now)

  const session = getSession(db, id)
  if (!session) {
    throw new Error('Failed to create session')
  }
  return session
}

/**
 * Get session by ID
 *
 * @param id - Session ID
 * @returns Session or null
 */
export function getSession(db: DatabaseType, id: string): Session | null {
  return (db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | Session
    | undefined) ?? null
}

/**
 * List sessions for a workspace, ordered by updated_at DESC
 *
 * @param workspaceId - Workspace ID
 * @returns Array of sessions
 */
export function listSessions(
  db: DatabaseType,
  workspaceId: string
): Session[] {
  return db
    .prepare(
      'SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC'
    )
    .all(workspaceId) as Session[]
}

/**
 * Update session name
 *
 * @param id - Session ID
 * @param name - New name (null to clear)
 * @returns Updated session or null if not found
 */
export function updateSessionName(
  db: DatabaseType,
  id: string,
  name: string | null
): Session | null {
  const result = db
    .prepare('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?')
    .run(name, Date.now(), id)

  if (result.changes === 0) {
    return null
  }
  return getSession(db, id)
}

/**
 * Update session statistics
 *
 * @param id - Session ID
 * @param stats - New statistics
 */
export function updateSessionStats(
  db: DatabaseType,
  id: string,
  stats: SessionStats
): void {
  db.prepare(
    `
    UPDATE sessions
    SET message_count = ?,
        total_input_tokens = ?,
        total_output_tokens = ?,
        total_cost_usd = ?,
        updated_at = ?
    WHERE id = ?
  `
  ).run(
    stats.message_count,
    stats.total_input_tokens,
    stats.total_output_tokens,
    stats.total_cost_usd,
    Date.now(),
    id
  )
}

/**
 * Increment session statistics by delta values
 *
 * @param id - Session ID
 * @param delta - Delta values to add
 */
export function incrementSessionStats(
  db: DatabaseType,
  id: string,
  delta: Partial<SessionStats>
): void {
  db.prepare(
    `
    UPDATE sessions
    SET message_count = message_count + ?,
        total_input_tokens = total_input_tokens + ?,
        total_output_tokens = total_output_tokens + ?,
        total_cost_usd = total_cost_usd + ?,
        updated_at = ?
    WHERE id = ?
  `
  ).run(
    delta.message_count ?? 0,
    delta.total_input_tokens ?? 0,
    delta.total_output_tokens ?? 0,
    delta.total_cost_usd ?? 0,
    Date.now(),
    id
  )
}

/**
 * Touch session - update updated_at to now
 *
 * @param id - Session ID
 */
export function touchSession(db: DatabaseType, id: string): void {
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
    Date.now(),
    id
  )
}

/**
 * Delete session index entry
 *
 * Note: Caller must also delete transcript from open-agent-sdk storage
 *
 * @param id - Session ID
 * @returns true if deleted, false if not found
 */
export function deleteSession(db: DatabaseType, id: string): boolean {
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Delete all sessions for a workspace
 *
 * @param workspaceId - Workspace ID
 * @returns Number of sessions deleted
 */
export function deleteWorkspaceSessions(
  db: DatabaseType,
  workspaceId: string
): number {
  const result = db
    .prepare('DELETE FROM sessions WHERE workspace_id = ?')
    .run(workspaceId)
  return result.changes
}

/**
 * Count sessions for a workspace
 *
 * @param workspaceId - Workspace ID
 * @returns Number of sessions
 */
export function countSessions(
  db: DatabaseType,
  workspaceId: string
): number {
  const result = db
    .prepare('SELECT COUNT(*) as count FROM sessions WHERE workspace_id = ?')
    .get(workspaceId) as { count: number }
  return result.count
}
