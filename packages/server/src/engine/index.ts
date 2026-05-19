/**
 * Engine Module
 *
 * Unified export for agent engine components
 */

// Types
export type {
  AgentEvent,
  SessionStartEvent,
  TextEvent,
  ThinkingEvent,
  ToolUseEvent,
  ToolResultEvent,
  CompactStartEvent,
  CompactDoneEvent,
  TurnCompleteEvent,
  BudgetExceededEvent,
  SessionSavedEvent,
  ErrorEvent,
  InterruptedEvent,
  PongEvent,
  ClientMessage,
  ChatMessage,
  InterruptMessage,
  PingMessage,
  AgentConfig,
  QueryResult,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  UserMessage,
  AssistantMessage,
  Message,
  Usage,
} from './types'

// FrogieAgent
export { FrogieAgent } from './frogie-agent'
export type { ToolDefinition, ToolExecutor } from './frogie-agent'

// Session Sync
export {
  SessionSync,
  InMemoryMessageStore,
  FileMessageStore,
  createSessionSync,
} from './session-sync'
export type { SessionWithMessages, MessageStore } from './session-sync'

// Event transformation
export {
  transformStreamEvent,
  transformContentBlocks,
  extractContentBlocks,
  ContentBlockAccumulator,
} from './transform'
