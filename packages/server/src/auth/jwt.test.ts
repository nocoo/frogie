/**
 * JWT Utilities Tests
 */

import { describe, it, expect } from 'vitest'
import { createToken, verifyToken } from './jwt'

describe('auth/jwt', () => {
  const TEST_SECRET = 'test-secret-key-for-jwt-signing'

  describe('createToken', () => {
    it('should create a valid JWT token', async () => {
      const token = await createToken(
        { sub: 'user-123', email: 'test@example.com' },
        TEST_SECRET,
        3600
      )

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      // JWT has 3 parts separated by dots
      expect(token.split('.').length).toBe(3)
    })
  })

  describe('verifyToken', () => {
    it('should verify a valid token', async () => {
      const token = await createToken(
        { sub: 'user-123', email: 'test@example.com' },
        TEST_SECRET,
        3600
      )

      const payload = await verifyToken(token, TEST_SECRET)

      expect(payload).not.toBeNull()
      expect(payload?.sub).toBe('user-123')
      expect(payload?.email).toBe('test@example.com')
      expect(payload?.iat).toBeDefined()
      expect(payload?.exp).toBeDefined()
    })

    it('should return null for invalid token', async () => {
      const payload = await verifyToken('invalid-token', TEST_SECRET)
      expect(payload).toBeNull()
    })

    it('should return null for token with wrong secret', async () => {
      const token = await createToken(
        { sub: 'user-123', email: 'test@example.com' },
        TEST_SECRET,
        3600
      )

      const payload = await verifyToken(token, 'wrong-secret')
      expect(payload).toBeNull()
    })

    it('should return null for expired token', async () => {
      const token = await createToken(
        { sub: 'user-123', email: 'test@example.com' },
        TEST_SECRET,
        -1 // Already expired
      )

      const payload = await verifyToken(token, TEST_SECRET)
      expect(payload).toBeNull()
    })
  })
})
