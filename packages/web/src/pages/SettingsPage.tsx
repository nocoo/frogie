/**
 * Settings Page
 *
 * Configure API settings, model, and budget limits.
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
import { Loader2, Save, AlertCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

const AVAILABLE_MODELS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
]

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
    }
  }, [settings])

  const handleSave = async () => {
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
              onChange={(e) => {
                setBaseUrl(e.target.value)
                markDirty()
              }}
              placeholder="https://api.anthropic.com"
            />
            <p className="text-xs text-muted-foreground">
              The base URL for the Anthropic API
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                markDirty()
              }}
              placeholder={settings?.llmApiKey ? '••••••••' : 'sk-ant-...'}
            />
            <p className="text-xs text-muted-foreground">
              Your Anthropic API key. Leave empty to keep existing key.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Model Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Select the default AI model for new sessions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="model">Default Model</Label>
            <Select
              value={model}
              onValueChange={(value) => {
                setModel(value)
                markDirty()
              }}
            >
              <SelectTrigger id="model">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

        <Button onClick={() => { void handleSave() }} disabled={!isDirty || isSaving}>
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
