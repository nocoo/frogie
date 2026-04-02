/**
 * Settings Page
 *
 * Configure API settings, model, and budget limits.
 * Includes API test functionality to verify connection and load available models.
 */

import { useEffect, useState, useMemo } from 'react'
import { useSettingsStore } from '@/viewmodels/settings.viewmodel'
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Save, AlertCircle, CheckCircle2, Zap } from 'lucide-react'
import { toast } from 'sonner'

const API_BASE = '/api'

interface ModelInfo {
  id: string
  name: string
  createdAt: string
}

interface ModelGroup {
  label: string
  icon: string
  models: ModelInfo[]
}

/**
 * Categorize models by provider based on ID patterns
 */
function categorizeModels(models: ModelInfo[]): ModelGroup[] {
  const claude: ModelInfo[] = []
  const gpt: ModelInfo[] = []
  const gemini: ModelInfo[] = []
  const embedding: ModelInfo[] = []
  const other: ModelInfo[] = []

  for (const model of models) {
    const id = model.id.toLowerCase()
    const name = model.name.toLowerCase()

    // Skip embedding models for chat
    if (id.includes('embedding') || name.includes('embedding')) {
      embedding.push(model)
    } else if (id.includes('claude') || name.includes('claude')) {
      claude.push(model)
    } else if (id.includes('gpt') || name.includes('gpt')) {
      gpt.push(model)
    } else if (id.includes('gemini') || name.includes('gemini')) {
      gemini.push(model)
    } else {
      other.push(model)
    }
  }

  const result: ModelGroup[] = []

  if (claude.length > 0) {
    result.push({ label: 'Claude (Anthropic)', icon: '🟠', models: claude })
  }
  if (gpt.length > 0) {
    result.push({ label: 'GPT (OpenAI)', icon: '🟢', models: gpt })
  }
  if (gemini.length > 0) {
    result.push({ label: 'Gemini (Google)', icon: '🔵', models: gemini })
  }
  if (other.length > 0) {
    result.push({ label: 'Other Models', icon: '⚪', models: other })
  }
  // Embedding models at the end (usually not for chat)
  if (embedding.length > 0) {
    result.push({ label: 'Embedding Models', icon: '📊', models: embedding })
  }

  return result
}

/**
 * Get display info for a model (for showing selected value)
 */
function getModelDisplayInfo(
  modelId: string,
  availableModels: ModelInfo[]
): { name: string; icon: string } | null {
  const model = availableModels.find((m) => m.id === modelId)
  if (!model) return null

  const id = modelId.toLowerCase()
  const name = model.name.toLowerCase()

  let icon = '⚪'
  if (id.includes('claude') || name.includes('claude')) {
    icon = '🟠'
  } else if (id.includes('gpt') || name.includes('gpt')) {
    icon = '🟢'
  } else if (id.includes('gemini') || name.includes('gemini')) {
    icon = '🔵'
  } else if (id.includes('embedding') || name.includes('embedding')) {
    icon = '📊'
  }

  return { name: model.name, icon }
}

