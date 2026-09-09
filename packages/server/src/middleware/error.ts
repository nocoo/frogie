/**
 * Error handling middleware
 */

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
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

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
