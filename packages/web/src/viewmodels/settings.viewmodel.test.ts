/**
 * Settings ViewModel Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useSettingsStore } from './settings.viewmodel'

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('settings.viewmodel', () => {
  beforeEach(() => {
    // Reset store state
    useSettingsStore.setState({
      settings: null,
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
      const state = useSettingsStore.getState()

      expect(state.settings).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('fetchSettings', () => {
    it('should fetch and store settings', async () => {
      const mockSettings = {
        llmBaseUrl: 'http://localhost:7024/v1',
        llmApiKey: '****',
        llmModel: 'claude-sonnet-4-6',
        maxTurns: 50,
        maxBudgetUsd: 10.0,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSettings),
      })

      await useSettingsStore.getState().fetchSettings()

      const state = useSettingsStore.getState()
      expect(state.settings).toEqual(mockSettings)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should set loading state during fetch', async () => {
      let resolvePromise: ((value: unknown) => void) | undefined
      const fetchPromise = new Promise((resolve) => {
        resolvePromise = resolve
      })

      mockFetch.mockReturnValueOnce(fetchPromise)

      const fetchCall = useSettingsStore.getState().fetchSettings()

      // Should be loading
      expect(useSettingsStore.getState().isLoading).toBe(true)

      // Resolve the fetch
      resolvePromise?.({
        ok: true,
        json: () => Promise.resolve({ llmModel: 'test' }),
      })

      await fetchCall

      // Should no longer be loading
      expect(useSettingsStore.getState().isLoading).toBe(false)
    })

    it('should handle fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Server error' },
          }),
      })

      await useSettingsStore.getState().fetchSettings()

      const state = useSettingsStore.getState()
      expect(state.settings).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Server error')
    })
  })

  describe('updateSettings', () => {
    it('should update settings', async () => {
      const updatedSettings = {
        llmBaseUrl: 'http://localhost:7024/v1',
        llmApiKey: '****',
        llmModel: 'claude-opus-4',
        maxTurns: 100,
        maxBudgetUsd: 20.0,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updatedSettings),
      })

      await useSettingsStore
        .getState()
        .updateSettings({ llm_model: 'claude-opus-4', max_turns: 100 })

      const state = useSettingsStore.getState()
      expect(state.settings).toEqual(updatedSettings)
      expect(state.isLoading).toBe(false)

      // Verify fetch was called with correct args
      expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_model: 'claude-opus-4', max_turns: 100 }),
      })
    })

    it('should handle update error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Invalid input' },
          }),
      })

      await useSettingsStore.getState().updateSettings({ max_turns: -1 })

      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Invalid input')
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      useSettingsStore.setState({ error: 'Some error' })

      useSettingsStore.getState().clearError()

      expect(useSettingsStore.getState().error).toBeNull()
    })
  })
})
