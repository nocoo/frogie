/**
 * WebSocket Chat Handler
 *
 * Handles WebSocket connections for real-time chat with agents.
 * Supports multiple concurrent sessions per connection.
 */

import type { DatabaseLike } from '../db/connection'
import type {
  ClientMessage,
  AgentEvent,
  AgentConfig,
  PongEvent,
  ErrorEvent,
} from '../engine/types'
import { FrogieAgent } from '../engine/frogie-agent'
import { SessionSync, type MessageStore } from '../engine/session-sync'
import { BUILTIN_TOOLS, createBuiltinToolExecutor } from '../engine/builtin-tools'
import { getWorkspace, getSettings, listEnabledMCPConfigs } from '../db'
import type { MCPConfig } from '../db'
import { WorkspaceMCPManager, createMCPToolExecutor } from '../mcp'
import type { MCPServerConfig as MCPTransportConfig } from '../mcp'

/**
 * Active agent tracking per session
 */
interface ActiveSession {
  agent: FrogieAgent
  abortController: AbortController
}

/**
 * WebSocket connection state
 */
interface ConnectionState {
  activeSessions: Map<string, ActiveSession>
  db: DatabaseLike
  sessionSync: SessionSync
  mcpManager: WorkspaceMCPManager
}

/**
 * Parse and validate incoming message
 */
function parseMessage(data: string | ArrayBuffer): ClientMessage | null {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const parsed = JSON.parse(text) as unknown

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const msg = parsed as Record<string, unknown>

    if (msg['type'] === 'chat') {
      if (
        typeof msg['sessionId'] === 'string' &&
        typeof msg['workspaceId'] === 'string' &&
        typeof msg['prompt'] === 'string'
      ) {
        return {
          type: 'chat',
          sessionId: msg['sessionId'],
          workspaceId: msg['workspaceId'],
          prompt: msg['prompt'],
          ...(typeof msg['model'] === 'string' && { model: msg['model'] }),
        }
      }
    } else if (msg['type'] === 'interrupt') {
      if (typeof msg['sessionId'] === 'string') {
        return {
          type: 'interrupt',
          sessionId: msg['sessionId'],
        }
      }
    } else if (msg['type'] === 'ping') {
      return { type: 'ping' }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Send event to WebSocket client
 */
function sendEvent(ws: WebSocket, event: AgentEvent | PongEvent | ErrorEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event))
  }
}

/**
 * Convert DB MCPConfig to MCP transport config
 */
function toMCPTransportConfig(config: MCPConfig): MCPTransportConfig {
  const dbConfig = config.config
  switch (config.type) {
    case 'stdio':
      return {
        type: 'stdio',
        command: dbConfig.command ?? '',
        args: dbConfig.args,
        env: dbConfig.env,
      }
    case 'sse':
      return {
        type: 'sse',
        url: dbConfig.url ?? '',
        headers: dbConfig.headers,
      }
    case 'http':
      return {
        type: 'http',
        url: dbConfig.url ?? '',
        headers: dbConfig.headers,
      }
  }
}

/**
 * Handle chat message - start agent query
 */
