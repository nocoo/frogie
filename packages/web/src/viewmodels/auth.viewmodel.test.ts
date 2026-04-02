/**
 * Auth ViewModel Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAuthStore } from './auth.viewmodel'

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Mock window.location
const mockLocation = { href: '' }
Object.defineProperty(globalThis, 'window', {
  value: { location: mockLocation },
  writable: true,
})

describe('auth.viewmodel', () => {
  beforeEach(() => {
    // Reset store state
    useAuthStore.setState({
      user: null,
      isLoading: false,
      isInitialized: false,
      error: null,
    })
    mockFetch.mockReset()
    mockLocation.href = ''
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAuthStore.getState()

      expect(state.user).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.isInitialized).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('fetchUser', () => {
    it('should fetch and store user', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.png',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ user: mockUser }),
      })

      await useAuthStore.getState().fetchUser()

      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.isLoading).toBe(false)
      expect(state.isInitialized).toBe(true)
      expect(state.error).toBeNull()
    })

    it('should handle null user (not authenticated)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ user: null }),
      })

      await useAuthStore.getState().fetchUser()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.isInitialized).toBe(true)
    })

    it('should handle fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      })

      await useAuthStore.getState().fetchUser()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.isInitialized).toBe(true)
      expect(state.error).toBe('Failed to fetch user')
    })
  })

  describe('login', () => {
    it('should redirect to Google OAuth', () => {
      useAuthStore.getState().login()

      expect(mockLocation.href).toBe('/api/auth/google')
    })
  })

  describe('logout', () => {
    it('should clear user on successful logout', async () => {
      useAuthStore.setState({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test',
          image: null,
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      await useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.isLoading).toBe(false)
    })

    it('should handle logout error', async () => {
      useAuthStore.setState({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test',
          image: null,
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
      })

      await useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.error).toBe('Failed to logout')
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      useAuthStore.setState({ error: 'Some error' })

      useAuthStore.getState().clearError()

      expect(useAuthStore.getState().error).toBeNull()
    })
  })
})
