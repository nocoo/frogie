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

      const response = (await res.json()) as { layers: GlobalPrompt[] }
      set({ globalPrompts: response.layers, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      set({ error: message, isLoading: false })
      throw err // Re-throw for caller to handle
    }
  },

  fetchMergedPrompts: async (workspaceId: string) => {
    set({ isLoading: true, error: null, currentWorkspaceId: workspaceId })

    try {
      const res = await fetch(`${API_BASE}/prompts/${workspaceId}`)

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to fetch merged prompts')
      }

      const response = (await res.json()) as { workspaceId: string; layers: MergedPromptLayer[] }
      set({ mergedPrompts: response.layers, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      set({ error: message, isLoading: false })
      throw err // Re-throw for caller to handle
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
      const { currentWorkspaceId } = get()
      if (currentWorkspaceId) {
        // Don't await - fire and forget refresh
        void get().fetchMergedPrompts(currentWorkspaceId).catch(() => {
          // Ignore refresh errors
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      set({ error: message, isSaving: false })
      throw err // Re-throw for caller to handle
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

      set({ isSaving: false })

      // Refresh merged prompts
      void get().fetchMergedPrompts(workspaceId).catch(() => {
        // Ignore refresh errors
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      set({ error: message, isSaving: false })
      throw err // Re-throw for caller to handle
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

      set({ isSaving: false })

      // Refresh merged prompts
      void get().fetchMergedPrompts(workspaceId).catch(() => {
        // Ignore refresh errors
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      set({ error: message, isSaving: false })
      throw err // Re-throw for caller to handle
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
      const message = err instanceof Error ? err.message : 'Unknown error'
      set({ error: message, isLoading: false })
      throw err // Re-throw for caller to handle
    }
  },

  clearPreview: () => {
    set({ preview: null })
  },

  clearError: () => {
    set({ error: null })
  },
}))