async function handleChat(
  ws: WebSocket,
  state: ConnectionState,
  sessionId: string,
  workspaceId: string,
  prompt: string,
  model?: string
): Promise<void> {
  // Check for existing active session
  if (state.activeSessions.has(sessionId)) {
    sendEvent(ws, {
      type: 'error',
      message: 'Session already has an active query',
      code: 'SESSION_BUSY',
    })
    return
  }

  // Verify workspace exists
  const workspace = getWorkspace(state.db, workspaceId)
  if (!workspace) {
    sendEvent(ws, {
      type: 'error',
      message: `Workspace not found: ${workspaceId}`,
      code: 'WORKSPACE_NOT_FOUND',
    })
    return
  }

  // Get session index
  const session = state.sessionSync.getSession(sessionId)
  if (!session) {
    sendEvent(ws, {
      type: 'error',
      message: `Session not found: ${sessionId}`,
      code: 'SESSION_NOT_FOUND',
    })
    return
  }

  // CRITICAL: Verify session belongs to the specified workspace
  if (session.workspace_id !== workspaceId) {
    sendEvent(ws, {
      type: 'error',
      message: `Session ${sessionId} does not belong to workspace ${workspaceId}`,
      code: 'SESSION_WORKSPACE_MISMATCH',
    })
    return
  }

  // Get global settings
  const settings = getSettings(state.db)

  // Load existing conversation history for multi-turn context
  const sessionWithMessages = await state.sessionSync.getSessionWithMessages(sessionId)
  const existingMessages = sessionWithMessages?.messages ?? []

  // Create abort controller for this query
  const abortController = new AbortController()

  // Create agent config
  const config: AgentConfig = {
    baseUrl: settings.llm_base_url,
    apiKey: settings.llm_api_key,
    model: model ?? session.model,
    cwd: workspace.path,
    maxTurns: settings.max_turns,
    maxBudgetUsd: settings.max_budget_usd,
    sessionId,
    abortController,
  }

  // Create agent with restored conversation context
  const agent = FrogieAgent.create(config, existingMessages)

  // Inject built-in tools
  const builtinToolExecutor = createBuiltinToolExecutor(workspace.path)
  agent.setTools(BUILTIN_TOOLS, builtinToolExecutor)

  // Load MCP tools from workspace config and inject them
  const mcpConfigs = listEnabledMCPConfigs(state.db, workspaceId)
  if (mcpConfigs.length > 0) {
    try {
      // Convert DB configs to transport configs for MCP manager
      const transportConfigs = mcpConfigs.map((c) => ({
        name: c.name,
        config: toMCPTransportConfig(c),
        enabled: c.enabled,
      }))

      // Connect all enabled MCP servers for this workspace
      await state.mcpManager.connectForWorkspace(workspaceId, transportConfigs)

      // Get MCP tools and inject them (append to built-in tools)
      const mcpTools = state.mcpManager.getToolsForWorkspace(workspaceId)
      if (mcpTools.length > 0) {
        const mcpToolExecutor = createMCPToolExecutor()
        agent.addTools(mcpTools, mcpToolExecutor)
      }
    } catch (err) {
      // Log MCP errors but don't fail the chat - continue with built-in tools
      console.error(
        `Failed to load MCP tools for workspace ${workspaceId}:`,
        err instanceof Error ? err.message : 'Unknown error'
      )
    }
  }

  // Track active session
  state.activeSessions.set(sessionId, { agent, abortController })

  try {
    // Stream events from agent
    for await (const event of agent.query(prompt)) {
      sendEvent(ws, event)

      // Update session stats on turn_complete
      if (event.type === 'turn_complete') {
        state.sessionSync.incrementSessionStats(sessionId, {
          message_count: 1,
          total_input_tokens: event.inputTokens,
          total_output_tokens: event.outputTokens,
          total_cost_usd: event.costUsd,
        })
      }
    }

    // Save messages after query completes (append to history, not replace)
    const allMessages = agent.getMessages()
    await state.sessionSync.saveMessages(sessionId, allMessages)

    // Emit session_saved event to confirm persistence
    sendEvent(ws, { type: 'session_saved' })
  } catch (err) {
    sendEvent(ws, {
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
      code: 'QUERY_ERROR',
    })
  } finally {
    // Clean up active session
    state.activeSessions.delete(sessionId)
  }
}

/**
 * Handle interrupt message
 */
function handleInterrupt(state: ConnectionState, sessionId: string): void {
  const activeSession = state.activeSessions.get(sessionId)
  if (activeSession) {
    activeSession.agent.interrupt()
  }
}

/**
 * Create WebSocket handler for chat
 */
export function createWSHandler(
  db: DatabaseLike,
  messageStore: MessageStore,
  mcpManager: WorkspaceMCPManager
): {
  handleOpen: (ws: WebSocket) => ConnectionState
  handleMessage: (ws: WebSocket, state: ConnectionState, data: string | ArrayBuffer) => void
  handleClose: (state: ConnectionState) => void
} {
  const sessionSync = new SessionSync(db, messageStore)

  return {
    handleOpen: (_ws: WebSocket): ConnectionState => {
      return {
        activeSessions: new Map(),
        db,
        sessionSync,
        mcpManager,
      }
    },

    handleMessage: (ws: WebSocket, state: ConnectionState, data: string | ArrayBuffer): void => {
      const message = parseMessage(data)

      if (!message) {
        sendEvent(ws, {
          type: 'error',
          message: 'Invalid message format',
          code: 'INVALID_MESSAGE',
        })
        return
      }

      switch (message.type) {
        case 'ping':
          sendEvent(ws, { type: 'pong' })
          break

        case 'chat':
          // Fire and forget - async handling
          void handleChat(ws, state, message.sessionId, message.workspaceId, message.prompt, message.model)
          break

        case 'interrupt':
          handleInterrupt(state, message.sessionId)
          break
      }
    },

    handleClose: (state: ConnectionState): void => {
      // Interrupt all active sessions on close
      for (const [, session] of state.activeSessions) {
        session.agent.interrupt()
      }
      state.activeSessions.clear()
    },
  }
}

/**
 * WebSocket upgrade handler for Bun server
 *
 * This function can be used to handle WebSocket upgrades in Bun's serve()
 *
 * Example usage with Bun.serve:
 * ```
 * const wsHandler = createWSHandler(db, messageStore)
 *
 * Bun.serve({
 *   port: 7034,
 *   fetch(req, server) {
 *     if (new URL(req.url).pathname === '/ws') {
 *       if (server.upgrade(req)) {
 *         return undefined
 *       }
 *       return new Response('Upgrade failed', { status: 500 })
 *     }
 *     return app.fetch(req)
 *   },
 *   websocket: {
 *     open(ws) {
 *       ws.data = wsHandler.handleOpen(ws)
 *     },
 *     message(ws, data) {
 *       wsHandler.handleMessage(ws, ws.data as ConnectionState, data)
 *     },
 *     close(ws) {
 *       wsHandler.handleClose(ws.data as ConnectionState)
 *     },
 *   },
 * })
 * ```
 */
export type { ConnectionState }
