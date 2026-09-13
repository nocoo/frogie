import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createToken } from './auth/jwt'
import type { AuthConfig } from './auth/config'
import { closeDb, initDb, type DatabaseLike } from './db/connection'
import { runMigrations } from './db/migrate'
import { upsertUser } from './db/repositories/users'
import { cleanupTestDb, getTestDbPath } from './test/db-utils'
import { authorizeWebSocketRequest, configureAuthentication } from './index'

describe('WebSocket authorization', () => {
  const secret = 'websocket-auth-test-secret'
  const auth: AuthConfig = {
    jwtSecret: secret,
    google: {
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:7033/api/auth/callback',
    },
  }
  let dbPath: string
  let db: DatabaseLike

  beforeEach(() => {
    dbPath = getTestDbPath()
    db = initDb(dbPath)
    runMigrations(db)
  })

  afterEach(() => {
    closeDb()
    cleanupTestDb(dbPath)
  })

  function request(cookie?: string, origin = 'http://localhost:7033'): Request {
    const headers = new Headers({ Origin: origin })
    if (cookie) headers.set('Cookie', cookie)
    return new Request('http://localhost:7034/ws', { headers })
  }

  it('fails closed when authentication is not configured', async () => {
    const response = await authorizeWebSocketRequest(request(), db, undefined)
    expect(response?.status).toBe(503)
  })

  it('rejects browser connections from an untrusted origin', async () => {
    const response = await authorizeWebSocketRequest(request(undefined, 'https://evil.example'), db, auth)
    expect(response?.status).toBe(403)
  })

  it('rejects requests without a session cookie', async () => {
    const response = await authorizeWebSocketRequest(request(), db, auth)
    expect(response?.status).toBe(401)
  })

  it('rejects a valid token whose user no longer exists', async () => {
    const token = await createToken({ sub: 'missing', email: 'missing@example.test' }, secret, 60)
    const response = await authorizeWebSocketRequest(
      request(`frogie-session=${token}`),
      db,
      auth
    )
    expect(response?.status).toBe(401)
  })

  it('accepts a trusted origin with a current user session', async () => {
    const user = upsertUser(db, {
      email: 'user@example.test',
      name: 'Test User',
      image: null,
      google_id: 'google-user',
    })
    const token = await createToken({ sub: user.id, email: user.email }, secret, 60)
    const response = await authorizeWebSocketRequest(
      request(`frogie-session=${token}`),
      db,
      auth
    )
    expect(response).toBeNull()
  })

  it('blocks business APIs when authentication is not configured', async () => {
    const app = new Hono()
    configureAuthentication(app, db, undefined)
    app.get('/api/private', (ctx) => ctx.json({ ok: true }))

    const response = await app.request('/api/private')
    expect(response.status).toBe(503)
  })

  it('requires a valid session for business APIs', async () => {
    const app = new Hono()
    configureAuthentication(app, db, auth)
    app.get('/api/private', (ctx) => ctx.json({ ok: true }))

    expect((await app.request('/api/private')).status).toBe(401)

    const user = upsertUser(db, {
      email: 'api-user@example.test',
      name: 'API User',
      image: null,
      google_id: 'api-google-user',
    })
    const token = await createToken({ sub: user.id, email: user.email }, secret, 60)
    const response = await app.request('/api/private', {
      headers: { Cookie: `frogie-session=${token}` },
    })
    expect(response.status).toBe(200)
  })
})
