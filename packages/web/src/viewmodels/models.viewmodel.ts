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
  const glm: ModelInfo[] = []
  const ollama: ModelInfo[] = []
  const embedding: ModelInfo[] = []
  const other: ModelInfo[] = []

  for (const model of models) {
    const id = model.id.toLowerCase()
    const name = model.name.toLowerCase()

    if (id.includes('embedding') || name.includes('embedding')) {
      embedding.push(model)
    } else if (id.includes('claude') || name.includes('claude')) {
      claude.push(model)
    } else if (id.includes('gpt') || name.includes('gpt') || id.includes('o1') || id.includes('o3')) {
      gpt.push(model)
    } else if (id.includes('gemini') || name.includes('gemini')) {
      gemini.push(model)
    } else if (id.includes('glm') || name.includes('glm') || id.includes('chatglm') || id.includes('zhipu')) {
      glm.push(model)
    } else if (OLLAMA_PATTERNS.some(p => id.includes(p) || name.includes(p))) {
      ollama.push(model)
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
  if (glm.length > 0) {
    result.push({ label: 'GLM (Zhipu)', icon: '🟣', models: glm })
  }
  if (ollama.length > 0) {
    result.push({ label: 'Local Models', icon: '🖥️', models: ollama })
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
 * Common Ollama/local model patterns
 */
const OLLAMA_PATTERNS = ['llama', 'qwen', 'mistral', 'codellama', 'deepseek', 'phi', 'vicuna', 'wizardlm', 'orca', 'neural', 'solar', 'yi', 'mixtral', 'dolphin', 'openchat', 'starling', 'nous', 'tinyllama', 'stablelm', 'falcon', 'mpt', 'replit', 'starcoder', 'codestral', 'granite', 'command-r', 'aya', 'gemma', 'codegemma', 'llava', 'bakllava', 'moondream']

/**
 * Get icon for a model based on ID pattern
 */
function getModelIcon(modelId: string): string {
  const id = modelId.toLowerCase()

  if (id.includes('claude')) {
    return '🟠'
  } else if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) {
    return '🟢'
  } else if (id.includes('gemini')) {
    return '🔵'
  } else if (id.includes('glm') || id.includes('chatglm') || id.includes('zhipu')) {
    return '🟣'
  } else if (OLLAMA_PATTERNS.some(p => id.includes(p))) {
    return '🖥️'
  } else if (id.includes('embedding')) {
    return '📊'
  }
  return '⚪'
}

/**
 * Get display info for a model
 * Returns display name and icon. If model is not in the list,
 * falls back to formatting the model ID as a readable name.
 */
export function getModelDisplayInfo(
  modelId: string,
  models: ModelInfo[]
): { name: string; icon: string } {
  const model = models.find((m) => m.id === modelId)

  if (model) {
    const id = modelId.toLowerCase()
    const name = model.name.toLowerCase()

    let icon = '⚪'
    if (id.includes('claude') || name.includes('claude')) {
      icon = '🟠'
    } else if (id.includes('gpt') || name.includes('gpt') || id.includes('o1') || id.includes('o3')) {
      icon = '🟢'
    } else if (id.includes('gemini') || name.includes('gemini')) {
      icon = '🔵'
    } else if (id.includes('glm') || name.includes('glm') || id.includes('chatglm') || id.includes('zhipu')) {
      icon = '🟣'
    } else if (OLLAMA_PATTERNS.some(p => id.includes(p) || name.includes(p))) {
      icon = '🖥️'
    } else if (id.includes('embedding') || name.includes('embedding')) {
      icon = '📊'
    }

    return { name: model.name, icon }
  }

  // Fallback: format model ID as readable name
  // e.g., "claude-3-5-sonnet-20241022" -> "Claude 3 5 Sonnet 20241022"
  const formattedName = modelId
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  return { name: formattedName, icon: getModelIcon(modelId) }
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
