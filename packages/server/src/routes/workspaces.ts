/**
 * Workspace Routes
 *
 * GET /api/workspaces - List all workspaces
 * POST /api/workspaces - Create workspace
 * GET /api/workspaces/:id - Get workspace by ID
 * DELETE /api/workspaces/:id - Delete workspace with cascade
 */

import { existsSync, statSync } from 'node:fs'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Database as DatabaseType } from 'better-sqlite3'
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  deleteWorkspace,
} from '../db'
import { validationError, notFound, ErrorCodes } from '../middleware'

/**
 * Create workspace schema
 */
const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
})

/**
 * Transform workspace for API response
 */
function toApiWorkspace(workspace: {
  id: string
  name: string
  path: string
  created_at: number
  last_accessed: number | null
  settings: string
}) {
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    createdAt: workspace.created_at,
    lastAccessed: workspace.last_accessed,
  }
}

/**
 * Create workspace router
 */
export function createWorkspacesRouter(db: DatabaseType): Hono {
  const router = new Hono()

  /**
   * GET /api/workspaces - List all workspaces
   */
  router.get('/', (c) => {
    const workspaces = listWorkspaces(db)
    return c.json(workspaces.map(toApiWorkspace))
  })

  /**
   * POST /api/workspaces - Create workspace
   */
  router.post('/', async (c) => {
    const body: unknown = await c.req.json()

    // Validate request body
    const result = createWorkspaceSchema.safeParse(body)
    if (!result.success) {
      throw validationError(result.error.issues[0]?.message ?? 'Invalid input')
    }

    const { name, path } = result.data

    // Validate path exists and is a directory
    if (!existsSync(path)) {
      throw validationError(`Path does not exist: ${path}`)
    }

    try {
      const stat = statSync(path)
      if (!stat.isDirectory()) {
        throw validationError(`Path is not a directory: ${path}`)
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        throw validationError(`Path is not a directory: ${path}`)
      }
      throw err
    }

    // Create workspace
    const workspace = createWorkspace(db, { name, path })

    return c.json(toApiWorkspace(workspace), 201)
  })

  /**
   * GET /api/workspaces/:id - Get workspace by ID
   */
  router.get('/:id', (c) => {
    const { id } = c.req.param()

    const workspace = getWorkspace(db, id)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${id}`)
    }

    return c.json(toApiWorkspace(workspace))
  })

  /**
   * DELETE /api/workspaces/:id - Delete workspace with cascade
   */
  router.delete('/:id', (c) => {
    const { id } = c.req.param()

    const deleted = deleteWorkspace(db, id)
    if (!deleted) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${id}`)
    }

    return c.json({ success: true })
  })

  return router
}
