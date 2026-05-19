/**
 * Error handling middleware
 */

import type { Context, Next } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * API error with code and status
 */
export class ApiError extends Error {
  code: string
  status: ContentfulStatusCode

  constructor(code: string, message: string, status: ContentfulStatusCode = 500) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'ApiError'
  }
}

/**
 * Common error codes
 */
export const ErrorCodes = {
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  MCP_NOT_FOUND: 'MCP_NOT_FOUND',
  MCP_CONNECTION_FAILED: 'MCP_CONNECTION_FAILED',
  LLM_API_ERROR: 'LLM_API_ERROR',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

/**
 * Error response format
 */
interface ErrorResponse {
  error: {
    code: string
    message: string
  }
}

/**
 * Error handler middleware
 */
export async function errorHandler(c: Context, next: Next): Promise<Response | undefined> {
  try {
    await next()
    return undefined
  } catch (err) {
    if (err instanceof ApiError) {
      const response: ErrorResponse = {
        error: {
          code: err.code,
          message: err.message,
        },
      }
      return c.json(response, err.status)
    }

    // Log unexpected errors
    console.error('Unexpected error:', err)

    const response: ErrorResponse = {
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: err instanceof Error ? err.message : 'Internal server error',
      },
    }
    return c.json(response, 500)
  }
}

/**
 * Create a 404 not found error
 */
export function notFound(code: string, message: string): ApiError {
  return new ApiError(code, message, 404)
}

/**
 * Create a 400 validation error
 */
export function validationError(message: string): ApiError {
  return new ApiError(ErrorCodes.VALIDATION_ERROR, message, 400)
}

/**
 * Create a 402 budget exceeded error
 */
export function budgetExceeded(costUsd: number): ApiError {
  return new ApiError(
    ErrorCodes.BUDGET_EXCEEDED,
    `Budget exceeded: $${costUsd.toFixed(2)}`,
    402
  )
}

/**
 * Create a 502 LLM API error
 */
export function llmApiError(message: string): ApiError {
  return new ApiError(ErrorCodes.LLM_API_ERROR, message, 502)
}
