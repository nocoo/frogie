/**
 * FrogieAgent - Core agent wrapper
 *
 * Wraps Anthropic SDK with streaming event transformation for WebSocket transport.
 * Does NOT handle session indexing - that's SessionSync's responsibility.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  AgentEvent,
  AgentConfig,
  QueryResult,
  SessionStartEvent,
  TurnCompleteEvent,
  InterruptedEvent,
  BudgetExceededEvent,
  ToolResultEvent,
  ContentBlock,
  Message,
} from './types'
import {
  transformStreamEvent,
  extractContentBlocks,
  ContentBlockAccumulator,
} from './transform'

/**
 * Cost calculation for Claude models (per MTok)
 */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-haiku-3-5': { input: 0.8, output: 4 },
}

const DEFAULT_COST = { input: 3, output: 15 }

/**
 * Calculate cost from token usage
 */
function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const costs = MODEL_COSTS[model] ?? DEFAULT_COST
  const inputCost = (inputTokens / 1_000_000) * costs.input
  const outputCost = (outputTokens / 1_000_000) * costs.output
  return inputCost + outputCost
}

/**
 * Tool definition for Anthropic API
 */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/**
 * Tool executor function type
 */
export type ToolExecutor = (
  name: string,
  input: unknown,
  abortSignal?: AbortSignal
) => Promise<{ output: string; isError: boolean }>

/**
 * FrogieAgent - Agentic loop wrapper for Anthropic SDK
 */
export class FrogieAgent {
  private client: Anthropic
  private config: AgentConfig
  private messages: Message[] = []
  private aborted = false
  private tools: ToolDefinition[] = []
  private toolExecutor: ToolExecutor | null = null

  private constructor(config: AgentConfig, initialMessages?: Message[]) {
    this.config = config
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    })

    // Restore conversation history if provided
    if (initialMessages && initialMessages.length > 0) {
      this.messages = [...initialMessages]
    }

    // Set up abort handler
    if (config.abortController) {
      config.abortController.signal.addEventListener('abort', () => {
        this.aborted = true
      })
    }
  }

  /**
   * Create a new FrogieAgent instance
   *
   * @param config - Agent configuration
   * @param initialMessages - Optional initial messages to restore conversation context
   */
  static create(config: AgentConfig, initialMessages?: Message[]): FrogieAgent {
    return new FrogieAgent(config, initialMessages)
  }

  /**
   * Set tools for the agent
   */
  setTools(tools: ToolDefinition[], executor: ToolExecutor): void {
    this.tools = tools
    this.toolExecutor = executor
  }

  /**
   * Get the session ID
   */
  getSessionId(): string | undefined {
    return this.config.sessionId
  }

  /**
   * Get the model
   */
  getModel(): string {
    return this.config.model
  }

  /**
   * Get conversation messages
   */
  getMessages(): Message[] {
    return [...this.messages]
  }

  /**
   * Clear conversation history
   */
  clear(): void {
    this.messages = []
  }

  /**
   * Interrupt current execution
   */
  interrupt(): void {
    this.aborted = true
    this.config.abortController?.abort()
  }

  /**
   * Run a query and yield streaming events
   */
  async *query(prompt: string): AsyncGenerator<AgentEvent> {
    const startTime = Date.now()
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let turns = 0
    let totalCostUsd = 0

    this.aborted = false

    // Add user message
    this.messages.push({
      role: 'user',
      content: prompt,
    })

    // Emit session start
    yield {
      type: 'session_start',
      sessionId: this.config.sessionId ?? 'unknown',
      model: this.config.model,
    } satisfies SessionStartEvent

    // Agentic loop
    while (turns < this.config.maxTurns) {
      // Check abort flag (may be set by interrupt() via event listener)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.aborted) {
        yield { type: 'interrupted' } satisfies InterruptedEvent
        break
      }

      // Check budget
      if (totalCostUsd >= this.config.maxBudgetUsd) {
        yield {
          type: 'budget_exceeded',
          costUsd: totalCostUsd,
        } satisfies BudgetExceededEvent
        break
      }

      turns++

      // Call LLM
      const accumulator = new ContentBlockAccumulator()
      const assistantContent: ContentBlock[] = []
      const toolCalls: { id: string; name: string; input: unknown }[] = []

      const stream = this.client.messages.stream({
        model: this.config.model,
        max_tokens: 8192,
        messages: this.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })) as Anthropic.MessageParam[],
        ...(this.tools.length > 0 && {
          tools: this.tools as Anthropic.Tool[],
        }),
      })

      // Process streaming events
      for await (const event of stream) {
        // Check abort flag (may be set by interrupt() during streaming)
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.aborted) {
          break
        }

        // Transform and yield events
        for (const agentEvent of transformStreamEvent(event, accumulator)) {
          yield agentEvent

          // Track tool calls for execution
          if (agentEvent.type === 'tool_use') {
            toolCalls.push({
              id: agentEvent.id,
              name: agentEvent.name,
              input: agentEvent.input,
            })
          }
        }
      }

      // Get final message for usage
      const finalMessage = await stream.finalMessage()

      // Update token counts
      totalInputTokens += finalMessage.usage.input_tokens
      totalOutputTokens += finalMessage.usage.output_tokens
      totalCostUsd = calculateCost(
        totalInputTokens,
        totalOutputTokens,
        this.config.model
      )

      // Extract content blocks from response
      const responseContent = extractContentBlocks(
        finalMessage.content as Anthropic.ContentBlockParam[]
      )
      assistantContent.push(...responseContent)

      // Add assistant message to history
      this.messages.push({
        role: 'assistant',
        content: assistantContent,
      })

      // If no tool calls, we're done
      if (toolCalls.length === 0 || finalMessage.stop_reason === 'end_turn') {
        break
      }

      // Execute tools
      if (this.toolExecutor) {
        const toolResults: {
          type: 'tool_result'
          tool_use_id: string
          content: string
          is_error?: boolean
        }[] = []

        for (const call of toolCalls) {
          // Check abort flag (may be set by interrupt() during tool execution)
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (this.aborted) {
            break
          }

          const result = await this.toolExecutor(
            call.name,
            call.input,
            this.config.abortController?.signal
          )

          // Yield tool result event
          yield {
            type: 'tool_result',
            id: call.id,
            output: result.output,
            isError: result.isError,
          } satisfies ToolResultEvent

          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: result.output,
            is_error: result.isError ? true : false,
          })
        }

        // Add tool results to conversation
        if (toolResults.length > 0) {
          this.messages.push({
            role: 'user',
            content: toolResults,
          })
        }
      } else {
        // No tool executor - break loop
        break
      }
    }

    // Emit turn complete
    yield {
      type: 'turn_complete',
      turns,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCostUsd,
      durationMs: Date.now() - startTime,
    } satisfies TurnCompleteEvent
  }

  /**
   * Close the agent (cleanup)
   */
  close(): void {
    this.aborted = true
    // No persistent resources to clean up in this implementation
  }

  /**
   * Get query result summary (for testing)
   */
  getQueryResult(
    turns: number,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    interrupted: boolean,
    budgetExceeded: boolean
  ): QueryResult {
    return {
      turns,
      inputTokens,
      outputTokens,
      costUsd: calculateCost(inputTokens, outputTokens, this.config.model),
      durationMs,
      interrupted,
      budgetExceeded,
    }
  }
}
