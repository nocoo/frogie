/**
 * Workspaces Page
 *
 * Full workspace management:
 * - Edit name/path
 * - Color selection (16 colors)
 * - Auto-detect logo from workspace directory
 * - Open workspace in Finder
 */

import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/viewmodels/workspace.viewmodel'
import { useSessionStore } from '@/viewmodels/session.viewmodel'
import { WorkspaceIcon } from '@/components/workspace-icon'
import { WORKSPACE_COLORS, DEFAULT_WORKSPACE_COLOR } from '@/constants/colors'
import type { Workspace } from '@/models'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Loader2,
  Save,
  AlertCircle,
  FolderOpen,
  Trash2,
  Plus,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Individual workspace edit card
 */
function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const { updateWorkspace, deleteWorkspace, openWorkspace, selectWorkspace, currentWorkspace, browseDirectory } =
    useWorkspaceStore()
  const { clearSessions } = useSessionStore()

  const [name, setName] = useState(workspace.name)
  const [path, setPath] = useState(workspace.path)
  const [color, setColor] = useState(workspace.color ?? DEFAULT_WORKSPACE_COLOR)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const isSelected = currentWorkspace?.id === workspace.id

  // Reset form when workspace changes
  useEffect(() => {
    setName(workspace.name)
    setPath(workspace.path)
    setColor(workspace.color ?? DEFAULT_WORKSPACE_COLOR)
    setIsDirty(false)
  }, [workspace])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Workspace name is required')
      return
    }
    if (!path.trim()) {
      toast.error('Workspace path is required')
      return
    }

    setIsSaving(true)
    try {
      const result = await updateWorkspace(workspace.id, {
        name: name.trim(),
        path: path.trim(),
        color,
      })

      if (result) {
        toast.success('Workspace saved')
        setIsDirty(false)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const success = await deleteWorkspace(workspace.id)
      if (success) {
        toast.success('Workspace deleted')
        setDeleteDialogOpen(false)
      }
    } finally {
      setIsDeleting(false)
    }
  }

  const handleOpenInFinder = async () => {
    const success = await openWorkspace(workspace.id)
    if (success) {
      toast.success('Opened in Finder')
    }
  }

  const handleSelect = () => {
    selectWorkspace(workspace.id)
    clearSessions()
    toast.success(`Switched to ${workspace.name}`)
  }

  const markDirty = () => {
    if (!isDirty) setIsDirty(true)
  }

  return (
    <>
      <Card className={cn(isSelected && 'ring-2 ring-primary')}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <WorkspaceIcon workspace={{ ...workspace, color }} size="lg" />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg truncate">{workspace.name}</CardTitle>
              <CardDescription className="truncate font-mono text-xs">
                {workspace.path}
              </CardDescription>
            </div>
            {isSelected && (
              <span className="shrink-0 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                Current
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor={`name-${workspace.id}`}>Name</Label>
            <Input
              id={`name-${workspace.id}`}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                markDirty()
              }}
              placeholder="Workspace name"
            />
          </div>

          {/* Path */}
          <div className="space-y-2">
            <Label htmlFor={`path-${workspace.id}`}>Path</Label>
            <div className="flex gap-2">
              <Input
                id={`path-${workspace.id}`}
                value={path}
                onChange={(e) => {
                  setPath(e.target.value)
                  markDirty()
                }}
                placeholder="/path/to/workspace"
                className="font-mono text-sm flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  void (async () => {
                    const selected = await browseDirectory()
                    if (selected) {
                      setPath(selected)
                      markDirty()
                    }
                  })()
                }}
                title="Browse..."
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Color Selector */}
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="grid grid-cols-8 gap-2">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setColor(c.value)
                    markDirty()
                  }}
                  className={cn(
                    'h-9 w-9 rounded-lg border-2 transition-all hover:scale-105',
                    color === c.value
                      ? 'border-foreground ring-2 ring-foreground/20'
                      : 'border-transparent hover:border-border'
                  )}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                >
                  {color === c.value && (
                    <Check className="h-4 w-4 mx-auto text-white drop-shadow-md" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleOpenInFinder()
                }}
              >
                <FolderOpen className="h-4 w-4 mr-1.5" />
                Open in Finder
              </Button>
              {!isSelected && (
                <Button variant="outline" size="sm" onClick={handleSelect}>
                  Select
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setDeleteDialogOpen(true)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>

              <Button
                size="sm"
                onClick={() => {
                  void handleSave()
                }}
                disabled={!isDirty || isSaving}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1.5" />
                )}
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Workspace</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{workspace.name}&quot;? This will also delete
              all sessions associated with this workspace. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleDelete()
              }}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1.5" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Add workspace card
 */
function AddWorkspaceCard() {
  const { createWorkspace, isLoading, browseDirectory } = useWorkspaceStore()
  const { clearSessions } = useSessionStore()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [color, setColor] = useState(DEFAULT_WORKSPACE_COLOR)

  const handleCreate = async () => {
    if (!name.trim() || !path.trim()) return

    const workspace = await createWorkspace({
      name: name.trim(),
      path: path.trim(),
      color,
    })

    if (workspace) {
      toast.success('Workspace created')
      setDialogOpen(false)
      setName('')
      setPath('')
      setColor(DEFAULT_WORKSPACE_COLOR)
      clearSessions()
    }
  }

  return (
    <>
      <Card
        className="border-dashed cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors h-full min-h-[200px]"
        onClick={() => {
          setDialogOpen(true)
        }}
      >
        <CardContent className="flex flex-col items-center justify-center h-full py-12">
          <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-3">
            <Plus className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Add Workspace</p>
          <p className="text-xs text-muted-foreground">
            Create a new workspace for your project
          </p>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
            <DialogDescription>
              Add a new workspace for your project
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-workspace-name">Name</Label>
              <Input
                id="new-workspace-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                }}
                placeholder="My Project"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-workspace-path">Path</Label>
              <div className="flex gap-2">
                <Input
                  id="new-workspace-path"
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value)
                  }}
                  placeholder="/path/to/project"
                  className="font-mono text-sm flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void (async () => {
                      const selected = await browseDirectory()
                      if (selected) {
                        setPath(selected)
                        // Auto-fill name if empty
                        if (!name) {
                          const dirName = selected.split('/').pop()
                          if (dirName) {
                            setName(dirName)
                          }
                        }
                      }
                    })()
                  }}
                  title="Browse..."
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The local directory path for this workspace
              </p>
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="grid grid-cols-8 gap-2">
                {WORKSPACE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => {
                      setColor(c.value)
                    }}
                    className={cn(
                      'h-9 w-9 rounded-lg border-2 transition-all hover:scale-105',
                      color === c.value
                        ? 'border-foreground ring-2 ring-foreground/20'
                        : 'border-transparent hover:border-border'
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  >
                    {color === c.value && (
                      <Check className="h-4 w-4 mx-auto text-white drop-shadow-md" />
                    )}
                  </button>
                ))}
              </div>
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
              disabled={!name.trim() || !path.trim() || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function WorkspacesPage() {
  const { workspaces, isLoading, error, fetchWorkspaces, clearError } =
    useWorkspaceStore()

  // Fetch workspaces on mount
  useEffect(() => {
    void fetchWorkspaces()
  }, [fetchWorkspaces])

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        clearError()
      }, 5000)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [error, clearError])

  if (isLoading && workspaces.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
          Workspaces
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your project workspaces
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Workspace Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {workspaces.map((workspace) => (
          <WorkspaceCard key={workspace.id} workspace={workspace} />
        ))}
        <AddWorkspaceCard />
      </div>
    </div>
  )
}
