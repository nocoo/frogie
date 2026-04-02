/**
 * Auth Router Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { initDb, closeDb } from '../db/connection'
import { runMigrations } from '../db/migrate'
import { createAuthRouter } from './router'
import { authMiddleware } from './middleware'
import { createToken } from './jwt'
import { getTestDbPath, cleanupTestDb } from '../test/db-utils'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { AuthConfig } from './config'

// Mock fetch for Google OAuth
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('auth/router', () => {
  let testDbPath: string
  let db: DatabaseType
  let app: Hono
  const testSecret = 'test-jwt-secret-12345'

  const config: AuthConfig = {
    jwtSecret: testSecret,
    google: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:7034/api/auth/callback',
    },
  }

  beforeEach(() => {
    testDbPath = getTestDbPath()
    db = initDb(testDbPath)
    runMigrations(db)

    app = new Hono()
    app.use('*', authMiddleware(testSecret))
    app.route('/api/auth', createAuthRouter(db, config))

    mockFetch.mockReset()
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(testDbPath)
    vi.clearAllMocks()
  })

  describe('GET /api/auth/google', () => {
    it('should redirect to Google OAuth URL', async () => {
      const res = await app.request('/api/auth/google')

      expect(res.status).toBe(302)
      const location = res.headers.get('Location')
      expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(location).toContain('client_id=test-client-id')
      expect(location).toContain('redirect_uri=')
    })

    it('should set oauth_state cookie', async () => {
      const res = await app.request('/api/auth/google')

      const cookies = res.headers.get('Set-Cookie')
      expect(cookies).toContain('oauth_state=')
    })
  })

  describe('GET /api/auth/callback', () => {
    it('should redirect to login on invalid callback', async () => {
      const res = await app.request('/api/auth/callback')

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/login?error=InvalidCallback')
    })

    it('should handle successful OAuth flow', async () => {
      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'test-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
      })

      // Mock user info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'google-123',
            email: 'test@example.com',
            verified_email: true,
            name: 'Test User',
            picture: 'https://example.com/avatar.png',
          }),
      })

      const res = await app.request('/api/auth/callback?code=test-code')

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/')

      // Should set session cookie
      const cookies = res.headers.get('Set-Cookie')
      expect(cookies).toContain('frogie-session=')
    })

    it('should redirect on access denied for restricted emails', async () => {
      const restrictedApp = new Hono()
      const restrictedConfig: AuthConfig = {
        ...config,
        allowedEmails: ['allowed@example.com'],
      }
      restrictedApp.use('*', authMiddleware(testSecret))
      restrictedApp.route('/api/auth', createAuthRouter(db, restrictedConfig))

      // Mock successful OAuth but with non-allowed email
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'test-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'google-456',
            email: 'notallowed@example.com',
            verified_email: true,
            name: 'Not Allowed',
            picture: 'https://example.com/avatar.png',
          }),
      })

      const res = await restrictedApp.request('/api/auth/callback?code=test-code')

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/login?error=AccessDenied')
    })
  })

  describe('GET /api/auth/me', () => {
    it('should return null user when not authenticated', async () => {
      const res = await app.request('/api/auth/me')

      expect(res.status).toBe(200)
      const data = (await res.json()) as { user: unknown }
      expect(data.user).toBeNull()
    })

    it('should return user when authenticated', async () => {
      // First create a user via callback
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'test-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'google-123',
            email: 'test@example.com',
            verified_email: true,
            name: 'Test User',
            picture: 'https://example.com/avatar.png',
          }),
      })

      const callbackRes = await app.request('/api/auth/callback?code=test-code')
      const cookies = callbackRes.headers.get('Set-Cookie') ?? ''
      const sessionCookie = cookies.split(';')[0] ?? ''

      // Now request /me with the session cookie
      const res = await app.request('/api/auth/me', {
        headers: { Cookie: sessionCookie },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { user: { email: string; name: string } }
      expect(data.user).not.toBeNull()
      expect(data.user.email).toBe('test@example.com')
      expect(data.user.name).toBe('Test User')
    })
  })

  describe('POST /api/auth/logout', () => {
    it('should clear session cookie', async () => {
      // Create a token first
      const token = await createToken(
        { sub: 'user-123', email: 'test@example.com' },
        testSecret,
        3600
      )

      const res = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: `frogie-session=${token}` },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean }
      expect(data.success).toBe(true)

      // Cookie should be deleted
      const cookies = res.headers.get('Set-Cookie')
      expect(cookies).toContain('frogie-session=;')
    })
  })
})
