/**
 * Settings Page
 *
 * Configure API settings, model, and budget limits.
 * Uses shared models store for model selection.
 */

import { useEffect, useState, useMemo } from 'react'
import { useSettingsStore } from '@/viewmodels/settings.viewmodel'
import { useModelsStore, getModelDisplayInfo } from '@/viewmodels/models.viewmodel'
import { Button } from '@nocoo/basalt/components/button'
import { Input } from '@nocoo/basalt/components/input'
import { LayerCard } from '@nocoo/basalt/components/layer-card'
import { Label } from '@nocoo/basalt/components/label'
import { PageHeader } from '@nocoo/basalt/components/page-header'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@nocoo/basalt/components/select'
import { Loader2, Save, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { toast } from '@nocoo/basalt'

export function SettingsPage() {
  const { settings, isLoading, error, fetchSettings, updateSettings, clearError } =
    useSettingsStore()

  const {
    models: availableModels,
    isLoading: isLoadingModels,
    error: modelsError,
    fetchModels,
    getGroupedModels,
    setDefaultModel,
  } = useModelsStore()

  // Local form state
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [maxTurns, setMaxTurns] = useState('')
  const [maxBudget, setMaxBudget] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Categorized models for grouped display
  const modelGroups = useMemo(() => getGroupedModels(), [getGroupedModels, availableModels])

  // Selected model display info
  const selectedModelInfo = useMemo(
    () => model ? getModelDisplayInfo(model, availableModels) : null,
    [model, availableModels]
  )

  // Fetch settings on mount
  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  // Fetch models on mount and when entering page
  useEffect(() => {
    void fetchModels()
  }, [fetchModels])

  // Sync form state with settings
  useEffect(() => {
    if (settings) {
      setBaseUrl(settings.llmBaseUrl)
      setApiKey('') // Don't show masked API key
      setModel(settings.llmModel)
      setMaxTurns(String(settings.maxTurns))
      setMaxBudget(String(settings.maxBudgetUsd))
      setIsDirty(false)

      // Update shared default model
      setDefaultModel(settings.llmModel)
    }
  }, [settings, setDefaultModel])

  // Validate base URL format
  const validateBaseUrl = (url: string): string | null => {
    if (!url) return null
    if (/\/v1\/?$/.exec(url)) {
      return 'Base URL should not end with /v1 (SDK adds it automatically)'
    }
    return null
  }

  const baseUrlError = validateBaseUrl(baseUrl)

  const handleRefreshModels = () => {
    void fetchModels()
  }

  const handleSave = async () => {
    // Validate model is selected
    if (!model) {
      toast.error('Please select a model before saving')
      return
    }

    // Validate base URL
    if (baseUrlError) {
      toast.error(baseUrlError)
      return
    }

    setIsSaving(true)
    clearError()

    try {
      await updateSettings({
        llm_base_url: baseUrl || undefined,
        llm_api_key: apiKey || undefined,
        llm_model: model || undefined,
        max_turns: maxTurns ? parseInt(maxTurns, 10) : undefined,
        max_budget_usd: maxBudget ? parseFloat(maxBudget) : undefined,
      })

      // Update shared default model
      setDefaultModel(model)

      toast.success('Settings saved successfully')
      setApiKey('') // Clear API key input after save
      setIsDirty(false)
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const markDirty = () => {
    if (!isDirty) setIsDirty(true)
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    markDirty()
  }

  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    markDirty()
  }

  // Can save only if model is selected
  const canSave = isDirty && model && !baseUrlError

  if (isLoading && !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-basalt-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-4 md:space-y-6">
      <PageHeader title="Settings" description="Configure your Frogie instance" />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-basalt-destructive/10 text-basalt-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* API Configuration */}
      <LayerCard outlined>
        <LayerCard.Header>
          <div>
            <h2 className="font-semibold leading-none">API Configuration</h2>
            <p className="mt-1 text-sm text-basalt-muted-foreground">
              Configure your LLM API connection
            </p>
          </div>
        </LayerCard.Header>
        <LayerCard.Body className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="base-url">API Base URL</Label>
            <Input
              id="base-url"
              value={baseUrl}
              onChange={(e) => { handleBaseUrlChange(e.target.value) }}
              placeholder="https://api.anthropic.com"
              className={baseUrlError ? 'border-basalt-destructive' : ''}
            />
            {baseUrlError ? (
              <p className="text-xs text-basalt-destructive">{baseUrlError}</p>
            ) : (
              <p className="text-xs text-basalt-muted-foreground">
                The base URL for the Anthropic API (without /v1)
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => { handleApiKeyChange(e.target.value) }}
              placeholder={settings?.llmApiKey ? '••••••••' : 'sk-ant-...'}
            />
            <p className="text-xs text-basalt-muted-foreground">
              Your Anthropic API key. Leave empty to keep existing key.
            </p>
          </div>
        </LayerCard.Body>
      </LayerCard>

      {/* Model Configuration */}
      <LayerCard outlined>
        <LayerCard.Header>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold leading-none">Model</h2>
              <p className="text-sm text-basalt-muted-foreground">
                Select the default AI model for new sessions
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshModels}
              disabled={isLoadingModels}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingModels ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </LayerCard.Header>
        <LayerCard.Body>
          <div className="space-y-2">
            <Label htmlFor="model">
              Default Model
              <span className="text-basalt-destructive ml-1">*</span>
            </Label>
            <Select
              value={model}
              onValueChange={(value) => {
                setModel(value)
                markDirty()
              }}
              disabled={availableModels.length === 0 && !model}
            >
              <SelectTrigger id="model" className="h-auto min-h-10">
                <SelectValue placeholder={
                  isLoadingModels
                    ? 'Loading models...'
                    : availableModels.length === 0
                    ? 'No models available'
                    : 'Select a model'
                }>
                  {selectedModelInfo ? (
                    <span className="flex items-center gap-2">
                      <span>{selectedModelInfo.icon}</span>
                      <span>{selectedModelInfo.name}</span>
                    </span>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {modelGroups.length > 0 ? (
                  modelGroups.map((group) => (
                    <div key={group.label}>
                      <div className="my-1 h-px bg-basalt-border" />
                      <SelectGroup>
                        <SelectLabel className="flex items-center gap-2 font-semibold">
                          <span>{group.icon}</span>
                          <span>{group.label}</span>
                          <span className="text-xs font-normal text-basalt-muted-foreground">
                            ({group.models.length})
                          </span>
                        </SelectLabel>
                        {group.models.map((m) => (
                          <SelectItem
                            key={m.id}
                            value={m.id}
                            className="pl-6"
                          >
                            <div className="flex flex-col">
                              <span>{m.name}</span>
                              <span className="text-xs text-basalt-muted-foreground font-mono">
                                {m.id}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </div>
                  ))
                ) : model ? (
                  <SelectItem value={model}>{model}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>

            {modelsError && (
              <p className="text-xs text-basalt-destructive">{modelsError}</p>
            )}

            {!model && !modelsError && (
              <p className="text-xs text-basalt-destructive">
                Model is required. Select a model from the list.
              </p>
            )}

            {model && (
              <p className="text-xs text-basalt-muted-foreground font-mono">
                ID: {model}
              </p>
            )}

            {availableModels.length > 0 && (
              <p className="text-xs text-basalt-muted-foreground">
                {availableModels.length} models available
              </p>
            )}
          </div>
        </LayerCard.Body>
      </LayerCard>

      {/* Limits */}
      <LayerCard outlined>
        <LayerCard.Header>
          <div>
            <h2 className="font-semibold leading-none">Limits</h2>
            <p className="mt-1 text-sm text-basalt-muted-foreground">
              Set safety limits for agent execution
            </p>
          </div>
        </LayerCard.Header>
        <LayerCard.Body className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-turns">Max Turns per Query</Label>
              <Input
                id="max-turns"
                type="number"
                min={1}
                max={100}
                value={maxTurns}
                onChange={(e) => {
                  setMaxTurns(e.target.value)
                  markDirty()
                }}
              />
              <p className="text-xs text-basalt-muted-foreground">
                Maximum agentic loops (1-100)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-budget">Max Budget (USD)</Label>
              <Input
                id="max-budget"
                type="number"
                min={0}
                step={0.01}
                value={maxBudget}
                onChange={(e) => {
                  setMaxBudget(e.target.value)
                  markDirty()
                }}
              />
              <p className="text-xs text-basalt-muted-foreground">
                Maximum spend per query
              </p>
            </div>
          </div>
        </LayerCard.Body>
      </LayerCard>

      {/* Save Button */}
      <div className="flex items-center justify-between pt-4">
        <div className="text-sm text-basalt-muted-foreground">
          {isDirty ? (
            <span className="text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          ) : settings ? (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All changes saved
            </span>
          ) : null}
        </div>

        <Button
          onClick={() => {
            void handleSave()
          }}
          disabled={!canSave || isSaving}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
