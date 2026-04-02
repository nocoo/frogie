/**
 * Chat ViewModel Tests
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useChatStore } from './chat.viewmodel'
import type { AgentEvent } from '@/models/events'

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 0
  sentMessages: string[] = []

  constructor(_url: string) {
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.onclose?.()
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1
    this.onopen?.()
  }

  simulateMessage(data: AgentEvent) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateError() {
    this.onerror?.()
  }

  simulateClose() {
    this.readyState = 3
    this.onclose?.()
  }
}

// Mock WebSocket globally
vi.stubGlobal('WebSocket', MockWebSocket)

describe('chat.viewmodel', () => {
  beforeEach(() => {
    // Reset store state
    useChatStore.setState({
      messages: [],
      sessionId: null,
      ws: null,
      status: 'disconnected',
      isProcessing: false,
      error: null,
      turnStats: null,
    })
    MockWebSocket.instances = []
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useChatStore.getState()

      expect(state.messages).toEqual([])
      expect(state.sessionId).toBeNull()
      expect(state.ws).toBeNull()
      expect(state.status).toBe('disconnected')
      expect(state.isProcessing).toBe(false)
      expect(state.error).toBeNull()
      expect(state.turnStats).toBeNull()
    })
  })

  describe('connect', () => {
    it('should establish WebSocket connection', () => {
      useChatStore.getState().connect()

      expect(useChatStore.getState().status).toBe('connecting')
      expect(MockWebSocket.instances).toHaveLength(1)

      // Simulate successful connection
      MockWebSocket.instances[0]?.simulateOpen()

      expect(useChatStore.getState().status).toBe('connected')
      expect(useChatStore.getState().ws).not.toBeNull()
    })

    it('should handle connection error', () => {
      useChatStore.getState().connect()

      MockWebSocket.instances[0]?.simulateError()

      expect(useChatStore.getState().status).toBe('error')
      expect(useChatStore.getState().error).toBe('WebSocket connection failed')
    })

    it('should not reconnect if already connecting', () => {
      useChatStore.getState().connect()
      useChatStore.getState().connect()

      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })

  describe('disconnect', () => {
    it('should close WebSocket connection', () => {
      useChatStore.getState().connect()
      MockWebSocket.instances[0]?.simulateOpen()

      useChatStore.getState().disconnect()

      expect(useChatStore.getState().status).toBe('disconnected')
      expect(useChatStore.getState().ws).toBeNull()
    })
  })

  describe('sendMessage', () => {
    it('should send chat message', () => {
      useChatStore.getState().connect()
      MockWebSocket.instances[0]?.simulateOpen()

      useChatStore
        .getState()
        .sendMessage('ws-1', 'sess-1', 'Hello, how are you?')

      const state = useChatStore.getState()

      // Should add user message
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]?.role).toBe('user')
      expect(state.messages[0]?.content[0]).toMatchObject({
        type: 'text',
        text: 'Hello, how are you?',
      })

      // Should be processing
      expect(state.isProcessing).toBe(true)

      // Should send WebSocket message
      expect(MockWebSocket.instances[0]?.sentMessages).toHaveLength(1)
      const sent = JSON.parse(
        MockWebSocket.instances[0]?.sentMessages[0] ?? '{}'
      ) as unknown
      expect(sent).toMatchObject({
        type: 'chat',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        prompt: 'Hello, how are you?',
      })
    })

    it('should set error when not connected', () => {
      useChatStore.getState().sendMessage('ws-1', 'sess-1', 'Hello')

      expect(useChatStore.getState().error).toBe('Not connected to server')
    })
  })

  describe('handleEvent', () => {
    it('should handle session_start event', () => {
      useChatStore.getState().handleEvent({
        type: 'session_start',
        sessionId: 'sess-123',
        model: 'claude-sonnet',
      })

      expect(useChatStore.getState().sessionId).toBe('sess-123')
    })

    it('should handle text event', () => {
      useChatStore.getState().handleEvent({
        type: 'text',
        text: 'Hello ',
      })

      useChatStore.getState().handleEvent({
        type: 'text',
        text: 'world!',
      })

      const messages = useChatStore.getState().messages
      expect(messages).toHaveLength(1)
      expect(messages[0]?.role).toBe('assistant')
      expect(messages[0]?.content[0]).toMatchObject({
        type: 'text',
        text: 'Hello world!',
      })
    })

    it('should handle tool_use event', () => {
      useChatStore.getState().handleEvent({
        type: 'tool_use',
        id: 'tool-1',
        name: 'read_file',
        input: { path: '/test.txt' },
      })

      const messages = useChatStore.getState().messages
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content[0]).toMatchObject({
        type: 'tool_use',
        id: 'tool-1',
        name: 'read_file',
        input: { path: '/test.txt' },
      })
    })

    it('should handle tool_result event', () => {
      // First add tool use
      useChatStore.getState().handleEvent({
        type: 'tool_use',
        id: 'tool-1',
        name: 'read_file',
        input: { path: '/test.txt' },
      })

      // Then add result
      useChatStore.getState().handleEvent({
        type: 'tool_result',
        id: 'tool-1',
        output: 'file contents here',
        isError: false,
      })

      const content = useChatStore.getState().messages[0]?.content[0]
      expect(content?.type).toBe('tool_use')
      if (content?.type === 'tool_use') {
        expect(content.result).toMatchObject({
          output: 'file contents here',
          isError: false,
        })
      }
    })

    it('should handle turn_complete event', () => {
      useChatStore.setState({ isProcessing: true })

      useChatStore.getState().handleEvent({
        type: 'turn_complete',
        turns: 3,
        inputTokens: 500,
        outputTokens: 300,
        costUsd: 0.05,
        durationMs: 2000,
      })

      const state = useChatStore.getState()
      expect(state.isProcessing).toBe(false)
      expect(state.turnStats).toMatchObject({
        turns: 3,
        inputTokens: 500,
        outputTokens: 300,
        costUsd: 0.05,
        durationMs: 2000,
      })
    })

    it('should handle error event', () => {
      useChatStore.setState({ isProcessing: true })

      useChatStore.getState().handleEvent({
        type: 'error',
        message: 'Something went wrong',
      })

      const state = useChatStore.getState()
      expect(state.isProcessing).toBe(false)
      expect(state.error).toBe('Something went wrong')
    })

    it('should handle interrupted event', () => {
      useChatStore.setState({ isProcessing: true })

      useChatStore.getState().handleEvent({
        type: 'interrupted',
      })

      expect(useChatStore.getState().isProcessing).toBe(false)
    })

    it('should handle budget_exceeded event', () => {
      useChatStore.setState({ isProcessing: true })

      useChatStore.getState().handleEvent({
        type: 'budget_exceeded',
        costUsd: 10.5,
      })

      const state = useChatStore.getState()
      expect(state.isProcessing).toBe(false)
      expect(state.error).toBe('Budget exceeded: $10.50')
    })
  })

  describe('interrupt', () => {
    it('should send interrupt message', () => {
      useChatStore.getState().connect()
      MockWebSocket.instances[0]?.simulateOpen()

      useChatStore.setState({
        sessionId: 'sess-1',
        isProcessing: true,
      })

      useChatStore.getState().interrupt()

      const sent = JSON.parse(
        MockWebSocket.instances[0]?.sentMessages[0] ?? '{}'
      ) as unknown
      expect(sent).toMatchObject({
        type: 'interrupt',
        sessionId: 'sess-1',
      })
    })

    it('should not send if not processing', () => {
      useChatStore.getState().connect()
      MockWebSocket.instances[0]?.simulateOpen()

      useChatStore.setState({
        sessionId: 'sess-1',
        isProcessing: false,
      })

      useChatStore.getState().interrupt()

      expect(MockWebSocket.instances[0]?.sentMessages).toHaveLength(0)
    })
  })

  describe('clearMessages', () => {
    it('should clear all messages and stats', () => {
      useChatStore.setState({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
            createdAt: 1000,
          },
        ],
        sessionId: 'sess-1',
        turnStats: {
          turns: 3,
          inputTokens: 500,
          outputTokens: 300,
          costUsd: 0.05,
          durationMs: 2000,
        },
      })

      useChatStore.getState().clearMessages()

      const state = useChatStore.getState()
      expect(state.messages).toEqual([])
      expect(state.sessionId).toBeNull()
      expect(state.turnStats).toBeNull()
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      useChatStore.setState({ error: 'Some error' })

      useChatStore.getState().clearError()

      expect(useChatStore.getState().error).toBeNull()
    })
  })
})
