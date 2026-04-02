# 03 - Agent Engine

## Overview

The Agent Engine is the core of Frogie, implementing the agentic loop that powers multi-turn conversations with tool execution.

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
      yield { type: 'budget_exceeded', cost: totalCost }
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
      yield { type: 'turn_complete', turns: config.maxTurns - turnsRemaining + 1, cost: totalCost }
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
  
  // 4. Create compacted message history
  const compacted: Message[] = [
    {
      role: 'user',
      content: `[Previous conversation summary]\n\n${summary}\n\n[End of summary]`,
    },
    {
      role: 'assistant',
      content: "I understand the context from the previous conversation. I'll continue from where we left off.",
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

Inspired by Claude Code CLI's `StreamingToolExecutor`:

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

### OpenAI-Compatible Streaming

```typescript
// packages/server/src/engine/llm-client.ts

export async function* callLLM(params: LLMCallParams): AsyncGenerator<LLMChunk> {
  const response = await fetch(`${params.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages,
      ],
      tools: params.tools.length > 0 ? params.tools : undefined,
      stream: true,
    }),
  })
  
  if (!response.ok) {
    throw new LLMError(response.status, await response.text())
  }
  
  // Parse SSE stream
  for await (const chunk of parseSSEStream(response.body)) {
    const delta = chunk.choices?.[0]?.delta
    
    if (delta?.content) {
      yield { type: 'text_delta', text: delta.content }
    }
    
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        yield {
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        }
      }
    }
    
    // Handle thinking (Anthropic extension)
    if (delta?.thinking) {
      yield { type: 'thinking', content: delta.thinking }
    }
    
    if (chunk.usage) {
      yield { type: 'usage', usage: chunk.usage }
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
