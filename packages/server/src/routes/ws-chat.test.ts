/**
 * WebSocket Chat Handler Tests
 */





















import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  initDb,
  closeDb,
  runMigrations,
  createWorkspace,
  createSession,
} from '../db'
import { createWSHandler } from './ws-chat'
import { InMemoryMessageStore } from '../engine/session-sync'
import { WorkspaceMCPManager } from '../mcp'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'

// Mock FrogieAgent
vi.mock('../engine/frogie-agent', () => ({
  FrogieAgent: {
    create: vi.fn(() => ({
      query: vi.fn(function* () {
        yield { type: 'session_start', sessionId: 'test-session', model: 'claude-sonnet-4-6' }
        yield { type: 'text', text: 'Hello!' }
        yield {
          type: 'turn_complete',
          turns: 1,
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.001,
          durationMs: 500,
        }
      }),
      interrupt: vi.fn(),
      getMessages: vi.fn(() => []),
      setTools: vi.fn(),
    })),
  },
}))

// Mock MCP module
vi.mock('../mcp', () => {
  class MockWorkspaceMCPManager {
    getManager() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        disconnectAll: vi.fn(),
        reconnect: vi.fn(),
        getAllTools: vi.fn(() => []),
        getConnectionInfo: vi.fn(() => ({ name: 'test', status: 'disconnected', toolCount: 0 })),
      }
    }
    connectForWorkspace = vi.fn()
    disconnectWorkspace = vi.fn()
    getToolsForWorkspace = vi.fn(() => [])
  }
  return {
    WorkspaceMCPManager: MockWorkspaceMCPManager,
    createMCPToolExecutor: vi.fn(() => vi.fn()),
  }
})

// Mock builtin-tools
vi.mock('../engine/builtin-tools', () => ({
  BUILTIN_TOOLS: [],
  createBuiltinToolExecutor: vi.fn(() => vi.fn()),
}))

/**
 * Create a temporary test directory
 */
