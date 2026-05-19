/**
 * Prompt Context Utilities
 *
 * Runtime context extraction for system prompt building:
 * - Git status (branch, commits, status)
 * - Current date
 */

import { execSync } from 'child_process'

/**
 * Git status information
 */
export interface GitStatus {
  /** Current branch name */
  branch: string | null
  /** Main/master branch name */
  mainBranch: string | null
  /** Git user name */
  user: string | null
  /** Short status output */
  status: string | null
  /** Recent commits (oneline format) */
  recentCommits: string | null
}

/**
 * Execute git command safely
 *
 * @param cmd - Git command to execute
 * @param cwd - Working directory
 * @param timeoutMs - Command timeout in milliseconds
 * @returns Command output or null if failed
 */
function gitExec(cmd: string, cwd: string, timeoutMs = 5000): string | null {
  try {
    return execSync(cmd, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Detect the main branch name (main or master)
 */
function detectMainBranch(cwd: string): string | null {
  try {
    const branches = execSync('git branch -l main master', {
      cwd,
      timeout: 3000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (branches.includes('main')) return 'main'
    if (branches.includes('master')) return 'master'
    return null
  } catch {
    return null
  }
}

/**
 * Check if directory is a git repository
 */
export function isGitRepo(cwd: string): boolean {
  return gitExec('git rev-parse --git-dir', cwd) !== null
}

/**
 * Get detailed git status information
 *
 * @param cwd - Working directory
 * @returns Git status object
 */
export function getGitStatusDetails(cwd: string): GitStatus {
  if (!isGitRepo(cwd)) {
    return {
      branch: null,
      mainBranch: null,
      user: null,
      status: null,
      recentCommits: null,
    }
  }

  const branch = gitExec('git rev-parse --abbrev-ref HEAD', cwd)
  const mainBranch = detectMainBranch(cwd)
  const user = gitExec('git config user.name', cwd, 3000)

  // Get status (limit output to prevent huge diffs)
  let status = gitExec('git status --short', cwd)
  if (status && status.length > 2000) {
    status = status.slice(0, 2000) + '\n...(truncated)'
  }

  // Get recent commits (only if HEAD exists)
  let recentCommits: string | null = null
  const hasHead = gitExec('git rev-parse HEAD', cwd)
  if (hasHead) {
    recentCommits = gitExec('git log --oneline -5 --no-decorate', cwd)
  }

  return {
    branch,
    mainBranch,
    user,
    status,
    recentCommits,
  }
}

/**
 * Format git status for system prompt
 *
 * @param cwd - Working directory
 * @returns Formatted git status string or empty string if not a git repo
 */
export function getGitStatus(cwd: string): string {
  const info = getGitStatusDetails(cwd)

  if (!info.branch) {
    return ''
  }

  const parts: string[] = []

  if (info.branch) {
    parts.push(`Current branch: ${info.branch}`)
  }
  if (info.mainBranch) {
    parts.push(`Main branch: ${info.mainBranch}`)
  }
  if (info.user) {
    parts.push(`Git user: ${info.user}`)
  }
  if (info.status) {
    parts.push(`Status:\n${info.status}`)
  }
  if (info.recentCommits) {
    parts.push(`Recent commits:\n${info.recentCommits}`)
  }

  return parts.join('\n\n')
}

/**
 * Get current date in YYYY-MM-DD format
 */
/**
 * Get current date in YYYY-MM-DD format (local timezone)
 */
export function getCurrentDate(): string {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
