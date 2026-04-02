/**
 * Session Sync Service
 *
 * Manages dual persistence: SQLite index + file-based message storage.
 * This is the SINGLE SOURCE for session index writes - FrogieAgent does NOT touch the index.
 */

import type { Database as DatabaseType } from 'better-sqlite3'
import type { Session, CreateSession, SessionStats } from '../db/types'
import type { Message } from './types'
import {
  createSession as dbCreateSession,
  getSession as dbGetSession,
  listSessions as dbListSessions,
  updateSessionStats as dbUpdateSessionStats,
  incrementSessionStats as dbIncrementSessionStats,
  deleteSession as dbDeleteSession,
  touchSession as dbTouchSession,
} from '../db'
import { ulid } from 'ulid'

/**
 * Session with messages from both SQLite index and file storage
 */
export interface SessionWithMessages {
  index: Session
  messages: Message[]
}

/**
 * Session sync service for managing dual persistence
 */
export class SessionSync {
  private db: DatabaseType
  private messageStore: MessageStore

  constructor(db: DatabaseType, messageStore: MessageStore) {
    this.db = db
    this.messageStore = messageStore
  }

  /**
   * Create a new session
   *
   * @param workspaceId - Workspace ID
   * @param name - Session name
   * @param model - Model identifier
   * @returns Session ID
   */
  createSession(workspaceId: string, name: string | null, model: string): string {
    const sessionId = ulid()

    const input: CreateSession = {
      id: sessionId,
      workspace_id: workspaceId,
      name,
      model,
    }

    dbCreateSession(this.db, input)

    return sessionId
  }

  /**
   * Get session index entry
   *
   * @param sessionId - Session ID
   * @returns Session or null
   */
  getSession(sessionId: string): Session | null {
    return dbGetSession(this.db, sessionId)
  }

  /**
   * List sessions for a workspace
   *
   * @param workspaceId - Workspace ID
   * @returns Array of sessions
   */
  listSessions(workspaceId: string): Session[] {
    return dbListSessions(this.db, workspaceId)
  }

  /**
   * Get session with messages
   *
   * @param sessionId - Session ID
   * @returns Session index + messages from file storage
   */
  async getSessionWithMessages(sessionId: string): Promise<SessionWithMessages | null> {
    const index = dbGetSession(this.db, sessionId)
    if (!index) {
      return null
    }

    const messages = await this.messageStore.loadMessages(sessionId)

    return { index, messages }
  }

  /**
   * Save messages for a session
   *
   * @param sessionId - Session ID
   * @param messages - Messages to save
   */
  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    await this.messageStore.saveMessages(sessionId, messages)
    dbTouchSession(this.db, sessionId)
  }

  /**
   * Update session statistics
   *
   * @param sessionId - Session ID
   * @param stats - New statistics
   */
  updateSessionStats(sessionId: string, stats: SessionStats): void {
    dbUpdateSessionStats(this.db, sessionId, stats)
  }

  /**
   * Increment session statistics by delta values
   *
   * @param sessionId - Session ID
   * @param delta - Delta values to add
   */
  incrementSessionStats(sessionId: string, delta: Partial<SessionStats>): void {
    dbIncrementSessionStats(this.db, sessionId, delta)
  }

  /**
   * Touch session (update updated_at)
   *
   * @param sessionId - Session ID
   */
  touchSession(sessionId: string): void {
    dbTouchSession(this.db, sessionId)
  }

  /**
   * Delete a session
   *
   * Removes both SQLite index and file storage
   *
   * @param sessionId - Session ID
   * @returns true if deleted
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    // Delete from file storage first
    await this.messageStore.deleteSession(sessionId)

    // Then delete from SQLite index
    return dbDeleteSession(this.db, sessionId)
  }
}

/**
 * Message storage interface
 *
 * Abstraction for file-based message persistence
 */
export interface MessageStore {
  /**
   * Load messages for a session
   */
  loadMessages(sessionId: string): Promise<Message[]>

  /**
   * Save messages for a session
   */
  saveMessages(sessionId: string, messages: Message[]): Promise<void>

  /**
   * Delete session files
   */
  deleteSession(sessionId: string): Promise<void>
}

/**
 * In-memory message store for testing
 */
export class InMemoryMessageStore implements MessageStore {
  private store = new Map<string, Message[]>()

  loadMessages(sessionId: string): Promise<Message[]> {
    return Promise.resolve(this.store.get(sessionId) ?? [])
  }

  saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    this.store.set(sessionId, [...messages])
    return Promise.resolve()
  }

  deleteSession(sessionId: string): Promise<void> {
    this.store.delete(sessionId)
    return Promise.resolve()
  }

  /**
   * Clear all stored messages (for testing)
   */
  clear(): void {
    this.store.clear()
  }
}

/**
 * File-based message store
 *
 * Stores messages in JSON files under a base directory
 */
export class FileMessageStore implements MessageStore {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  private getSessionPath(sessionId: string): string {
    return `${this.baseDir}/sessions/${sessionId}/transcript.json`
  }

  async loadMessages(sessionId: string): Promise<Message[]> {
    const { readFile } = await import('fs/promises')
    const path = this.getSessionPath(sessionId)

    try {
      const content = await readFile(path, 'utf-8')
      const data = JSON.parse(content) as { messages?: Message[] }
      return data.messages ?? []
    } catch {
      // File doesn't exist or is invalid
      return []
    }
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    const { writeFile, mkdir } = await import('fs/promises')
    const { dirname } = await import('path')
    const path = this.getSessionPath(sessionId)

    // Ensure directory exists
    await mkdir(dirname(path), { recursive: true })

    const data = {
      sessionId,
      messages,
      savedAt: Date.now(),
    }

    await writeFile(path, JSON.stringify(data, null, 2))
  }

  async deleteSession(sessionId: string): Promise<void> {
    const { rm } = await import('fs/promises')
    const { dirname } = await import('path')
    const path = this.getSessionPath(sessionId)

    try {
      // Remove the entire session directory
      await rm(dirname(path), { recursive: true, force: true })
    } catch {
      // Ignore errors if directory doesn't exist
    }
  }
}

/**
 * Create a session sync instance
 *
 * @param db - Database instance
 * @param messageStoreBaseDir - Base directory for file storage (e.g., ~/.frogie)
 */
export function createSessionSync(
  db: DatabaseType,
  messageStoreBaseDir: string
): SessionSync {
  const messageStore = new FileMessageStore(messageStoreBaseDir)
  return new SessionSync(db, messageStore)
}
