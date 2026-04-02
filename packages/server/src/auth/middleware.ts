/**
 * Auth Middleware
 *
 * Hono middleware for JWT-based authentication
 */

import type { Context, Next, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken } from './jwt'
import { AUTH_DEFAULTS } from './config'

/**
 * Authenticated user info stored in context
 */
export interface AuthUser {
  id: string
  email: string
}

/**
 * Context variables added by auth middleware
 */
export interface AuthVariables {
  user: AuthUser | null
}

/**
 * Create auth middleware that extracts user from JWT cookie
 *
 * This middleware always runs and sets ctx.get('user') to the user or null.
 * Use requireAuth() to block unauthenticated requests.
 */
export function authMiddleware(jwtSecret: string): MiddlewareHandler {
  return async (ctx: Context, next: Next) => {
    const cookieName = AUTH_DEFAULTS.cookieName
    const token = getCookie(ctx, cookieName)

    let user: AuthUser | null = null

    if (token) {
      const payload = await verifyToken(token, jwtSecret)
      if (payload) {
        user = {
          id: payload.sub,
          email: payload.email,
        }
      }
    }

    ctx.set('user', user)
    await next()
  }
}

/**
 * Get authenticated user from context
 *
 * Returns null if not authenticated or middleware not applied
 */
export function getAuthUser(ctx: Context): AuthUser | null {
  return ctx.get('user') as AuthUser | null
}

/**
 * Middleware that requires authentication
 *
 * Must be used after authMiddleware. Returns 401 if not authenticated.
 */
export function requireAuth(): MiddlewareHandler {
  return async (ctx: Context, next: Next) => {
    const user = getAuthUser(ctx)

    if (!user) {
      return ctx.json({ error: { message: 'Unauthorized' } }, 401)
    }

    await next()
  }
}
