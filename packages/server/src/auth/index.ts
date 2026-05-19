/**
 * Auth Module
 *
 * Re-exports all auth-related components
 */

export { createAuthRouter } from './router'
export { authMiddleware, requireAuth, getAuthUser, type AuthUser } from './middleware'
export { createToken, verifyToken, type JWTPayload } from './jwt'
export {
  type AuthConfig,
  type GoogleOAuthConfig,
  AUTH_DEFAULTS,
  GOOGLE_OAUTH,
} from './config'
