import { expect, test as base, type Route } from '@playwright/test'

interface MockWorkspace {
  id: string
  name: string
  path: string
  color: string | null
  createdAt: number
  lastAccessed: number | null
}

interface MockSession {
  id: string
  workspaceId: string
  name: string | null
  model: string
  createdAt: number
  updatedAt: number
  messageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
}

const user = {
  id: 'e2e-user',
  email: 'e2e@example.test',
  name: 'E2E User',
  image: null,
}

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
  })
}

export const test = base.extend<{ mockBackend: undefined }>({
  mockBackend: [async ({ page }, use) => {
    const workspaces: MockWorkspace[] = []
    const sessions = new Map<string, MockSession[]>()
    let settings = {
      llmBaseUrl: 'https://api.anthropic.com',
      llmApiKey: '••••••••',
      llmModel: 'claude-sonnet-4-6',
      maxTurns: 25,
      maxBudgetUsd: 10,
    }

    await page.routeWebSocket(/\/ws$/, (socket) => {
      socket.onMessage((message) => {
        if (typeof message !== 'string') return
        const parsed = JSON.parse(message) as { type?: string }
        if (parsed.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }))
        }
      })
    })

    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const method = request.method()

      if (path === '/api/auth/me') {
        await json(route, { user })
        return
      }

      if (path === '/api/auth/logout') {
        await json(route, { success: true })
        return
      }

      if (path === '/api/settings/test-api') {
        await json(route, {
          success: true,
          models: [
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4 6', createdAt: '2026-01-01' },
            { id: 'claude-opus-4', name: 'Claude Opus 4', createdAt: '2026-01-01' },
          ],
        })
        return
      }

      if (path === '/api/settings') {
        if (method === 'PATCH') {
          const update = request.postDataJSON() as Record<string, unknown>
          settings = {
            llmBaseUrl: typeof update['llm_base_url'] === 'string'
              ? update['llm_base_url']
              : settings.llmBaseUrl,
            llmApiKey: settings.llmApiKey,
            llmModel: typeof update['llm_model'] === 'string'
              ? update['llm_model']
              : settings.llmModel,
            maxTurns: typeof update['max_turns'] === 'number'
              ? update['max_turns']
              : settings.maxTurns,
            maxBudgetUsd: typeof update['max_budget_usd'] === 'number'
              ? update['max_budget_usd']
              : settings.maxBudgetUsd,
          }
        }
        await json(route, settings)
        return
      }

      if (path === '/api/workspaces/browse') {
        await json(route, { cancelled: true })
        return
      }

      const sessionMatch = /^\/api\/workspaces\/([^/]+)\/sessions(?:\/([^/]+))?$/.exec(path)
      if (sessionMatch) {
        const workspaceId = sessionMatch[1] ?? ''
        const sessionId = sessionMatch[2]
        const workspaceSessions = sessions.get(workspaceId) ?? []

        if (!sessionId && method === 'GET') {
          await json(route, workspaceSessions)
          return
        }
        if (!sessionId && method === 'POST') {
          const input = request.postDataJSON() as { name?: string; model?: string }
          const now = Date.now()
          const session: MockSession = {
            id: `session-${String(workspaceSessions.length + 1)}`,
            workspaceId,
            name: input.name ?? `Session ${String(workspaceSessions.length + 1)}`,
            model: input.model ?? 'claude-sonnet-4-6',
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCostUsd: 0,
          }
          workspaceSessions.push(session)
          sessions.set(workspaceId, workspaceSessions)
          await json(route, session, 201)
          return
        }
        if (sessionId && method === 'DELETE') {
          sessions.set(workspaceId, workspaceSessions.filter((item) => item.id !== sessionId))
          await json(route, { success: true })
          return
        }
      }

      if (path === '/api/workspaces') {
        if (method === 'POST') {
          const input = request.postDataJSON() as { name: string; path: string; color?: string }
          const workspace: MockWorkspace = {
            id: `workspace-${String(workspaces.length + 1)}`,
            name: input.name,
            path: input.path,
            color: input.color ?? null,
            createdAt: Date.now(),
            lastAccessed: null,
          }
          workspaces.push(workspace)
          sessions.set(workspace.id, [])
          await json(route, workspace, 201)
          return
        }
        await json(route, workspaces)
        return
      }

      if (/^\/api\/workspaces\/[^/]+\/icon$/.test(path)) {
        await route.fulfill({ status: 404 })
        return
      }

      if (path === '/api/prompts/global') {
        await json(route, { layers: [] })
        return
      }

      const promptWorkspace = /^\/api\/prompts\/([^/]+)$/.exec(path)
      if (promptWorkspace) {
        await json(route, { workspaceId: promptWorkspace[1], layers: [] })
        return
      }

      await json(route, { error: { message: `Unhandled mock route: ${method} ${path}` } }, 404)
    })

    await use(undefined)
  }, { auto: true }],
})

export { expect }
