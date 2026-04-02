/**
 * Agent Event Types
 *
 * WebSocket event types for real-time communication with agents.
 * Mirrors server-side event types.
 */

// =============================================================================
// Server → Client Events
// =============================================================================

/**
 * Session started event (first event after chat message)
 */
export interface SessionStartEvent {
  type: 'session_start'
  sessionId: string
  model: string
}

/**
 * Text content event (streaming)
 */
export interface TextEvent {
  type: 'text'
  text: string
}

/**
 * Thinking/reasoning content event
 */
export interface ThinkingEvent {
  type: 'thinking'
  content: string
}

/**
 * Tool use event - tool call started
 */
export interface ToolUseEvent {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

/**
 * Tool execution result event
 */
export interface ToolResultEvent {
  type: 'tool_result'
  id: string
  output: string
  isError: boolean
}

/**
 * Context compression started event
 */
export interface CompactStartEvent {
  type: 'compact_start'
}

/**
 * Context compression completed event
 */
export interface CompactDoneEvent {
  type: 'compact_done'
  summary: string
}

/**
 * Turn completed event
 */
export interface TurnCompleteEvent {
  type: 'turn_complete'
  turns: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
}

/**
 * Budget exceeded event
 */
export interface BudgetExceededEvent {
  type: 'budget_exceeded'
  costUsd: number
}

/**
 * Session saved event
 */
export interface SessionSavedEvent {
  type: 'session_saved'
}

/**
 * Error event
 */
export interface ErrorEvent {
  type: 'error'
  message: string
  code?: string
}

/**
 * Execution interrupted event
 */
export interface InterruptedEvent {
  type: 'interrupted'
}

/**
 * Pong response event
 */
export interface PongEvent {
  type: 'pong'
}

/**
 * Union type of all server → client events
 */
export type AgentEvent =
  | SessionStartEvent
  | TextEvent
  | ThinkingEvent
  | ToolUseEvent
  | ToolResultEvent
  | CompactStartEvent
  | CompactDoneEvent
  | TurnCompleteEvent
  | BudgetExceededEvent
  | SessionSavedEvent
  | ErrorEvent
  | InterruptedEvent
  | PongEvent

// =============================================================================
// Client → Server Messages
// =============================================================================

/**
 * Start a chat turn
 */
export interface ChatMessage {
  type: 'chat'
  sessionId: string
  workspaceId: string
  prompt: string
  model?: string
}

/**
 * Interrupt current execution
 */
export interface InterruptMessage {
  type: 'interrupt'
  sessionId: string
}

/**
 * Ping for keepalive
 */
export interface PingMessage {
  type: 'ping'
}

/**
 * Union type of all client → server messages
 */
export type ClientMessage = ChatMessage | InterruptMessage | PingMessage

// =============================================================================
// UI Message Types
// =============================================================================

/**
 * Message role
 */
export type MessageRole = 'user' | 'assistant'

/**
 * Content block types
 */
export interface TextContent {
  type: 'text'
  text: string
}

export interface ThinkingContent {
  type: 'thinking'
  content: string
}

export interface ToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
  result?: {
    output: string
    isError: boolean
  }
}

export type MessageContent = TextContent | ThinkingContent | ToolUseContent

/**
 * UI message representation
 */
export interface Message {
  id: string
  role: MessageRole
  content: MessageContent[]
  createdAt: number
}
