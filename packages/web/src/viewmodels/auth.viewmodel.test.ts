/**
 * Auth ViewModel Tests
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAuthStore, useAuth } from './auth.viewmodel'

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Use a writable href on the existing jsdom window.location.
const mockLocation = { href: '' }
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
  configurable: true,
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

  describe('error fallbacks', () => {
    it('should use default message when fetchUser rejects with non-Error', async () => {
      mockFetch.mockRejectedValueOnce('boom')

      await useAuthStore.getState().fetchUser()

      expect(useAuthStore.getState().error).toBe('Unknown error')
    })

    it('should use default message when logout rejects with non-Error', async () => {
      mockFetch.mockRejectedValueOnce('boom')

      await useAuthStore.getState().logout()

      expect(useAuthStore.getState().error).toBe('Unknown error')
    })
  })

  describe('useAuth hook', () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    })

    afterEach(() => {
      act(() => {
        root.unmount()
      })
      container.remove()
    })

    it('should expose auth state and actions, with isAuthenticated flag', () => {
      type Snapshot = ReturnType<typeof useAuth>
      let snapshot: Snapshot | null = null
      const Probe: FC = () => {
        snapshot = useAuth()
        return null
      }

      act(() => {
        root.render(createElement(Probe))
      })

      expect(snapshot).not.toBeNull()
      const view = snapshot as unknown as Snapshot
      expect(view.user).toBeNull()
      expect(view.isAuthenticated).toBe(false)
      expect(view.isLoading).toBe(false)
      expect(view.isInitialized).toBe(false)
      expect(view.error).toBeNull()
      expect(typeof view.fetchUser).toBe('function')
      expect(typeof view.login).toBe('function')
      expect(typeof view.logout).toBe('function')
      expect(typeof view.clearError).toBe('function')

      act(() => {
        useAuthStore.setState({
          user: { id: 'u-1', email: 'a@b.c', name: null, image: null },
          isInitialized: true,
        })
      })

      const view2 = snapshot as unknown as Snapshot
      expect(view2.user?.id).toBe('u-1')
      expect(view2.isAuthenticated).toBe(true)
      expect(view2.isInitialized).toBe(true)
    })
  })
})
