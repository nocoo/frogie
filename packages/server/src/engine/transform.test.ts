import { describe, it, expect, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import {
  transformStreamEvent,
  transformContentBlocks,
  extractContentBlocks,
  ContentBlockAccumulator,
} from './transform'

type RawMessageStreamEvent = Anthropic.RawMessageStreamEvent
type ContentBlockParam = Anthropic.ContentBlockParam

// Helper to create mock events with proper types
function mockStreamEvent(obj: object): RawMessageStreamEvent {
  return obj as RawMessageStreamEvent
}

function mockContentBlocks(blocks: object[]): ContentBlockParam[] {
  return blocks as ContentBlockParam[]
}

describe('engine/transform', () => {
  describe('transformStreamEvent', () => {
    let accumulator: ContentBlockAccumulator

    beforeEach(() => {
      accumulator = new ContentBlockAccumulator()
    })

    it('should transform text_delta to text event', () => {
      const event = mockStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello, world!' },
      })

      const events = [...transformStreamEvent(event, accumulator)]

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'text', text: 'Hello, world!' })
    })

    it('should transform thinking_delta to thinking event', () => {
      const event = mockStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me think...' },
      })

      const events = [...transformStreamEvent(event, accumulator)]

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'thinking', content: 'Let me think...' })
    })

    it('should accumulate tool_use and emit on block_stop', () => {
      // Start tool use block
      const startEvent = mockStreamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool_123',
          name: 'read_file',
          input: {},
        },
      })

      let events = [...transformStreamEvent(startEvent, accumulator)]
      expect(events).toHaveLength(0) // No event emitted yet

      // Delta with partial JSON
      const delta1 = mockStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      })
      events = [...transformStreamEvent(delta1, accumulator)]
      expect(events).toHaveLength(0) // Still accumulating

      // More JSON
      const delta2 = mockStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"/test.txt"}' },
      })
      events = [...transformStreamEvent(delta2, accumulator)]
      expect(events).toHaveLength(0) // Still accumulating

      // Stop block - now emit
      const stopEvent = mockStreamEvent({
        type: 'content_block_stop',
        index: 0,
      })
      events = [...transformStreamEvent(stopEvent, accumulator)]

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: 'tool_use',
        id: 'tool_123',
        name: 'read_file',
        input: { path: '/test.txt' },
      })
    })

    it('should handle empty tool input', () => {
      const startEvent = mockStreamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool_456',
          name: 'get_status',
          input: {},
        },
      })

      transformStreamEvent(startEvent, accumulator).next()

      const stopEvent = mockStreamEvent({
        type: 'content_block_stop',
        index: 0,
      })
      const events = [...transformStreamEvent(stopEvent, accumulator)]

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: 'tool_use',
        id: 'tool_456',
        name: 'get_status',
        input: {},
      })
    })

    it('should handle message_start without yielding events', () => {
      const event = mockStreamEvent({
        type: 'message_start',
        message: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-6',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      })

      const events = [...transformStreamEvent(event, accumulator)]
      expect(events).toHaveLength(0)
    })
  })

  describe('transformContentBlocks', () => {
    it('should transform text block', () => {
      const blocks = mockContentBlocks([{ type: 'text', text: 'Hello!' }])

      const events = [...transformContentBlocks(blocks)]

      expect(events).toEqual([{ type: 'text', text: 'Hello!' }])
    })

    it('should transform thinking block', () => {
      const blocks = mockContentBlocks([
        { type: 'thinking', thinking: 'Reasoning...' },
      ])

      const events = [...transformContentBlocks(blocks)]

      expect(events).toEqual([{ type: 'thinking', content: 'Reasoning...' }])
    })

    it('should transform tool_use block', () => {
      const blocks = mockContentBlocks([
        {
          type: 'tool_use',
          id: 'tool_789',
          name: 'write_file',
          input: { path: '/out.txt', content: 'data' },
        },
      ])

      const events = [...transformContentBlocks(blocks)]

      expect(events).toEqual([
        {
          type: 'tool_use',
          id: 'tool_789',
          name: 'write_file',
          input: { path: '/out.txt', content: 'data' },
        },
      ])
    })

    it('should transform multiple blocks in order', () => {
      const blocks = mockContentBlocks([
        { type: 'thinking', thinking: 'First think' },
        { type: 'text', text: 'Then respond' },
        { type: 'tool_use', id: 't1', name: 'tool1', input: {} },
      ])

      const events = [...transformContentBlocks(blocks)]

      expect(events).toHaveLength(3)
      expect(events[0]?.type).toBe('thinking')
      expect(events[1]?.type).toBe('text')
      expect(events[2]?.type).toBe('tool_use')
    })
  })

  describe('extractContentBlocks', () => {
    it('should extract text block', () => {
      const content = mockContentBlocks([{ type: 'text', text: 'Hello' }])

      const blocks = extractContentBlocks(content)

      expect(blocks).toEqual([{ type: 'text', text: 'Hello' }])
    })

    it('should extract thinking block', () => {
      const content = mockContentBlocks([
        { type: 'thinking', thinking: 'Hmm...' },
      ])

      const blocks = extractContentBlocks(content)

      expect(blocks).toEqual([{ type: 'thinking', thinking: 'Hmm...' }])
    })

    it('should extract tool_use block', () => {
      const content = mockContentBlocks([
        {
          type: 'tool_use',
          id: 'id1',
          name: 'test',
          input: { x: 1 },
        },
      ])

      const blocks = extractContentBlocks(content)

      expect(blocks).toEqual([
        { type: 'tool_use', id: 'id1', name: 'test', input: { x: 1 } },
      ])
    })
  })

  describe('ContentBlockAccumulator', () => {
    it('should track multiple concurrent tool uses', () => {
      const acc = new ContentBlockAccumulator()

      acc.startToolUse(0, 'id1', 'tool1')
      acc.startToolUse(1, 'id2', 'tool2')

      acc.appendToolInput(0, '{"a":')
      acc.appendToolInput(1, '{"b":')
      acc.appendToolInput(0, '1}')
      acc.appendToolInput(1, '2}')

      const tool1 = acc.finishBlock(0)
      const tool2 = acc.finishBlock(1)

      expect(tool1).toEqual({ id: 'id1', name: 'tool1', input: { a: 1 } })
      expect(tool2).toEqual({ id: 'id2', name: 'tool2', input: { b: 2 } })
    })

    it('should handle invalid JSON gracefully', () => {
      const acc = new ContentBlockAccumulator()

      acc.startToolUse(0, 'id1', 'tool1')
      acc.appendToolInput(0, 'not valid json')

      const result = acc.finishBlock(0)

      expect(result).toEqual({
        id: 'id1',
        name: 'tool1',
        input: 'not valid json',
      })
    })

    it('should return null for unknown block index', () => {
      const acc = new ContentBlockAccumulator()

      const result = acc.finishBlock(999)

      expect(result).toBeNull()
    })

    it('should clear all pending blocks', () => {
      const acc = new ContentBlockAccumulator()

      acc.startToolUse(0, 'id1', 'tool1')
      acc.startToolUse(1, 'id2', 'tool2')

      expect(acc.getPendingToolUses()).toHaveLength(2)

      acc.clear()

      expect(acc.getPendingToolUses()).toHaveLength(0)
    })
  })
})
