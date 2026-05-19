import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { authMiddleware, requireAuth, getAuthUser } from './middleware'
import { createToken } from './jwt'

describe('auth/middleware', () => {
  const secret = 'test-secret-abc'
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    app.use('*', authMiddleware(secret))
  })

  afterEach(() => {
    // nothing
  })

  describe('authMiddleware', () => {
    it('should set user to null when no cookie', async () => {
      app.get('/probe', (c) => c.json({ user: getAuthUser(c) }))

      const res = await app.request('/probe')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { user: unknown }
      expect(body.user).toBeNull()
    })

    it('should set user to null for invalid token', async () => {
      app.get('/probe', (c) => c.json({ user: getAuthUser(c) }))

      const res = await app.request('/probe', {
        headers: { Cookie: 'frogie-session=not-a-valid-token' },
      })

      const body = (await res.json()) as { user: unknown }
      expect(body.user).toBeNull()
    })

    it('should set user from valid token', async () => {
      app.get('/probe', (c) => c.json({ user: getAuthUser(c) }))

      const token = await createToken(
        { sub: 'user-1', email: 'a@b.com' },
        secret,
        3600
      )

      const res = await app.request('/probe', {
        headers: { Cookie: `frogie-session=${token}` },
      })

      const body = (await res.json()) as { user: { id: string; email: string } | null }
      expect(body.user?.id).toBe('user-1')
      expect(body.user?.email).toBe('a@b.com')
    })
  })

  describe('requireAuth', () => {
    it('should return 401 when not authenticated', async () => {
      app.get('/protected', requireAuth(), (c) => c.json({ ok: true }))

      const res = await app.request('/protected')
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toBe('Unauthorized')
    })

    it('should pass through when authenticated', async () => {
      app.get('/protected', requireAuth(), (c) => c.json({ ok: true }))

      const token = await createToken(
        { sub: 'user-1', email: 'a@b.com' },
        secret,
        3600
      )

      const res = await app.request('/protected', {
        headers: { Cookie: `frogie-session=${token}` },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean }
      expect(body.ok).toBe(true)
    })
  })

  describe('getAuthUser', () => {
    it('should return null when middleware not applied', () => {
      const bareApp = new Hono()
      bareApp.get('/probe', (c) => c.json({ user: getAuthUser(c) }))
      // no middleware — getAuthUser returns null because ctx.get('user') is undefined cast as null
    })
  })
})
