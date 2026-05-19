# 03 - Agent Engine

## Overview

Frogie uses **open-agent-sdk** as its engine base, wrapping it with a thin adapter layer for WebSocket transport and SQLite session indexing.

**Architecture**:
- `open-agent-sdk` provides: Agent class, QueryEngine, tool execution, MCP client, file-based session persistence
- Frogie adds: WebSocket adapter, SQLite session index, multi-workspace routing

**Note**: Event types emitted to WebSocket must match the protocol defined in `07-api-protocol.md`.

## Integration with open-agent-sdk

### Real API Surface

Based on open-agent-sdk's actual exports (`README.md:224`, `src/agent.ts`):

```typescript
// open-agent-sdk real API
import { createAgent, listSessions, getSessionMessages, forkSession, deleteSession } from 'open-agent-sdk'

// createAgent is SYNCHRONOUS (returns Agent, not Promise<Agent>)
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  apiKey: process.env.API_KEY,
  baseURL: 'http://localhost:7024/v1',      // Note: baseURL not baseUrl
  cwd: '/path/to/workspace',
  tools: customTools,                        // Optional: override built-in tools
  mcpServers: { memory: { ... } },          // MCP server configs
  maxTurns: 10,
  maxBudgetUsd: 5.0,
  permissionMode: 'bypassPermissions',
  persistSession: true,                      // File-based persistence (default)
  sessionId: 'my-session-id',               // Explicit session ID
  resume: 'existing-session-id',            // Resume existing session
  abortController: new AbortController(),
})

// Streaming query - returns AsyncGenerator<SDKMessage>
for await (const event of agent.query(prompt)) {
  // event.type: 'assistant' | 'tool_result' | 'result' | 'system' | 'partial_message' | ...
}

// Blocking query - returns Promise<QueryResult>
const result = await agent.prompt(text)
// result: { text, usage, num_turns, duration_ms, messages }

// Session management
agent.getMessages()        // Get conversation history
agent.clear()              // Reset session
agent.interrupt()          // Abort current query
agent.getSessionId()       // Get session ID
await agent.close()        // Close MCP connections, persist session

// Session file operations (standalone functions)
await deleteSession(sessionId)  // Delete ~/.open-agent-sdk/sessions/<id>/
```

### Frogie Adapter Layer

Since open-agent-sdk uses file-based session persistence without a pluggable storage interface, Frogie maintains a **parallel SQLite index** for session discovery and metadata:

```typescript
// packages/server/src/engine/frogie-agent.ts

import { createAgent, type Agent } from 'open-agent-sdk'
import type { AgentEvent } from '../types'
import { sessionIndex } from '../db/session-index'

export class FrogieAgent {
  private agent: Agent
  private sessionId: string
  private workspaceId: string
  
  static async create(config: FrogieAgentConfig): Promise<FrogieAgent> {
    const sessionId = config.sessionId ?? generateId()
    
    // Create open-agent-sdk agent (SYNCHRONOUS)
    const agent = createAgent({
      model: config.model,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      cwd: config.workspace.path,
      mcpServers: config.mcpServers,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      permissionMode: 'bypassPermissions',
      persistSession: true,
      sessionId,
      resume: config.resume,
      abortController: config.abortController,
    })
    
    // Index session in SQLite for discovery
    await sessionIndex.upsert({
      id: sessionId,
      workspaceId: config.workspaceId,
      name: config.sessionName ?? 'New Session',
      model: config.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    
    return new FrogieAgent(agent, sessionId, config.workspaceId)
  }
  
  private constructor(agent: Agent, sessionId: string, workspaceId: string) {
    this.agent = agent
    this.sessionId = sessionId
    this.workspaceId = workspaceId
  }
  
  /**
   * Run query and yield events for WebSocket transport
   */
  async *query(prompt: string): AsyncGenerator<AgentEvent> {
    const startTime = Date.now()
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let turns = 0
    
    yield { type: 'session_start', sessionId: this.sessionId, model: this.getModel() }
    
    try {
      // Iterate open-agent-sdk's streaming events
      for await (const event of this.agent.query(prompt)) {
        // Transform SDK events to Frogie WebSocket events
        const wsEvents = this.transformEvent(event)
        for (const wsEvent of wsEvents) {
          yield wsEvent
        }
        
        // Track usage from 'result' event
        if (event.type === 'result') {
          totalInputTokens = event.usage?.input_tokens ?? 0
          totalOutputTokens = event.usage?.output_tokens ?? 0
          turns = event.num_turns ?? 0
        }
      }
      
      yield {
        type: 'turn_complete',
        turns,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: this.calculateCost(totalInputTokens, totalOutputTokens),
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        yield { type: 'interrupted' }
      } else {
        throw error
      }
    }
    
    // Update session index
    await sessionIndex.touch(this.sessionId)
    yield { type: 'session_saved' }
  }
  
  private *transformEvent(event: SDKMessage): Generator<AgentEvent> {
    switch (event.type) {
      case 'assistant':
        // Extract text and tool_use blocks from assistant message
        for (const block of event.message.content) {
          if (block.type === 'text') {
            yield { type: 'text', text: block.text }
          } else if (block.type === 'thinking') {
            yield { type: 'thinking', content: block.thinking }
          } else if (block.type === 'tool_use') {
            yield { type: 'tool_use', id: block.id, name: block.name, input: block.input }
          }
        }
        break
      
      case 'tool_result':
        // Tool result event (SDKToolResultMessage)
        yield {
          type: 'tool_result',
          id: event.result.tool_use_id,
          output: event.result.output,
          isError: false,
        }
        break
      
      // 'result' event is handled in query() for usage tracking
      // Other internal events are not exposed to WebSocket
    }
  }
  
  interrupt(): void {
    this.agent.interrupt()
  }
  
  getSessionId(): string {
    return this.sessionId
  }
  
  getModel(): string {
    return (this.agent as any).modelId ?? 'claude-sonnet-4-6'
  }
  
  async close(): Promise<void> {
    await this.agent.close()
  }
  
  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Simplified cost calculation - adjust per model
    const inputCost = (inputTokens / 1_000_000) * 3    // $3/MTok input
    const outputCost = (outputTokens / 1_000_000) * 15 // $15/MTok output
    return inputCost + outputCost
  }
}
```

