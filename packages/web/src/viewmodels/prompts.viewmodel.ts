/**
 * Prompts ViewModel
 *
 * Zustand store for system prompt layer management.
 * Supports both global prompts and workspace-level overrides.
 */

import { create } from 'zustand'
import type {
  PromptLayerName,
  GlobalPrompt,
  WorkspacePrompt,
  MergedPromptLayer,
  PromptPreviewResponse,
} from '@/models'

/**
 * API base URL
 */
const API_BASE = '/api'

/**
 * Prompts store state
 */
interface PromptsState {
  /** Global prompts (all 7 layers) */
  globalPrompts: GlobalPrompt[]

  /** Workspace prompt overrides */
  workspacePrompts: WorkspacePrompt[]

  /** Merged prompts for current workspace */
  mergedPrompts: MergedPromptLayer[]

  /** Current workspace ID being viewed */
  currentWorkspaceId: string | null

  /** Preview result */
  preview: PromptPreviewResponse | null

  /** Loading state */
  isLoading: boolean

  /** Saving state */
  isSaving: boolean

  /** Error message */
  error: string | null

  // Actions

  /** Fetch all global prompts */
  fetchGlobalPrompts: () => Promise<void>

  /** Fetch workspace prompts for a specific workspace */
  fetchWorkspacePrompts: (workspaceId: string) => Promise<void>

  /** Fetch merged prompts for a workspace */
  fetchMergedPrompts: (workspaceId: string) => Promise<void>

  /** Update a global prompt layer */
  updateGlobalPrompt: (
    layer: PromptLayerName,
    update: { content?: string; enabled?: boolean }
  ) => Promise<void>

  /** Update or create a workspace prompt override */
  updateWorkspacePrompt: (
    workspaceId: string,
    layer: PromptLayerName,
    update: { content?: string; enabled?: boolean }
  ) => Promise<void>

  /** Delete a workspace prompt override (revert to global) */
  deleteWorkspacePrompt: (workspaceId: string, layer: PromptLayerName) => Promise<void>

  /** Preview assembled prompt */
  previewPrompt: (
    workspaceId: string,
    overrides?: Record<string, { content?: string; enabled?: boolean }>
  ) => Promise<void>

  /** Clear preview */
  clearPreview: () => void

  /** Clear error */
  clearError: () => void
}

/**
 * Prompts store
 */
export const usePromptsStore = create<PromptsState>((set, get) => ({
  globalPrompts: [],
  workspacePrompts: [],
  mergedPrompts: [],
  currentWorkspaceId: null,
  preview: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchGlobalPrompts: async () => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/prompts/global`)

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to fetch global prompts')
      }

      const globalPrompts = (await res.json()) as GlobalPrompt[]
      set({ globalPrompts, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  fetchWorkspacePrompts: async (workspaceId: string) => {
    set({ isLoading: true, error: null, currentWorkspaceId: workspaceId })

    try {
      const res = await fetch(`${API_BASE}/prompts/${workspaceId}`)

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to fetch workspace prompts')
      }

      const workspacePrompts = (await res.json()) as WorkspacePrompt[]
      set({ workspacePrompts, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  fetchMergedPrompts: async (workspaceId: string) => {
    set({ isLoading: true, error: null, currentWorkspaceId: workspaceId })

    try {
      const res = await fetch(`${API_BASE}/prompts/${workspaceId}/merged`)

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to fetch merged prompts')
      }

      const mergedPrompts = (await res.json()) as MergedPromptLayer[]
      set({ mergedPrompts, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  updateGlobalPrompt: async (
    layer: PromptLayerName,
    update: { content?: string; enabled?: boolean }
  ) => {
    set({ isSaving: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/prompts/global/${layer}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to update global prompt')
      }

      const updated = (await res.json()) as GlobalPrompt

      // Update local state
      set((state) => ({
        globalPrompts: state.globalPrompts.map((p) =>
          p.layer === layer ? updated : p
        ),
        isSaving: false,
      }))

      // Refresh merged prompts if viewing a workspace
      const { currentWorkspaceId, fetchMergedPrompts } = get()
      if (currentWorkspaceId) {
        void fetchMergedPrompts(currentWorkspaceId)
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isSaving: false,
      })
    }
  },

  updateWorkspacePrompt: async (
    workspaceId: string,
    layer: PromptLayerName,
    update: { content?: string; enabled?: boolean }
  ) => {
    set({ isSaving: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/prompts/${workspaceId}/${layer}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to update workspace prompt')
      }

      const updated = (await res.json()) as WorkspacePrompt

      // Update local state
      set((state) => {
        const existing = state.workspacePrompts.find(
          (p) => p.workspaceId === workspaceId && p.layer === layer
        )
        if (existing) {
          return {
            workspacePrompts: state.workspacePrompts.map((p) =>
              p.workspaceId === workspaceId && p.layer === layer ? updated : p
            ),
            isSaving: false,
          }
        } else {
          return {
            workspacePrompts: [...state.workspacePrompts, updated],
            isSaving: false,
          }
        }
      })

      // Refresh merged prompts
      void get().fetchMergedPrompts(workspaceId)
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isSaving: false,
      })
    }
  },

  deleteWorkspacePrompt: async (workspaceId: string, layer: PromptLayerName) => {
    set({ isSaving: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/prompts/${workspaceId}/${layer}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to delete workspace prompt')
      }

      // Update local state
      set((state) => ({
        workspacePrompts: state.workspacePrompts.filter(
          (p) => !(p.workspaceId === workspaceId && p.layer === layer)
        ),
        isSaving: false,
      }))

      // Refresh merged prompts
      void get().fetchMergedPrompts(workspaceId)
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isSaving: false,
      })
    }
  },

  previewPrompt: async (
    workspaceId: string,
    overrides?: Record<string, { content?: string; enabled?: boolean }>
  ) => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/prompts/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, overrides }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to preview prompt')
      }

      const preview = (await res.json()) as PromptPreviewResponse
      set({ preview, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  clearPreview: () => {
    set({ preview: null })
  },

  clearError: () => {
    set({ error: null })
  },
}))
