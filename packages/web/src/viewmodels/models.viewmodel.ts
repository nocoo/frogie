/**
 * Models ViewModel
 *
 * Zustand store for available LLM models.
 * Shared between Settings and Chat for model selection.
 */

import { create } from 'zustand'

const API_BASE = '/api'

/**
 * Model information from API
 */
export interface ModelInfo {
  id: string
  name: string
  createdAt: string
}

/**
 * Model group for categorized display
 */
export interface ModelGroup {
  label: string
  icon: string
  models: ModelInfo[]
}

/**
 * Models store state
 */
interface ModelsState {
  /** Available models from API */
  models: ModelInfo[]

  /** Default model from settings */
  defaultModel: string

  /** Loading state */
  isLoading: boolean

  /** Error message */
  error: string | null

  /** Last fetch timestamp */
  lastFetched: number | null

  /** Fetch models from API */
  fetchModels: () => Promise<void>

  /** Set default model (from settings) */
  setDefaultModel: (model: string) => void

  /** Get models grouped by provider */
  getGroupedModels: () => ModelGroup[]

  /** Clear error */
  clearError: () => void
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
  if (embedding.length > 0) {
    result.push({ label: 'Embedding Models', icon: '📊', models: embedding })
  }

  return result
}

/**
 * Get display info for a model
 */
export function getModelDisplayInfo(
  modelId: string,
  models: ModelInfo[]
): { name: string; icon: string } | null {
  const model = models.find((m) => m.id === modelId)
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

/**
 * Models store
 */
export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  defaultModel: '',
  isLoading: false,
  error: null,
  lastFetched: null,

  fetchModels: async () => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`${API_BASE}/settings/test-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      // Check if response has content
      const text = await res.text()
      if (!text) {
        throw new Error('Empty response from server')
      }

      let data: {
        success: boolean
        error?: string
        models?: ModelInfo[]
      }

      try {
        data = JSON.parse(text) as typeof data
      } catch {
        throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`)
      }

      if (!data.success) {
        throw new Error(data.error ?? 'Failed to fetch models')
      }

      set({
        models: data.models ?? [],
        isLoading: false,
        lastFetched: Date.now(),
      })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  setDefaultModel: (model: string) => {
    set({ defaultModel: model })
  },

  getGroupedModels: () => {
    return categorizeModels(get().models)
  },

  clearError: () => {
    set({ error: null })
  },
}))
