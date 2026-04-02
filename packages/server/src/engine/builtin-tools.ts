/**
 * Built-in Tools
 *
 * Core tools that are always available to agents.
 * These provide basic file system and shell operations.
 */

import { spawn } from 'node:child_process'
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises'
import { join, dirname, isAbsolute } from 'node:path'
import type { ToolDefinition, ToolExecutor } from './frogie-agent'

/**
 * Built-in tool definitions
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the specified path.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to read (relative to workspace)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file at the specified path. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to write (relative to workspace)',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories at the specified path.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list (relative to workspace, defaults to ".")',
        },
      },
      required: [],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command in the workspace directory. Use for running tests, builds, git commands, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for files matching a glob pattern in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match (e.g., "**/*.ts", "src/**/*.tsx")',
        },
      },
      required: ['pattern'],
    },
  },
]

/**
 * Resolve path safely within workspace
 */
function resolvePath(cwd: string, path: string): string {
  if (isAbsolute(path)) {
    // Check if absolute path is within workspace
    if (!path.startsWith(cwd)) {
      throw new Error(`Path must be within workspace: ${path}`)
    }
    return path
  }
  return join(cwd, path)
}

/**
 * Execute a shell command
 */
async function executeCommand(
  command: string,
  cwd: string,
  timeout: number,
  abortSignal?: AbortSignal
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      })
    })

    child.on('error', (err) => {
      reject(err)
    })

    // Handle abort signal
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        child.kill('SIGTERM')
        reject(new Error('Command aborted'))
      })
    }
  })
}

/**
 * Simple glob matching using find command
 */
async function globFiles(pattern: string, cwd: string): Promise<string[]> {
  const { stdout } = await executeCommand(
    `find . -name "${pattern.replace(/\*\*/g, '*')}" -type f 2>/dev/null | head -100`,
    cwd,
    10000
  )
  return stdout.trim().split('\n').filter(Boolean)
}

/**
 * Create a tool executor for the built-in tools
 */
export function createBuiltinToolExecutor(cwd: string): ToolExecutor {
  return async (name: string, input: unknown, abortSignal?: AbortSignal) => {
    try {
      const params = input as Record<string, unknown>

      switch (name) {
        case 'read_file': {
          const path = resolvePath(cwd, params['path'] as string)
          const content = await readFile(path, 'utf-8')
          return { output: content, isError: false }
        }

        case 'write_file': {
          const path = resolvePath(cwd, params['path'] as string)
          const content = params['content'] as string
          // Create parent directories if needed
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, content, 'utf-8')
          return { output: `File written: ${path}`, isError: false }
        }

        case 'list_files': {
          const dirPath = resolvePath(cwd, (params['path'] as string | undefined) ?? '.')
          const entries = await readdir(dirPath)
          const results: string[] = []

          for (const entry of entries) {
            const entryPath = join(dirPath, entry)
            const stats = await stat(entryPath)
            results.push(`${stats.isDirectory() ? 'd' : '-'} ${entry}`)
          }

          return { output: results.join('\n'), isError: false }
        }

        case 'run_command': {
          const command = params['command'] as string
          const timeout = (params['timeout'] as number | undefined) ?? 30000

          const result = await executeCommand(command, cwd, timeout, abortSignal)

          let output = ''
          if (result.stdout) output += result.stdout
          if (result.stderr) output += `\n[stderr]\n${result.stderr}`
          output += `\n[exit code: ${String(result.exitCode)}]`

          return {
            output: output.trim(),
            isError: result.exitCode !== 0,
          }
        }

        case 'search_files': {
          const pattern = params['pattern'] as string
          const files = await globFiles(pattern, cwd)
          return {
            output: files.length > 0 ? files.join('\n') : 'No files found',
            isError: false,
          }
        }

        default:
          return { output: `Unknown tool: ${name}`, isError: true }
      }
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : 'Unknown error',
        isError: true,
      }
    }
  }
}
