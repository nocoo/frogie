/**
 * Server Entry Point Tests
 *
 * These tests require Bun runtime and are skipped in vitest (Node.js).
 * Run with: bun test packages/server/src/index.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { startServer, type FrogieServer } from './index'

// Skip tests if not running in Bun
const isBun = typeof globalThis.Bun !== 'undefined'

/**
 * Create a temporary test directory
 */
function createTempDir(suffix: string): string {
  const dir = join('/tmp', `frogie-server-test-${suffix}-${String(Date.now())}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Remove temporary test directory
 */
function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore errors
  }
}

describe.skipIf(!isBun)('server entry point', () => {
  let server: FrogieServer | null = null
  let tempDir: string | null = null

  afterEach(() => {
    if (server) {
      server.stop()
      server = null
    }
    if (tempDir) {
      removeTempDir(tempDir)
      tempDir = null
    }
  })

  describe('startServer', () => {
    it('should start server and respond to health check', async () => {
      tempDir = createTempDir('health')
      const port = 7099 + Math.floor(Math.random() * 100)

      server = startServer({
        port,
        dataDir: tempDir,
        dbPath: join(tempDir, 'test.db'),
      })

      const res = await fetch(`http://localhost:${String(port)}/health`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as { status: string }
      expect(body.status).toBe('ok')
    })

    it('should serve settings API', async () => {
      tempDir = createTempDir('settings')
      const port = 7199 + Math.floor(Math.random() * 100)

      server = startServer({
        port,
        dataDir: tempDir,
        dbPath: join(tempDir, 'test.db'),
      })

      const res = await fetch(`http://localhost:${String(port)}/api/settings`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as { llmModel: string }
      expect(body.llmModel).toBeDefined()
    })

    it('should serve workspaces API', async () => {
      tempDir = createTempDir('workspaces')
      const port = 7299 + Math.floor(Math.random() * 100)

      server = startServer({
        port,
        dataDir: tempDir,
        dbPath: join(tempDir, 'test.db'),
      })

      const res = await fetch(`http://localhost:${String(port)}/api/workspaces`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as unknown[]
      expect(Array.isArray(body)).toBe(true)
    })

    it('should gracefully stop', async () => {
      tempDir = createTempDir('stop')
      const port = 7399 + Math.floor(Math.random() * 100)

      server = startServer({
        port,
        dataDir: tempDir,
        dbPath: join(tempDir, 'test.db'),
      })

      // Server should respond before stop
      const res1 = await fetch(`http://localhost:${String(port)}/health`)
      expect(res1.status).toBe(200)

      // Stop server
      server.stop()
      server = null

      // Server should not respond after stop
      try {
        await fetch(`http://localhost:${String(port)}/health`)
        expect.fail('Server should not respond after stop')
      } catch {
        // Expected - connection refused
      }
    })
  })
})
