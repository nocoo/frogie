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
      expect(agent.getSessionId()).toBe('test-session-123')
      expect(agent.getModel()).toBe('claude-sonnet-4-6')
    })

    it('should handle missing sessionId', () => {
      const configWithoutSession = { ...baseConfig }
      delete configWithoutSession.sessionId

      const agent = FrogieAgent.create(configWithoutSession)

      expect(agent.getSessionId()).toBeUndefined()
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

  describe('clear', () => {
    it('should clear message history', () => {
      const agent = FrogieAgent.create(baseConfig)

      agent.clear()

      expect(agent.getMessages()).toEqual([])
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

  describe('close', () => {
    it('should cleanup agent resources', () => {
      const agent = FrogieAgent.create(baseConfig)

      // Should not throw
      expect(() => {
        agent.close()
      }).not.toThrow()
    })
  })

  describe('getQueryResult', () => {
    it('should calculate cost correctly for claude-sonnet-4-6', () => {
      const agent = FrogieAgent.create(baseConfig)

      const result = agent.getQueryResult(
        3, // turns
        1000000, // 1M input tokens
        500000, // 500K output tokens
        5000, // 5 seconds
        false,
        false
      )

      expect(result.turns).toBe(3)
      expect(result.inputTokens).toBe(1000000)
      expect(result.outputTokens).toBe(500000)
      // Cost: 1M * $3/MTok + 0.5M * $15/MTok = $3 + $7.50 = $10.50
      expect(result.costUsd).toBeCloseTo(10.5, 2)
      expect(result.durationMs).toBe(5000)
      expect(result.interrupted).toBe(false)
      expect(result.budgetExceeded).toBe(false)
    })

    it('should calculate cost correctly for claude-opus-4', () => {
      const agent = FrogieAgent.create({ ...baseConfig, model: 'claude-opus-4' })

      const result = agent.getQueryResult(
        1,
        1000000, // 1M input tokens
        100000, // 100K output tokens
        1000,
        false,
        false
      )

      // Cost: 1M * $15/MTok + 0.1M * $75/MTok = $15 + $7.50 = $22.50
      expect(result.costUsd).toBeCloseTo(22.5, 2)
    })

    it('should calculate cost correctly for claude-haiku-3-5', () => {
      const agent = FrogieAgent.create({
        ...baseConfig,
        model: 'claude-haiku-3-5',
      })

      const result = agent.getQueryResult(
        1,
        1000000, // 1M input tokens
        500000, // 500K output tokens
        1000,
        false,
        false
      )

      // Cost: 1M * $0.8/MTok + 0.5M * $4/MTok = $0.80 + $2.00 = $2.80
      expect(result.costUsd).toBeCloseTo(2.8, 2)
    })

    it('should use default cost for unknown model', () => {
      const agent = FrogieAgent.create({
        ...baseConfig,
        model: 'unknown-model',
      })

      const result = agent.getQueryResult(
        1,
        1000000, // 1M input tokens
        500000, // 500K output tokens
        1000,
        false,
        false
      )

      // Default cost: 1M * $3/MTok + 0.5M * $15/MTok = $3 + $7.50 = $10.50
      expect(result.costUsd).toBeCloseTo(10.5, 2)
    })
  })

  // Note: query() tests require integration testing with actual SDK
  // The streaming logic is covered by transform.test.ts
})
