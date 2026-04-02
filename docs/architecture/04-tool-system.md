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

```typescript
// packages/server/src/tools/read.ts

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
    const { file_path, offset = 0, limit = 2000 } = input
    // Note: No path restriction - Frogie runs with full user permissions like Claude Code CLI
    // Absolute paths are used directly, relative paths resolve from workspace cwd
    const fullPath = isAbsolute(file_path) ? file_path : resolve(context.cwd, file_path)
    
    try {
      const content = await readFile(fullPath, 'utf-8')
      const lines = content.split('\n')
      const selected = lines.slice(offset, offset + limit)
      
      // Format with line numbers (cat -n style)
      return selected
        .map((line, i) => `${(offset + i + 1).toString().padStart(6)}\t${line}`)
        .join('\n')
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { data: `Error: File not found: ${file_path}`, isError: true }
      }
      throw err
    }
  },
  
  prompt: () => READ_PROMPT,
})
```

#### Edit Tool

```typescript
// packages/server/src/tools/edit.ts

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
    const fullPath = resolve(context.cwd, file_path)
    
    if (old_string === new_string) {
      return { data: 'Error: old_string and new_string are identical', isError: true }
    }
    
    let content = await readFile(fullPath, 'utf-8')
    
    if (!content.includes(old_string)) {
      return { data: `Error: old_string not found in ${file_path}`, isError: true }
    }
    
    if (!replace_all) {
      const count = content.split(old_string).length - 1
      if (count > 1) {
        return {
          data: `Error: old_string appears ${count} times. Provide more context or set replace_all: true.`,
          isError: true,
        }
      }
      content = content.replace(old_string, new_string)
    } else {
      content = content.split(old_string).join(new_string)
    }
    
    await writeFile(fullPath, content, 'utf-8')
    return `File edited: ${file_path}`
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
- The file_path parameter must be an absolute path, not relative
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
- You MUST use the Read tool first before editing. This tool will fail if you haven't read the file.
- When editing text from Read output, preserve exact indentation as it appears AFTER the line number prefix
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- The edit will FAIL if old_string is not unique. Provide more context or use replace_all.
- Use replace_all for renaming variables across the file.`
```

## Tool Pool Assembly

```typescript
// packages/server/src/tools/pool.ts

export function assembleToolPool(
  builtinTools: ToolDefinition[],
  mcpTools: ToolDefinition[],
  options?: { allowedTools?: string[], disallowedTools?: string[] }
): ToolDefinition[] {
  
  // Combine built-in and MCP tools
  let tools = [...builtinTools, ...mcpTools]
  
  // Deduplicate by name (MCP tools can override built-in)
  const byName = new Map<string, ToolDefinition>()
  for (const tool of tools) {
    byName.set(tool.name, tool)
  }
  tools = Array.from(byName.values())
  
  // Apply allow/deny filters
  if (options?.allowedTools?.length) {
    const allowed = new Set(options.allowedTools)
    tools = tools.filter(t => allowed.has(t.name))
  }
  
  if (options?.disallowedTools?.length) {
    const disallowed = new Set(options.disallowedTools)
    tools = tools.filter(t => !disallowed.has(t.name))
  }
  
  return tools
}
```

## Format for API

```typescript
// packages/server/src/tools/format.ts

// Convert to OpenAI tools format
export function formatToolsForAPI(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
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
