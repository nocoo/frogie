/**
 * Prompts Page
 *
 * Configure system prompt layers for AI agents.
 * Supports both global defaults and workspace-level overrides.
 */

import { useEffect, useState, useMemo } from 'react'
import { usePromptsStore } from '@/viewmodels/prompts.viewmodel'
import { useWorkspaceStore } from '@/viewmodels/workspace.viewmodel'
import {
  PROMPT_LAYERS,
  type PromptLayerName,
  type MergedPromptLayer,
  type PromptLayerInfo,
} from '@/models'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Loader2,
  Save,
  AlertCircle,
  RotateCcw,
  Eye,
  Code2,
  Globe,
  FolderOpen,
} from 'lucide-react'
import { toast } from 'sonner'

/**
 * Simple Badge component (inline)
 */
function Badge({
  variant = 'default',
  className = '',
  children,
}: {
  variant?: 'default' | 'secondary' | 'outline'
  className?: string
  children: React.ReactNode
}) {
  const variantStyles = {
    default: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border bg-background',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  )
}

/**
 * Get layer info by name
 */
function getLayerInfo(name: PromptLayerName): PromptLayerInfo | undefined {
  return PROMPT_LAYERS.find((l) => l.name === name)
}

/**
 * Prompt Layer Card Component
 */
function PromptLayerCard({
  layer,
  info,
  onEdit,
  onToggle,
  onRevert,
  isGlobal,
}: {
  layer: MergedPromptLayer
  info: PromptLayerInfo
  onEdit: () => void
  onToggle: (enabled: boolean) => void
  onRevert?: () => void
  isGlobal: boolean
}) {
  return (
    <Card className="group">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{info.title}</CardTitle>
              {layer.isTemplate && (
                <Badge variant="outline" className="text-xs">
                  <Code2 className="mr-1 h-3 w-3" />
                  Template
                </Badge>
              )}
              {!layer.isGlobal && (
                <Badge variant="secondary" className="text-xs">
                  <FolderOpen className="mr-1 h-3 w-3" />
                  Override
                </Badge>
              )}
              {layer.isGlobal && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  <Globe className="mr-1 h-3 w-3" />
                  Global
                </Badge>
              )}
            </div>
            <CardDescription>{info.description}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={layer.enabled}
              onCheckedChange={onToggle}
              aria-label={`Toggle ${info.title}`}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="cursor-pointer rounded-md border bg-muted/50 p-3 font-mono text-xs text-muted-foreground hover:bg-muted transition-colors"
          onClick={onEdit}
        >
          <div className="line-clamp-3 whitespace-pre-wrap">
            {layer.content || '(empty)'}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isGlobal && onRevert && !layer.isGlobal && (
            <Button variant="ghost" size="sm" onClick={onRevert}>
              <RotateCcw className="mr-1 h-3 w-3" />
              Revert to Global
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Edit Modal Component
 */
function EditModal({
  open,
  onOpenChange,
  layer: _layer,
  info,
  content,
  enabled,
  onSave,
  isSaving,
  isGlobal,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  layer: PromptLayerName
  info: PromptLayerInfo
  content: string
  enabled: boolean
  onSave: (content: string, enabled: boolean) => void
  isSaving: boolean
  isGlobal: boolean
}) {
  const [editContent, setEditContent] = useState(content)
  const [editEnabled, setEditEnabled] = useState(enabled)

  // Reset on open
  useEffect(() => {
    if (open) {
      setEditContent(content)
      setEditEnabled(enabled)
    }
  }, [open, content, enabled])

  const handleSave = () => {
    onSave(editContent, editEnabled)
  }

  const isDirty = editContent !== content || editEnabled !== enabled

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            Edit {info.title}
            {isGlobal ? ' (Global)' : ' (Workspace Override)'}
          </DialogTitle>
          <DialogDescription>{info.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">Enabled</Label>
            <Switch
              id="enabled"
              checked={editEnabled}
              onCheckedChange={setEditEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <textarea
              id="content"
              value={editContent}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                setEditContent(e.target.value)
              }}
              className="flex min-h-[300px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              placeholder="Enter prompt content..."
            />
            <p className="text-xs text-muted-foreground">
              Available variables: {'{{cwd}}'}, {'{{date}}'}, {'{{git_status}}'}, {'{{tools}}'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false) }}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Preview Modal Component
 */
function PreviewModal({
  open,
  onOpenChange,
  assembledPrompt,
  tokenEstimate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  assembledPrompt: string
  tokenEstimate: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Prompt Preview
          </DialogTitle>
          <DialogDescription>
            Estimated tokens: ~{tokenEstimate.toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[500px] rounded-md border p-4">
          <pre className="whitespace-pre-wrap font-mono text-sm">
            {assembledPrompt}
          </pre>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={() => { onOpenChange(false) }}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Main Prompts Page
 */
export function PromptsPage() {
  const { currentWorkspace } = useWorkspaceStore()
  const {
    globalPrompts,
    mergedPrompts,
    preview,
    isLoading,
    isSaving,
    error,
    fetchGlobalPrompts,
    fetchMergedPrompts,
    updateGlobalPrompt,
    updateWorkspacePrompt,
    deleteWorkspacePrompt,
    previewPrompt,
    clearPreview,
    clearError,
  } = usePromptsStore()

  // Default to global tab if no workspace selected
  const [activeTab, setActiveTab] = useState<'workspace' | 'global'>(
    currentWorkspace ? 'workspace' : 'global'
  )
  const [editingLayer, setEditingLayer] = useState<PromptLayerName | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Fetch merged prompts when workspace changes (workspace tab only)
  useEffect(() => {
    if (currentWorkspace && activeTab === 'workspace') {
      void fetchMergedPrompts(currentWorkspace.id).catch(() => {
        // Error is already set in store
      })
    }
  }, [currentWorkspace, activeTab, fetchMergedPrompts])

  // Fetch global prompts on mount and when switching to global tab
  useEffect(() => {
    if (activeTab === 'global') {
      void fetchGlobalPrompts().catch(() => {
        // Error is already set in store
      })
    }
  }, [activeTab, fetchGlobalPrompts])

  // Clear error on unmount
  useEffect(() => {
    return () => {
      clearError()
    }
  }, [clearError])

  // Get editing layer data based on active tab
  const editingLayerData = useMemo(() => {
    if (!editingLayer) return null
    const prompts = activeTab === 'global' ? globalPrompts : mergedPrompts
    const layer = prompts.find((p) => p.layer === editingLayer)
    const info = getLayerInfo(editingLayer)
    if (!layer || !info) return null
    // Normalize to MergedPromptLayer shape for the modal
    return {
      layer: {
        layer: layer.layer,
        content: layer.content,
        enabled: layer.enabled,
        isTemplate: layer.isTemplate,
        isGlobal: 'isGlobal' in layer ? layer.isGlobal : true,
      },
      info,
    }
  }, [editingLayer, activeTab, globalPrompts, mergedPrompts])

  // Handle save - global prompts don't need workspace
  const handleSave = async (content: string, enabled: boolean) => {
    if (!editingLayer) return

    try {
      if (activeTab === 'global') {
        await updateGlobalPrompt(editingLayer, { content, enabled })
      } else {
        if (!currentWorkspace) return
        await updateWorkspacePrompt(currentWorkspace.id, editingLayer, {
          content,
          enabled,
        })
      }
      toast.success('Prompt saved')
      setEditingLayer(null)
    } catch {
      toast.error('Failed to save prompt')
    }
  }

  // Handle toggle - global prompts don't need workspace
  const handleToggle = async (layer: PromptLayerName, enabled: boolean) => {
    try {
      if (activeTab === 'global') {
        await updateGlobalPrompt(layer, { enabled })
      } else {
        if (!currentWorkspace) return
        await updateWorkspacePrompt(currentWorkspace.id, layer, { enabled })
      }
      toast.success(enabled ? 'Layer enabled' : 'Layer disabled')
    } catch {
      toast.error('Failed to toggle layer')
    }
  }

  // Handle revert (workspace tab only)
  const handleRevert = async (layer: PromptLayerName) => {
    if (!currentWorkspace) return

    try {
      await deleteWorkspacePrompt(currentWorkspace.id, layer)
      toast.success('Reverted to global default')
    } catch {
      toast.error('Failed to revert')
    }
  }

  // Handle preview (requires workspace for context)
  const handlePreview = async () => {
    if (!currentWorkspace) return

    try {
      await previewPrompt(currentWorkspace.id)
      setShowPreview(true)
    } catch {
      toast.error('Failed to generate preview')
    }
  }

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Prompts</h1>
          <p className="text-muted-foreground">
            Configure AI behavior
            {currentWorkspace && activeTab === 'workspace' && (
              <> for <span className="font-medium text-foreground">{currentWorkspace.name}</span></>
            )}
          </p>
        </div>
        {currentWorkspace && (
          <Button onClick={() => { void handlePreview() }} disabled={isLoading}>
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>{error}</p>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => { setActiveTab(v as 'workspace' | 'global') }}
      >
        <TabsList>
          <TabsTrigger value="workspace" disabled={!currentWorkspace}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Workspace
          </TabsTrigger>
          <TabsTrigger value="global">
            <Globe className="mr-2 h-4 w-4" />
            Global Defaults
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workspace" className="space-y-4 mt-4">
          {!currentWorkspace ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FolderOpen className="h-12 w-12 mb-4 opacity-50" />
              <p>Select a workspace to configure workspace-specific overrides</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Customize prompts for this workspace. Overrides inherit from global defaults.
              </p>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {mergedPrompts.map((layer) => {
                    const info = getLayerInfo(layer.layer)
                    if (!info) return null
                    return (
                      <PromptLayerCard
                        key={layer.layer}
                        layer={layer}
                        info={info}
                        isGlobal={false}
                        onEdit={() => { setEditingLayer(layer.layer) }}
                        onToggle={(enabled) => { void handleToggle(layer.layer, enabled) }}
                        onRevert={() => { void handleRevert(layer.layer) }}
                      />
                    )
                  })}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="global" className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            Edit global defaults that apply to all workspaces without overrides.
          </p>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {globalPrompts.map((prompt) => {
                const info = getLayerInfo(prompt.layer)
                if (!info) return null
                // Convert GlobalPrompt to MergedPromptLayer shape for the card
                const layer: MergedPromptLayer = {
                  layer: prompt.layer,
                  content: prompt.content,
                  enabled: prompt.enabled,
                  isTemplate: prompt.isTemplate,
                  isGlobal: true,
                }
                return (
                  <PromptLayerCard
                    key={prompt.layer}
                    layer={layer}
                    info={info}
                    isGlobal={true}
                    onEdit={() => { setEditingLayer(prompt.layer) }}
                    onToggle={(enabled) => { void handleToggle(prompt.layer, enabled) }}
                  />
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Modal */}
      {editingLayerData && (
        <EditModal
          open={!!editingLayer}
          onOpenChange={(open) => {
            if (!open) setEditingLayer(null)
          }}
          layer={editingLayerData.layer.layer}
          info={editingLayerData.info}
          content={editingLayerData.layer.content}
          enabled={editingLayerData.layer.enabled}
          onSave={(content, enabled) => { void handleSave(content, enabled) }}
          isSaving={isSaving}
          isGlobal={activeTab === 'global'}
        />
      )}

      {/* Preview Modal */}
      {preview && (
        <PreviewModal
          open={showPreview}
          onOpenChange={(open) => {
            if (!open) {
              setShowPreview(false)
              clearPreview()
            }
          }}
          assembledPrompt={preview.assembledPrompt}
          tokenEstimate={preview.tokenEstimate}
        />
      )}
    </div>
  )
}
