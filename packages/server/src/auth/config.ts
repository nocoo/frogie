/**
 * Auth Routes Configuration
 *
 * Exports auth configuration and constants
 */

/**
 * Google OAuth configuration
 */
export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/**
 * Auth configuration
 */
export interface AuthConfig {
  /** Secret key for signing JWTs */
  jwtSecret: string

  /** JWT expiration time in seconds (default: 7 days) */
  jwtExpiresIn?: number | undefined

  /** Cookie name for storing JWT */
  cookieName?: string | undefined

  /** Google OAuth configuration */
  google: GoogleOAuthConfig

  /** Allowed email addresses (empty = allow all) */
  allowedEmails?: string[] | undefined
}

/**
 * Default values
 */
export const AUTH_DEFAULTS = {
  cookieName: 'frogie-session',
  jwtExpiresIn: 7 * 24 * 60 * 60, // 7 days
} as const

/**
 * Google OAuth endpoints
 */
export const GOOGLE_OAUTH = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: ['openid', 'email', 'profile'],
} as const
