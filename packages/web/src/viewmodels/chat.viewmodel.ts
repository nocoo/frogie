/**
 * Chat ViewModel
 *
 * Zustand store for real-time chat with WebSocket.
 * Supports multiple concurrent sessions with independent streaming state.
 * Includes auto-reconnection with exponential backoff.
 */

import { create } from 'zustand'
import type {
  Message,
  MessageContent,
  AgentEvent,
  ClientMessage,
} from '@/models/events'

/**
 * Chat connection status
 */
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Per-session state
 */
interface SessionChatState {
  messages: Message[]
  isProcessing: boolean
  error: string | null
  turnStats: {
    turns: number
    inputTokens: number
    outputTokens: number
    costUsd: number
    durationMs: number
  } | null
}

/**
 * Reconnection config
 */
const RECONNECT_CONFIG = {
  initialDelay: 1000, // 1s
  maxDelay: 30000, // 30s
  backoffMultiplier: 2,
  maxRetries: 10,
} as const

/**
 * Chat store state
 */
interface ChatState {
  /** Per-session chat state */
  sessions: Map<string, SessionChatState>

  /** WebSocket connection */
  ws: WebSocket | null

  /** Connection status */
  status: ConnectionStatus

  /** Connection-level error (affects all sessions) */
  connectionError: string | null

  /** Reconnection state (internal) */
  _reconnectAttempts: number
  _reconnectTimeout: ReturnType<typeof setTimeout> | null
  _intentionalDisconnect: boolean

  /** Connect to WebSocket */
  connect: () => void

  /** Disconnect from WebSocket */
  disconnect: () => void

  /** Send a chat message */
  sendMessage: (workspaceId: string, sessionId: string, prompt: string, model?: string) => void

  /** Interrupt current execution for a session */
  interrupt: (sessionId: string) => void

  /** Clear messages for a session */
  clearMessages: (sessionId: string) => void

  /** Clear error for a session */
  clearError: (sessionId: string) => void

  /** Clear connection error */
  clearConnectionError: () => void

  /** Get session state (creates if not exists) */
  getSessionState: (sessionId: string) => SessionChatState

  /** Handle incoming events (internal) */
  handleEvent: (event: AgentEvent) => void

  /** Schedule reconnection (internal) */
  _scheduleReconnect: () => void
}

/**
 * Generate unique ID for messages
 */
