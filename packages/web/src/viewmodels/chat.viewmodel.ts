/**
 * Chat ViewModel
 *
 * Zustand store for real-time chat with WebSocket.
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
 * Chat store state
 */
interface ChatState {
  /** Messages in current conversation */
  messages: Message[]

  /** Current session ID */
  sessionId: string | null

  /** WebSocket connection */
  ws: WebSocket | null

  /** Connection status */
  status: ConnectionStatus

  /** Is agent currently processing */
  isProcessing: boolean

  /** Error message */
  error: string | null

  /** Current turn stats */
  turnStats: {
    turns: number
    inputTokens: number
    outputTokens: number
    costUsd: number
    durationMs: number
  } | null

  /** Connect to WebSocket */
  connect: () => void

  /** Disconnect from WebSocket */
  disconnect: () => void

  /** Send a chat message */
  sendMessage: (workspaceId: string, sessionId: string, prompt: string) => void

  /** Interrupt current execution */
  interrupt: () => void

  /** Clear messages */
  clearMessages: () => void

  /** Clear error */
  clearError: () => void

  /** Add a user message */
  addUserMessage: (prompt: string) => void

  /** Handle incoming events (internal) */
  handleEvent: (event: AgentEvent) => void
}

/**
 * Generate unique ID for messages
 */
function generateId(): string {
  return `msg-${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Chat store
 */
export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sessionId: null,
  ws: null,
  status: 'disconnected',
  isProcessing: false,
  error: null,
  turnStats: null,

  connect: () => {
    const { ws, status } = get()
    if (ws || status === 'connecting') return

    set({ status: 'connecting', error: null })

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    const socket = new WebSocket(wsUrl)

    socket.onopen = () => {
      set({ ws: socket, status: 'connected' })
    }

    socket.onclose = () => {
      set({ ws: null, status: 'disconnected' })
    }

    socket.onerror = () => {
      set({ ws: null, status: 'error', error: 'WebSocket connection failed' })
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
    const { ws } = get()
    if (ws) {
      ws.close()
      set({ ws: null, status: 'disconnected' })
    }
  },

  sendMessage: (workspaceId: string, sessionId: string, prompt: string) => {
    const { ws, status } = get()

    if (!ws || status !== 'connected') {
      set({ error: 'Not connected to server' })
      return
    }

    // Add user message to UI
    get().addUserMessage(prompt)

    // Send chat message
    const message: ClientMessage = {
      type: 'chat',
      sessionId,
      workspaceId,
      prompt,
    }

    ws.send(JSON.stringify(message))
    set({ isProcessing: true, sessionId })
  },

  interrupt: () => {
    const { ws, sessionId, isProcessing } = get()

    if (!ws || !sessionId || !isProcessing) return

    const message: ClientMessage = {
      type: 'interrupt',
      sessionId,
    }

    ws.send(JSON.stringify(message))
  },

  clearMessages: () => {
    set({ messages: [], sessionId: null, turnStats: null })
  },

  clearError: () => {
    set({ error: null })
  },

  addUserMessage: (prompt: string) => {
    const message: Message = {
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      createdAt: Date.now(),
    }

    set((state) => ({ messages: [...state.messages, message] }))
  },

  handleEvent: (event: AgentEvent) => {
    switch (event.type) {
      case 'session_start':
        set({ sessionId: event.sessionId })
        break

      case 'text': {
        set((state) => {
          const messages = [...state.messages]
          const lastMessage = messages[messages.length - 1]

          // Append to existing assistant message or create new one
          if (lastMessage?.role === 'assistant') {
            const textContent = lastMessage.content.find(
              (c) => c.type === 'text'
            )
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

          return { messages }
        })
        break
      }

      case 'thinking': {
        set((state) => {
          const messages = [...state.messages]
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

          return { messages }
        })
        break
      }

      case 'tool_use': {
        set((state) => {
          const messages = [...state.messages]
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

          return { messages }
        })
        break
      }

      case 'tool_result': {
        set((state) => {
          const messages = [...state.messages]

          // Find the tool_use content block and add result
          for (const msg of messages) {
            for (const content of msg.content) {
              if (content.type === 'tool_use' && content.id === event.id) {
                content.result = {
                  output: event.output,
                  isError: event.isError,
                }
                return { messages }
              }
            }
          }

          return { messages }
        })
        break
      }

      case 'turn_complete':
        set({
          isProcessing: false,
          turnStats: {
            turns: event.turns,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            costUsd: event.costUsd,
            durationMs: event.durationMs,
          },
        })
        break

      case 'error':
        set({ error: event.message, isProcessing: false })
        break

      case 'interrupted':
        set({ isProcessing: false })
        break

      case 'budget_exceeded':
        set({
          error: `Budget exceeded: $${event.costUsd.toFixed(2)}`,
          isProcessing: false,
        })
        break

      case 'pong':
      case 'compact_start':
      case 'compact_done':
      case 'session_saved':
        // These events are informational, no state update needed
        break
    }
  },
}))
