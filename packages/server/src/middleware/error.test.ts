import { describe, it, expect, vi } from 'vitest'
import {
  ApiError,
  ErrorCodes,
  errorHandler,
  notFound,
  validationError,
  budgetExceeded,
  llmApiError,
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

    it('budgetExceeded returns 402 with formatted message', () => {
      const err = budgetExceeded(12.345)
      expect(err.status).toBe(402)
      expect(err.code).toBe(ErrorCodes.BUDGET_EXCEEDED)
      expect(err.message).toContain('$12.35')
    })

    it('llmApiError returns 502', () => {
      const err = llmApiError('upstream down')
      expect(err.status).toBe(502)
      expect(err.code).toBe(ErrorCodes.LLM_API_ERROR)
    })
  })

  describe('errorHandler middleware', () => {
    function makeContext(): { json: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
      const json = vi.fn().mockImplementation((body: unknown, status?: number) => {
        return new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      return { json, get: vi.fn(), set: vi.fn() }
    }

    it('should pass through when no error thrown', async () => {
      const ctx = makeContext()
      const next = vi.fn().mockResolvedValue(undefined)
      const result = await errorHandler(ctx as unknown as Parameters<typeof errorHandler>[0], next)
      expect(next).toHaveBeenCalled()
      expect(result).toBeUndefined()
    })

    it('should return ApiError as JSON with its status', async () => {
      const ctx = makeContext()
      const next = vi.fn().mockRejectedValue(new ApiError('CUSTOM', 'oops', 418))
      const result = await errorHandler(
        ctx as unknown as Parameters<typeof errorHandler>[0],
        next
      )
      expect(result).toBeInstanceOf(Response)
      expect(result?.status).toBe(418)
      const body = result === undefined ? null : ((await result.json()) as { error: { code: string; message: string } })
      expect(body?.error.code).toBe('CUSTOM')
      expect(body?.error.message).toBe('oops')
    })

    it('should return 500 for generic Error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // suppress
      })
      const ctx = makeContext()
      const next = vi.fn().mockRejectedValue(new Error('kaboom'))
      const result = await errorHandler(
        ctx as unknown as Parameters<typeof errorHandler>[0],
        next
      )
      expect(result?.status).toBe(500)
      const body = result === undefined ? null : ((await result.json()) as { error: { code: string; message: string } })
      expect(body?.error.code).toBe(ErrorCodes.INTERNAL_ERROR)
      expect(body?.error.message).toBe('kaboom')
      consoleSpy.mockRestore()
    })

    it('should return generic message for non-Error throwables', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // suppress
      })
      const ctx = makeContext()
      const next = vi.fn().mockRejectedValue('just a string')
      const result = await errorHandler(
        ctx as unknown as Parameters<typeof errorHandler>[0],
        next
      )
      expect(result?.status).toBe(500)
      const body = result === undefined ? null : ((await result.json()) as { error: { code: string; message: string } })
      expect(body?.error.message).toBe('Internal server error')
      consoleSpy.mockRestore()
    })
  })
})
