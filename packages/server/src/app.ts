/**
 * Hono Application
 *
 * Main application setup with middleware and routes
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { errorHandler, logger } from './middleware'

/**
 * Create the Hono application
 */
export function createApp(): Hono {
  const app = new Hono()

  // CORS for web UI
  app.use(
    '*',
    cors({
      origin: ['http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    })
  )

  // Request logging
  app.use('*', logger)

  // Error handling (wraps all routes)
  app.use('*', errorHandler)

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
