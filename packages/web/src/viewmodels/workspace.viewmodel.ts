/**
 * Workspace ViewModel
 *
 * Zustand store for workspace management.
 */

import { create } from 'zustand'
import type { Workspace, CreateWorkspace } from '@/models'

/**
 * API base URL
 */
const API_BASE = '/api'

/**
 * Workspace store state
 */
interface WorkspaceState {
  /** List of workspaces */
  workspaces: Workspace[]

  /** Current workspace */
  currentWorkspace: Workspace | null

  /** Loading state */
  isLoading: boolean

  /** Error message */
  error: string | null

  /** Fetch all workspaces */
  fetchWorkspaces: () => Promise<void>

  /** Create a new workspace */
  createWorkspace: (input: CreateWorkspace) => Promise<Workspace | null>

  /** Select a workspace */
  selectWorkspace: (id: string) => void

  /** Delete a workspace */
  deleteWorkspace: (id: string) => Promise<boolean>

  /** Clear error */
  clearError: () => void
}

/**
 * Workspace store
 */
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  currentWorkspace: null,
  isLoading: false,
  error: null,

  fetchWorkspaces: async () => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/workspaces`)

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to fetch workspaces')
      }

      const workspaces = (await res.json()) as Workspace[]
      set({ workspaces, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  createWorkspace: async (input: CreateWorkspace) => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to create workspace')
      }

      const workspace = (await res.json()) as Workspace
      set((state) => ({
        workspaces: [...state.workspaces, workspace],
        isLoading: false,
      }))
      return workspace
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
      return null
    }
  },

  selectWorkspace: (id: string) => {
    const workspace = get().workspaces.find((w) => w.id === id) ?? null
    set({ currentWorkspace: workspace })
  },

  deleteWorkspace: async (id: string) => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/workspaces/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to delete workspace')
      }

      set((state) => ({
        workspaces: state.workspaces.filter((w) => w.id !== id),
        currentWorkspace:
          state.currentWorkspace?.id === id ? null : state.currentWorkspace,
        isLoading: false,
      }))
      return true
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
      return false
    }
  },

  clearError: () => {
    set({ error: null })
  },
}))
