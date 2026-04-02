/**
 * Event Transformer
 *
 * Transforms Anthropic SDK streaming events to Frogie WebSocket events
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  AgentEvent,
  TextEvent,
  ThinkingEvent,
  ToolUseEvent,
  ContentBlock,
} from './types'

type RawMessageStreamEvent = Anthropic.RawMessageStreamEvent
type ContentBlockParam = Anthropic.ContentBlockParam

/**
 * Transform a single Anthropic streaming event to Frogie events
 *
 * Note: This generator may yield 0, 1, or multiple events depending on the input
 */
export function* transformStreamEvent(
  event: RawMessageStreamEvent,
  contentBlocks: ContentBlockAccumulator
): Generator<AgentEvent> {
  switch (event.type) {
    case 'content_block_start': {
      const block = event.content_block
      if (block.type === 'tool_use') {
        // Start tracking tool use - will emit when complete
        contentBlocks.startToolUse(event.index, block.id, block.name)
      }
      break
    }

    case 'content_block_delta': {
      const delta = event.delta
      if (delta.type === 'text_delta') {
        yield { type: 'text', text: delta.text } satisfies TextEvent
      } else if (delta.type === 'thinking_delta') {
        yield { type: 'thinking', content: delta.thinking } satisfies ThinkingEvent
      } else if (delta.type === 'input_json_delta') {
        // Accumulate JSON for tool input
        contentBlocks.appendToolInput(event.index, delta.partial_json)
      }
      break
    }

    case 'content_block_stop': {
      // Emit tool_use event when tool block is complete
      const toolUse = contentBlocks.finishBlock(event.index)
      if (toolUse) {
        yield {
          type: 'tool_use',
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        } satisfies ToolUseEvent
      }
      break
    }

    // message_start, message_delta, message_stop are handled at a higher level
    // for usage tracking
  }
}

/**
 * Transform assistant message content blocks to Frogie events
 *
 * Used for non-streaming responses or when processing accumulated content
 */
export function* transformContentBlocks(
  content: ContentBlockParam[]
): Generator<AgentEvent> {
  for (const block of content) {
    switch (block.type) {
      case 'text':
        yield { type: 'text', text: block.text } satisfies TextEvent
        break

      case 'thinking':
        yield {
          type: 'thinking',
          content: block.thinking,
        } satisfies ThinkingEvent
        break

      case 'tool_use':
        yield {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        } satisfies ToolUseEvent
        break
    }
  }
}

/**
 * Extract content blocks from assistant message for conversation history
 */
export function extractContentBlocks(
  content: ContentBlockParam[]
): ContentBlock[] {
  return content.map((block) => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text }
      case 'thinking':
        return { type: 'thinking', thinking: block.thinking }
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        }
      default:
        // Handle other block types by converting to text
        return { type: 'text', text: JSON.stringify(block) }
    }
  })
}

/**
 * Accumulator for content blocks during streaming
 *
 * Tracks partial tool inputs until blocks are complete
 */
export class ContentBlockAccumulator {
  private toolUseBlocks = new Map<
    number,
    { id: string; name: string; inputJson: string }
  >()

  startToolUse(index: number, id: string, name: string): void {
    this.toolUseBlocks.set(index, { id, name, inputJson: '' })
  }

  appendToolInput(index: number, partialJson: string): void {
    const block = this.toolUseBlocks.get(index)
    if (block) {
      block.inputJson += partialJson
    }
  }

  finishBlock(
    index: number
  ): { id: string; name: string; input: unknown } | null {
    const block = this.toolUseBlocks.get(index)
    if (!block) {
      return null
    }

    this.toolUseBlocks.delete(index)

    try {
      const input: unknown = block.inputJson ? JSON.parse(block.inputJson) : {}
      return { id: block.id, name: block.name, input }
    } catch {
      // If JSON parse fails, return raw string as input
      return { id: block.id, name: block.name, input: block.inputJson }
    }
  }

  clear(): void {
    this.toolUseBlocks.clear()
  }

  /**
   * Get all pending tool uses (for cleanup/debugging)
   */
  getPendingToolUses(): string[] {
    return Array.from(this.toolUseBlocks.values()).map((b) => b.name)
  }
}