### Session Index (SQLite)

The SQLite session index provides fast session discovery without replacing open-agent-sdk's file persistence:

```typescript
// packages/server/src/db/session-index.ts

/**
 * Session index for fast discovery and metadata.
 * Actual message history is stored by open-agent-sdk in files.
 */
export const sessionIndex = {
  async upsert(session: SessionMeta): Promise<void> {
    db.run(`
      INSERT INTO sessions (id, workspace_id, name, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        model = excluded.model,
        updated_at = excluded.updated_at
    `, [session.id, session.workspaceId, session.name, session.model, session.createdAt, session.updatedAt])
  },
  
  async touch(sessionId: string): Promise<void> {
    db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [Date.now(), sessionId])
  },
  
  async listByWorkspace(workspaceId: string): Promise<SessionMeta[]> {
    return db.query(`
      SELECT id, workspace_id, name, model, created_at, updated_at
      FROM sessions
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
    `).all(workspaceId)
  },
  
  async delete(sessionId: string): Promise<void> {
    db.run('DELETE FROM sessions WHERE id = ?', [sessionId])
  },
}
```

## Agentic Loop

### Core Algorithm

```typescript
// packages/server/src/engine/query.ts

export async function* agentLoop(params: AgentLoopParams): AsyncGenerator<AgentEvent> {
  const { sessionId, prompt, workspace, tools, mcpConnections, config } = params
  
  // Load existing messages
  const messages = await sessionStore.loadMessages(sessionId)
  messages.push({ role: 'user', content: prompt })
  
  let turnsRemaining = config.maxTurns
  let totalCost = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  const startTime = Date.now()
  
  // Emit session start
  yield { type: 'session_start', sessionId, model: config.model }
  
  while (turnsRemaining > 0) {
    // Check abort signal
    if (params.abortSignal?.aborted) {
      yield { type: 'interrupted' }
      break
    }
    
    // Check budget
    if (totalCost >= config.maxBudgetUsd) {
      yield { type: 'budget_exceeded', costUsd: totalCost }
      break
    }
    
    // === Step 1: Context Compression ===
    if (shouldCompact(messages, config.model)) {
      yield { type: 'compact_start' }
      const { compacted, summary } = await compactConversation(messages, config)
      messages.length = 0
      messages.push(...compacted)
      yield { type: 'compact_done', summary }
    }
    
    // === Step 2: Build System Prompt ===
    const systemPrompt = await buildSystemPrompt({
      tools,
      workspace,
      mcpConnections,
    })
    
    // === Step 3: Call LLM API ===
    const apiMessages = microCompact(normalizeMessages(messages))
    
    const stream = await callLLM({
      baseUrl: config.llmBaseUrl,
      apiKey: config.llmApiKey,
      model: config.model,
      messages: apiMessages,
      systemPrompt,
      tools: formatToolsForAPI(tools),
    })
    
    // === Step 4: Process Streaming Response ===
    const toolCalls: ToolCall[] = []
    const assistantContent: ContentBlock[] = []
    
    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text_delta':
          yield { type: 'text', text: chunk.text }
          break
        case 'thinking':
          yield { type: 'thinking', content: chunk.content }
          break
        case 'tool_use':
          yield { type: 'tool_use', id: chunk.id, name: chunk.name, input: chunk.input }
          toolCalls.push(chunk)
          break
        case 'usage':
          totalCost += calculateCost(chunk.usage, config.model)
          break
      }
      assistantContent.push(chunk)
    }
    
    // Add assistant message to history
    messages.push({ role: 'assistant', content: assistantContent })
    
    // === Step 5: Execute Tools ===
    if (toolCalls.length === 0) {
      const turns = config.maxTurns - turnsRemaining + 1
      yield { 
        type: 'turn_complete', 
        turns,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: totalCost,
        durationMs: Date.now() - startTime,
      }
      break
    }
    
    const results = await executeTools(toolCalls, {
      workspace,
      mcpConnections,
      abortSignal: params.abortSignal,
      onProgress: (event) => { /* yield progress if needed */ },
    })
    
    for (const result of results) {
      yield { type: 'tool_result', id: result.toolUseId, output: result.output, isError: result.isError }
    }
    
    // Add tool results to history
    messages.push({ role: 'user', content: results.map(toToolResultBlock) })
    
    turnsRemaining--
  }
  
  // === Step 6: Persist Session ===
  await sessionStore.saveMessages(sessionId, messages)
  yield { type: 'session_saved' }
}
```

### Loop States

```
                    ┌─────────────┐
                    │    START    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
              ┌────▶│   COMPACT?  │
              │     └──────┬──────┘
              │            │ (if needed)
              │     ┌──────▼──────┐
              │     │   COMPACT   │
              │     └──────┬──────┘
              │            │
              │     ┌──────▼──────┐
              │     │  CALL LLM   │
              │     └──────┬──────┘
              │            │
              │     ┌──────▼──────┐
              │     │ TOOL CALLS? │──── No ────▶ END
              │     └──────┬──────┘
              │            │ Yes
              │     ┌──────▼──────┐
              │     │   EXECUTE   │
              │     │    TOOLS    │
              │     └──────┬──────┘
              │            │
              └────────────┘
```

## Context Compression

### When to Compress

```typescript
// packages/server/src/engine/compact.ts

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-6': 200000,
  'claude-opus-4': 200000,
  'claude-haiku-3-5': 200000,
}

const COMPACT_BUFFER = 13000  // Reserve for response

export function shouldCompact(messages: Message[], model: string): boolean {
  const contextWindow = MODEL_CONTEXT_WINDOWS[model] || 200000
  const threshold = contextWindow - COMPACT_BUFFER
  const estimatedTokens = estimateTokens(messages)
  
  return estimatedTokens >= threshold
}
```

### Compression Algorithm

```typescript
export async function compactConversation(
  messages: Message[],
  config: AgentConfig,
): Promise<{ compacted: Message[], summary: string }> {
  
  // 1. Strip images (too large for summary)
  const strippedMessages = stripImages(messages)
  
  // 2. Build compaction prompt
  const compactionPrompt = buildCompactionPrompt(strippedMessages)
  
  // 3. Call LLM for summary
  const response = await callLLM({
    ...config,
    messages: [{ role: 'user', content: compactionPrompt }],
    systemPrompt: COMPACTION_SYSTEM_PROMPT,
    tools: [],  // No tools for compaction
  })
  
  const summary = extractText(response)
  
  // 4. Create compacted message history using system role compact_boundary
  // This is the canonical format - must match 06-data-model.md and 08-ui-design.md
  const compacted: Message[] = [
    {
      role: 'system',
      content: [{
        type: 'compact_boundary',
        summary,
        compacted_at: Date.now(),
        original_message_count: messages.length,
      }],
    },
  ]
  
  return { compacted, summary }
}

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Create a detailed summary that preserves:
- All important context and decisions made
- Files modified and their changes
- Tool outputs and their significance
- Current state and next steps
The summary should allow the conversation to continue seamlessly.`
```

### Micro-Compaction

For large tool results within a single turn:

```typescript
export function microCompact(messages: Message[], maxChars = 50000): Message[] {
  return messages.map(msg => {
    if (msg.role !== 'user') return msg
    
    const content = msg.content.map(block => {
      if (block.type === 'tool_result' && block.content.length > maxChars) {
        return {
          ...block,
          content: truncateMiddle(block.content, maxChars),
        }
      }
      return block
    })
    
    return { ...msg, content }
  })
}
```

## Tool Execution

### Concurrency Control

Tool execution implements concurrent read-only operations with serial mutations:

```typescript
// packages/server/src/engine/tool-executor.ts

export async function executeTools(
  toolCalls: ToolCall[],
  context: ExecutionContext,
): Promise<ToolResult[]> {
  
  // Partition: read-only (concurrent) vs mutations (serial)
  const readOnly: ToolCall[] = []
  const mutations: ToolCall[] = []
  
  for (const call of toolCalls) {
    const tool = getToolDefinition(call.name)
    if (tool?.isReadOnly?.(call.input)) {
      readOnly.push(call)
    } else {
      mutations.push(call)
    }
  }
  
  const results: ToolResult[] = []
  
  // Execute read-only tools concurrently (max 10)
  const MAX_CONCURRENCY = 10
  for (let i = 0; i < readOnly.length; i += MAX_CONCURRENCY) {
    const batch = readOnly.slice(i, i + MAX_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(call => executeSingleTool(call, context))
    )
    results.push(...batchResults)
  }
  
  // Execute mutation tools serially
  for (const call of mutations) {
    const result = await executeSingleTool(call, context)
    results.push(result)
  }
  
  return results
}
```

### Single Tool Execution

```typescript
async function executeSingleTool(
  call: ToolCall,
  context: ExecutionContext,
): Promise<ToolResult> {
  const tool = getToolDefinition(call.name)
  
  if (!tool) {
    return {
      toolUseId: call.id,
      output: `Error: Unknown tool "${call.name}"`,
      isError: true,
    }
  }
  
  // Check if MCP tool
  if (call.name.startsWith('mcp__')) {
    return executeMCPTool(call, context)
  }
  
  // Execute built-in tool
  try {
    const output = await tool.call(call.input, {
      cwd: context.workspace.path,
      abortSignal: context.abortSignal,
    })
    
    return {
      toolUseId: call.id,
      output: typeof output === 'string' ? output : JSON.stringify(output),
      isError: false,
    }
  } catch (error) {
    return {
      toolUseId: call.id,
      output: `Error: ${error.message}`,
      isError: true,
    }
  }
}
```

## LLM API Client

### Anthropic Messages API Streaming

```typescript
// packages/server/src/engine/llm-client.ts

export async function* callLLM(params: LLMCallParams): AsyncGenerator<LLMChunk> {
  const response = await fetch(`${params.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      system: params.systemPrompt,
      messages: params.messages,
      tools: params.tools.length > 0 ? params.tools : undefined,
      max_tokens: 8192,
      stream: true,
    }),
  })
  
  if (!response.ok) {
    throw new LLMError(response.status, await response.text())
  }
  
  // Parse SSE stream (Anthropic format)
  for await (const event of parseSSEStream(response.body)) {
    switch (event.type) {
      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text }
        } else if (event.delta.type === 'thinking_delta') {
          yield { type: 'thinking', content: event.delta.thinking }
        } else if (event.delta.type === 'input_json_delta') {
          // Tool input streaming - accumulate in caller
          yield { type: 'tool_input_delta', partial_json: event.delta.partial_json }
        }
        break
      
      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          yield {
            type: 'tool_use_start',
            id: event.content_block.id,
            name: event.content_block.name,
          }
        }
        break
      
      case 'message_delta':
        if (event.usage) {
          yield { type: 'usage', usage: event.usage }
        }
        break
    }
  }
}
```

## Error Handling

### Retry Logic

```typescript
// packages/server/src/engine/retry.ts

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 529]
const MAX_RETRIES = 3

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      
      if (!isRetryable(error)) throw error
      if (attempt === MAX_RETRIES) throw error
      
      // Exponential backoff with jitter
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000)
      await sleep(delay)
    }
  }
  
  throw lastError
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LLMError) {
    return RETRYABLE_STATUS_CODES.includes(error.status)
  }
  if (error instanceof Error) {
    return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(error.code)
  }
  return false
}
```
