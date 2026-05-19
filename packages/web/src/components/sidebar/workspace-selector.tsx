/**
 * WorkspaceSelector Component
 *
 * Dropdown for selecting and managing workspaces.
 * Uses Radix Popover for accessible, animated dropdown.
 */

import { useEffect, useState } from 'react'
import {
  Plus,
  Check,
  ChevronsUpDown,
  Loader2,
  FolderOpen,
} from 'lucide-react'
import { useWorkspaceStore } from '@/viewmodels/workspace.viewmodel'
import { useSessionStore } from '@/viewmodels/session.viewmodel'
import { WorkspaceIcon } from '@/components/workspace-icon'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Workspace } from '@/models'

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
    browseDirectory,
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
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg transition-colors mx-auto',
                  currentWorkspace
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
                aria-label="Select workspace"
              >
                {currentWorkspace ? (
                  <WorkspaceIcon workspace={currentWorkspace} size="sm" />
                ) : (
                  <div className="h-5 w-5 rounded bg-muted" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {currentWorkspace?.name ?? 'Select workspace'}
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-56 p-0">
          <WorkspaceList
            workspaces={workspaces}
            currentWorkspace={currentWorkspace}
            onSelect={handleSelect}
            onAddClick={() => {
              setOpen(false)
              setDialogOpen(true)
            }}
          />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <div className="px-3 py-2">
        <Label className="text-xs text-muted-foreground mb-1.5 block">
          Workspace
        </Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm',
                'bg-input hover:bg-accent transition-colors'
              )}
              disabled={isLoading}
              aria-label="Select workspace"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                ) : currentWorkspace ? (
                  <WorkspaceIcon workspace={currentWorkspace} size="sm" />
                ) : (
                  <div className="h-5 w-5 rounded bg-muted shrink-0" />
                )}
                <span className="truncate">
                  {currentWorkspace?.name ?? 'Select workspace...'}
                </span>
              </div>
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
            <WorkspaceList
              workspaces={workspaces}
              currentWorkspace={currentWorkspace}
              onSelect={handleSelect}
              onAddClick={() => {
                setOpen(false)
                setDialogOpen(true)
              }}
            />
          </PopoverContent>
        </Popover>
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
              <div className="flex gap-2">
                <Input
                  id="workspace-path"
                  value={newPath}
                  onChange={(e) => {
                    setNewPath(e.target.value)
                  }}
                  placeholder="/path/to/project"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void (async () => {
                      const selected = await browseDirectory()
                      if (selected) {
                        setNewPath(selected)
                        // Auto-fill name if empty
                        if (!newName) {
                          const dirName = selected.split('/').pop()
                          if (dirName) {
                            setNewName(dirName)
                          }
                        }
                      }
                    })()
                  }}
                  aria-label="Browse directory"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
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

/**
 * Extracted workspace list for reuse in both collapsed and expanded modes
 */
interface WorkspaceListProps {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null
  onSelect: (workspaceId: string) => void
  onAddClick: () => void
}

function WorkspaceList({
  workspaces,
  currentWorkspace,
  onSelect,
  onAddClick,
}: WorkspaceListProps) {
  return (
    <>
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
                onSelect(workspace.id)
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
              <WorkspaceIcon workspace={workspace} size="sm" />
              <span className="truncate">{workspace.name}</span>
            </button>
          ))
        )}
      </div>

      <div className="border-t p-1">
        <button
          onClick={onAddClick}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Add workspace</span>
        </button>
      </div>
    </>
  )
}
