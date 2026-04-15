import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import {
  isGitRepo,
  getGitStatusDetails,
  getGitStatus,
  getCurrentDate,
} from './prompt-context'

describe('engine/prompt-context', () => {
  describe('getCurrentDate', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const date = getCurrentDate()
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should return today date', () => {
      const date = getCurrentDate()
      const now = new Date()
      const expected = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      expect(date).toBe(expected)
    })
  })

  describe('isGitRepo', () => {
    it('should return true for actual git repo', () => {
      // Current project is a git repo
      const result = isGitRepo(process.cwd())
      expect(result).toBe(true)
    })

    it('should return false for non-git directory', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'prompt-context-test-'))
      try {
        const result = isGitRepo(tempDir)
        expect(result).toBe(false)
      } finally {
        rmSync(tempDir, { recursive: true })
      }
    })
  })

  describe('getGitStatusDetails', () => {
    it('should return null values for non-git directory', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'prompt-context-test-'))
      try {
        const status = getGitStatusDetails(tempDir)
        expect(status.branch).toBeNull()
        expect(status.mainBranch).toBeNull()
        expect(status.user).toBeNull()
        expect(status.status).toBeNull()
        expect(status.recentCommits).toBeNull()
      } finally {
        rmSync(tempDir, { recursive: true })
      }
    })

    it('should return branch info for git repo', () => {
      // Use current project
      const status = getGitStatusDetails(process.cwd())
      expect(status.branch).not.toBeNull()
      expect(typeof status.branch).toBe('string')
    })

    it('should return git user for git repo', () => {
      const status = getGitStatusDetails(process.cwd())
      // User might be null if git config not set, but if set should be string
      if (status.user !== null) {
        expect(typeof status.user).toBe('string')
      }
    })
  })

  describe('getGitStatus', () => {
    it('should return empty string for non-git directory', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'prompt-context-test-'))
      try {
        const status = getGitStatus(tempDir)
        expect(status).toBe('')
      } finally {
        rmSync(tempDir, { recursive: true })
      }
    })

    it('should return formatted status for git repo', () => {
      const status = getGitStatus(process.cwd())
      expect(status).toContain('Current branch:')
    })

    it('should include git user if configured', () => {
      const status = getGitStatus(process.cwd())
      const details = getGitStatusDetails(process.cwd())
      if (details.user) {
        expect(status).toContain('Git user:')
      }
    })

    it('should handle fresh git repo without commits', { timeout: 15000 }, () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'prompt-context-test-'))
      try {
        // Initialize a fresh git repo
        execSync('git init', { cwd: tempDir, stdio: 'pipe' })
        execSync('git config user.email "test@test.com"', {
          cwd: tempDir,
          stdio: 'pipe',
        })
        execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' })

        // Verify it's detected as git repo
        expect(isGitRepo(tempDir)).toBe(true)

        // Verify getGitStatus returns something (even if empty for fresh repo)
        const status = getGitStatus(tempDir)
        expect(typeof status).toBe('string')

        const details = getGitStatusDetails(tempDir)

        // Fresh repo might have empty status (no commits = no proper HEAD)
        // Branch might be "main" or "master" or null depending on git version
        expect(details.recentCommits).toBeNull() // No commits yet
      } finally {
        rmSync(tempDir, { recursive: true })
      }
    })

    it('should include recent commits after commit', { timeout: 15000 }, () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'prompt-context-test-'))
      try {
        // Initialize git repo with a commit
        execSync('git init', { cwd: tempDir, stdio: 'pipe' })
        execSync('git config user.email "test@test.com"', {
          cwd: tempDir,
          stdio: 'pipe',
        })
        execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' })

        // Create a file and commit
        const testFile = join(tempDir, 'test.txt')
        mkdirSync(tempDir, { recursive: true })
        execSync(`echo "test" > "${testFile}"`, { cwd: tempDir, stdio: 'pipe' })
        execSync('git add .', { cwd: tempDir, stdio: 'pipe' })
        execSync('git commit -m "Initial commit"', {
          cwd: tempDir,
          stdio: 'pipe',
        })

        const status = getGitStatus(tempDir)

        expect(status).toContain('Recent commits:')
        expect(status).toContain('Initial commit')
      } finally {
        rmSync(tempDir, { recursive: true })
      }
    })
  })
})
