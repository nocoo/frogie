/**
 * Auth Router
 *
 * Handles Google OAuth flow and session management
 */

import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { Database as DatabaseType } from 'better-sqlite3'
import { z } from 'zod'
import { upsertUser, getUserById } from '../db/repositories/users'
import { createToken } from './jwt'
import { getAuthUser } from './middleware'
import {
  type AuthConfig,
  AUTH_DEFAULTS,
  GOOGLE_OAUTH,
} from './config'

/**
 * Google OAuth token response
 */
interface GoogleTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
  id_token?: string
}

/**
 * Google user info response
 */
interface GoogleUserInfo {
  id: string
  email: string
  verified_email: boolean
  name: string
  given_name: string
  family_name: string
  picture: string
}

/**
 * Callback query schema
 */
const callbackSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
})

/**
 * Generate OAuth state for CSRF protection
 */
function generateState(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Create auth router
 */
export function createAuthRouter(
  db: DatabaseType,
  config: AuthConfig
): Hono {
  const app = new Hono()
  const cookieName = config.cookieName ?? AUTH_DEFAULTS.cookieName
  const jwtExpiresIn = config.jwtExpiresIn ?? AUTH_DEFAULTS.jwtExpiresIn

  /**
   * GET /api/auth/google - Initiate Google OAuth flow
   */
  app.get('/google', (ctx) => {
    const state = generateState()

    // Build OAuth URL
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: 'code',
      scope: GOOGLE_OAUTH.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'select_account',
    })

    const authUrl = `${GOOGLE_OAUTH.authUrl}?${params.toString()}`

    // Store state in cookie for verification
    setCookie(ctx, 'oauth_state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600, // 10 minutes
    })

    return ctx.redirect(authUrl)
  })

  /**
   * GET /api/auth/callback - Handle Google OAuth callback
   */
  app.get('/callback', async (ctx) => {
    const query = ctx.req.query()

    // Validate query params
    const parsed = callbackSchema.safeParse(query)
    if (!parsed.success) {
      return ctx.redirect('/login?error=InvalidCallback')
    }

    const { code } = parsed.data

    try {
      // Exchange code for tokens
      const tokenRes = await fetch(GOOGLE_OAUTH.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: config.google.redirectUri,
          grant_type: 'authorization_code',
        }),
      })

      if (!tokenRes.ok) {
        console.error('[auth] Token exchange failed:', await tokenRes.text())
        return ctx.redirect('/login?error=TokenExchangeFailed')
      }

      const tokens = (await tokenRes.json()) as GoogleTokenResponse

      // Fetch user info
      const userRes = await fetch(GOOGLE_OAUTH.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      })

      if (!userRes.ok) {
        console.error('[auth] User info fetch failed:', await userRes.text())
        return ctx.redirect('/login?error=UserInfoFailed')
      }

      const googleUser = (await userRes.json()) as GoogleUserInfo

      // Check allowed emails
      if (
        config.allowedEmails &&
        config.allowedEmails.length > 0 &&
        !config.allowedEmails.includes(googleUser.email.toLowerCase())
      ) {
        return ctx.redirect('/login?error=AccessDenied')
      }

      // Upsert user in database
      const user = upsertUser(db, {
        email: googleUser.email,
        name: googleUser.name,
        image: googleUser.picture,
        google_id: googleUser.id,
      })

      // Create JWT
      const jwt = await createToken(
        { sub: user.id, email: user.email },
        config.jwtSecret,
        jwtExpiresIn
      )

      // Set session cookie
      setCookie(ctx, cookieName, jwt, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: jwtExpiresIn,
      })

      // Clear OAuth state cookie
      deleteCookie(ctx, 'oauth_state')

      return ctx.redirect('/')
    } catch (err) {
      console.error('[auth] OAuth callback error:', err)
      return ctx.redirect('/login?error=AuthFailed')
    }
  })

  /**
   * GET /api/auth/me - Get current authenticated user
   */
  app.get('/me', (ctx) => {
    const authUser = getAuthUser(ctx)

    if (!authUser) {
      return ctx.json({ user: null })
    }

    // Fetch full user from database
    const user = getUserById(db, authUser.id)

    if (!user) {
      // User deleted from database but still has valid JWT
      deleteCookie(ctx, cookieName)
      return ctx.json({ user: null })
    }

    return ctx.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    })
  })

  /**
   * POST /api/auth/logout - Clear session
   */
  app.post('/logout', (ctx) => {
    deleteCookie(ctx, cookieName, { path: '/' })
    return ctx.json({ success: true })
  })

  return app
}
