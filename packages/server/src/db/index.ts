/**
 * Database module
 *
 * Unified database API for Frogie persistence layer
 */

import { initDb as _initDb } from './connection'
import { runMigrations as _runMigrations } from './migrate'

// Re-export connection functions
export { initDb, getDb, closeDb, isDbInitialized } from './connection'

// Re-export migration functions
export { runMigrations, tableExists, getTables } from './migrate'

// Re-export types
export type {
  Settings,
  SettingsUpdate,
  Workspace,
  CreateWorkspace,
  WorkspaceUpdate,
  Session,
  CreateSession,
  SessionStats,
  MCPConfig,
  MCPConfigRow,
  CreateMCPConfig,
  MCPServerConfig,
  User,
  CreateUser,
} from './types'

// Re-export repositories
export * as settings from './repositories/settings'
export * as workspaces from './repositories/workspaces'
export * as sessions from './repositories/sessions'
export * as mcpConfigs from './repositories/mcp-configs'
export * as users from './repositories/users'

// Convenience re-exports of common functions
export { getSettings, updateSettings, resetSettings } from './repositories/settings'
export {
  createWorkspace,
  getWorkspace,
  getWorkspaceByPath,
  listWorkspaces,
  touchWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getOrCreateWorkspace,
} from './repositories/workspaces'
export {
  createSession,
  getSession,
  listSessions,
  updateSessionName,
  updateSessionModel,
  updateSessionStats,
  incrementSessionStats,
  touchSession,
  deleteSession,
  deleteWorkspaceSessions,
  countSessions,
} from './repositories/sessions'
export {
  saveMCPConfig,
  getMCPConfig,
  getMCPConfigById,
  listEnabledMCPConfigs,
  listAllMCPConfigs,
  setMCPConfigEnabled,
  deleteMCPConfig,
  deleteMCPConfigById,
  deleteWorkspaceMCPConfigs,
} from './repositories/mcp-configs'
export {
  upsertUser,
  getUserById,
  getUserByEmail,
  getUserByGoogleId,
  listUsers,
  deleteUser,
} from './repositories/users'

/**
 * Initialize database with migrations
 *
 * Convenience function that initializes connection and runs migrations
 *
 * @param dbPath - Path to SQLite database file
 */
export function initDbWithMigrations(dbPath: string): void {
  const db = _initDb(dbPath)
  _runMigrations(db)
}
