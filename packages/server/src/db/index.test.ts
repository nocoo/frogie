import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initDb,
  closeDb,
  runMigrations,
  getSettings,
  updateSettings,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  deleteWorkspace,
  createSession,
  listSessions,
  updateSessionStats,
  saveMCPConfig,
  listEnabledMCPConfigs,
  initDbWithMigrations,
} from './index'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'

describe('db/index (integration)', () => {
  let testDbPath: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('initDbWithMigrations', () => {
    it('should initialize database and run migrations', () => {
      initDbWithMigrations(testDbPath)

      // Verify migrations ran - settings should exist
      const db = initDb(testDbPath)
      const settings = getSettings(db)
      expect(settings).toBeDefined()
      expect(settings.llm_model).toBe('claude-sonnet-4-6')
    })
  })

  describe('full workflow integration', () => {
    it('should support complete workspace → session → mcp workflow', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      // Configure settings
      const settings = updateSettings(db, {
        llm_api_key: 'sk-test',
        llm_model: 'claude-opus-4',
      })
      expect(settings.llm_api_key).toBe('sk-test')

      // Create workspace
      const workspace = createWorkspace(db, {
        name: 'My Project',
        path: '/home/user/my-project',
      })
      expect(workspace.name).toBe('My Project')

      // Create session in workspace
      const session = createSession(db, {
        workspace_id: workspace.id,
        model: 'claude-opus-4',
        name: 'Debug session',
      })
      expect(session.workspace_id).toBe(workspace.id)

      // Update session stats
      updateSessionStats(db, session.id, {
        message_count: 5,
        total_input_tokens: 1000,
        total_output_tokens: 500,
        total_cost_usd: 0.05,
      })

      // Add MCP config
      const mcpConfig = saveMCPConfig(db, workspace.id, {
        name: 'filesystem',
        type: 'stdio',
        config: {
          command: 'npx',
          args: ['@anthropic/mcp-server-fs'],
        },
      })
      expect(mcpConfig.name).toBe('filesystem')

      // Verify all data is linked
      const sessions = listSessions(db, workspace.id)
      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.message_count).toBe(5)

      const mcpConfigs = listEnabledMCPConfigs(db, workspace.id)
      expect(mcpConfigs).toHaveLength(1)

      // Delete workspace - should cascade
      deleteWorkspace(db, workspace.id)

      // Verify cascade
      const deletedWorkspace = getWorkspace(db, workspace.id)
      expect(deletedWorkspace).toBeNull()

      const deletedSessions = listSessions(db, workspace.id)
      expect(deletedSessions).toHaveLength(0)

      const deletedConfigs = listEnabledMCPConfigs(db, workspace.id)
      expect(deletedConfigs).toHaveLength(0)
    })

    it('should handle multiple workspaces independently', () => {
      const db = initDb(testDbPath)
      runMigrations(db)

      // Create two workspaces
      const ws1 = createWorkspace(db, { name: 'Project A', path: '/path/a' })
      const ws2 = createWorkspace(db, { name: 'Project B', path: '/path/b' })

      // Add sessions to both
      createSession(db, { workspace_id: ws1.id, model: 'claude-sonnet-4-6' })
      createSession(db, { workspace_id: ws1.id, model: 'claude-sonnet-4-6' })
      createSession(db, { workspace_id: ws2.id, model: 'claude-opus-4' })

      // Add MCP configs to both
      saveMCPConfig(db, ws1.id, {
        name: 'server',
        type: 'stdio',
        config: { command: 'cmd1' },
      })
      saveMCPConfig(db, ws2.id, {
        name: 'server',
        type: 'stdio',
        config: { command: 'cmd2' },
      })

      // Verify independence
      expect(listSessions(db, ws1.id)).toHaveLength(2)
      expect(listSessions(db, ws2.id)).toHaveLength(1)
      expect(listEnabledMCPConfigs(db, ws1.id)[0]?.config.command).toBe('cmd1')
      expect(listEnabledMCPConfigs(db, ws2.id)[0]?.config.command).toBe('cmd2')

      // Delete one workspace
      deleteWorkspace(db, ws1.id)

      // Other workspace unaffected
      expect(listWorkspaces(db)).toHaveLength(1)
      expect(listSessions(db, ws2.id)).toHaveLength(1)
      expect(listEnabledMCPConfigs(db, ws2.id)).toHaveLength(1)
    })
  })
})
