/**
 * Workspace Routes
 *
 * GET /api/workspaces - List all workspaces
 * POST /api/workspaces - Create workspace
 * GET /api/workspaces/:id - Get workspace by ID
 * PATCH /api/workspaces/:id - Update workspace
 * DELETE /api/workspaces/:id - Delete workspace with cascade
 * GET /api/workspaces/:id/icon - Get workspace icon (auto-detected logo)
 * POST /api/workspaces/:id/open - Open workspace in Finder
 * POST /api/workspaces/browse - Open Finder directory picker
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { DatabaseLike } from '../db/connection'
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  deleteWorkspace,
  updateWorkspace,
} from '../db'
import { validationError, notFound, ErrorCodes } from '../middleware'

/**
 * Create workspace schema
 */
const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  color: z.string().optional(),
})

/**
 * Update workspace schema
 */
const updateWorkspaceSchema = z.object({
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  color: z.string().nullable().optional(),
})

/**
 * Supported logo file names and extensions
 */
const LOGO_FILE_NAMES = ['logo', 'icon', 'favicon', 'brand']
const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp']

/**
 * Get MIME type for image extension
 */
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
  }
  return mimeTypes[ext.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Find logo file in workspace directory
 */
function findLogoFile(workspacePath: string): string | null {
  if (!existsSync(workspacePath)) {
    return null
  }

  try {
    const files = readdirSync(workspacePath)

    // Check for common logo file patterns
    for (const name of LOGO_FILE_NAMES) {
      for (const ext of LOGO_EXTENSIONS) {
        const fileName = `${name}${ext}`
        if (files.some((f) => f.toLowerCase() === fileName)) {
          const actualFile = files.find((f) => f.toLowerCase() === fileName)
          if (actualFile) {
            return join(workspacePath, actualFile)
          }
        }
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Transform workspace for API response
 */
function toApiWorkspace(workspace: {
  id: string
  name: string
  path: string
  color: string | null
  created_at: number
  last_accessed: number | null
  settings: string
}) {
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    color: workspace.color,
    createdAt: workspace.created_at,
    lastAccessed: workspace.last_accessed,
  }
}

/**
 * Create workspace router
 */
export function createWorkspacesRouter(db: DatabaseLike): Hono {
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

  /**
   * PATCH /api/workspaces/:id - Update workspace
   */
  router.patch('/:id', async (c) => {
    const { id } = c.req.param()
    const body: unknown = await c.req.json()

    // Validate request body
    const result = updateWorkspaceSchema.safeParse(body)
    if (!result.success) {
      throw validationError(result.error.issues[0]?.message ?? 'Invalid input')
    }

    const { name, path, color } = result.data

    // Check if workspace exists
    const existing = getWorkspace(db, id)
    if (!existing) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${id}`)
    }

    // If updating path, validate it exists and is a directory
    if (path && path !== existing.path) {
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
    }

    // Update workspace
    const updateData: { name?: string; path?: string; color?: string | null } = {}
    if (name !== undefined) updateData.name = name
    if (path !== undefined) updateData.path = path
    if (color !== undefined) updateData.color = color

    const workspace = updateWorkspace(db, id, updateData)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${id}`)
    }

    return c.json(toApiWorkspace(workspace))
  })

  /**
   * GET /api/workspaces/:id/icon - Get workspace icon (auto-detected logo)
   */
  router.get('/:id/icon', (c) => {
    const { id } = c.req.param()

    const workspace = getWorkspace(db, id)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${id}`)
    }

    const logoPath = findLogoFile(workspace.path)
    if (!logoPath) {
      return c.json({ error: 'No icon found' }, 404)
    }

    try {
      const content = readFileSync(logoPath)
      const ext = extname(logoPath)
      const mimeType = getMimeType(ext)

      return new Response(content, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } catch {
      return c.json({ error: 'Failed to read icon' }, 500)
    }
  })

  /**
   * POST /api/workspaces/:id/open - Open workspace in Finder
   */
  router.post('/:id/open', async (c) => {
    const { id } = c.req.param()

    const workspace = getWorkspace(db, id)
    if (!workspace) {
      throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND, `Workspace not found: ${id}`)
    }

    if (!existsSync(workspace.path)) {
      throw validationError(`Workspace path does not exist: ${workspace.path}`)
    }

    try {
      // Open in Finder (macOS)
      const proc = Bun.spawn(['open', workspace.path])
      await proc.exited

      return c.json({ success: true })
    } catch {
      return c.json({ error: 'Failed to open workspace' }, 500)
    }
  })

  /**
   * POST /api/workspaces/browse - Open Finder directory picker
   */
  router.post('/browse', async (c) => {
    try {
      // Use AppleScript to open a directory picker on macOS
      const script = `
        tell application "System Events"
          activate
        end tell
        set selectedFolder to choose folder with prompt "Select a workspace directory"
        return POSIX path of selectedFolder
      `

      const proc = Bun.spawn(['osascript', '-e', script], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const output = await new Response(proc.stdout).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        // User cancelled or error
        return c.json({ cancelled: true })
      }

      const path = output.trim().replace(/\/$/, '') // Remove trailing slash
      return c.json({ path })
    } catch {
      return c.json({ error: 'Failed to open directory picker' }, 500)
    }
  })

  return router
}
