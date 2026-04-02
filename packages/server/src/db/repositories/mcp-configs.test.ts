import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../connection'
import { runMigrations } from '../migrate'
import { createWorkspace } from './workspaces'
import {
  saveMCPConfig,
  getMCPConfig,
  getMCPConfigById,
  listEnabledMCPConfigs,
  listAllMCPConfigs,
  setMCPConfigEnabled,
  deleteMCPConfig,
  deleteMCPConfigById,
  deleteWorkspaceMCPConfigs,
} from './mcp-configs'
import { getTestDbPath, cleanupTestDb } from '../../test/db-utils'

describe('repositories/mcp-configs', () => {
  let testDbPath: string
  let workspaceId: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
    const db = initDb(testDbPath)
    runMigrations(db)
    const ws = createWorkspace(db, {
      name: 'Test',
      path: `/test/${String(Date.now())}`,
    })
    workspaceId = ws.id
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('saveMCPConfig', () => {
    it('should create new MCP config', () => {
      const db = initDb(testDbPath)

      const config = saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'stdio',
        config: {
          command: 'npx',
          args: ['my-mcp-server'],
          env: { DEBUG: 'true' },
        },
      })

      expect(config.id).toBeDefined()
      expect(config.id).toMatch(/^[0-9A-Z]{26}$/)
      expect(config.workspace_id).toBe(workspaceId)
      expect(config.name).toBe('my-server')
      expect(config.type).toBe('stdio')
      expect(config.config.command).toBe('npx')
      expect(config.config.args).toEqual(['my-mcp-server'])
      expect(config.config.env).toEqual({ DEBUG: 'true' })
      expect(config.enabled).toBe(true)
    })

    it('should update existing config with same name', () => {
      const db = initDb(testDbPath)

      const original = saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'stdio',
        config: { command: 'old-command' },
      })

      const updated = saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'sse',
        config: { url: 'http://localhost:3000' },
      })

      expect(updated.id).toBe(original.id)
      expect(updated.type).toBe('sse')
      expect(updated.config.url).toBe('http://localhost:3000')
      expect(updated.config.command).toBeUndefined()
    })

    it('should allow same name in different workspaces', () => {
      const db = initDb(testDbPath)

      const ws2 = createWorkspace(db, { name: 'Other', path: '/other' })

      const config1 = saveMCPConfig(db, workspaceId, {
        name: 'shared-name',
        type: 'stdio',
        config: { command: 'cmd1' },
      })

      const config2 = saveMCPConfig(db, ws2.id, {
        name: 'shared-name',
        type: 'stdio',
        config: { command: 'cmd2' },
      })

      expect(config1.id).not.toBe(config2.id)
      expect(config1.config.command).toBe('cmd1')
      expect(config2.config.command).toBe('cmd2')
    })

    it('should create disabled config when enabled=false', () => {
      const db = initDb(testDbPath)

      const config = saveMCPConfig(db, workspaceId, {
        name: 'disabled-server',
        type: 'stdio',
        config: { command: 'cmd' },
        enabled: false,
      })

      expect(config.enabled).toBe(false)
    })
  })

  describe('getMCPConfig', () => {
    it('should return config by workspace and name', () => {
      const db = initDb(testDbPath)

      saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'stdio',
        config: { command: 'cmd' },
      })

      const config = getMCPConfig(db, workspaceId, 'my-server')

      expect(config).not.toBeNull()
      expect(config?.name).toBe('my-server')
    })

    it('should return null for non-existent config', () => {
      const db = initDb(testDbPath)

      const config = getMCPConfig(db, workspaceId, 'nonexistent')
      expect(config).toBeNull()
    })
  })

  describe('getMCPConfigById', () => {
    it('should return config by ID', () => {
      const db = initDb(testDbPath)

      const created = saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'stdio',
        config: { command: 'cmd' },
      })

      const config = getMCPConfigById(db, created.id)

      expect(config).not.toBeNull()
      expect(config?.id).toBe(created.id)
    })
  })

  describe('listEnabledMCPConfigs', () => {
    it('should return only enabled configs', () => {
      const db = initDb(testDbPath)

      saveMCPConfig(db, workspaceId, {
        name: 'enabled-1',
        type: 'stdio',
        config: { command: 'cmd1' },
        enabled: true,
      })

      saveMCPConfig(db, workspaceId, {
        name: 'disabled',
        type: 'stdio',
        config: { command: 'cmd2' },
        enabled: false,
      })

      saveMCPConfig(db, workspaceId, {
        name: 'enabled-2',
        type: 'stdio',
        config: { command: 'cmd3' },
        enabled: true,
      })

      const configs = listEnabledMCPConfigs(db, workspaceId)

      expect(configs).toHaveLength(2)
      expect(configs.map((c) => c.name).sort()).toEqual(['enabled-1', 'enabled-2'])
    })

    it('should return configs ordered by name', () => {
      const db = initDb(testDbPath)

      saveMCPConfig(db, workspaceId, {
        name: 'zebra',
        type: 'stdio',
        config: { command: 'cmd' },
      })
      saveMCPConfig(db, workspaceId, {
        name: 'alpha',
        type: 'stdio',
        config: { command: 'cmd' },
      })

      const configs = listEnabledMCPConfigs(db, workspaceId)

      expect(configs[0]?.name).toBe('alpha')
      expect(configs[1]?.name).toBe('zebra')
    })
  })

  describe('listAllMCPConfigs', () => {
    it('should return all configs including disabled', () => {
      const db = initDb(testDbPath)

      saveMCPConfig(db, workspaceId, {
        name: 'enabled',
        type: 'stdio',
        config: { command: 'cmd' },
        enabled: true,
      })

      saveMCPConfig(db, workspaceId, {
        name: 'disabled',
        type: 'stdio',
        config: { command: 'cmd' },
        enabled: false,
      })

      const configs = listAllMCPConfigs(db, workspaceId)

      expect(configs).toHaveLength(2)
    })
  })

  describe('setMCPConfigEnabled', () => {
    it('should enable disabled config', () => {
      const db = initDb(testDbPath)

      const created = saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'stdio',
        config: { command: 'cmd' },
        enabled: false,
      })

      const updated = setMCPConfigEnabled(db, created.id, true)

      expect(updated?.enabled).toBe(true)
    })

    it('should disable enabled config', () => {
      const db = initDb(testDbPath)

      const created = saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'stdio',
        config: { command: 'cmd' },
        enabled: true,
      })

      const updated = setMCPConfigEnabled(db, created.id, false)

      expect(updated?.enabled).toBe(false)
    })

    it('should return null for non-existent config', () => {
      const db = initDb(testDbPath)

      const result = setMCPConfigEnabled(db, 'nonexistent', true)
      expect(result).toBeNull()
    })
  })

  describe('deleteMCPConfig', () => {
    it('should delete config by workspace and name', () => {
      const db = initDb(testDbPath)

      saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'stdio',
        config: { command: 'cmd' },
      })

      const result = deleteMCPConfig(db, workspaceId, 'my-server')

      expect(result).toBe(true)
      expect(getMCPConfig(db, workspaceId, 'my-server')).toBeNull()
    })

    it('should return false for non-existent config', () => {
      const db = initDb(testDbPath)

      const result = deleteMCPConfig(db, workspaceId, 'nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('deleteMCPConfigById', () => {
    it('should delete config by ID', () => {
      const db = initDb(testDbPath)

      const created = saveMCPConfig(db, workspaceId, {
        name: 'my-server',
        type: 'stdio',
        config: { command: 'cmd' },
      })

      const result = deleteMCPConfigById(db, created.id)

      expect(result).toBe(true)
      expect(getMCPConfigById(db, created.id)).toBeNull()
    })
  })

  describe('deleteWorkspaceMCPConfigs', () => {
    it('should delete all configs for workspace', () => {
      const db = initDb(testDbPath)

      saveMCPConfig(db, workspaceId, {
        name: 'server-1',
        type: 'stdio',
        config: { command: 'cmd1' },
      })
      saveMCPConfig(db, workspaceId, {
        name: 'server-2',
        type: 'stdio',
        config: { command: 'cmd2' },
      })

      const deleted = deleteWorkspaceMCPConfigs(db, workspaceId)

      expect(deleted).toBe(2)
      expect(listAllMCPConfigs(db, workspaceId)).toHaveLength(0)
    })
  })

  describe('config types', () => {
    it('should support stdio config', () => {
      const db = initDb(testDbPath)

      const config = saveMCPConfig(db, workspaceId, {
        name: 'stdio-server',
        type: 'stdio',
        config: {
          command: 'node',
          args: ['server.js'],
          env: { NODE_ENV: 'production' },
        },
      })

      expect(config.type).toBe('stdio')
      expect(config.config.command).toBe('node')
      expect(config.config.args).toEqual(['server.js'])
      expect(config.config.env).toEqual({ NODE_ENV: 'production' })
    })

    it('should support sse config', () => {
      const db = initDb(testDbPath)

      const config = saveMCPConfig(db, workspaceId, {
        name: 'sse-server',
        type: 'sse',
        config: {
          url: 'http://localhost:3000/sse',
          headers: { Authorization: 'Bearer token' },
        },
      })

      expect(config.type).toBe('sse')
      expect(config.config.url).toBe('http://localhost:3000/sse')
      expect(config.config.headers).toEqual({ Authorization: 'Bearer token' })
    })

    it('should support http config', () => {
      const db = initDb(testDbPath)

      const config = saveMCPConfig(db, workspaceId, {
        name: 'http-server',
        type: 'http',
        config: {
          url: 'http://localhost:3000/mcp',
        },
      })

      expect(config.type).toBe('http')
      expect(config.config.url).toBe('http://localhost:3000/mcp')
    })
  })
})
