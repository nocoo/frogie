/**
 * Users repository
 *
 * CRUD operations for authenticated users
 */

import type { DatabaseLike } from '../connection'
import type { User, CreateUser } from '../types'
import { ulid } from 'ulid'

/**
 * Create or update a user (upsert by google_id)
 */
export function upsertUser(db: DatabaseLike, input: CreateUser): User {
  const now = Date.now()

  // Check if user exists by google_id
  const existing = db
    .prepare('SELECT * FROM users WHERE google_id = ?')
    .get(input.google_id) as User | undefined

  if (existing) {
    // Update existing user
    db.prepare(
      `UPDATE users SET
        email = ?,
        name = ?,
        image = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(input.email, input.name ?? null, input.image ?? null, now, existing.id)

    return {
      ...existing,
      email: input.email,
      name: input.name ?? null,
      image: input.image ?? null,
      updated_at: now,
    }
  }

  // Create new user
  const id = ulid()
  db.prepare(
    `INSERT INTO users (id, email, name, image, google_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.email, input.name ?? null, input.image ?? null, input.google_id, now, now)

  return {
    id,
    email: input.email,
    name: input.name ?? null,
    image: input.image ?? null,
    google_id: input.google_id,
    created_at: now,
    updated_at: now,
  }
}

/**
 * Get user by ID
 */
export function getUserById(db: DatabaseLike, id: string): User | null {
  return (
    (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined) ??
    null
  )
}

/**
 * Get user by email
 */
export function getUserByEmail(db: DatabaseLike, email: string): User | null {
  return (
    (db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | User
      | undefined) ?? null
  )
}

/**
 * Get user by Google ID
 */
export function getUserByGoogleId(
  db: DatabaseLike,
  googleId: string
): User | null {
  return (
    (db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) as
      | User
      | undefined) ?? null
  )
}

/**
 * List all users
 */
export function listUsers(db: DatabaseLike): User[] {
  return db
    .prepare('SELECT * FROM users ORDER BY created_at DESC')
    .all() as User[]
}

/**
 * Delete user by ID
 */
export function deleteUser(db: DatabaseLike, id: string): boolean {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id)
  return result.changes > 0
}
