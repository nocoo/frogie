import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb, runMigrations, createWorkspace } from '../db'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import { upsertWorkspacePrompt, updateGlobalPrompt } from '../db'
import {
  buildSystemPrompt,
  resolveTemplate,
  formatToolDescriptions,
  estimateTokens,
  type PromptContext,
} from './prompt-builder'
import type { PromptLayerConfig } from '../db/repositories/prompts'
import type { Workspace } from '../db/types'
import type { ToolDefinition } from './frogie-agent'

describe('engine/prompt-builder', () => {
  let testDbPath: string
  let workspace: Workspace

  beforeEach(() => {
    testDbPath = getTestDbPath()
    const db = initDb(testDbPath)
    runMigrations(db)
    workspace = createWorkspace(db, {
      name: 'Test',
      path: '/Users/test/project',
    })
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
  })

  describe('formatToolDescriptions', () => {
    it('should format empty tools array', () => {
      const result = formatToolDescriptions([])
      expect(result).toBe('(No tools available)')
    })

    it('should format single tool', () => {
      const tools: ToolDefinition[] = [
        { name: 'Read', description: 'Read a file from disk' },
      ]
      const result = formatToolDescriptions(tools)
      expect(result).toBe('- **Read**: Read a file from disk')
    })

    it('should format multiple tools', () => {
      const tools: ToolDefinition[] = [
        { name: 'Read', description: 'Read a file' },
        { name: 'Write', description: 'Write a file' },
        { name: 'Bash', description: 'Execute shell commands' },
      ]
      const result = formatToolDescriptions(tools)
      expect(result).toContain('- **Read**: Read a file')
      expect(result).toContain('- **Write**: Write a file')
      expect(result).toContain('- **Bash**: Execute shell commands')
      expect(result.split('\n')).toHaveLength(3)
    })
  })

  describe('resolveTemplate', () => {
    const createContext = (overrides?: Partial<PromptContext>): PromptContext => ({
      workspace,
      tools: [],
      date: '2026-04-06',
      ...overrides,
    })

    it('should replace {{cwd}} with workspace path', () => {
      const layer: PromptLayerConfig = {
        layer: 'working_directory',
        content: 'Working in {{cwd}}',
        enabled: true,
        isGlobal: true,
        isTemplate: true,
      }
      const result = resolveTemplate(layer, createContext())
      expect(result).toBe('Working in /Users/test/project')
    })

    it('should replace {{date}} with current date', () => {
      const layer: PromptLayerConfig = {
        layer: 'date_context',
        content: 'Today is {{date}}.',
        enabled: true,
        isGlobal: true,
        isTemplate: true,
      }
      const result = resolveTemplate(layer, createContext())
      expect(result).toBe('Today is 2026-04-06.')
    })

    it('should replace {{git_status}} with git status', () => {
      const layer: PromptLayerConfig = {
        layer: 'git_context',
        content: '# Git\n{{git_status}}',
        enabled: true,
        isGlobal: true,
        isTemplate: true,
      }
      const result = resolveTemplate(
        layer,
        createContext({ gitStatus: 'On branch main\nnothing to commit' })
      )
      expect(result).toBe('# Git\nOn branch main\nnothing to commit')
    })

    it('should replace {{git_status}} with empty string when undefined', () => {
      const layer: PromptLayerConfig = {
        layer: 'git_context',
        content: 'Git: {{git_status}}',
        enabled: true,
        isGlobal: true,
        isTemplate: true,
      }
      const result = resolveTemplate(layer, createContext())
      expect(result).toBe('Git: ')
    })

    it('should replace {{tools}} with formatted tool list', () => {
      const tools: ToolDefinition[] = [
        { name: 'Read', description: 'Read files' },
        { name: 'Write', description: 'Write files' },
      ]
      const layer: PromptLayerConfig = {
        layer: 'tool_descriptions',
        content: '# Tools\n{{tools}}',
        enabled: true,
        isGlobal: true,
        isTemplate: true,
      }
      const result = resolveTemplate(layer, createContext({ tools }))
      expect(result).toContain('# Tools')
      expect(result).toContain('- **Read**: Read files')
      expect(result).toContain('- **Write**: Write files')
    })

    it('should handle multiple variables in one template', () => {
      const layer: PromptLayerConfig = {
        layer: 'identity',
        content: 'Date: {{date}}, CWD: {{cwd}}',
        enabled: true,
        isGlobal: true,
        isTemplate: true,
      }
      const result = resolveTemplate(layer, createContext())
      expect(result).toBe('Date: 2026-04-06, CWD: /Users/test/project')
    })

    it('should handle content without variables', () => {
      const layer: PromptLayerConfig = {
        layer: 'identity',
        content: 'You are a helpful assistant.',
        enabled: true,
        isGlobal: true,
        isTemplate: false,
      }
      const result = resolveTemplate(layer, createContext())
      expect(result).toBe('You are a helpful assistant.')
    })
  })

  describe('buildSystemPrompt', () => {
    it('should build prompt with all default layers', () => {
      const db = initDb(testDbPath)
      const context: PromptContext = {
        workspace,
        tools: [{ name: 'Read', description: 'Read files' }],
        date: '2026-04-06',
      }

      const prompt = buildSystemPrompt(db, context)

      // Should contain identity content (Claude Code style)
      expect(prompt).toContain('interactive agent')
      expect(prompt).toContain('software engineering tasks')
      // Should contain system rules
      expect(prompt).toContain('Github-flavored markdown')
      // Should contain tool descriptions
      expect(prompt).toContain('- **Read**: Read files')
      // Should contain date
      expect(prompt).toContain('2026-04-06')
      // Should contain cwd
      expect(prompt).toContain('/Users/test/project')
    })

    it('should exclude disabled layers', () => {
      const db = initDb(testDbPath)

      // Disable git_context globally
      updateGlobalPrompt(db, 'git_context', { enabled: false })

      const context: PromptContext = {
        workspace,
        tools: [],
        gitStatus: 'On branch main',
        date: '2026-04-06',
      }

      const prompt = buildSystemPrompt(db, context)

      // Should NOT contain git status header
      expect(prompt).not.toContain('# Git Status')
    })

    it('should use workspace overrides', () => {
      const db = initDb(testDbPath)

      // Override identity for this workspace
      upsertWorkspacePrompt(db, workspace.id, 'identity', {
        content: 'You are a coding expert specialized in TypeScript.',
      })

      const context: PromptContext = {
        workspace,
        tools: [],
        date: '2026-04-06',
      }

      const prompt = buildSystemPrompt(db, context)

      expect(prompt).toContain('TypeScript')
      expect(prompt).not.toContain('AI assistant with access to tools')
    })

    it('should filter out empty content layers', () => {
      const db = initDb(testDbPath)

      const context: PromptContext = {
        workspace,
        tools: [],
        date: '2026-04-06',
      }

      const prompt = buildSystemPrompt(db, context)

      // project_instructions is empty by default
      // git_context with empty gitStatus will be filtered out
      // We check that there are no instances of 4+ consecutive newlines
      const badSeparators = prompt.match(/\n{4,}/g)
      expect(badSeparators).toBeNull()
    })

    it('should join layers with double newline', () => {
      const db = initDb(testDbPath)

      const context: PromptContext = {
        workspace,
        tools: [{ name: 'Test', description: 'Test tool' }],
        date: '2026-04-06',
      }

      const prompt = buildSystemPrompt(db, context)

      // Each layer should be separated by exactly two newlines
      expect(prompt).toContain('\n\n')
    })
  })

  describe('estimateTokens', () => {
    it('should estimate tokens for short text', () => {
      const tokens = estimateTokens('Hello world')
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(10)
    })

    it('should estimate tokens for longer text', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10)
      const tokens = estimateTokens(text)
      // ~450 chars / 4 ≈ 113 tokens
      expect(tokens).toBeGreaterThan(100)
      expect(tokens).toBeLessThan(150)
    })

    it('should return 0 for empty string', () => {
      const tokens = estimateTokens('')
      expect(tokens).toBe(0)
    })
  })
})
