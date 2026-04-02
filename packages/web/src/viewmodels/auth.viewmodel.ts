/**
 * Auth ViewModel
 *
 * Zustand store for authentication state management
 */

import { create } from 'zustand'

/**
 * Authenticated user info
 */
export interface User {
  id: string
  email: string
  name: string | null
  image: string | null
}

/**
 * Auth store state
 */
interface AuthState {
  /** Current authenticated user */
  user: User | null

  /** Loading state */
  isLoading: boolean

  /** Whether initial auth check is complete */
  isInitialized: boolean

  /** Error message */
  error: string | null

  /** Fetch current user from /api/auth/me */
  fetchUser: () => Promise<void>

  /** Redirect to Google OAuth */
  login: () => void

  /** Logout and clear session */
  logout: () => Promise<void>

  /** Clear error */
  clearError: () => void
}

/**
 * Auth store
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  isInitialized: false,
  error: null,

  fetchUser: async () => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch('/api/auth/me')

      if (!res.ok) {
        throw new Error('Failed to fetch user')
      }

      const data = (await res.json()) as { user: User | null }
      set({ user: data.user, isLoading: false, isInitialized: true })
    } catch (err) {
      set({
        user: null,
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
        isInitialized: true,
      })
    }
  },

  login: () => {
    window.location.href = '/api/auth/google'
  },

  logout: async () => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })

      if (!res.ok) {
        throw new Error('Failed to logout')
      }

      set({ user: null, isLoading: false })
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

/**
 * Convenience hook for common auth operations
 */
export function useAuth() {
  const user = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const error = useAuthStore((s) => s.error)
  const fetchUser = useAuthStore((s) => s.fetchUser)
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)
  const clearError = useAuthStore((s) => s.clearError)

  return {
    user,
    isLoading,
    isInitialized,
    isAuthenticated: !!user,
    error,
    fetchUser,
    login,
    logout,
    clearError,
  }
}
