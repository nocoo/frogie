/**
 * JWT Utilities
 *
 * Wrapper around jose for signing and verifying JWTs
 */

import * as jose from 'jose'

/**
 * JWT payload structure
 */
export interface JWTPayload {
  /** User ID */
  sub: string

  /** User email */
  email: string

  /** Issued at timestamp */
  iat?: number | undefined

  /** Expiration timestamp */
  exp?: number | undefined
}

/**
 * Create a signed JWT token
 */
export async function createToken(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresIn: number
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)

  const token = await new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .sign(secretKey)

  return token
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const secretKey = new TextEncoder().encode(secret)
    const { payload } = await jose.jwtVerify(token, secretKey)

    // Validate required fields
    if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') {
      return null
    }

    return {
      sub: payload.sub,
      email: payload['email'],
      iat: payload.iat,
      exp: payload.exp,
    }
  } catch {
    return null
  }
}
