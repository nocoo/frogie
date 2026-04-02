# 04 - Tool System

## Overview

Frogie's tool system is directly inspired by Claude Code CLI's design. The key insight is that **tool prompts are the core value** - detailed instructions that guide the LLM on how to use each tool effectively.

## Tool Definition

### Structure

```typescript
// packages/server/src/tools/types.ts

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JSONSchema
  
  // Core execution
  call(input: unknown, context: ToolContext): Promise<ToolOutput>
  
  // System prompt for this tool
  prompt(): Promise<string>
  
  // Behavior hints
  isReadOnly?(input: unknown): boolean       // Can run concurrently
  isConcurrencySafe?(input: unknown): boolean
  isEnabled?(): boolean
}

export interface ToolContext {
  cwd: string                    // Workspace root
  abortSignal?: AbortSignal      // For cancellation
}

export type ToolOutput = string | { data: string, isError?: boolean }
```

### Tool Builder

```typescript
// packages/server/src/tools/define-tool.ts

export function defineTool<T>(def: ToolDef<T>): ToolDefinition {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    
    async call(input: T, context: ToolContext) {
      return def.call(input, context)
    },
    
    async prompt() {
      return def.prompt?.() ?? def.description
    },
    
    isReadOnly: def.isReadOnly ?? (() => false),
    isConcurrencySafe: def.isConcurrencySafe ?? (() => false),
    isEnabled: def.isEnabled ?? (() => true),
  }
}
```

## Built-in Tools

### Tool Registry

```typescript
// packages/server/src/tools/index.ts

import { BashTool } from './bash'
import { ReadTool } from './read'
import { WriteTool } from './write'
import { EditTool } from './edit'
import { GlobTool } from './glob'
import { GrepTool } from './grep'
// ... more tools

export const BUILTIN_TOOLS: ToolDefinition[] = [
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  // ... more
]

export function getToolDefinition(name: string): ToolDefinition | undefined {
  // Handle MCP tool names
  if (name.startsWith('mcp__')) {
    return undefined  // MCP tools handled separately
  }
  return BUILTIN_TOOLS.find(t => t.name === name)
}
```

### Core Tools

#### Bash Tool

```typescript
// packages/server/src/tools/bash.ts

export const BashTool = defineTool({
  name: 'Bash',
  description: 'Execute a bash command and return its output.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (max 600000)' },
    },
    required: ['command'],
  },
  
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  
  async call(input, context) {
    const { command, timeout = 120000 } = input
    const timeoutMs = Math.min(timeout, 600000)
    
    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', command], {
        cwd: context.cwd,
        timeout: timeoutMs,
      })
      
      let stdout = '', stderr = ''
      proc.stdout.on('data', (d) => stdout += d)
      proc.stderr.on('data', (d) => stderr += d)
      
      if (context.abortSignal) {
        context.abortSignal.addEventListener('abort', () => proc.kill('SIGTERM'))
      }
      
      proc.on('close', (code) => {
        let output = stdout + (stderr ? '\n' + stderr : '')
        if (code !== 0) output += `\nExit code: ${code}`
        
        // Truncate large outputs
        if (output.length > 100000) {
          output = output.slice(0, 50000) + '\n...(truncated)...\n' + output.slice(-50000)
        }
        
        resolve(output || '(no output)')
      })
    })
  },
  
  prompt: () => BASH_PROMPT,
})
```

#### Read Tool

