import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'
import { getConfig, getDefaultConfig, expandPath } from './index'

describe('config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env['FROGIE_PORT']
    delete process.env['FROGIE_HOST']
    delete process.env['FROGIE_DB_PATH']
  })

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv }
  })

  describe('expandPath', () => {
    it('should expand ~ to home directory', () => {
      const result = expandPath('~/.frogie/test.db')
      expect(result).toBe(join(homedir(), '.frogie/test.db'))
    })

    it('should expand ~ only at start', () => {
      const result = expandPath('~/path/with~/tilde')
      expect(result).toBe(join(homedir(), 'path/with~/tilde'))
    })

    it('should not modify absolute path', () => {
      const result = expandPath('/absolute/path/to/db')
      expect(result).toBe('/absolute/path/to/db')
    })

    it('should not modify relative path without ~', () => {
      const result = expandPath('relative/path/to/db')
      expect(result).toBe('relative/path/to/db')
    })
  })

  describe('getDefaultConfig', () => {
    it('should return default configuration', () => {
      const config = getDefaultConfig()

      expect(config.port).toBe(7034)
      expect(config.host).toBe('0.0.0.0')
      expect(config.dbPath).toBe(join(homedir(), '.frogie/frogie.db'))
    })
  })

  describe('getConfig', () => {
    it('should use defaults when env not set', () => {
      const config = getConfig()

      expect(config.port).toBe(7034)
      expect(config.host).toBe('0.0.0.0')
      expect(config.dbPath).toBe(join(homedir(), '.frogie/frogie.db'))
    })

    it('should override port from FROGIE_PORT', () => {
      process.env['FROGIE_PORT'] = '8080'

      const config = getConfig()

      expect(config.port).toBe(8080)
    })

    it('should override host from FROGIE_HOST', () => {
      process.env['FROGIE_HOST'] = '127.0.0.1'

      const config = getConfig()

      expect(config.host).toBe('127.0.0.1')
    })

    it('should override dbPath from FROGIE_DB_PATH', () => {
      process.env['FROGIE_DB_PATH'] = '/custom/path/data.db'

      const config = getConfig()

      expect(config.dbPath).toBe('/custom/path/data.db')
    })

    it('should expand ~ in FROGIE_DB_PATH', () => {
      process.env['FROGIE_DB_PATH'] = '~/custom/db.sqlite'

      const config = getConfig()

      expect(config.dbPath).toBe(join(homedir(), 'custom/db.sqlite'))
    })

    it('should throw on invalid port', () => {
      process.env['FROGIE_PORT'] = 'invalid'

      expect(() => {
        getConfig()
      }).toThrow('Invalid port: invalid')
    })

    it('should throw on port out of range (too low)', () => {
      process.env['FROGIE_PORT'] = '0'

      expect(() => {
        getConfig()
      }).toThrow('Invalid port: 0')
    })

    it('should throw on port out of range (too high)', () => {
      process.env['FROGIE_PORT'] = '65536'

      expect(() => {
        getConfig()
      }).toThrow('Invalid port: 65536')
    })

    it('should accept valid port boundaries', () => {
      process.env['FROGIE_PORT'] = '1'
      expect(getConfig().port).toBe(1)

      process.env['FROGIE_PORT'] = '65535'
      expect(getConfig().port).toBe(65535)
    })
  })
})
