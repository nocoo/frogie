/**
 * Context Compaction
 *
 * Implements conversation compression to stay within model context limits.
 * Uses LLM to summarize older conversation history.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Message } from './types'

/**
 * Model context window sizes (in tokens)
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-6': 200000,
  'claude-opus-4': 200000,
  'claude-haiku-3-5': 200000,
}

/**
 * Reserved space for response generation
 */
const COMPACT_BUFFER = 13000

/**
 * Compaction prompt to send to LLM
 */
const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Create a detailed summary that preserves:
- All important context and decisions made
- Files modified and their changes
- Tool outputs and their significance
- Current state and next steps
The summary should allow the conversation to continue seamlessly.`

/**
 * Rough token estimation (4 chars ≈ 1 token)
 */
function estimateTokens(messages: Message[]): number {
  let chars = 0
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ('text' in block) {
          chars += block.text.length
        } else if ('content' in block) {
          chars += block.content.length
        } else if ('thinking' in block) {
          chars += block.thinking.length
        } else if ('input' in block) {
          chars += JSON.stringify(block.input).length
        }
      }
    }
  }
  return Math.ceil(chars / 4)
}

/**
 * Check if compaction is needed based on token estimate
 */
export function shouldCompact(messages: Message[], model: string): boolean {
  const contextWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200000
  const threshold = contextWindow - COMPACT_BUFFER
  const estimatedTokens = estimateTokens(messages)

  return estimatedTokens >= threshold
}

/**
 * Strip image content from messages (too large for summary)
 * Note: Currently ContentBlock doesn't include images, this is future-proofing
 */
function stripImages(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return msg
    }

    // Just return as-is since we don't have image blocks currently
    return msg
  })
}

/**
 * Build compaction prompt from messages
 */
function buildCompactionPrompt(messages: Message[]): string {
  const formatted = messages.map((msg, idx) => {
    let content = ''
    if (typeof msg.content === 'string') {
      content = msg.content
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .map((block) => {
          if ('text' in block) return block.text
          if ('content' in block) return `[Tool Result]: ${block.content.slice(0, 500)}`
          if ('thinking' in block) return `[Thinking]: ${block.thinking.slice(0, 500)}`
          if ('name' in block) return `[Tool Call: ${block.name}]`
          return '[Unknown block]'
        })
        .join('\n')
    }
    return `[${String(idx + 1)}] ${msg.role.toUpperCase()}: ${content}`
  })

  return `Please summarize this conversation, preserving all important details:\n\n${formatted.join('\n\n')}`
}

/**
 * Compact boundary block for system message
 */
interface CompactBoundaryBlock {
  type: 'compact_boundary'
  summary: string
  compacted_at: number
  original_message_count: number
}

/**
 * System message with compact boundary
 */
interface SystemMessage {
  role: 'system'
  content: CompactBoundaryBlock[]
}

/**
 * Compaction result
 */
export interface CompactionResult {
  compacted: (Message | SystemMessage)[]
  summary: string
}

/**
 * Compact a conversation using LLM summarization
 *
 * @param messages - Current conversation messages
 * @param apiKey - Anthropic API key
 * @param baseUrl - Anthropic API base URL
 * @param model - Model to use for summarization
 * @returns Compacted messages and summary
 */
export async function compactConversation(
  messages: Message[],
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<CompactionResult> {
  // 1. Strip images (too large for summary)
  const strippedMessages = stripImages(messages)

  // 2. Build compaction prompt
  const compactionPrompt = buildCompactionPrompt(strippedMessages)

  // 3. Call LLM for summary
  const client = new Anthropic({
    apiKey,
    baseURL: baseUrl,
  })

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: COMPACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: compactionPrompt }],
  })

  // Extract text from response
  let summary = ''
  for (const block of response.content) {
    if (block.type === 'text') {
      summary += block.text
    }
  }

  // 4. Create compacted message history using system role compact_boundary
  // This is the canonical format - must match 06-data-model.md and 08-ui-design.md
  const compacted: (Message | SystemMessage)[] = [
    {
      role: 'system',
      content: [
        {
          type: 'compact_boundary',
          summary,
          compacted_at: Date.now(),
          original_message_count: messages.length,
        },
      ],
    },
  ]

  return { compacted, summary }
}

/**
 * Micro-compaction for large tool results within a single turn
 */
export function microCompact(messages: Message[], maxChars = 50000): Message[] {
  return messages.map((msg) => {
    if (msg.role !== 'user') return msg
    if (typeof msg.content === 'string') return msg

    const content = msg.content.map((block) => {
      if ('content' in block && typeof block.content === 'string') {
        if (block.content.length > maxChars) {
          return {
            ...block,
            content: truncateMiddle(block.content, maxChars),
          }
        }
      }
      return block
    })

    return { ...msg, content }
  })
}

/**
 * Truncate string in the middle, keeping start and end
 */
function truncateMiddle(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str

  const keepLength = Math.floor(maxLength / 2) - 20
  const start = str.slice(0, keepLength)
  const end = str.slice(-keepLength)
  const removed = str.length - maxLength

  return `${start}\n\n... [${String(removed)} characters truncated] ...\n\n${end}`
}

/**
 * Get compaction statistics
 */
export function getCompactionStats(messages: Message[], model: string): {
  estimatedTokens: number
  contextWindow: number
  threshold: number
  shouldCompact: boolean
  utilizationPercent: number
} {
  const contextWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200000
  const threshold = contextWindow - COMPACT_BUFFER
  const estimated = estimateTokens(messages)

  return {
    estimatedTokens: estimated,
    contextWindow,
    threshold,
    shouldCompact: estimated >= threshold,
    utilizationPercent: Math.round((estimated / contextWindow) * 100),
  }
}