function createTempDir(suffix: string): string {
  const dir = join('/tmp', `frogie-test-${suffix}-${String(Date.now())}`)
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

/**
 * Mock WebSocket implementation
 */
function createMockWebSocket(): WebSocket & {
  sentMessages: string[]
  mockClose: () => void
} {
  const sentMessages: string[] = []

  const result = {
    readyState: WebSocket.OPEN,
    send: vi.fn((data: string) => {
      sentMessages.push(data)
    }),
    close: vi.fn(),
    sentMessages,
    mockClose: function () {
      // Unused but kept for potential future tests
    },
    // Required WebSocket interface members
    binaryType: 'blob' as const,
    bufferedAmount: 0,
    extensions: '',
    protocol: '',
    url: 'ws://localhost/ws',
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }
  return result as unknown as WebSocket & { sentMessages: string[]; mockClose: () => void }
}

describe('ws-chat', () => {
  let testDbPath: string
  let db: ReturnType<typeof initDb>
  let messageStore: InMemoryMessageStore
  let tempDirs: string[] = []
  let workspaceId: string
  let sessionId: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
    db = initDb(testDbPath)
    runMigrations(db)
    messageStore = new InMemoryMessageStore()

    // Create test workspace and session
    const workspaceDir = createTempDir('ws-workspace')
    tempDirs.push(workspaceDir)

    const workspace = createWorkspace(db, { name: 'Test', path: workspaceDir })
    workspaceId = workspace.id

    const session = createSession(db, {
      workspace_id: workspaceId,
      model: 'claude-sonnet-4-6',
    })
    sessionId = session.id
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
    messageStore.clear()
    vi.clearAllMocks()

    for (const dir of tempDirs) {
      removeTempDir(dir)
    }
    tempDirs = []
  })

  describe('createWSHandler', () => {
    it('should create handler with required methods', () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())

      expect(handler.handleOpen).toBeDefined()
      expect(handler.handleMessage).toBeDefined()
      expect(handler.handleClose).toBeDefined()
    })
  })

  describe('handleOpen', () => {
    it('should create connection state', () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()

      const state = handler.handleOpen(ws)

      expect(state.activeSessions).toBeDefined()
      expect(state.activeSessions.size).toBe(0)
    })
  })

  describe('handleMessage', () => {
    it('should respond to ping with pong', () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      handler.handleMessage(ws, state, JSON.stringify({ type: 'ping' }))

      expect(ws.sentMessages).toHaveLength(1)
      const response = JSON.parse(ws.sentMessages[0] ?? '{}') as { type: string }
      expect(response.type).toBe('pong')
    })

    it('should send error for invalid message format', () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      handler.handleMessage(ws, state, 'not json')

      expect(ws.sentMessages).toHaveLength(1)
      const response = JSON.parse(ws.sentMessages[0] ?? '{}') as { type: string; code: string }
      expect(response.type).toBe('error')
      expect(response.code).toBe('INVALID_MESSAGE')
    })

    it('should send error for unknown message type', () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      handler.handleMessage(ws, state, JSON.stringify({ type: 'unknown' }))

      expect(ws.sentMessages).toHaveLength(1)
      const response = JSON.parse(ws.sentMessages[0] ?? '{}') as { type: string }
      expect(response.type).toBe('error')
    })

    it('should handle chat message and stream events', async () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      handler.handleMessage(
        ws,
        state,
        JSON.stringify({
          type: 'chat',
          sessionId,
          workspaceId,
          prompt: 'Hello',
        })
      )

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should have received session_start, text, and turn_complete events
      expect(ws.sentMessages.length).toBeGreaterThanOrEqual(3)

      const events = ws.sentMessages.map((m) => JSON.parse(m) as { type: string })
      expect(events.some((e) => e.type === 'session_start')).toBe(true)
      expect(events.some((e) => e.type === 'text')).toBe(true)
      expect(events.some((e) => e.type === 'turn_complete')).toBe(true)
    })

    it('should send error for non-existent workspace', async () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      handler.handleMessage(
        ws,
        state,
        JSON.stringify({
          type: 'chat',
          sessionId,
          workspaceId: 'nonexistent',
          prompt: 'Hello',
        })
      )

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(ws.sentMessages.length).toBe(1)
      const response = JSON.parse(ws.sentMessages[0] ?? '{}') as { type: string; code: string }
      expect(response.type).toBe('error')
      expect(response.code).toBe('WORKSPACE_NOT_FOUND')
    })

    it('should send error for non-existent session', async () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      handler.handleMessage(
        ws,
        state,
        JSON.stringify({
          type: 'chat',
          sessionId: 'nonexistent',
          workspaceId,
          prompt: 'Hello',
        })
      )

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(ws.sentMessages.length).toBe(1)
      const response = JSON.parse(ws.sentMessages[0] ?? '{}') as { type: string; code: string }
      expect(response.type).toBe('error')
      expect(response.code).toBe('SESSION_NOT_FOUND')
    })
    it('should send error for session not belonging to workspace', async () => {
      // Create another workspace
      const otherDir = createTempDir('other-workspace')
      tempDirs.push(otherDir)
      const otherWorkspace = createWorkspace(db, { name: 'Other', path: otherDir })

      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      // Try to use session from first workspace with second workspace ID
      handler.handleMessage(
        ws,
        state,
        JSON.stringify({
          type: 'chat',
          sessionId, // belongs to first workspace
          workspaceId: otherWorkspace.id, // but using second workspace
          prompt: 'Hello',
        })
      )

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(ws.sentMessages.length).toBe(1)
      const response = JSON.parse(ws.sentMessages[0] ?? '{}') as { type: string; code: string }
      expect(response.type).toBe('error')
      expect(response.code).toBe('SESSION_WORKSPACE_MISMATCH')
    })
  })

  describe('handleClose', () => {
    it('should interrupt all active sessions', async () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      // Start a chat
      handler.handleMessage(
        ws,
        state,
        JSON.stringify({
          type: 'chat',
          sessionId,
          workspaceId,
          prompt: 'Hello',
        })
      )

      // Wait a bit for the session to become active
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Close connection
      handler.handleClose(state)

      // Active sessions should be cleared
      expect(state.activeSessions.size).toBe(0)
    })
  })

  describe('interrupt handling', () => {
    it('should interrupt active session', async () => {
      const handler = createWSHandler(db, messageStore, new WorkspaceMCPManager())
      const ws = createMockWebSocket()
      const state = handler.handleOpen(ws)

      // Start a chat
      handler.handleMessage(
        ws,
        state,
        JSON.stringify({
          type: 'chat',
          sessionId,
          workspaceId,
          prompt: 'Hello',
        })
      )

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 5))

      // Send interrupt
      handler.handleMessage(
        ws,
        state,
        JSON.stringify({
          type: 'interrupt',
          sessionId,
        })
      )

      // The interrupt should be processed (agent.interrupt() called)
      // We can't easily verify this with our mock, but we can verify no error
      expect(
        ws.sentMessages.every((m) => {
          const parsed = JSON.parse(m) as { type: string; code?: string }
          return parsed.type !== 'error' || parsed.code !== 'INTERRUPT_ERROR'
        })
      ).toBe(true)
    })
  })
})
