/**
 * Workspace ViewModel Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useWorkspaceStore } from './workspace.viewmodel'

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('workspace.viewmodel', () => {
  beforeEach(() => {
    // Reset store state
    useWorkspaceStore.setState({
      workspaces: [],
      currentWorkspace: null,
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
      const state = useWorkspaceStore.getState()

      expect(state.workspaces).toEqual([])
      expect(state.currentWorkspace).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('fetchWorkspaces', () => {
    it('should fetch and store workspaces', async () => {
      const mockWorkspaces = [
        {
          id: 'ws-1',
          name: 'Project 1',
          path: '/path/to/project1',
          color: '#3b82f6',
          createdAt: 1000,
          lastAccessed: 2000,
        },
        {
          id: 'ws-2',
          name: 'Project 2',
          path: '/path/to/project2',
          color: null,
          createdAt: 1500,
          lastAccessed: null,
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkspaces),
      })

      await useWorkspaceStore.getState().fetchWorkspaces()

      const state = useWorkspaceStore.getState()
      expect(state.workspaces).toEqual(mockWorkspaces)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should handle fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Server error' },
          }),
      })

      await useWorkspaceStore.getState().fetchWorkspaces()

      const state = useWorkspaceStore.getState()
      expect(state.workspaces).toEqual([])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Server error')
    })
  })

  describe('createWorkspace', () => {
    it('should create workspace and add to list', async () => {
      const newWorkspace = {
        id: 'ws-new',
        name: 'New Project',
        path: '/path/to/new',
        color: null,
        createdAt: 3000,
        lastAccessed: null,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newWorkspace),
      })

      const result = await useWorkspaceStore
        .getState()
        .createWorkspace({ name: 'New Project', path: '/path/to/new' })

      expect(result).toEqual(newWorkspace)

      const state = useWorkspaceStore.getState()
      expect(state.workspaces).toContainEqual(newWorkspace)
      expect(state.isLoading).toBe(false)

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Project', path: '/path/to/new' }),
      })
    })

    it('should handle create error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Invalid path' },
          }),
      })

      const result = await useWorkspaceStore
        .getState()
        .createWorkspace({ name: 'Bad', path: '/invalid' })

      expect(result).toBeNull()

      const state = useWorkspaceStore.getState()
      expect(state.error).toBe('Invalid path')
    })
  })

  describe('selectWorkspace', () => {
    it('should select an existing workspace', () => {
      const workspace = {
        id: 'ws-1',
        name: 'Project 1',
        path: '/path',
        color: null,
        createdAt: 1000,
        lastAccessed: null,
      }

      useWorkspaceStore.setState({ workspaces: [workspace] })

      useWorkspaceStore.getState().selectWorkspace('ws-1')

      expect(useWorkspaceStore.getState().currentWorkspace).toEqual(workspace)
    })

    it('should set null for non-existing workspace', () => {
      useWorkspaceStore.getState().selectWorkspace('non-existent')

      expect(useWorkspaceStore.getState().currentWorkspace).toBeNull()
    })
  })

  describe('deleteWorkspace', () => {
    it('should delete workspace and remove from list', async () => {
      const workspace = {
        id: 'ws-1',
        name: 'Project 1',
        path: '/path',
        color: '#ef4444',
        createdAt: 1000,
        lastAccessed: null,
      }

      useWorkspaceStore.setState({
        workspaces: [workspace],
        currentWorkspace: workspace,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      const result = await useWorkspaceStore.getState().deleteWorkspace('ws-1')

      expect(result).toBe(true)

      const state = useWorkspaceStore.getState()
      expect(state.workspaces).toEqual([])
      expect(state.currentWorkspace).toBeNull()
    })

    it('should handle delete error', async () => {
      useWorkspaceStore.setState({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Project',
            path: '/path',
            color: null,
            createdAt: 1000,
            lastAccessed: null,
          },
        ],
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Cannot delete' },
          }),
      })

      const result = await useWorkspaceStore.getState().deleteWorkspace('ws-1')

      expect(result).toBe(false)

      const state = useWorkspaceStore.getState()
      expect(state.workspaces).toHaveLength(1)
      expect(state.error).toBe('Cannot delete')
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      useWorkspaceStore.setState({ error: 'Some error' })

      useWorkspaceStore.getState().clearError()

      expect(useWorkspaceStore.getState().error).toBeNull()
    })
  })
})
