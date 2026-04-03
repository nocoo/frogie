/**
 * Agent Engine Types
 *
 * Event types for WebSocket communication between server and client.
 * This is the single source of truth - matches 07-api-protocol.md
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
 * Turn completed successfully event
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
 * Budget limit reached event
 */
export interface BudgetExceededEvent {
  type: 'budget_exceeded'
  costUsd: number
}

/**
 * Session saved to database event
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
 * Execution interrupted by user event
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
  /** Optional model override for this message */
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
// Agent Configuration
// =============================================================================

/**
 * Configuration for creating an agent
 */
export interface AgentConfig {
  /** LLM API base URL */
  baseUrl: string

  /** LLM API key */
  apiKey: string

  /** Model identifier */
  model: string

  /** Working directory for tools */
  cwd: string

  /** Maximum number of agentic turns */
  maxTurns: number

  /** Maximum budget in USD */
  maxBudgetUsd: number

  /** Session ID (optional - will be generated if not provided) */
  sessionId?: string

  /** Abort controller for cancellation */
  abortController?: AbortController
}

/**
 * Query result with usage statistics
 */
export interface QueryResult {
  /** Number of turns executed */
  turns: number

  /** Total input tokens */
  inputTokens: number

  /** Total output tokens */
  outputTokens: number

  /** Total cost in USD */
  costUsd: number

  /** Query duration in milliseconds */
  durationMs: number

  /** Whether the query was interrupted */
  interrupted: boolean

  /** Whether budget was exceeded */
  budgetExceeded: boolean
}

// =============================================================================
// Anthropic SDK Types (subset used by Frogie)
// =============================================================================

/**
 * Content block types from Anthropic Messages API
 */
export interface TextBlock {
  type: 'text'
  text: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock

/**
 * Message types for conversation history
 */
export interface UserMessage {
  role: 'user'
  content: string | (TextBlock | ToolResultBlock)[]
}

export interface AssistantMessage {
  role: 'assistant'
  content: ContentBlock[]
}

export type Message = UserMessage | AssistantMessage

/**
 * Usage statistics from Anthropic API
 */
export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}
