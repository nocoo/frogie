/**
 * Session Routes
 *
 * GET /api/workspaces/:wid/sessions - List sessions for workspace
 * POST /api/workspaces/:wid/sessions - Create new session
 * GET /api/workspaces/:wid/sessions/:id - Get session with messages
 * DELETE /api/workspaces/:wid/sessions/:id - Delete session (dual persistence)
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { Session } from '../db'
import { getWorkspace } from '../db'
import { SessionSync, type MessageStore } from '../engine/session-sync'
import { validationError, notFound, ErrorCodes } from '../middleware'

/**
 * Create session schema
 */
const createSessionSchema = z.object({
  name: z.string().nullable().optional(),
  model: z.string().min(1),
})

/**
 * Transform session for API response
 */
function toApiSession(session: Session) {
  return {
    id: session.id,
    workspaceId: session.workspace_id,
    name: session.name,
    model: session.model,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    messageCount: session.message_count,
    totalInputTokens: session.total_input_tokens,
    totalOutputTokens: session.total_output_tokens,
    totalCostUsd: session.total_cost_usd,
  }
}

/**
 * Create sessions router
 */
export function createSessionsRouter(
  db: DatabaseType,
  messageStore: MessageStore
): Hono {
  const router = new Hono()
  const sessionSync = new SessionSync(db, messageStore)

  /**
   * GET /api/workspaces/:wid/sessions - List sessions for workspace
   */
  router.get('/', (c) => {
    const wid = c.req.param('wid') ?? ''

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    const sessions = sessionSync.listSessions(wid)
    return c.json(sessions.map(toApiSession))
  })

  /**
   * POST /api/workspaces/:wid/sessions - Create new session
   */
  router.post('/', async (c) => {
    const wid = c.req.param('wid') ?? ''

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    const body: unknown = await c.req.json()

    // Validate request body
    const result = createSessionSchema.safeParse(body)
    if (!result.success) {
      throw validationError(result.error.issues[0]?.message ?? 'Invalid input')
    }

    const { name, model } = result.data

    // Create session via sync service
    const sessionId = sessionSync.createSession(wid, name ?? null, model)
    const session = sessionSync.getSession(sessionId)

    if (!session) {
      throw new Error('Failed to create session')
    }

    return c.json(toApiSession(session), 201)
  })

  /**
   * GET /api/workspaces/:wid/sessions/:id - Get session with messages
   */
  router.get('/:id', async (c) => {
    const wid = c.req.param('wid') ?? ''
    const id = c.req.param('id')

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    // Get session with messages
    const sessionResult = await sessionSync.getSessionWithMessages(id)
    if (!sessionResult) {
      throw notFound(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${id}`)
    }

    // Verify session belongs to workspace
    if (sessionResult.index.workspace_id !== wid) {
      throw notFound(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${id}`)
    }

    return c.json({
      ...toApiSession(sessionResult.index),
      messages: sessionResult.messages,
    })
  })

  /**
   * DELETE /api/workspaces/:wid/sessions/:id - Delete session
   */
  router.delete('/:id', async (c) => {
    const wid = c.req.param('wid') ?? ''
    const id = c.req.param('id')

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    // Verify session exists and belongs to workspace
    const session = sessionSync.getSession(id)
    if (session?.workspace_id !== wid) {
      throw notFound(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${id}`)
    }

    // Delete via sync service (handles both SQLite and file storage)
    await sessionSync.deleteSession(id)

    return c.json({ success: true })
  })

  return router
}
