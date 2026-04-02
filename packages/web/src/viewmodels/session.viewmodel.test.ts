/**
 * Session ViewModel Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useSessionStore } from './session.viewmodel'

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('session.viewmodel', () => {
  beforeEach(() => {
    // Reset store state
    useSessionStore.setState({
      sessions: [],
      currentSession: null,
      workspaceId: null,
      isLoading: false,
      error: null,
    })
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useSessionStore.getState()

      expect(state.sessions).toEqual([])
      expect(state.currentSession).toBeNull()
      expect(state.workspaceId).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('fetchSessions', () => {
    it('should fetch and store sessions', async () => {
      const mockSessions = [
        {
          id: 'sess-1',
          workspaceId: 'ws-1',
          name: 'Session 1',
          model: 'claude-sonnet',
          createdAt: 1000,
          updatedAt: 2000,
          messageCount: 10,
          totalInputTokens: 500,
          totalOutputTokens: 300,
          totalCostUsd: 0.05,
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessions),
      })

      await useSessionStore.getState().fetchSessions('ws-1')

      const state = useSessionStore.getState()
      expect(state.sessions).toEqual(mockSessions)
      expect(state.workspaceId).toBe('ws-1')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should handle fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Workspace not found' },
          }),
      })

      await useSessionStore.getState().fetchSessions('invalid')

      const state = useSessionStore.getState()
      expect(state.sessions).toEqual([])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Workspace not found')
    })
  })

  describe('createSession', () => {
    it('should create session and add to list', async () => {
      const newSession = {
        id: 'sess-new',
        workspaceId: 'ws-1',
        name: 'New Session',
        model: 'claude-opus',
        createdAt: 3000,
        updatedAt: 3000,
        messageCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newSession),
      })

      const result = await useSessionStore
        .getState()
        .createSession('ws-1', { model: 'claude-opus', name: 'New Session' })

      expect(result).toEqual(newSession)

      const state = useSessionStore.getState()
      expect(state.sessions).toContainEqual(newSession)
      expect(state.currentSession).toEqual(newSession)
      expect(state.isLoading).toBe(false)

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/ws-1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus', name: 'New Session' }),
      })
    })

    it('should handle create error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Invalid model' },
          }),
      })

      const result = await useSessionStore
        .getState()
        .createSession('ws-1', { model: 'invalid' })

      expect(result).toBeNull()

      const state = useSessionStore.getState()
      expect(state.error).toBe('Invalid model')
    })
  })

  describe('selectSession', () => {
    it('should select an existing session', () => {
      const session = {
        id: 'sess-1',
        workspaceId: 'ws-1',
        name: 'Session 1',
        model: 'claude-sonnet',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 10,
        totalInputTokens: 500,
        totalOutputTokens: 300,
        totalCostUsd: 0.05,
      }

      useSessionStore.setState({ sessions: [session] })

      useSessionStore.getState().selectSession('sess-1')

      expect(useSessionStore.getState().currentSession).toEqual(session)
    })

    it('should set null for non-existing session', () => {
      useSessionStore.getState().selectSession('non-existent')

      expect(useSessionStore.getState().currentSession).toBeNull()
    })
  })

  describe('deleteSession', () => {
    it('should delete session and remove from list', async () => {
      const session = {
        id: 'sess-1',
        workspaceId: 'ws-1',
        name: 'Session 1',
        model: 'claude-sonnet',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 10,
        totalInputTokens: 500,
        totalOutputTokens: 300,
        totalCostUsd: 0.05,
      }

      useSessionStore.setState({
        sessions: [session],
        currentSession: session,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      const result = await useSessionStore
        .getState()
        .deleteSession('ws-1', 'sess-1')

      expect(result).toBe(true)

      const state = useSessionStore.getState()
      expect(state.sessions).toEqual([])
      expect(state.currentSession).toBeNull()
    })

    it('should handle delete error', async () => {
      const session = {
        id: 'sess-1',
        workspaceId: 'ws-1',
        name: 'Session 1',
        model: 'claude-sonnet',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 10,
        totalInputTokens: 500,
        totalOutputTokens: 300,
        totalCostUsd: 0.05,
      }

      useSessionStore.setState({ sessions: [session] })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Cannot delete' },
          }),
      })

      const result = await useSessionStore
        .getState()
        .deleteSession('ws-1', 'sess-1')

      expect(result).toBe(false)

      const state = useSessionStore.getState()
      expect(state.sessions).toHaveLength(1)
      expect(state.error).toBe('Cannot delete')
    })
  })

  describe('clearSessions', () => {
    it('should clear all session data', () => {
      useSessionStore.setState({
        sessions: [
          {
            id: 'sess-1',
            workspaceId: 'ws-1',
            name: 'Session 1',
            model: 'claude-sonnet',
            createdAt: 1000,
            updatedAt: 2000,
            messageCount: 10,
            totalInputTokens: 500,
            totalOutputTokens: 300,
            totalCostUsd: 0.05,
          },
        ],
        currentSession: {
          id: 'sess-1',
          workspaceId: 'ws-1',
          name: 'Session 1',
          model: 'claude-sonnet',
          createdAt: 1000,
          updatedAt: 2000,
          messageCount: 10,
          totalInputTokens: 500,
          totalOutputTokens: 300,
          totalCostUsd: 0.05,
        },
        workspaceId: 'ws-1',
        error: 'Some error',
      })

      useSessionStore.getState().clearSessions()

      const state = useSessionStore.getState()
      expect(state.sessions).toEqual([])
      expect(state.currentSession).toBeNull()
      expect(state.workspaceId).toBeNull()
      expect(state.error).toBeNull()
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      useSessionStore.setState({ error: 'Some error' })

      useSessionStore.getState().clearError()

      expect(useSessionStore.getState().error).toBeNull()
    })
  })
})