export function SettingsPage() {
  const { settings, isLoading, error, fetchSettings, updateSettings, clearError } =
    useSettingsStore()

  // Local form state
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [maxTurns, setMaxTurns] = useState('')
  const [maxBudget, setMaxBudget] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // API test state
  const [isTesting, setIsTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [apiVerified, setApiVerified] = useState(false)

  // Categorized models for grouped display
  const modelGroups = useMemo(
    () => categorizeModels(availableModels),
    [availableModels]
  )

  // Selected model display info
  const selectedModelInfo = useMemo(
    () => getModelDisplayInfo(model, availableModels),
    [model, availableModels]
  )

  // Fetch settings on mount
  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  // Sync form state with settings
  useEffect(() => {
    if (settings) {
      setBaseUrl(settings.llmBaseUrl)
      setApiKey('') // Don't show masked API key
      setModel(settings.llmModel)
      setMaxTurns(String(settings.maxTurns))
      setMaxBudget(String(settings.maxBudgetUsd))
      setIsDirty(false)
      // If there's already a model set, consider API verified
      if (settings.llmModel) {
        setApiVerified(true)
      }
    }
  }, [settings])

  // Validate base URL format
  const validateBaseUrl = (url: string): string | null => {
    if (!url) return null
    if (/\/v1\/?$/.exec(url)) {
      return 'Base URL should not end with /v1 (SDK adds it automatically)'
    }
    return null
  }

  const baseUrlError = validateBaseUrl(baseUrl)

  const handleTestApi = async () => {
    setIsTesting(true)
    setTestError(null)
    setAvailableModels([])

    try {
      const res = await fetch(`${API_BASE}/settings/test-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl || undefined,
          api_key: apiKey || undefined,
        }),
      })

      const data = (await res.json()) as {
        success: boolean
        error?: string
        models?: ModelInfo[]
      }

      if (!data.success) {
        setTestError(data.error ?? 'API test failed')
        setApiVerified(false)
        return
      }

      setAvailableModels(data.models ?? [])
      setApiVerified(true)
      toast.success(`API connection verified (${String(data.models?.length ?? 0)} models available)`)

      // Auto-select first Claude model if none selected
      const claudeModel = data.models?.find((m) =>
        m.id.toLowerCase().includes('claude')
      )
      const firstModel = claudeModel ?? data.models?.[0]
      if (!model && firstModel) {
        setModel(firstModel.id)
        markDirty()
      }
    } catch {
      setTestError('Failed to test API connection')
      setApiVerified(false)
    } finally {
      setIsTesting(false)
    }
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

  // Reset API verification when credentials change
  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    setApiVerified(false)
    setAvailableModels([])
    markDirty()
  }

  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    setApiVerified(false)
    setAvailableModels([])
    markDirty()
  }

  // Can save only if model is selected
  const canSave = isDirty && model && !baseUrlError

  if (isLoading && !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 md:space-y-6">
      {/* B-4 页面 Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your Frogie instance
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>API Configuration</CardTitle>
          <CardDescription>
            Configure your LLM API connection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="base-url">API Base URL</Label>
            <Input
              id="base-url"
              value={baseUrl}
              onChange={(e) => { handleBaseUrlChange(e.target.value) }}
              placeholder="https://api.anthropic.com"
              className={baseUrlError ? 'border-destructive' : ''}
            />
            {baseUrlError ? (
              <p className="text-xs text-destructive">{baseUrlError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
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
            <p className="text-xs text-muted-foreground">
              Your Anthropic API key. Leave empty to keep existing key.
            </p>
          </div>

          {/* Test API Button */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                void handleTestApi()
              }}
              disabled={isTesting || !!baseUrlError}
            >
              {isTesting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Test Connection
            </Button>

            {apiVerified && !testError && (
              <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Connected ({availableModels.length} models)
              </span>
            )}
          </div>

          {testError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{testError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Select the default AI model for new sessions.
            {!apiVerified && ' Test API connection first to load available models.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="model">
              Default Model
              <span className="text-destructive ml-1">*</span>
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
                  availableModels.length === 0
                    ? 'Test API connection to load models'
                    : 'Select a model'
                }>
                  {selectedModelInfo ? (
                    <span className="flex items-center gap-2">
                      <span>{selectedModelInfo.icon}</span>
                      <span>{selectedModelInfo.name}</span>
                    </span>
                  ) : model ? (
                    <span className="text-muted-foreground">{model}</span>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {modelGroups.length > 0 ? (
                  modelGroups.map((group, groupIndex) => (
                    <div key={group.label}>
                      {groupIndex > 0 && <SelectSeparator />}
                      <SelectGroup>
                        <SelectLabel className="flex items-center gap-2 font-semibold">
                          <span>{group.icon}</span>
                          <span>{group.label}</span>
                          <span className="text-xs font-normal text-muted-foreground">
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
                              <span className="text-xs text-muted-foreground font-mono">
                                {m.id}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </div>
                  ))
                ) : model ? (
                  // Show current model if no models loaded yet
                  <SelectItem value={model}>{model}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            {!model && (
              <p className="text-xs text-destructive">
                Model is required. Test API connection to load available models.
              </p>
            )}
            {model && (
              <p className="text-xs text-muted-foreground font-mono">
                ID: {model}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Limits */}
      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
          <CardDescription>
            Set safety limits for agent execution
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <p className="text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
                Maximum spend per query
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-between pt-4">
        <div className="text-sm text-muted-foreground">
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
