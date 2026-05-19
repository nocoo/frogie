/**
 * Session Routes
 *
 * GET /api/workspaces/:wid/sessions - List sessions for workspace
 * POST /api/workspaces/:wid/sessions - Create new session
 * GET /api/workspaces/:wid/sessions/:id - Get session with messages
 * PATCH /api/workspaces/:wid/sessions/:id - Update session (name, model)
 * DELETE /api/workspaces/:wid/sessions/:id - Delete session (dual persistence)
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { DatabaseLike } from '../db/connection'
import type { Session } from '../db'
import { getWorkspace, updateSessionName, updateSessionModel, getSession } from '../db'
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
 * Update session schema
 */
const updateSessionSchema = z.object({
  name: z.string().nullable().optional(),
  model: z.string().min(1).optional(),
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
  db: DatabaseLike,
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

    // Return format per 07-api-protocol.md: { session, messages }
    return c.json({
      session: toApiSession(sessionResult.index),
      messages: sessionResult.messages,
    })
  })

  /**
   * PATCH /api/workspaces/:wid/sessions/:id - Update session
   */
  router.patch('/:id', async (c) => {
    const wid = c.req.param('wid') ?? ''
    const id = c.req.param('id')

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    // Verify session exists and belongs to workspace
    let session = getSession(db, id)
    if (session?.workspace_id !== wid) {
      throw notFound(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${id}`)
    }

    const body: unknown = await c.req.json()

    // Validate request body
    const result = updateSessionSchema.safeParse(body)
    if (!result.success) {
      throw validationError(result.error.issues[0]?.message ?? 'Invalid input')
    }

    const { name, model } = result.data

    // Update name if provided
    if (name !== undefined) {
      session = updateSessionName(db, id, name)
    }

    // Update model if provided
    if (model !== undefined) {
      session = updateSessionModel(db, id, model)
    }

    if (!session) {
      throw notFound(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${id}`)
    }

    return c.json(toApiSession(session))
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

  /**
   * POST /api/workspaces/:wid/sessions/:id/fork - Fork session
   *
   * Creates a new session with copied conversation history up to current point.
   */
  router.post('/:id/fork', async (c) => {
    const wid = c.req.param('wid') ?? ''
    const id = c.req.param('id')

    // Verify workspace exists
    const workspace = getWorkspace(db, wid)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${wid}`)
    }

    // Get original session with messages
    const originalSession = await sessionSync.getSessionWithMessages(id)
    if (!originalSession) {
      throw notFound(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${id}`)
    }

    // Verify session belongs to workspace
    if (originalSession.index.workspace_id !== wid) {
      throw notFound(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${id}`)
    }

    // Create new session with "(fork)" suffix
    const originalName = originalSession.index.name ?? 'Session'
    const forkName = `${originalName} (fork)`
    const forkedSessionId = sessionSync.createSession(wid, forkName, originalSession.index.model)

    // Copy messages to forked session
    if (originalSession.messages.length > 0) {
      await sessionSync.saveMessages(forkedSessionId, originalSession.messages)
    }

    // Get the forked session
    const forkedSession = sessionSync.getSession(forkedSessionId)
    if (!forkedSession) {
      throw new Error('Failed to create forked session')
    }

    return c.json(toApiSession(forkedSession), 201)
  })

  return router
}
