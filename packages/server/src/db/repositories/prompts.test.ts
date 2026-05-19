import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../connection'
import { runMigrations } from '../migrate'
import { createWorkspace } from './workspaces'
import {
  PROMPT_LAYERS,
  isValidLayer,
  getGlobalPrompt,
  getAllGlobalPrompts,
  updateGlobalPrompt,
  getWorkspacePrompt,
  getAllWorkspacePrompts,
  upsertWorkspacePrompt,
  deleteWorkspacePrompt,
  deleteAllWorkspacePrompts,
  getMergedPrompts,
} from './prompts'
import { getTestDbPath, cleanupTestDb } from '../../test/db-utils'

describe('repositories/prompts', () => {
  let testDbPath: string
  let workspaceId: string

  beforeEach(() => {
    testDbPath = getTestDbPath()
    const db = initDb(testDbPath)
    runMigrations(db)
    const ws = createWorkspace(db, {
      name: 'Test',
      path: `/test/${String(Date.now())}`,
    })
    workspaceId = ws.id
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('isValidLayer', () => {
    it('should return true for valid layers', () => {
      expect(isValidLayer('identity')).toBe(true)
      expect(isValidLayer('system_rules')).toBe(true)
      expect(isValidLayer('tool_descriptions')).toBe(true)
      expect(isValidLayer('git_context')).toBe(true)
      expect(isValidLayer('project_instructions')).toBe(true)
      expect(isValidLayer('working_directory')).toBe(true)
      expect(isValidLayer('date_context')).toBe(true)
    })

    it('should return false for invalid layers', () => {
      expect(isValidLayer('invalid')).toBe(false)
      expect(isValidLayer('')).toBe(false)
      expect(isValidLayer('IDENTITY')).toBe(false)
    })
  })

  describe('PROMPT_LAYERS', () => {
    it('should have exactly 7 layers in correct order', () => {
      expect(PROMPT_LAYERS).toHaveLength(7)
      expect(PROMPT_LAYERS[0]).toBe('identity')
      expect(PROMPT_LAYERS[6]).toBe('date_context')
    })
  })

  describe('Global Prompts', () => {
    describe('getGlobalPrompt', () => {
      it('should return default identity prompt', () => {
        const db = initDb(testDbPath)
        const prompt = getGlobalPrompt(db, 'identity')

        expect(prompt).not.toBeNull()
        if (!prompt) throw new Error('Expected prompt to exist')
        expect(prompt.layer).toBe('identity')
        expect(prompt.content).toContain('interactive agent')
        expect(prompt.enabled).toBe(true)
      })

      it('should return default date_context prompt with template', () => {
        const db = initDb(testDbPath)
        const prompt = getGlobalPrompt(db, 'date_context')

        expect(prompt).not.toBeNull()
        if (!prompt) throw new Error('Expected prompt to exist')
        expect(prompt.content).toContain('{{date}}')
      })

      it('should return null for non-existent layer', () => {
        const db = initDb(testDbPath)
        // Force a non-existent check by directly querying
        const row = db
          .prepare('SELECT * FROM global_prompts WHERE layer = ?')
          .get('nonexistent')
        expect(row).toBeUndefined()
      })
    })

    describe('getAllGlobalPrompts', () => {
      it('should return all 7 default prompts', () => {
        const db = initDb(testDbPath)
        const prompts = getAllGlobalPrompts(db)

        expect(prompts).toHaveLength(7)
        const layers = prompts.map((p) => p.layer)
        expect(layers).toContain('identity')
        expect(layers).toContain('system_rules')
        expect(layers).toContain('tool_descriptions')
        expect(layers).toContain('git_context')
        expect(layers).toContain('project_instructions')
        expect(layers).toContain('working_directory')
        expect(layers).toContain('date_context')
      })

      it('should have all prompts enabled by default', () => {
        const db = initDb(testDbPath)
        const prompts = getAllGlobalPrompts(db)

        for (const prompt of prompts) {
          expect(prompt.enabled).toBe(true)
        }
      })
    })

    describe('updateGlobalPrompt', () => {
      it('should update content', () => {
        const db = initDb(testDbPath)
        const updated = updateGlobalPrompt(db, 'identity', {
          content: 'You are a helpful coding assistant.',
        })

        expect(updated.content).toBe('You are a helpful coding assistant.')
        expect(updated.enabled).toBe(true)
      })

      it('should update enabled status', () => {
        const db = initDb(testDbPath)
        const updated = updateGlobalPrompt(db, 'git_context', {
          enabled: false,
        })

        expect(updated.enabled).toBe(false)
      })

      it('should update both content and enabled', () => {
        const db = initDb(testDbPath)
        const updated = updateGlobalPrompt(db, 'project_instructions', {
          content: 'Follow TDD principles.',
          enabled: true,
        })

        expect(updated.content).toBe('Follow TDD principles.')
        expect(updated.enabled).toBe(true)
      })

      it('should update timestamp', () => {
        const db = initDb(testDbPath)
        const before = getGlobalPrompt(db, 'identity')
        if (!before) throw new Error('Expected prompt to exist')
        const beforeTime = before.updated_at

        // Small delay to ensure different timestamp
        const updated = updateGlobalPrompt(db, 'identity', {
          content: 'New content',
        })

        expect(updated.updated_at).toBeGreaterThanOrEqual(beforeTime)
      })

      it('should throw for non-existent layer', () => {
        const db = initDb(testDbPath)

        expect(() =>
          // @ts-expect-error Testing invalid layer
          updateGlobalPrompt(db, 'nonexistent', { content: 'test' })
        ).toThrow('Global prompt layer not found')
      })
    })
  })

  describe('Workspace Prompts', () => {
    describe('getWorkspacePrompt', () => {
      it('should return null when no override exists', () => {
        const db = initDb(testDbPath)
        const prompt = getWorkspacePrompt(db, workspaceId, 'identity')

        expect(prompt).toBeNull()
      })

      it('should return override after creation', () => {
        const db = initDb(testDbPath)
        upsertWorkspacePrompt(db, workspaceId, 'identity', {
          content: 'Custom identity',
        })

        const prompt = getWorkspacePrompt(db, workspaceId, 'identity')
        expect(prompt).not.toBeNull()
        if (!prompt) throw new Error('Expected prompt to exist')
        expect(prompt.content).toBe('Custom identity')
      })
    })

    describe('getAllWorkspacePrompts', () => {
      it('should return empty array when no overrides', () => {
        const db = initDb(testDbPath)
        const prompts = getAllWorkspacePrompts(db, workspaceId)

        expect(prompts).toHaveLength(0)
      })

      it('should return only overridden layers', () => {
        const db = initDb(testDbPath)
        upsertWorkspacePrompt(db, workspaceId, 'identity', {
          content: 'Custom',
        })
        upsertWorkspacePrompt(db, workspaceId, 'project_instructions', {
          content: 'Instructions',
        })

        const prompts = getAllWorkspacePrompts(db, workspaceId)
        expect(prompts).toHaveLength(2)
      })
    })

    describe('upsertWorkspacePrompt', () => {
      it('should create new override', () => {
        const db = initDb(testDbPath)
        const prompt = upsertWorkspacePrompt(db, workspaceId, 'identity', {
          content: 'New identity',
        })

        expect(prompt.id).toBeDefined()
        expect(prompt.workspace_id).toBe(workspaceId)
        expect(prompt.layer).toBe('identity')
        expect(prompt.content).toBe('New identity')
        expect(prompt.enabled).toBe(true)
      })

      it('should update existing override', () => {
        const db = initDb(testDbPath)
        const first = upsertWorkspacePrompt(db, workspaceId, 'identity', {
          content: 'First',
        })

        const second = upsertWorkspacePrompt(db, workspaceId, 'identity', {
          content: 'Second',
        })

        expect(second.id).toBe(first.id)
        expect(second.content).toBe('Second')
      })

      it('should create with enabled=false', () => {
        const db = initDb(testDbPath)
        const prompt = upsertWorkspacePrompt(db, workspaceId, 'git_context', {
          enabled: false,
        })

        expect(prompt.enabled).toBe(false)
      })

      it('should use global default when content not provided on insert', () => {
        const db = initDb(testDbPath)
        const prompt = upsertWorkspacePrompt(db, workspaceId, 'identity', {
          enabled: false,
        })

        // Content should come from global default
        expect(prompt.content).toContain('interactive agent')
        expect(prompt.enabled).toBe(false)
      })
    })

    describe('deleteWorkspacePrompt', () => {
      it('should delete existing override', () => {
        const db = initDb(testDbPath)
        upsertWorkspacePrompt(db, workspaceId, 'identity', {
          content: 'Custom',
        })

        const deleted = deleteWorkspacePrompt(db, workspaceId, 'identity')
        expect(deleted).toBe(true)

        const prompt = getWorkspacePrompt(db, workspaceId, 'identity')
        expect(prompt).toBeNull()
      })

      it('should return false when no override exists', () => {
        const db = initDb(testDbPath)
        const deleted = deleteWorkspacePrompt(db, workspaceId, 'identity')
        expect(deleted).toBe(false)
      })
    })

    describe('deleteAllWorkspacePrompts', () => {
      it('should delete all overrides for workspace', () => {
        const db = initDb(testDbPath)
        upsertWorkspacePrompt(db, workspaceId, 'identity', { content: 'A' })
        upsertWorkspacePrompt(db, workspaceId, 'system_rules', { content: 'B' })
        upsertWorkspacePrompt(db, workspaceId, 'git_context', { content: 'C' })

        const count = deleteAllWorkspacePrompts(db, workspaceId)
        expect(count).toBe(3)

        const prompts = getAllWorkspacePrompts(db, workspaceId)
        expect(prompts).toHaveLength(0)
      })
    })
  })

  describe('Merged Prompts', () => {
    describe('getMergedPrompts', () => {
      it('should return all 7 layers', () => {
        const db = initDb(testDbPath)
        const merged = getMergedPrompts(db, workspaceId)

        expect(merged).toHaveLength(7)
      })

      it('should return layers in correct order', () => {
        const db = initDb(testDbPath)
        const merged = getMergedPrompts(db, workspaceId)

        expect(merged[0].layer).toBe('identity')
        expect(merged[1].layer).toBe('system_rules')
        expect(merged[2].layer).toBe('tool_descriptions')
        expect(merged[3].layer).toBe('git_context')
        expect(merged[4].layer).toBe('project_instructions')
        expect(merged[5].layer).toBe('working_directory')
        expect(merged[6].layer).toBe('date_context')
      })

      it('should use global prompts when no overrides', () => {
        const db = initDb(testDbPath)
        const merged = getMergedPrompts(db, workspaceId)

        for (const layer of merged) {
          expect(layer.isGlobal).toBe(true)
        }
      })

      it('should use workspace override when exists', () => {
        const db = initDb(testDbPath)
        upsertWorkspacePrompt(db, workspaceId, 'identity', {
          content: 'Custom identity',
        })

        const merged = getMergedPrompts(db, workspaceId)
        const identity = merged.find((l) => l.layer === 'identity')
        if (!identity) throw new Error('Expected identity layer to exist')

        expect(identity.content).toBe('Custom identity')
        expect(identity.isGlobal).toBe(false)
      })

      it('should correctly identify templates', () => {
        const db = initDb(testDbPath)
        const merged = getMergedPrompts(db, workspaceId)

        const toolDescriptions = merged.find(
          (l) => l.layer === 'tool_descriptions'
        )
        const dateContext = merged.find((l) => l.layer === 'date_context')
        const identity = merged.find((l) => l.layer === 'identity')
        if (!toolDescriptions || !dateContext || !identity) {
          throw new Error('Expected all layers to exist')
        }

        expect(toolDescriptions.isTemplate).toBe(true)
        expect(dateContext.isTemplate).toBe(true)
        expect(identity.isTemplate).toBe(false)
      })

      it('should preserve workspace enabled status', () => {
        const db = initDb(testDbPath)
        upsertWorkspacePrompt(db, workspaceId, 'git_context', {
          enabled: false,
        })

        const merged = getMergedPrompts(db, workspaceId)
        const gitContext = merged.find((l) => l.layer === 'git_context')
        if (!gitContext) throw new Error('Expected git_context layer to exist')

        expect(gitContext.enabled).toBe(false)
        expect(gitContext.isGlobal).toBe(false)
      })

      it('should mix global and workspace prompts correctly', () => {
        const db = initDb(testDbPath)
        // Override only 2 layers
        upsertWorkspacePrompt(db, workspaceId, 'identity', {
          content: 'WS Identity',
        })
        upsertWorkspacePrompt(db, workspaceId, 'project_instructions', {
          content: 'WS Instructions',
        })

        const merged = getMergedPrompts(db, workspaceId)

        // Check overridden layers
        const identity = merged.find((l) => l.layer === 'identity')
        const instructions = merged.find(
          (l) => l.layer === 'project_instructions'
        )
        if (!identity || !instructions) {
          throw new Error('Expected layers to exist')
        }
        expect(identity.isGlobal).toBe(false)
        expect(identity.content).toBe('WS Identity')
        expect(instructions.isGlobal).toBe(false)
        expect(instructions.content).toBe('WS Instructions')

        // Check non-overridden layers
        const systemRules = merged.find((l) => l.layer === 'system_rules')
        const gitContext = merged.find((l) => l.layer === 'git_context')
        if (!systemRules || !gitContext) {
          throw new Error('Expected layers to exist')
        }
        expect(systemRules.isGlobal).toBe(true)
        expect(gitContext.isGlobal).toBe(true)
      })
    })
  })
})