function generateId(): string {
  return `msg-${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Create default session state
 */
function createDefaultSessionState(): SessionChatState {
  return {
    messages: [],
    isProcessing: false,
    error: null,
    turnStats: null,
  }
}

/**
 * Chat store
 */
export const useChatStore = create<ChatState>((set, get) => ({
  sessions: new Map(),
  ws: null,
  status: 'disconnected',
  connectionError: null,
  _reconnectAttempts: 0,
  _reconnectTimeout: null,
  _intentionalDisconnect: false,

  connect: () => {
    const { ws, status, _reconnectTimeout } = get()
    if (ws || status === 'connecting') return

    // Clear any pending reconnect
    if (_reconnectTimeout) {
      clearTimeout(_reconnectTimeout)
      set({ _reconnectTimeout: null })
    }

    set({ status: 'connecting', connectionError: null, _intentionalDisconnect: false })

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    const socket = new WebSocket(wsUrl)

    socket.onopen = () => {
      set({
        ws: socket,
        status: 'connected',
        _reconnectAttempts: 0, // Reset on successful connection
      })
    }

    socket.onclose = () => {
      set({ ws: null, status: 'disconnected' })

      // Auto-reconnect if not intentional
      const state = get()
      if (!state._intentionalDisconnect) {
        state._scheduleReconnect()
      }
    }

    socket.onerror = () => {
      set({ ws: null, status: 'error', connectionError: 'WebSocket connection failed' })
    }

    socket.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as AgentEvent
        get().handleEvent(data)
      } catch {
        // Ignore parse errors
      }
    }
  },

  disconnect: () => {
    const { ws, _reconnectTimeout } = get()

    // Clear any pending reconnect
    if (_reconnectTimeout) {
      clearTimeout(_reconnectTimeout)
    }

    // Mark as intentional disconnect to prevent auto-reconnect
    set({
      _intentionalDisconnect: true,
      _reconnectTimeout: null,
      _reconnectAttempts: 0,
    })

    if (ws) {
      ws.close()
      set({ ws: null, status: 'disconnected' })
    }
  },

  sendMessage: (workspaceId: string, sessionId: string, prompt: string, model?: string) => {
    const { ws, status, sessions } = get()

    if (!ws || status !== 'connected') {
      // Set error on the specific session
      const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()
      const newSessions = new Map(sessions)
      newSessions.set(sessionId, {
        ...sessionState,
        error: 'Not connected to server',
      })
      set({ sessions: newSessions })
      return
    }

    // Get or create session state
    const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()

    // Add user message
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      createdAt: Date.now(),
    }

    const newSessions = new Map(sessions)
    newSessions.set(sessionId, {
      ...sessionState,
      messages: [...sessionState.messages, userMessage],
      isProcessing: true,
      error: null, // Clear any previous error
    })

    set({ sessions: newSessions })

    // Send chat message
    const message: ClientMessage = {
      type: 'chat',
      sessionId,
      workspaceId,
      prompt,
      ...(model && { model }),
    }

    ws.send(JSON.stringify(message))
  },

  interrupt: (sessionId: string) => {
    const { ws, sessions } = get()
    const sessionState = sessions.get(sessionId)

    if (!ws || !sessionState?.isProcessing) return

    const message: ClientMessage = {
      type: 'interrupt',
      sessionId,
    }

    ws.send(JSON.stringify(message))
  },

  clearMessages: (sessionId: string) => {
    const { sessions } = get()
    const newSessions = new Map(sessions)
    newSessions.delete(sessionId)
    set({ sessions: newSessions })
  },

  clearError: (sessionId: string) => {
    const { sessions } = get()
    const sessionState = sessions.get(sessionId)
    if (!sessionState) return

    const newSessions = new Map(sessions)
    newSessions.set(sessionId, {
      ...sessionState,
      error: null,
    })
    set({ sessions: newSessions })
  },

  clearConnectionError: () => {
    set({ connectionError: null })
  },

  getSessionState: (sessionId: string) => {
    const { sessions } = get()
    return sessions.get(sessionId) ?? createDefaultSessionState()
  },

  handleEvent: (event: AgentEvent) => {
    // Extract sessionId from event if available
    const sessionId = 'sessionId' in event ? event.sessionId : null
    if (!sessionId && event.type !== 'pong') {
      // Most events should have sessionId
      return
    }

    const { sessions } = get()

    switch (event.type) {
      case 'session_start': {
        // Initialize session state if not exists
        if (!sessions.has(event.sessionId)) {
          const newSessions = new Map(sessions)
          newSessions.set(event.sessionId, createDefaultSessionState())
          set({ sessions: newSessions })
        }
        break
      }

      case 'text': {
        if (!sessionId) return
        const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()
        const messages = [...sessionState.messages]
        const lastMessage = messages[messages.length - 1]

        // Append to existing assistant message or create new one
        if (lastMessage?.role === 'assistant') {
          const textContent = lastMessage.content.find((c) => c.type === 'text')
          if (textContent?.type === 'text') {
            textContent.text += event.text
          }
        } else {
          messages.push({
            id: generateId(),
            role: 'assistant',
            content: [{ type: 'text', text: event.text }],
            createdAt: Date.now(),
          })
        }

        const newSessions = new Map(sessions)
        newSessions.set(sessionId, { ...sessionState, messages })
        set({ sessions: newSessions })
        break
      }

      case 'thinking': {
        if (!sessionId) return
        const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()
        const messages = [...sessionState.messages]
        const lastMessage = messages[messages.length - 1]

        if (lastMessage?.role === 'assistant') {
          lastMessage.content.push({
            type: 'thinking',
            content: event.content,
          })
        } else {
          messages.push({
            id: generateId(),
            role: 'assistant',
            content: [{ type: 'thinking', content: event.content }],
            createdAt: Date.now(),
          })
        }

        const newSessions = new Map(sessions)
        newSessions.set(sessionId, { ...sessionState, messages })
        set({ sessions: newSessions })
        break
      }

      case 'tool_use': {
        if (!sessionId) return
        const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()
        const messages = [...sessionState.messages]
        const lastMessage = messages[messages.length - 1]
        const toolContent: MessageContent = {
          type: 'tool_use',
          id: event.id,
          name: event.name,
          input: event.input,
        }

        if (lastMessage?.role === 'assistant') {
          lastMessage.content.push(toolContent)
        } else {
          messages.push({
            id: generateId(),
            role: 'assistant',
            content: [toolContent],
            createdAt: Date.now(),
          })
        }

        const newSessions = new Map(sessions)
        newSessions.set(sessionId, { ...sessionState, messages })
        set({ sessions: newSessions })
        break
      }

      case 'tool_result': {
        if (!sessionId) return
        const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()
        const messages = [...sessionState.messages]

        // Find the tool_use content block and add result
        for (const msg of messages) {
          for (const content of msg.content) {
            if (content.type === 'tool_use' && content.id === event.id) {
              content.result = {
                output: event.output,
                isError: event.isError,
              }
              break
            }
          }
        }

        const newSessions = new Map(sessions)
        newSessions.set(sessionId, { ...sessionState, messages })
        set({ sessions: newSessions })
        break
      }

      case 'turn_complete': {
        if (!sessionId) return
        const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()

        const newSessions = new Map(sessions)
        newSessions.set(sessionId, {
          ...sessionState,
          isProcessing: false,
          turnStats: {
            turns: event.turns,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            costUsd: event.costUsd,
            durationMs: event.durationMs,
          },
        })
        set({ sessions: newSessions })
        break
      }

      case 'error': {
        // Error without sessionId is a global error (rare, shouldn't happen in normal flow)
        if (!sessionId) {
          // Can't associate with a session, log it
          console.error('Global error (no sessionId):', event.message)
          return
        }
        const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()

        const newSessions = new Map(sessions)
        newSessions.set(sessionId, {
          ...sessionState,
          isProcessing: false,
          error: event.message,
        })
        set({ sessions: newSessions })
        break
      }

      case 'interrupted': {
        if (!sessionId) return
        const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()

        const newSessions = new Map(sessions)
        newSessions.set(sessionId, {
          ...sessionState,
          isProcessing: false,
        })
        set({ sessions: newSessions })
        break
      }

      case 'budget_exceeded': {
        if (!sessionId) return
        const sessionState = sessions.get(sessionId) ?? createDefaultSessionState()

        const newSessions = new Map(sessions)
        newSessions.set(sessionId, {
          ...sessionState,
          isProcessing: false,
          error: `Budget exceeded: $${event.costUsd.toFixed(2)}`,
        })
        set({ sessions: newSessions })
        break
      }

      case 'pong':
      case 'compact_start':
      case 'compact_done':
      case 'session_saved':
        // These events are informational, no state update needed
        break
    }
  },

  _scheduleReconnect: () => {
    const { _reconnectAttempts, _intentionalDisconnect } = get()

    // Don't reconnect if intentionally disconnected or max retries reached
    if (_intentionalDisconnect || _reconnectAttempts >= RECONNECT_CONFIG.maxRetries) {
      if (_reconnectAttempts >= RECONNECT_CONFIG.maxRetries) {
        set({ connectionError: 'Connection lost. Please refresh the page.' })
      }
      return
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      RECONNECT_CONFIG.initialDelay * Math.pow(RECONNECT_CONFIG.backoffMultiplier, _reconnectAttempts),
      RECONNECT_CONFIG.maxDelay
    )

    const timeout = setTimeout(() => {
      set({ _reconnectAttempts: _reconnectAttempts + 1 })
      get().connect()
    }, delay)

    set({ _reconnectTimeout: timeout })
  },
}))
