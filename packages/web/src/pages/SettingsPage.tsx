/**
 * Settings Page
 *
 * Configure API settings, model, and budget limits.
 * Includes API test functionality to verify connection and load available models.
 */

import { useEffect, useState } from 'react'
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
  SelectItem,
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
      toast.success('API connection verified')

      // Auto-select first model if none selected
      const firstModel = data.models?.[0]
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="text-muted-foreground">
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
                Connected
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
              <SelectTrigger id="model">
                <SelectValue placeholder={
                  availableModels.length === 0
                    ? 'Test API connection to load models'
                    : 'Select a model'
                } />
              </SelectTrigger>
              <SelectContent>
                {availableModels.length > 0 ? (
                  availableModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
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
