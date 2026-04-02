/**
 * MCP Client
 *
 * Creates MCP connections using the official SDK.
 * Supports stdio, SSE, and HTTP transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ToolDefinition, ToolExecutor } from '../engine/frogie-agent'
import type {
  MCPConnection,
  MCPServerConfig,
  MCPStdioConfig,
  MCPToolDefinition,
} from './types'

/**
 * Extended MCP connection with client reference
 */
interface MCPConnectionInternal extends MCPConnection {
  client: Client
}

/**
 * Global registry of MCP clients by tool name
 */
const mcpToolRegistry = new Map<string, { client: Client; originalName: string }>()

/**
 * Wrap an MCP tool as a ToolDefinition for FrogieAgent
 */
function wrapMCPTool(
  serverName: string,
  mcpTool: MCPToolDefinition,
  client: Client
): ToolDefinition {
  // Namespace: mcp__serverName__toolName
  const toolName = `mcp__${serverName}__${mcpTool.name}`

  // Register in global registry for executor lookup
  mcpToolRegistry.set(toolName, { client, originalName: mcpTool.name })

  return {
    name: toolName,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name} from ${serverName}`,
    input_schema: mcpTool.inputSchema ?? { type: 'object', properties: {} },
  }
}

/**
 * Create an MCP tool executor
 */
export function createMCPToolExecutor(): ToolExecutor {
  return async (name: string, input: unknown) => {
    const registration = mcpToolRegistry.get(name)

    if (!registration) {
      return { output: `MCP tool not found: ${name}`, isError: true }
    }

    const { client, originalName } = registration

    try {
      const result = await client.callTool({
        name: originalName,
        arguments: input as Record<string, unknown>,
      })

      // Extract text content
      let output = ''
      if (result.content && Array.isArray(result.content)) {
        for (const block of result.content) {
          if (typeof block === 'object' && block !== null && 'type' in block) {
            const typedBlock = block as { type: string; text?: string }
            if (typedBlock.type === 'text' && typedBlock.text !== undefined) {
              output += typedBlock.text
            } else {
              output += JSON.stringify(block)
            }
          }
        }
      } else {
        output = JSON.stringify(result)
      }

      return {
        output,
        isError: result.isError === true,
      }
    } catch (err) {
      return {
        output: `MCP tool error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        isError: true,
      }
    }
  }
}

/**
 * Unregister MCP tools for a connection
 */
export function unregisterMCPTools(serverName: string): void {
  const prefix = `mcp__${serverName}__`
  for (const key of mcpToolRegistry.keys()) {
    if (key.startsWith(prefix)) {
      mcpToolRegistry.delete(key)
    }
  }
}

/**
 * Create an MCP connection
 */
export async function createMCPConnection(
  name: string,
  config: MCPServerConfig
): Promise<MCPConnection> {
  let transport: Transport
  const configType = config.type ?? 'stdio'

  switch (configType) {
    case 'stdio': {
      const stdioConfig = config as MCPStdioConfig
      if (!stdioConfig.command) {
        throw new Error('stdio transport requires command')
      }
      transport = new StdioClientTransport({
        command: stdioConfig.command,
        args: stdioConfig.args ?? [],
        env: { ...process.env, ...stdioConfig.env } as Record<string, string>,
      })
      break
    }

    case 'sse':
    case 'http':
      // SSE and HTTP transports require additional SDK imports
      // For now, throw an error indicating they're not yet supported
      throw new Error(`${configType} transport not yet implemented`)

    default: {
      // TypeScript exhaustiveness check - configType should never reach here
      const _exhaustive: never = configType
      throw new Error(`Unsupported MCP transport: ${String(_exhaustive)}`)
    }
  }

  const client = new Client(
    { name: `frogie-${name}`, version: '1.0.0' },
    { capabilities: {} }
  )

  await client.connect(transport)

  // Discover tools
  const toolList = await client.listTools()
  const tools: ToolDefinition[] = toolList.tools.map((mcpTool) =>
    wrapMCPTool(name, mcpTool as MCPToolDefinition, client)
  )

  const connection: MCPConnectionInternal = {
    name,
    status: 'connected',
    tools,
    client,
    async close() {
      // Unregister tools first
      unregisterMCPTools(name)
      try {
        await client.close()
      } catch {
        // Ignore close errors
      }
    },
  }

  return connection
}
