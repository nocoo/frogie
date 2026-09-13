import { describe, it, expect } from 'vitest'
import {
  ApiError,
  ErrorCodes,
  notFound,
  validationError,
} from './error'

describe('middleware/error', () => {
  describe('ApiError class', () => {
    it('should default status to 500', () => {
      const err = new ApiError('CODE', 'msg')
      expect(err.status).toBe(500)
      expect(err.code).toBe('CODE')
      expect(err.name).toBe('ApiError')
    })

    it('should accept custom status', () => {
      const err = new ApiError('CODE', 'msg', 418)
      expect(err.status).toBe(418)
    })
  })

  describe('factory helpers', () => {
    it('notFound returns 404 ApiError', () => {
      const err = notFound('X', 'msg')
      expect(err.status).toBe(404)
      expect(err.code).toBe('X')
    })

    it('validationError returns 400 with VALIDATION_ERROR code', () => {
      const err = validationError('bad input')
      expect(err.status).toBe(400)
      expect(err.code).toBe(ErrorCodes.VALIDATION_ERROR)
    })
  })
})
