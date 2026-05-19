# 05 - MCP Integration

## Overview

MCP (Model Context Protocol) allows Frogie to connect to external tool servers, extending its capabilities beyond built-in tools.

## Supported Transports

| Transport | Use Case | Configuration |
|-----------|----------|---------------|
| `stdio` | Local processes (most common) | command, args, env |
| `sse` | Remote HTTP servers (Server-Sent Events) | url, headers |
| `http` | Remote HTTP servers (Streamable HTTP) | url, headers |

## MCP Client

### Connection Manager

```typescript
// packages/server/src/mcp/manager.ts

export class MCPManager {
  private connections = new Map<string, MCPConnection>()
  
  async connect(name: string, config: MCPServerConfig): Promise<MCPConnection> {
    // Close existing connection if any
    if (this.connections.has(name)) {
      await this.disconnect(name)
    }
    
    const connection = await createConnection(name, config)
    this.connections.set(name, connection)
    
    return connection
  }
  
  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (conn) {
      await conn.close()
      this.connections.delete(name)
    }
  }
  
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.connections.keys()).map(name => this.disconnect(name))
    )
  }
  
  getConnection(name: string): MCPConnection | undefined {
    return this.connections.get(name)
  }
  
  getAllConnections(): MCPConnection[] {
    return Array.from(this.connections.values())
  }
  
  getAllTools(): ToolDefinition[] {
    return this.getAllConnections().flatMap(conn => conn.tools)
  }
}
```

### Connection Creation

```typescript
// packages/server/src/mcp/client.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export async function createConnection(
  name: string,
  config: MCPServerConfig,
): Promise<MCPConnection> {
  
  let transport: Transport
  
  switch (config.type ?? 'stdio') {
    case 'stdio':
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...process.env, ...config.env },
      })
      break
      
    case 'sse':
      transport = new SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      })
      break
      
    case 'http':
      transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      })
      break
      
    default:
      throw new Error(`Unsupported MCP transport: ${config.type}`)
  }
  
  const client = new Client(
    { name: `frogie-${name}`, version: '1.0.0' },
    { capabilities: {} },
  )
  
  await client.connect(transport)
  
  // Discover tools
  const toolList = await client.listTools()
  const tools = (toolList.tools ?? []).map(mcpTool => 
    wrapMCPTool(name, mcpTool, client)
  )
  
  return {
    name,
    status: 'connected',
    tools,
    client,
    async close() {
      try {
        await client.close()
      } catch {
        // Ignore close errors
      }
    },
  }
}
```

### Tool Wrapping

```typescript
// packages/server/src/mcp/tool-wrapper.ts

export function wrapMCPTool(
  serverName: string,
  mcpTool: MCPToolDefinition,
  client: Client,
): ToolDefinition {
  
  // Namespace: mcp__serverName__toolName
  const toolName = `mcp__${serverName}__${mcpTool.name}`
  
  return {
    name: toolName,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name} from ${serverName}`,
    inputSchema: mcpTool.inputSchema ?? { type: 'object', properties: {} },
    
    isReadOnly: () => false,  // Conservative default
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    
    async prompt() {
      return mcpTool.description ?? ''
    },
    
    async call(input: unknown): Promise<ToolOutput> {
      try {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: input as Record<string, unknown>,
        })
        
        // Extract text content
        let output = ''
        if (result.content) {
          for (const block of result.content) {
            if (block.type === 'text') {
              output += block.text
            } else {
              output += JSON.stringify(block)
            }
          }
        } else {
          output = JSON.stringify(result)
        }
        
        return {
          data: output,
          isError: result.isError ?? false,
        }
      } catch (err) {
        return {
          data: `MCP tool error: ${err.message}`,
          isError: true,
        }
      }
    },
  }
}
```

## Types

```typescript
// packages/server/src/mcp/types.ts

export type MCPTransportType = 'stdio' | 'sse' | 'http'

