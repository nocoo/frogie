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
    const workspaceOverrides = new Map<string, { content: string; enabled: boolean }>()
    let globalPrompts = [{
      layer: 'date_context',
      content: "Today's date is {{date}}.",
      enabled: true,
      isTemplate: true,
      updatedAt: Date.now(),
    }]
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
        const parsed = JSON.parse(message) as { type?: string; sessionId?: string }
        if (parsed.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }))
        } else if (parsed.type === 'chat' && parsed.sessionId) {
          socket.send(JSON.stringify({ type: 'text', sessionId: parsed.sessionId, text: 'Mock response ' }))
          socket.send(JSON.stringify({ type: 'text', sessionId: parsed.sessionId, text: 'complete' }))
          socket.send(JSON.stringify({
            type: 'turn_complete',
            sessionId: parsed.sessionId,
            turns: 1,
            inputTokens: 2,
            outputTokens: 3,
            costUsd: 0.001,
            durationMs: 10,
          }))
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
        await json(route, { path: '/tmp/browsed-workspace' })
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
          workspaceOverrides.set(workspace.id, {
            content: 'Workspace date: {{date}}.',
            enabled: true,
          })
          await json(route, workspace, 201)
          return
        }
        await json(route, workspaces)
        return
      }

      const workspaceDetail = /^\/api\/workspaces\/([^/]+)(?:\/(open|icon))?$/.exec(path)
      if (workspaceDetail) {
        const workspaceId = workspaceDetail[1] ?? ''
        const action = workspaceDetail[2]
        const index = workspaces.findIndex((workspace) => workspace.id === workspaceId)
        if (action === 'icon') {
          await route.fulfill({ status: 404 })
          return
        }
        if (action === 'open') {
          await json(route, { success: true })
          return
        }
        if (method === 'PATCH' && index >= 0) {
          const update = request.postDataJSON() as Partial<MockWorkspace>
          const updated = { ...workspaces[index], ...update } as MockWorkspace
          workspaces[index] = updated
          await json(route, updated)
          return
        }
        if (method === 'DELETE' && index >= 0) {
          workspaces.splice(index, 1)
          sessions.delete(workspaceId)
          workspaceOverrides.delete(workspaceId)
          await json(route, { success: true })
          return
        }
      }

      if (path === '/api/prompts/preview') {
        await json(route, {
          assembledPrompt: 'Preview prompt',
          tokenEstimate: 3,
          builtinToolsOnly: true,
          layers: [],
        })
        return
      }

      if (path === '/api/prompts/global') {
        await json(route, { layers: globalPrompts })
        return
      }

      const globalPrompt = /^\/api\/prompts\/global\/([^/]+)$/.exec(path)
      if (globalPrompt && method === 'PUT') {
        const update = request.postDataJSON() as { content?: string; enabled?: boolean }
        globalPrompts = globalPrompts.map((prompt) => prompt.layer === globalPrompt[1]
          ? { ...prompt, ...update, updatedAt: Date.now() }
          : prompt)
        await json(route, globalPrompts.find((prompt) => prompt.layer === globalPrompt[1]))
        return
      }

      const promptWorkspace = /^\/api\/prompts\/([^/]+)$/.exec(path)
      if (promptWorkspace) {
        const workspaceId = promptWorkspace[1] ?? ''
        const override = workspaceOverrides.get(workspaceId)
        await json(route, {
          workspaceId,
          layers: [{
            layer: 'date_context',
            content: override?.content ?? globalPrompts[0]?.content ?? '',
            enabled: override?.enabled ?? globalPrompts[0]?.enabled ?? true,
            isTemplate: true,
            isGlobal: !override,
          }],
        })
        return
      }

      const workspacePrompt = /^\/api\/prompts\/([^/]+)\/([^/]+)$/.exec(path)
      if (workspacePrompt && (method === 'PUT' || method === 'DELETE')) {
        const workspaceId = workspacePrompt[1] ?? ''
        if (method === 'DELETE') {
          workspaceOverrides.delete(workspaceId)
        } else {
          const update = request.postDataJSON() as { content?: string; enabled?: boolean }
          const current = workspaceOverrides.get(workspaceId) ?? {
            content: globalPrompts[0]?.content ?? '',
            enabled: globalPrompts[0]?.enabled ?? true,
          }
          workspaceOverrides.set(workspaceId, { ...current, ...update })
        }
        await json(route, { success: true })
        return
      }

      await json(route, { error: { message: `Unhandled mock route: ${method} ${path}` } }, 404)
    })

    await use(undefined)
  }, { auto: true }],
})

export { expect }
