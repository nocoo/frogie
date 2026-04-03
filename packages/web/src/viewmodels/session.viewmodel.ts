/**
 * Session ViewModel
 *
 * Zustand store for session management within a workspace.
 */

import { create } from 'zustand'
import type { Session, CreateSession } from '@/models'

/**
 * API base URL
 */
const API_BASE = '/api'

/**
 * Session store state
 */
interface SessionState {
  /** List of sessions for current workspace */
  sessions: Session[]

  /** Current active session */
  currentSession: Session | null

  /** Current workspace ID */
  workspaceId: string | null

  /** Loading state */
  isLoading: boolean

  /** Error message */
  error: string | null

  /** Fetch sessions for a workspace */
  fetchSessions: (workspaceId: string) => Promise<void>

  /** Create a new session */
  createSession: (
    workspaceId: string,
    input: CreateSession
  ) => Promise<Session | null>

  /** Update session (name, model) */
  updateSession: (
    workspaceId: string,
    sessionId: string,
    update: { name?: string | null; model?: string }
  ) => Promise<Session | null>

  /** Select a session */
  selectSession: (id: string) => void

  /** Delete a session */
  deleteSession: (workspaceId: string, id: string) => Promise<boolean>

  /** Clear sessions (when switching workspace) */
  clearSessions: () => void

  /** Clear error */
  clearError: () => void
}

/**
 * Session store
 */
export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSession: null,
  workspaceId: null,
  isLoading: false,
  error: null,

  fetchSessions: async (workspaceId: string) => {
    set({ isLoading: true, error: null, workspaceId })

    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/sessions`)

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to fetch sessions')
      }

      const sessions = (await res.json()) as Session[]
      set({ sessions, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  createSession: async (workspaceId: string, input: CreateSession) => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to create session')
      }

      const session = (await res.json()) as Session
      set((state) => ({
        sessions: [...state.sessions, session],
        currentSession: session,
        isLoading: false,
      }))
      return session
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
      return null
    }
  },

  updateSession: async (
    workspaceId: string,
    sessionId: string,
    update: { name?: string | null; model?: string }
  ) => {
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/sessions/${sessionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
        }
      )

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to update session')
      }

      const session = (await res.json()) as Session
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? session : s
        ),
        currentSession:
          state.currentSession?.id === sessionId
            ? session
            : state.currentSession,
      }))
      return session
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
      })
      return null
    }
  },

  selectSession: (id: string) => {
    const session = get().sessions.find((s) => s.id === id) ?? null
    set({ currentSession: session })
  },

  deleteSession: async (workspaceId: string, id: string) => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/sessions/${id}`,
        {
          method: 'DELETE',
        }
      )

      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Failed to delete session')
      }

      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
        currentSession:
          state.currentSession?.id === id ? null : state.currentSession,
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

  clearSessions: () => {
    set({
      sessions: [],
      currentSession: null,
      workspaceId: null,
      error: null,
    })
  },

  clearError: () => {
    set({ error: null })
  },
}))
