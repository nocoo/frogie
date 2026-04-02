/**
 * Workspace ViewModel
 *
 * Zustand store for workspace management.
 * Persists selected workspace to LocalStorage.
 */

import { create } from 'zustand'
import type { Workspace, CreateWorkspace } from '@/models'

/**
 * API base URL
 */
const API_BASE = '/api'

/**
 * LocalStorage key for persisting selected workspace
 */
const STORAGE_KEY = 'frogie:selected-workspace-id'

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

  /** Initialize from LocalStorage (called after fetch) */
  initFromStorage: () => void
}

/**
 * Get saved workspace ID from LocalStorage
 */
function getSavedWorkspaceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Save workspace ID to LocalStorage
 */
function saveWorkspaceId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEY, id)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Ignore storage errors
  }
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

      // Auto-select workspace after fetch
      get().initFromStorage()
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  initFromStorage: () => {
    const { workspaces, currentWorkspace } = get()

    // Already have a workspace selected
    if (currentWorkspace) return

    // No workspaces available
    if (workspaces.length === 0) return

    // Try to restore from LocalStorage
    const savedId = getSavedWorkspaceId()
    if (savedId) {
      const saved = workspaces.find((w) => w.id === savedId)
      if (saved) {
        set({ currentWorkspace: saved })
        return
      }
    }

    // Fallback: select first workspace
    const firstWorkspace = workspaces[0] ?? null
    set({ currentWorkspace: firstWorkspace })
    saveWorkspaceId(firstWorkspace?.id ?? null)
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
    saveWorkspaceId(id)
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

      const { currentWorkspace, workspaces } = get()
      const newWorkspaces = workspaces.filter((w) => w.id !== id)

      // If deleting current workspace, select another one
      let newCurrent = currentWorkspace?.id === id ? null : currentWorkspace
      if (!newCurrent && newWorkspaces.length > 0) {
        newCurrent = newWorkspaces[0] ?? null
      }

      set({
        workspaces: newWorkspaces,
        currentWorkspace: newCurrent,
        isLoading: false,
      })

      saveWorkspaceId(newCurrent?.id ?? null)
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