Following Claude Code's defensive patterns (`FileReadTool.ts:96`), the Read tool handles:
- Path expansion (~ → home, symlink resolution)
- Device file rejection (/dev/*, /proc/*)
- Size limits to prevent memory exhaustion
- Similar path hints when file not found

```typescript
// packages/server/src/tools/read.ts

import { resolvePath, isDevicePath, findSimilarPaths, formatWithLineNumbers } from './utils'

const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10MB
const MAX_LINES = 2000

export const ReadTool = defineTool({
  name: 'Read',
  description: 'Read a file from the filesystem.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      offset: { type: 'number', description: 'Line number to start from (0-based)' },
      limit: { type: 'number', description: 'Number of lines to read' },
    },
    required: ['file_path'],
  },
  
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  
  async call(input, context) {
    const { file_path, offset = 0, limit = MAX_LINES } = input
    
    // Resolve path (expand ~, resolve symlinks, handle relative)
    const fullPath = resolvePath(file_path, context.cwd)
    
    // Reject device files
    if (isDevicePath(fullPath)) {
      return { data: `Error: Cannot read device file: ${file_path}`, isError: true }
    }
    
    try {
      // Check file size before reading
      const stat = await Bun.file(fullPath).stat()
      if (stat.size > MAX_FILE_SIZE) {
        return {
          data: `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
          isError: true,
        }
      }
      
      const content = await Bun.file(fullPath).text()
      const lines = content.split('\n')
      const selected = lines.slice(offset, offset + Math.min(limit, MAX_LINES))
      
      return formatWithLineNumbers(selected, offset)
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Find similar paths to help LLM recover
        const similar = await findSimilarPaths(file_path, context.cwd)
        let msg = `Error: File not found: ${file_path}`
        if (similar.length > 0) {
          msg += `\n\nDid you mean:\n${similar.map(p => `  - ${p}`).join('\n')}`
        }
        return { data: msg, isError: true }
      }
      if (err.code === 'EACCES') {
        return { data: `Error: Permission denied: ${file_path}`, isError: true }
      }
      throw err
    }
  },
  
  prompt: () => READ_PROMPT,
})
```

#### Edit Tool

Following Claude Code's defensive patterns (`FileEditTool.ts:137`), the Edit tool handles:
- File existence validation before edit
- Uniqueness check for old_string
- Diff feedback showing what changed

```typescript
// packages/server/src/tools/edit.ts

import { resolvePath, createDiff } from './utils'

export const EditTool = defineTool({
  name: 'Edit',
  description: 'Perform exact string replacement in a file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      old_string: { type: 'string', description: 'Exact text to find' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  
  async call(input, context) {
    const { file_path, old_string, new_string, replace_all } = input
    const fullPath = resolvePath(file_path, context.cwd)
    
    if (old_string === new_string) {
      return { data: 'Error: old_string and new_string are identical', isError: true }
    }
    
    // Read original content
    let content: string
    try {
      content = await Bun.file(fullPath).text()
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { data: `Error: File not found: ${file_path}`, isError: true }
      }
      throw err
    }
    
    if (!content.includes(old_string)) {
      return { data: `Error: old_string not found in ${file_path}`, isError: true }
    }
    
    // Check uniqueness
    const occurrences = content.split(old_string).length - 1
    if (!replace_all && occurrences > 1) {
      return {
        data: `Error: old_string appears ${occurrences} times. Provide more context or set replace_all: true.`,
        isError: true,
      }
    }
    
    // Perform replacement
    const originalContent = content
    content = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string)
    
    // Write and return diff feedback
    await Bun.write(fullPath, content)
    
    const diff = createDiff(originalContent, content, file_path)
    return `File edited: ${file_path}\n\n${diff}`
  },
  
  prompt: () => EDIT_PROMPT,
})
```

## Tool Prompts (Core Value)

The detailed prompts are the heart of Claude Code's effectiveness. These will be ported from Claude Code CLI.

### Bash Prompt

```typescript
// packages/server/src/tools/prompts/bash.ts

export const BASH_PROMPT = `Executes a given bash command and returns its output.

IMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed. Instead, use the appropriate dedicated tool:
 - File search: Use Glob (NOT find or ls)
 - Content search: Use Grep (NOT grep or rg)
 - Read files: Use Read (NOT cat/head/tail)
 - Edit files: Use Edit (NOT sed/awk)
 - Write files: Use Write (NOT echo >/cat <<EOF)

# Instructions
 - Always quote file paths that contain spaces with double quotes
 - Try to maintain your current working directory by using absolute paths
 - When issuing multiple commands:
   - If commands are independent, make multiple Bash tool calls in parallel
   - If commands depend on each other, use && to chain them
 - You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes)

# Git Commands
 - NEVER update the git config
 - NEVER run destructive git commands (push --force, reset --hard) unless explicitly requested
 - NEVER skip hooks (--no-verify) unless explicitly requested
 - Prefer creating NEW commits rather than amending

# Creating Pull Requests
 - Use \`gh pr create\` with proper title and body
 - Include a summary and test plan in the body`
```

### Read Prompt

```typescript
// packages/server/src/tools/prompts/read.ts

export const READ_PROMPT = `Reads a file from the local filesystem.

Usage:
- The file_path parameter should be an absolute path
- Relative paths are resolved from the workspace root
- By default, reads up to 2000 lines starting from the beginning
- When you already know which part of the file you need, only read that part
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can read images (PNG, JPG, etc.) - contents are presented visually
- This tool can read PDF files. For large PDFs (>10 pages), use the pages parameter
- This tool can only read files, not directories. Use ls via Bash for directories`
```

### Edit Prompt

```typescript
// packages/server/src/tools/prompts/edit.ts

export const EDIT_PROMPT = `Performs exact string replacements in files.

Usage:
- The file_path parameter should be an absolute path (same as Read tool)
- Relative paths are resolved from the workspace root
- You MUST use the Read tool first before editing. This tool will fail if you haven't read the file.
- When editing text from Read output, preserve exact indentation as it appears AFTER the line number prefix
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- The edit will FAIL if old_string is not unique. Provide more context or use replace_all.
- Use replace_all for renaming variables across the file.`
```

## Tool Pool Assembly

Following Claude Code CLI's pattern (`src/tools.ts:354`), tool pool assembly uses **built-in-first precedence** with `uniqBy` to resolve name conflicts:

```typescript
// packages/server/src/tools/pool.ts

import { uniqBy } from 'lodash-es'

export interface ToolPoolConfig {
  builtinTools: ToolDefinition[]
  mcpTools: ToolDefinition[]
  denyRules?: DenyRule[]           // Workspace-level deny patterns
  allowedTools?: string[]          // Explicit allowlist (if set, only these)
}

export interface DenyRule {
  pattern: string | RegExp         // Tool name pattern to deny
  reason?: string                  // Why denied (for error messages)
}

/**
 * Assemble final tool pool with Claude Code-style precedence:
 * 1. Apply deny rules to MCP tools first
 * 2. Sort built-in tools by name (stable for prompt cache)
 * 3. Sort allowed MCP tools by name
 * 4. Concat: built-in first, then MCP
 * 5. uniqBy('name') — preserves first occurrence, so BUILT-IN WINS on conflict
 * 6. Apply allowlist filter (if set)
 * 
 * Key insight from Claude Code: built-ins are kept as a contiguous prefix
 * for prompt-cache stability. uniqBy preserves insertion order, so built-ins
 * win on name conflict (not MCP).
 */
export function assembleToolPool(config: ToolPoolConfig): ToolDefinition[] {
  const { builtinTools, mcpTools, denyRules = [], allowedTools } = config
  
  // Step 1: Filter MCP tools by deny rules
  const allowedMcpTools = mcpTools.filter(tool => {
    const denied = denyRules.find(rule => matchDenyRule(tool.name, rule))
    if (denied) {
      console.debug(`Tool ${tool.name} denied: ${denied.reason || 'workspace rule'}`)
      return false
    }
    return true
  })
  
  // Step 2-4: Sort each partition, concat built-in first
  const byName = (a: ToolDefinition, b: ToolDefinition) => a.name.localeCompare(b.name)
  const sorted = [
    ...builtinTools.slice().sort(byName),      // Built-in tools first
    ...allowedMcpTools.sort(byName),           // MCP tools after
  ]
  
  // Step 5: Deduplicate — uniqBy keeps FIRST occurrence, so built-in wins
  let tools = uniqBy(sorted, 'name')
  
  // Step 6: Apply allowlist (if set)
  if (allowedTools?.length) {
    const allowed = new Set(allowedTools)
    tools = tools.filter(t => allowed.has(t.name))
  }
  
  return tools
}

function matchDenyRule(name: string, rule: DenyRule): boolean {
  if (typeof rule.pattern === 'string') {
    return name === rule.pattern || name.startsWith(rule.pattern + '_')
  }
  return rule.pattern.test(name)
}
```

## Format for API

```typescript
// packages/server/src/tools/format.ts

// Convert to Anthropic tools format
export function formatToolsForAPI(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}
```

## Future: Skill System

Skills are user-defined prompt templates that extend agent capabilities. This will be implemented in a future version, following Claude Code CLI's pattern.

```typescript
// Future: packages/server/src/skills/types.ts

interface Skill {
  name: string
  description: string
  whenToUse?: string
  allowedTools?: string[]
  
  // Returns prompt content to inject
  getPrompt(args: string, context: ToolContext): Promise<string>
}
```
