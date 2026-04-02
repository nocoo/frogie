/**
 * WorkspaceSelector Component
 *
 * Dropdown for selecting and managing workspaces.
 */

import { useEffect, useState } from 'react'
import {
  FolderOpen,
  Plus,
  Check,
  ChevronsUpDown,
  Loader2,
} from 'lucide-react'
import { useWorkspaceStore } from '@/viewmodels/workspace.viewmodel'
import { useSessionStore } from '@/viewmodels/session.viewmodel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface WorkspaceSelectorProps {
  collapsed?: boolean
}

export function WorkspaceSelector({ collapsed = false }: WorkspaceSelectorProps) {
  const {
    workspaces,
    currentWorkspace,
    isLoading,
    fetchWorkspaces,
    createWorkspace,
    selectWorkspace,
  } = useWorkspaceStore()
  const { clearSessions } = useSessionStore()

  const [open, setOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')

  // Fetch workspaces on mount
  useEffect(() => {
    void fetchWorkspaces()
  }, [fetchWorkspaces])

  const handleSelect = (workspaceId: string) => {
    selectWorkspace(workspaceId)
    clearSessions()
    setOpen(false)
  }

  const handleCreate = async () => {
    if (!newName.trim() || !newPath.trim()) return

    const workspace = await createWorkspace({
      name: newName.trim(),
      path: newPath.trim(),
    })

    if (workspace) {
      setDialogOpen(false)
      setNewName('')
      setNewPath('')
      clearSessions()
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => {
          setOpen(!open)
        }}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg transition-colors mx-auto',
          currentWorkspace
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        <FolderOpen className="h-5 w-5" strokeWidth={1.5} />
      </button>
    )
  }

  return (
    <>
      <div className="px-3 py-2">
        <Label className="text-xs text-muted-foreground mb-1.5 block">
          Workspace
        </Label>
        <button
          onClick={() => {
            setOpen(!open)
          }}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm',
            'bg-background hover:bg-accent transition-colors'
          )}
          disabled={isLoading}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : (
              <FolderOpen className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">
              {currentWorkspace?.name ?? 'Select workspace...'}
            </span>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>

        {/* Dropdown */}
        {open && (
          <div className="mt-1 rounded-lg border bg-popover shadow-md">
            <div className="max-h-[200px] overflow-y-auto p-1">
              {workspaces.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No workspaces
                </div>
              ) : (
                workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    onClick={() => {
                      handleSelect(workspace.id)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm',
                      'hover:bg-accent transition-colors',
                      currentWorkspace?.id === workspace.id && 'bg-accent'
                    )}
                  >
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        currentWorkspace?.id === workspace.id
                          ? 'opacity-100'
                          : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{workspace.name}</span>
                  </button>
                ))
              )}
            </div>

            <div className="border-t p-1">
              <button
                onClick={() => {
                  setOpen(false)
                  setDialogOpen(true)
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Add workspace</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Workspace Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Name</Label>
              <Input
                id="workspace-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                }}
                placeholder="My Project"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-path">Path</Label>
              <Input
                id="workspace-path"
                value={newPath}
                onChange={(e) => {
                  setNewPath(e.target.value)
                }}
                placeholder="/path/to/project"
              />
              <p className="text-xs text-muted-foreground">
                The local directory path for this workspace
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleCreate()
              }}
              disabled={!newName.trim() || !newPath.trim() || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
