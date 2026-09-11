import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FrogieAgent } from './frogie-agent'
import type { AgentConfig } from './types'

// Mock module with a class constructor
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: vi.fn(),
      }
    },
  }
})

describe('engine/frogie-agent', () => {
  const baseConfig: AgentConfig = {
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'test-api-key',
    model: 'claude-sonnet-4-6',
    cwd: '/test/workspace',
    maxTurns: 10,
    maxBudgetUsd: 5.0,
    sessionId: 'test-session-123',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create', () => {
    it('should create agent instance synchronously', () => {
      const agent = FrogieAgent.create(baseConfig)

      expect(agent).toBeInstanceOf(FrogieAgent)
    })
  })

  describe('setTools', () => {
    it('should accept tool definitions and executor', () => {
      const agent = FrogieAgent.create(baseConfig)

      const tools = [
        {
          name: 'read_file',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ]

      const executor = vi.fn()

      // Should not throw
      expect(() => {
        agent.setTools(tools, executor)
      }).not.toThrow()
    })
  })

  describe('getMessages', () => {
    it('should return empty array initially', () => {
      const agent = FrogieAgent.create(baseConfig)

      expect(agent.getMessages()).toEqual([])
    })

    it('should return copy of messages array', () => {
      const agent = FrogieAgent.create(baseConfig)

      const messages1 = agent.getMessages()
      const messages2 = agent.getMessages()

      expect(messages1).not.toBe(messages2)
    })
  })

  describe('interrupt', () => {
    it('should set aborted flag', () => {
      const abortController = new AbortController()
      const agent = FrogieAgent.create({
        ...baseConfig,
        abortController,
      })

      agent.interrupt()

      expect(abortController.signal.aborted).toBe(true)
    })

    it('should work without abort controller', () => {
      const agent = FrogieAgent.create(baseConfig)

      // Should not throw
      expect(() => {
        agent.interrupt()
      }).not.toThrow()
    })
  })

  // Note: query() tests require integration testing with actual SDK
  // The streaming logic is covered by transform.test.ts
})
