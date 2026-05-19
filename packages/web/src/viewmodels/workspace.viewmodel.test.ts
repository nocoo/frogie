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

  describe('updateWorkspace', () => {
    const baseWs = {
      id: 'ws-1',
      name: 'P',
      path: '/p',
      color: null,
      createdAt: 1,
      lastAccessed: null,
    }

    it('should update workspace and replace currentWorkspace when matching', async () => {
      const updated = { ...baseWs, name: 'Renamed' }
      useWorkspaceStore.setState({
        workspaces: [baseWs],
        currentWorkspace: baseWs,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updated),
      })

      const result = await useWorkspaceStore
        .getState()
        .updateWorkspace('ws-1', { name: 'Renamed' })

      expect(result).toEqual(updated)
      expect(useWorkspaceStore.getState().currentWorkspace).toEqual(updated)
    })

    it('should not replace currentWorkspace when ids differ', async () => {
      const other = { ...baseWs, id: 'ws-2' }
      const updated = { ...baseWs, name: 'X' }

      useWorkspaceStore.setState({
        workspaces: [baseWs, other],
        currentWorkspace: other,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updated),
      })

      await useWorkspaceStore
        .getState()
        .updateWorkspace('ws-1', { name: 'X' })

      expect(useWorkspaceStore.getState().currentWorkspace).toEqual(other)
    })

    it('should fall back to default error message and set error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      })

      const result = await useWorkspaceStore
        .getState()
        .updateWorkspace('ws-1', { name: 'X' })

      expect(result).toBeNull()
      expect(useWorkspaceStore.getState().error).toBe(
        'Failed to update workspace'
      )
    })

    it('should report unknown error on non-Error rejection', async () => {
      mockFetch.mockRejectedValueOnce('boom')

      await useWorkspaceStore.getState().updateWorkspace('ws-1', {})

      expect(useWorkspaceStore.getState().error).toBe('Unknown error')
    })
  })

  describe('openWorkspace', () => {
    it('should resolve true on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      const ok = await useWorkspaceStore.getState().openWorkspace('ws-1')
      expect(ok).toBe(true)
    })

    it('should set error and return false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({ error: { message: 'cannot open' } }),
      })

      const ok = await useWorkspaceStore.getState().openWorkspace('ws-1')

      expect(ok).toBe(false)
      expect(useWorkspaceStore.getState().error).toBe('cannot open')
    })

    it('should fall back to default error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      })

      await useWorkspaceStore.getState().openWorkspace('ws-1')

      expect(useWorkspaceStore.getState().error).toBe(
        'Failed to open workspace'
      )
    })

    it('should report unknown error on non-Error rejection', async () => {
      mockFetch.mockRejectedValueOnce('boom')

      await useWorkspaceStore.getState().openWorkspace('ws-1')

      expect(useWorkspaceStore.getState().error).toBe('Unknown error')
    })
  })

  describe('browseDirectory', () => {
    it('should return the chosen path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ path: '/picked' }),
      })
      const path = await useWorkspaceStore.getState().browseDirectory()
      expect(path).toBe('/picked')
    })

    it('should return null when the picker is cancelled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ cancelled: true }),
      })
      const path = await useWorkspaceStore.getState().browseDirectory()
      expect(path).toBeNull()
    })

    it('should return null when no path is supplied', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      const path = await useWorkspaceStore.getState().browseDirectory()
      expect(path).toBeNull()
    })

    it('should set error and return null on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({ error: { message: 'denied' } }),
      })

      const path = await useWorkspaceStore.getState().browseDirectory()

      expect(path).toBeNull()
      expect(useWorkspaceStore.getState().error).toBe('denied')
    })

    it('should fall back to default error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      })

      await useWorkspaceStore.getState().browseDirectory()

      expect(useWorkspaceStore.getState().error).toBe(
        'Failed to browse directory'
      )
    })

    it('should report unknown error on non-Error rejection', async () => {
      mockFetch.mockRejectedValueOnce('boom')

      await useWorkspaceStore.getState().browseDirectory()

      expect(useWorkspaceStore.getState().error).toBe('Unknown error')
    })
  })

  describe('error fallbacks', () => {
    it('fetchWorkspaces should fall back to default error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      })

      await useWorkspaceStore.getState().fetchWorkspaces()

      expect(useWorkspaceStore.getState().error).toBe(
        'Failed to fetch workspaces'
      )
    })

    it('fetchWorkspaces should report unknown error on non-Error rejection', async () => {
      mockFetch.mockRejectedValueOnce('boom')

      await useWorkspaceStore.getState().fetchWorkspaces()

      expect(useWorkspaceStore.getState().error).toBe('Unknown error')
    })

    it('createWorkspace should fall back to default error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      })

      const result = await useWorkspaceStore
        .getState()
        .createWorkspace({ name: 'x', path: '/x' })

      expect(result).toBeNull()
      expect(useWorkspaceStore.getState().error).toBe(
        'Failed to create workspace'
      )
    })

    it('createWorkspace should report unknown error on non-Error rejection', async () => {
      mockFetch.mockRejectedValueOnce('boom')

      await useWorkspaceStore
        .getState()
        .createWorkspace({ name: 'x', path: '/x' })

      expect(useWorkspaceStore.getState().error).toBe('Unknown error')
    })

    it('deleteWorkspace should fall back to default error message', async () => {
      useWorkspaceStore.setState({
        workspaces: [
          {
            id: 'ws-1',
            name: 'P',
            path: '/p',
            color: null,
            createdAt: 0,
            lastAccessed: null,
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      })

      const ok = await useWorkspaceStore.getState().deleteWorkspace('ws-1')

      expect(ok).toBe(false)
      expect(useWorkspaceStore.getState().error).toBe(
        'Failed to delete workspace'
      )
    })

    it('deleteWorkspace should report unknown error on non-Error rejection', async () => {
      mockFetch.mockRejectedValueOnce('boom')

      await useWorkspaceStore.getState().deleteWorkspace('ws-1')

      expect(useWorkspaceStore.getState().error).toBe('Unknown error')
    })
  })

  describe('deleteWorkspace — auto-select fallback', () => {
    it('should switch currentWorkspace to the next one when deleting current', async () => {
      const a = {
        id: 'ws-a',
        name: 'A',
        path: '/a',
        color: null,
        createdAt: 0,
        lastAccessed: null,
      }
      const b = { ...a, id: 'ws-b', name: 'B' }

      useWorkspaceStore.setState({
        workspaces: [a, b],
        currentWorkspace: a,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await useWorkspaceStore.getState().deleteWorkspace('ws-a')

      expect(useWorkspaceStore.getState().currentWorkspace).toEqual(b)
    })

    it('should leave a non-current workspace selected', async () => {
      const a = {
        id: 'ws-a',
        name: 'A',
        path: '/a',
        color: null,
        createdAt: 0,
        lastAccessed: null,
      }
      const b = { ...a, id: 'ws-b', name: 'B' }

      useWorkspaceStore.setState({
        workspaces: [a, b],
        currentWorkspace: a,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await useWorkspaceStore.getState().deleteWorkspace('ws-b')

      expect(useWorkspaceStore.getState().currentWorkspace).toEqual(a)
    })
  })

  describe('initFromStorage / fetchWorkspaces auto-select', () => {
    const storage = new Map<string, string>()
    const realLocalStorage = globalThis.localStorage

    beforeEach(() => {
      storage.clear()
      const fake: Storage = {
        get length() {
          return storage.size
        },
        clear: () => {
          storage.clear()
        },
        getItem: (k: string) => storage.get(k) ?? null,
        key: (i: number) => Array.from(storage.keys())[i] ?? null,
        removeItem: (k: string) => {
          storage.delete(k)
        },
        setItem: (k: string, v: string) => {
          storage.set(k, v)
        },
      }
      Object.defineProperty(globalThis, 'localStorage', {
        value: fake,
        writable: true,
        configurable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: realLocalStorage,
        writable: true,
        configurable: true,
      })
    })

    it('should restore the saved workspace from LocalStorage on fetch', async () => {
      storage.set('frogie:selected-workspace-id', 'ws-2')
      const list = [
        {
          id: 'ws-1',
          name: 'A',
          path: '/a',
          color: null,
          createdAt: 0,
          lastAccessed: null,
        },
        {
          id: 'ws-2',
          name: 'B',
          path: '/b',
          color: null,
          createdAt: 0,
          lastAccessed: null,
        },
      ]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(list),
      })

      await useWorkspaceStore.getState().fetchWorkspaces()

      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-2')
    })

    it('should fall back to the first workspace when saved id is unknown', async () => {
      storage.set('frogie:selected-workspace-id', 'missing')
      const list = [
        {
          id: 'ws-1',
          name: 'A',
          path: '/a',
          color: null,
          createdAt: 0,
          lastAccessed: null,
        },
      ]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(list),
      })

      await useWorkspaceStore.getState().fetchWorkspaces()

      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-1')
      expect(storage.get('frogie:selected-workspace-id')).toBe('ws-1')
    })

    it('should do nothing when there are no workspaces', () => {
      useWorkspaceStore.setState({ workspaces: [], currentWorkspace: null })
      useWorkspaceStore.getState().initFromStorage()
      expect(useWorkspaceStore.getState().currentWorkspace).toBeNull()
    })

    it('should preserve an already-selected workspace', () => {
      const a = {
        id: 'ws-a',
        name: 'A',
        path: '/a',
        color: null,
        createdAt: 0,
        lastAccessed: null,
      }
      useWorkspaceStore.setState({
        workspaces: [a],
        currentWorkspace: a,
      })

      useWorkspaceStore.getState().initFromStorage()

      expect(useWorkspaceStore.getState().currentWorkspace).toEqual(a)
    })

    it('should swallow LocalStorage read errors', async () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          getItem: () => {
            throw new Error('blocked')
          },
          setItem: () => {
            // no-op
          },
          removeItem: () => {
            // no-op
          },
        },
        writable: true,
        configurable: true,
      })

      const list = [
        {
          id: 'ws-1',
          name: 'A',
          path: '/a',
          color: null,
          createdAt: 0,
          lastAccessed: null,
        },
      ]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(list),
      })

      await useWorkspaceStore.getState().fetchWorkspaces()

      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-1')
    })

    it('should swallow LocalStorage write errors when selecting', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          getItem: () => null,
          setItem: () => {
            throw new Error('blocked')
          },
          removeItem: () => {
            throw new Error('blocked')
          },
        },
        writable: true,
        configurable: true,
      })

      const a = {
        id: 'ws-1',
        name: 'A',
        path: '/a',
        color: null,
        createdAt: 0,
        lastAccessed: null,
      }
      useWorkspaceStore.setState({ workspaces: [a] })

      expect(() => {
        useWorkspaceStore.getState().selectWorkspace('ws-1')
      }).not.toThrow()
    })
  })

  describe('selectWorkspace — unknown id', () => {
    it('should clear current workspace when no match', () => {
      useWorkspaceStore.setState({
        workspaces: [
          {
            id: 'ws-1',
            name: 'A',
            path: '/a',
            color: null,
            createdAt: 0,
            lastAccessed: null,
          },
        ],
      })

      useWorkspaceStore.getState().selectWorkspace('nope')

      expect(useWorkspaceStore.getState().currentWorkspace).toBeNull()
    })
  })
})
