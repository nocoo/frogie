import { describe, it, expect } from 'vitest'
import { app } from './app'

describe('app', () => {
  describe('health check', () => {
    it('should return ok status', async () => {
      const res = await app.request('/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; timestamp: number }
      expect(body.status).toBe('ok')
      expect(body.timestamp).toBeDefined()
    })
  })

  describe('CORS', () => {
    it('should include CORS headers for allowed origin', async () => {
      const res = await app.request('/health', {
        headers: {
          Origin: 'http://localhost:5173',
        },
      })

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
        'http://localhost:5173'
      )
    })

    it('should handle preflight requests', async () => {
      const res = await app.request('/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      })

      expect(res.status).toBe(204)
    })
  })

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await app.request('/unknown/route')

      expect(res.status).toBe(404)
    })
  })
})
