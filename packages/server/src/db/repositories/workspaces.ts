/**
 * Workspace Repository
 *
 * Manages workspace entities - project roots for organizing sessions
 */

import type { Database as DatabaseType } from 'better-sqlite3'
import type { Workspace, CreateWorkspace, WorkspaceUpdate } from '../types'
import { ulid } from 'ulid'

/**
 * Create a new workspace
 *
 * @param input - Workspace name and path
 * @returns Created workspace
 */
export function createWorkspace(
  db: DatabaseType,
  input: CreateWorkspace
): Workspace {
  const id = ulid()
  const now = Date.now()

  db.prepare(
    `
    INSERT INTO workspaces (id, name, path, created_at, last_accessed, settings)
    VALUES (?, ?, ?, ?, ?, '{}')
  `
  ).run(id, input.name, input.path, now, now)

  const workspace = getWorkspace(db, id)
  if (!workspace) {
    throw new Error('Failed to create workspace')
  }
  return workspace
}

/**
 * Get workspace by ID
 *
 * @param id - Workspace ID
 * @returns Workspace or null
 */
export function getWorkspace(
  db: DatabaseType,
  id: string
): Workspace | null {
  return (db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
    | Workspace
    | undefined) ?? null
}

/**
 * Get workspace by path
 *
 * @param path - Absolute path to workspace root
 * @returns Workspace or null
 */
export function getWorkspaceByPath(
  db: DatabaseType,
  path: string
): Workspace | null {
  return (db.prepare('SELECT * FROM workspaces WHERE path = ?').get(path) as
    | Workspace
    | undefined) ?? null
}

/**
 * List all workspaces ordered by last accessed
 *
 * @returns Array of workspaces
 */
export function listWorkspaces(db: DatabaseType): Workspace[] {
  return db
    .prepare('SELECT * FROM workspaces ORDER BY last_accessed DESC')
    .all() as Workspace[]
}

/**
 * Update workspace last_accessed timestamp to now
 *
 * @param id - Workspace ID
 */
export function touchWorkspace(db: DatabaseType, id: string): void {
  db.prepare('UPDATE workspaces SET last_accessed = ? WHERE id = ?').run(
    Date.now(),
    id
  )
}

/**
 * Update workspace fields
 *
 * @param id - Workspace ID
 * @param update - Fields to update
 * @returns Updated workspace or null if not found
 */
export function updateWorkspace(
  db: DatabaseType,
  id: string,
  update: WorkspaceUpdate
): Workspace | null {
  const current = getWorkspace(db, id)
  if (!current) {
    return null
  }

  const newValues = {
    name: update.name ?? current.name,
    path: update.path ?? current.path,
    last_accessed: update.last_accessed ?? current.last_accessed,
    settings: update.settings ?? current.settings,
  }

  db.prepare(
    `
    UPDATE workspaces
    SET name = ?, path = ?, last_accessed = ?, settings = ?
    WHERE id = ?
  `
  ).run(newValues.name, newValues.path, newValues.last_accessed, newValues.settings, id)

  return getWorkspace(db, id)
}

/**
 * Delete workspace by ID
 *
 * Note: This cascades to delete all sessions and MCP configs
 *
 * @param id - Workspace ID
 * @returns true if deleted, false if not found
 */
export function deleteWorkspace(db: DatabaseType, id: string): boolean {
  const result = db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Get or create workspace by path
 *
 * If a workspace exists at the given path, returns it.
 * Otherwise creates a new workspace with the path basename as name.
 *
 * @param path - Absolute path to workspace root
 * @returns Workspace (existing or newly created)
 */
export function getOrCreateWorkspace(
  db: DatabaseType,
  path: string
): Workspace {
  const existing = getWorkspaceByPath(db, path)
  if (existing) {
    touchWorkspace(db, existing.id)
    const updated = getWorkspace(db, existing.id)
    if (!updated) {
      throw new Error('Failed to retrieve workspace after touch')
    }
    return updated
  }

  // Extract basename as default name
  const name = path.split('/').pop() ?? path

  return createWorkspace(db, { name, path })
}
