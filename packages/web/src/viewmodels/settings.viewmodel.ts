/**
 * Settings ViewModel
 *
 * Zustand store for global application settings.
 */

import { create } from 'zustand'
import type { Settings, SettingsUpdate } from '@/models'

/**
 * API base URL
 */
const API_BASE = '/api'

/**
 * Settings store state
 */
interface SettingsState {
  /** Current settings */
  settings: Settings | null

  /** Loading state */
  isLoading: boolean

  /** Error message */
  error: string | null

  /** Fetch settings from server */
  fetchSettings: () => Promise<void>

  /** Update settings */
  updateSettings: (update: SettingsUpdate) => Promise<void>

  /** Clear error */
  clearError: () => void
}

/**
 * Settings store
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/settings`)

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to fetch settings')
      }

      const settings = (await res.json()) as Settings
      set({ settings, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  updateSettings: async (update: SettingsUpdate) => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to update settings')
      }

      const settings = (await res.json()) as Settings
      set({ settings, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  clearError: () => {
    set({ error: null })
  },
}))