export type MCPServerConfig = 
  | MCPStdioConfig
  | MCPSSEConfig
  | MCPHTTPConfig

export interface MCPStdioConfig {
  type?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface MCPSSEConfig {
  type: 'sse'
  url: string
  headers?: Record<string, string>
}

export interface MCPHTTPConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

export interface MCPConnection {
  name: string
  status: 'connected' | 'disconnected' | 'error'
  tools: ToolDefinition[]
  client?: Client
  close(): Promise<void>
}

export interface MCPToolDefinition {
  name: string
  description?: string
  inputSchema?: JSONSchema
}
```

## Workspace-scoped MCP

Each workspace can have its own MCP configuration:

```typescript
// packages/server/src/mcp/workspace-mcp.ts

export class WorkspaceMCPManager {
  private managers = new Map<string, MCPManager>()
  
  getManager(workspaceId: string): MCPManager {
    if (!this.managers.has(workspaceId)) {
      this.managers.set(workspaceId, new MCPManager())
    }
    return this.managers.get(workspaceId)!
  }
  
  async connectForWorkspace(
    workspaceId: string,
    configs: Record<string, MCPServerConfig>,
  ): Promise<void> {
    const manager = this.getManager(workspaceId)
    
    for (const [name, config] of Object.entries(configs)) {
      try {
        await manager.connect(name, config)
      } catch (err) {
        console.error(`Failed to connect MCP server ${name}:`, err.message)
      }
    }
  }
  
  async disconnectWorkspace(workspaceId: string): Promise<void> {
    const manager = this.managers.get(workspaceId)
    if (manager) {
      await manager.disconnectAll()
      this.managers.delete(workspaceId)
    }
  }
}
```

## Database Schema

```sql
-- MCP configurations per workspace
CREATE TABLE mcp_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'stdio',
  config TEXT NOT NULL,  -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
);

-- Example config JSON:
-- stdio: { "command": "npx", "args": ["-y", "@anthropic/mcp-server-memory"], "env": {} }
-- sse:   { "url": "https://mcp.example.com/sse", "headers": { "Authorization": "Bearer ..." } }
-- http:  { "url": "https://mcp.example.com/http" }
```

## API Routes

```typescript
// packages/server/src/routes/mcp.ts

app.get('/api/workspaces/:workspaceId/mcp', async (c) => {
  const { workspaceId } = c.req.param()
  const configs = await db.getMCPConfigs(workspaceId)
  const manager = mcpManager.getManager(workspaceId)
  
  return c.json({
    configs: configs.map(cfg => ({
      name: cfg.name,
      type: cfg.type,
      status: manager.getConnection(cfg.name)?.status ?? 'disconnected',
    })),
  })
})

app.post('/api/workspaces/:workspaceId/mcp', async (c) => {
  const { workspaceId } = c.req.param()
  const { name, type, config } = await c.req.json()
  
  // Save to database
  await db.saveMCPConfig(workspaceId, { name, type, config })
  
  // Connect
  const manager = mcpManager.getManager(workspaceId)
  const connection = await manager.connect(name, { type, ...config })
  
  return c.json({
    name,
    status: connection.status,
    tools: connection.tools.map(t => t.name),
  })
})

app.delete('/api/workspaces/:workspaceId/mcp/:name', async (c) => {
  const { workspaceId, name } = c.req.param()
  
  // Disconnect
  const manager = mcpManager.getManager(workspaceId)
  await manager.disconnect(name)
  
  // Remove from database
  await db.deleteMCPConfig(workspaceId, name)
  
  return c.json({ success: true })
})
```

## Execution Flow

```
1. User adds MCP server via UI
                │
2. POST /api/workspaces/:id/mcp
                │
3. Save config to SQLite
                │
4. MCPManager.connect()
                │
5. Create transport (stdio/sse/http)
                │
6. MCP handshake + tool discovery
                │
7. Wrap tools as ToolDefinition
                │
8. Tools available in next agent loop
```
