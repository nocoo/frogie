/**
 * Request logging middleware
 */

import type { Context, Next } from 'hono'

/**
 * Simple request logger
 */
export async function logger(c: Context, next: Next): Promise<void> {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.path

  await next()

  const duration = Date.now() - start
  const status = c.res.status

  // Format: [timestamp] METHOD /path STATUS duration
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${method} ${path} ${String(status)} ${String(duration)}ms`)
}
