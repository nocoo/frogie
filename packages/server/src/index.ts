/**
 * Frogie Server Entry Point
 *
 * Initializes database, mounts all routes, and starts the HTTP/WebSocket server.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import type { Server } from 'bun'
import type { Hono } from 'hono'

import { createApp, getAllowedOrigins } from './app'
import { initDb, runMigrations, closeDb } from './db'
import { FileMessageStore } from './engine/session-sync'
import { WorkspaceMCPManager } from './mcp'
import { createSettingsRouter } from './routes/settings'
import { createWorkspacesRouter } from './routes/workspaces'
import { createSessionsRouter } from './routes/sessions'
import { createMCPRouter } from './routes/mcp'
import { createPromptsRouter } from './routes/prompts'
import { createWSHandler, type ConnectionState } from './routes/ws-chat'
import {
  AUTH_DEFAULTS,
  createAuthRouter,
  authMiddleware,
  verifyToken,
  type AuthConfig,
} from './auth'
import { getUserById } from './db/repositories/users'

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Server port (default: 7034) */
  port?: number

  /** Database path (default: ~/.frogie/frogie.db) */
  dbPath?: string

  /** Data directory (default: ~/.frogie) */
  dataDir?: string

  /** Auth configuration (optional - enables Google OAuth) */
  auth?: AuthConfig
}

/**
 * WebSocket data type for Bun
 */
interface WSData {
  state: ConnectionState | null
}

/**
 * Frogie server instance
 */
export interface FrogieServer {
  /** Underlying Bun server */
  server: Server<WSData>

  /** Stop the server */
  stop: () => void
}

/**
 * Ensure directory exists
 */
function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null

  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=')
    if (separator < 0) continue
    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim()
    }
  }
  return null
}

export async function authorizeWebSocketRequest(
  request: Request,
  db: ReturnType<typeof initDb>,
  auth: AuthConfig | undefined
): Promise<Response | null> {
  if (!auth) {
    return new Response('Authentication is not configured', { status: 503 })
  }

  const origin = request.headers.get('origin')
  if (origin && !getAllowedOrigins().includes(origin)) {
    return new Response('Forbidden origin', { status: 403 })
  }

  const token = readCookie(request, auth.cookieName ?? AUTH_DEFAULTS.cookieName)
  if (!token) {
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = await verifyToken(token, auth.jwtSecret)
  if (!payload || !getUserById(db, payload.sub)) {
    return new Response('Unauthorized', { status: 401 })
  }

  return null
}

export function configureAuthentication(
  app: Hono,
  db: ReturnType<typeof initDb>,
  auth: AuthConfig | undefined
): void {
  if (!auth) {
    app.use('/api/*', (ctx) => Promise.resolve(
      ctx.json({ error: { message: 'Authentication is not configured' } }, 503)
    ))
    return
  }

  app.use('/api/auth/*', authMiddleware(auth.jwtSecret))
  app.use('/api/*', async (ctx, next) => {
    if (ctx.req.path.startsWith('/api/auth/')) {
      await next()
      return
    }
    const token = readCookie(ctx.req.raw, auth.cookieName ?? AUTH_DEFAULTS.cookieName)
    const payload = token ? await verifyToken(token, auth.jwtSecret) : null
    if (!payload || !getUserById(db, payload.sub)) {
      return ctx.json({ error: { message: 'Unauthorized' } }, 401)
    }
    await next()
  })
  app.route('/api/auth', createAuthRouter(db, auth))
}

/**
 * Start the Frogie server
 */
export function startServer(config: ServerConfig = {}): FrogieServer {
  const port = config.port ?? 7034
  const dataDir = config.dataDir ?? join(homedir(), '.frogie')
  const dbPath = config.dbPath ?? join(dataDir, 'frogie.db')

  // Ensure data directory exists
  ensureDir(dataDir)

  // Initialize database
  const db = initDb(dbPath)
  runMigrations(db)

  // Create message store
  const messageStore = new FileMessageStore(dataDir)

  // Create shared MCP manager for workspace-scoped connections
  const mcpManager = new WorkspaceMCPManager()

  // Create Hono app and mount routes
  const app = createApp()

  // Add auth middleware if configured
  configureAuthentication(app, db, config.auth)

  app.route('/api/settings', createSettingsRouter(db))
  app.route('/api/workspaces', createWorkspacesRouter(db))
  app.route('/api/workspaces/:wid/sessions', createSessionsRouter(db, messageStore))
  app.route('/api/workspaces/:wid/mcp', createMCPRouter(db, mcpManager))
  app.route('/api/prompts', createPromptsRouter(db))

  // Create WebSocket handler
  const wsHandler = createWSHandler(db, messageStore, mcpManager)

  // Start server with WebSocket support
  const server = Bun.serve<WSData>({
    port,
    async fetch(req, server) {
      const url = new URL(req.url)

      // Handle WebSocket upgrade
      if (url.pathname === '/ws') {
        const authError = await authorizeWebSocketRequest(req, db, config.auth)
        if (authError) {
          return authError
        }
        const upgraded = server.upgrade(req, {
          data: { state: null },
        })
        if (upgraded) {
          return undefined
        }
        return new Response('WebSocket upgrade failed', { status: 500 })
      }

      // Handle HTTP requests with Hono
      return app.fetch(req)
    },
    websocket: {
      open(ws) {
        ws.data.state = wsHandler.handleOpen(ws as unknown as WebSocket)
      },
      message(ws, message) {
        if (ws.data.state) {
          const messageStr = typeof message === 'string' ? message : message.toString()
          wsHandler.handleMessage(
            ws as unknown as WebSocket,
            ws.data.state,
            messageStr
          )
        }
      },
      close(ws) {
        if (ws.data.state) {
          wsHandler.handleClose(ws.data.state)
        }
      },
    },
  })

  console.log(`🐸 Frogie server running on http://localhost:${String(port)}`)
  console.log(`   WebSocket: ws://localhost:${String(port)}/ws`)
  console.log(`   Data dir: ${dataDir}`)

  // Return server with cleanup function
  return {
    server,
    stop: () => {
      console.log('Shutting down server...')
      void server.stop()
      closeDb()
      console.log('Server stopped')
    },
  }
}

/**
 * Main entry point
 *
 * Run directly with: bun run packages/server/src/index.ts
 */
if (import.meta.main) {
  // Load auth config from environment
  const googleClientId = process.env['GOOGLE_CLIENT_ID']
  const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET']
  const jwtSecret = process.env['JWT_SECRET']
  const port = parseInt(process.env['PORT'] ?? '7034', 10)

  let auth: AuthConfig | undefined
  if (googleClientId && googleClientSecret && jwtSecret) {
    const baseUrl = process.env['BASE_URL'] ?? `http://localhost:${String(port)}`
    const allowedEmailsEnv = process.env['ALLOWED_EMAILS']
    auth = {
      jwtSecret,
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: `${baseUrl}/api/auth/callback`,
      },
      allowedEmails: allowedEmailsEnv
        ? allowedEmailsEnv.split(',').map((e) => e.trim().toLowerCase())
        : undefined,
    }
  }

  const serverConfig: ServerConfig = { port }
  if (auth) {
    serverConfig.auth = auth
  }

  const server = startServer(serverConfig)

  // Handle graceful shutdown
  const shutdown = () => {
    server.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
