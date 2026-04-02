/**
 * Hono Application
 *
 * Main application setup with middleware and routes
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger, ApiError, ErrorCodes } from './middleware'

/**
 * Create the Hono application
 */
export function createApp(): Hono {
  const app = new Hono()

  // CORS for web UI
  // Default origins + custom via CORS_ORIGINS env var (comma-separated)
  const defaultOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:7033',
    'https://frogie.dev.hexly.ai',
  ]
  const envOrigins = process.env['CORS_ORIGINS']?.split(',').filter(Boolean) ?? []
  const allowedOrigins = [...defaultOrigins, ...envOrigins]

  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  )

  // Request logging
  app.use('*', logger)

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.status
      )
    }

    console.error('Unexpected error:', err)
    return c.json(
      {
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: err instanceof Error ? err.message : 'Internal server error',
        },
      },
      500
    )
  })

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() })
  })

  return app
}

/**
 * Default app instance
 */
export const app = createApp()
