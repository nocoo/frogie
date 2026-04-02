# 08 - UI Design

## Overview

Frogie's web UI is built on the **Basalt template** (Gen 2 architecture), providing a chat interface for interacting with the AI agent with full visibility into tool executions, thinking processes, and session management.

## Technology Stack

| Layer | Choice | Version |
|-------|--------|---------|
| Framework | React | 19 |
| Build Tool | Vite | 7 |
| Styling | Tailwind CSS | 4 |
| Components | shadcn/ui | default theme |
| Icons | Lucide React | latest |
| Charts | Recharts | latest |
| State | Zustand | latest |
| Toast | sonner | latest |
| Command Palette | cmdk | latest |
| Markdown | react-markdown + remark-gfm + rehype-highlight | latest |

## Architecture: MVVM (Model-View-ViewModel)

Frogie strictly follows the MVVM pattern from the Basalt template:

```
┌─────────────────────────────────────────────────────────────┐
│                         View Layer                          │
│   React Components (UI only, no business logic)            │
│   ├── pages/           Routing shells                      │
│   ├── components/      Presentational components           │
│   └── layouts/         Layout shells                       │
└─────────────────────────────┬───────────────────────────────┘
                              │ binds to
┌─────────────────────────────▼───────────────────────────────┐
│                     ViewModel Layer                         │
│   State + Logic (Zustand stores + custom hooks)            │
│   ├── viewmodels/      Zustand stores                      │
│   ├── hooks/           Custom React hooks                  │
│   └── transformers/    Data transformation functions       │
└─────────────────────────────┬───────────────────────────────┘
                              │ uses
┌─────────────────────────────▼───────────────────────────────┐
│                       Model Layer                           │
│   Data structures + API clients                            │
│   ├── models/          TypeScript types/interfaces         │
│   ├── api/             API client functions                │
│   └── schemas/         Zod validation schemas              │
└─────────────────────────────────────────────────────────────┘
```

### Coverage Requirements

| Layer | Coverage | Rationale |
|-------|----------|-----------|
| Model | ≥ 95% | Core data structures, must be rock solid |
| ViewModel | ≥ 95% | Business logic, critical for correctness |
| Transformers | ≥ 95% | Data flow integrity |
| View | Exempt | Thin presentation, tested via E2E |

## Directory Structure

```
packages/web/src/
├── models/                    # Data types (≥95% coverage)
│   ├── message.ts            # Message, ContentBlock types
│   ├── session.ts            # Session, Workspace types
│   ├── tool.ts               # ToolCall, ToolResult types
│   └── index.ts              # Re-exports
│
├── schemas/                   # Zod validation (≥95% coverage)
│   ├── message.schema.ts
│   ├── session.schema.ts
│   └── api.schema.ts
│
├── viewmodels/                # Zustand stores (≥95% coverage)
│   ├── chat.viewmodel.ts     # Chat state + actions
│   ├── session.viewmodel.ts  # Session management
│   ├── workspace.viewmodel.ts
│   └── settings.viewmodel.ts
│
├── hooks/                     # Custom hooks (≥95% coverage)
│   ├── use-chat-websocket.ts
│   ├── use-session.ts
│   └── use-workspace.ts
│
├── transformers/              # Data transformers (≥95% coverage)
│   ├── message.transformer.ts
│   ├── content-block.transformer.ts
│   └── tool-result.transformer.ts
│
├── api/                       # API clients (≥95% coverage)
│   ├── sessions.api.ts
│   ├── workspaces.api.ts
│   └── mcp.api.ts
│
├── components/                # UI components (coverage exempt)
│   ├── ui/                   # shadcn/ui primitives
│   ├── chat/                 # Chat-specific components
│   │   ├── chat-panel.tsx
│   │   ├── message-list.tsx
│   │   ├── user-message.tsx
│   │   ├── assistant-message.tsx
│   │   ├── thinking-block.tsx
│   │   ├── tool-use-card.tsx
│   │   └── chat-input.tsx
│   ├── sidebar/              # Gen 2 sidebar system
│   │   ├── app-sidebar.tsx
│   │   ├── sidebar-context.tsx
│   │   ├── sidebar-provider.tsx
│   │   └── session-list.tsx
│   └── shared/               # Shared components
│       ├── settings-dialog.tsx
│       └── workspace-selector.tsx
│
├── layouts/                   # Layout shells (coverage exempt)
│   ├── app-shell.tsx         # Gen 2 shell with sidebar-context
│   └── dashboard-layout.tsx
│
├── pages/                     # Route pages (coverage exempt)
│   ├── chat.tsx
│   └── settings.tsx
│
├── styles/
│   ├── globals.css
│   └── palette.ts            # 24-color chart palette (--chart-1~24)
│
└── lib/
    └── utils.ts              # cn() and utilities
```

## Gen 2 Sidebar Architecture

Basalt Gen 2 uses Context pattern for sidebar state management:

```tsx
// packages/web/src/components/sidebar/sidebar-context.tsx

interface SidebarContextValue {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (collapsed: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  
  const toggle = useCallback(() => setCollapsed(c => !c), [])
  
  return (
    <SidebarContext.Provider value={{
      collapsed,
      toggle,
      setCollapsed,
      mobileOpen,
      setMobileOpen,
    }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within SidebarProvider')
  return context
}
```

### App Shell

```tsx
// packages/web/src/layouts/app-shell.tsx

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen">
        <AppSidebar />
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </SidebarProvider>
  )
}
```

## Page Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              App Shell                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Header: Logo │ Workspace Selector │ Settings                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────┬─────────────────────────────────────────────────────┐  │
│  │   Sidebar   │                    Main                             │  │
│  │             │                                                      │  │
│  │  Sessions   │               ChatPanel                             │  │
│  │  ─────────  │                                                      │  │
│  │  [+ New]    │                                                      │  │
│  │  ○ Session1 │                                                      │  │
│  │  ● Session2 │                                                      │  │
│  │             │                                                      │  │
│  │  ─────────  │                                                      │  │
│  │  MCP        │                                                      │  │
│  │  🟢 memory  │                                                      │  │
│  │  🟢 linear  │                                                      │  │
│  │             │                                                      │  │
│  └─────────────┴─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Hierarchy

```
<App>
  <AppShell>
    <SidebarProvider>              {/* Gen 2 Context */}
      <Header>
        <Logo />
        <WorkspaceSelector />
        <SettingsButton />
      </Header>
      
      <AppSidebar>                 {/* Gen 2 Sidebar */}
        <SessionList />
        <MCPStatus />
      </AppSidebar>
      
      <Main>
        <ChatPanel>
          <MessageList>
            <UserMessage />
            <AssistantMessage>
              <ThinkingBlock />
              <TextBlock />
              <ToolUseCard />
            </AssistantMessage>
            <ToolResultMessage />
            <CompactBoundary />
          </MessageList>
          
          <ChatInput>
            <TextArea />
            <ModelSelector />
            <SendButton />
            <StopButton />
          </ChatInput>
          
          <StatsBar />
        </ChatPanel>
      </Main>
    </SidebarProvider>
  </AppShell>
  
  <SettingsDialog />
  <WorkspaceDialog />
</App>
```

## ViewModel Examples

### Chat ViewModel

```typescript
// packages/web/src/viewmodels/chat.viewmodel.ts

import { create } from 'zustand'
import type { Message, TurnStats, ToolResult } from '@/models'

interface ChatState {
  messages: Message[]
  isLoading: boolean
  stats: TurnStats | null
  error: string | null
}

interface ChatActions {
  addMessage: (msg: Message) => void
  appendText: (text: string) => void
  addToolUse: (id: string, name: string, input: unknown) => void
  setToolResult: (id: string, result: ToolResult) => void
  setLoading: (loading: boolean) => void
  setStats: (stats: TurnStats) => void
  setError: (error: string | null) => void
  clear: () => void
}

type ChatStore = ChatState & ChatActions

const initialState: ChatState = {
  messages: [],
  isLoading: false,
  stats: null,
  error: null,
}

export const useChatStore = create<ChatStore>((set, get) => ({
  ...initialState,
  
  addMessage: (msg) => set((s) => ({ 
    messages: [...s.messages, msg] 
  })),
  
  appendText: (text) => set((s) => {
    const messages = [...s.messages]
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant') {
      const content = [...last.content]
      const lastBlock = content[content.length - 1]
      if (lastBlock?.type === 'text') {
        content[content.length - 1] = { 
          ...lastBlock, 
          text: lastBlock.text + text 
        }
      } else {
        content.push({ type: 'text', text })
      }
      messages[messages.length - 1] = { ...last, content }
    }
    return { messages }
  }),
  
  addToolUse: (id, name, input) => set((s) => {
    const messages = [...s.messages]
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant') {
      const content = [...last.content, { type: 'tool_use', id, name, input }]
      messages[messages.length - 1] = { ...last, content }
    }
    return { messages }
  }),
  
  setToolResult: (id, result) => set((s) => {
    // Update tool result in message list
    const messages = s.messages.map(msg => {
      if (msg.role !== 'assistant') return msg
      const content = msg.content.map(block => {
        if (block.type === 'tool_use' && block.id === id) {
          return { ...block, result }
        }
        return block
      })
      return { ...msg, content }
    })
    return { messages }
  }),
  
  setLoading: (isLoading) => set({ isLoading }),
  setStats: (stats) => set({ stats }),
  setError: (error) => set({ error }),
  clear: () => set(initialState),
}))
```

### Session ViewModel

```typescript
// packages/web/src/viewmodels/session.viewmodel.ts

import { create } from 'zustand'
import type { Session } from '@/models'

interface SessionState {
  sessions: Session[]
  currentSessionId: string | null
  isLoading: boolean
}

interface SessionActions {
  setSessions: (sessions: Session[]) => void
  setCurrentSession: (id: string | null) => void
  addSession: (session: Session) => void
  updateSession: (id: string, updates: Partial<Session>) => void
  removeSession: (id: string) => void
  setLoading: (loading: boolean) => void
}

type SessionStore = SessionState & SessionActions

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  currentSessionId: null,
  isLoading: false,
  
  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  addSession: (session) => set((s) => ({ 
    sessions: [session, ...s.sessions] 
  })),
  updateSession: (id, updates) => set((s) => ({
    sessions: s.sessions.map(sess => 
      sess.id === id ? { ...sess, ...updates } : sess
    )
  })),
  removeSession: (id) => set((s) => ({
    sessions: s.sessions.filter(sess => sess.id !== id),
    currentSessionId: s.currentSessionId === id ? null : s.currentSessionId,
  })),
  setLoading: (isLoading) => set({ isLoading }),
}))
```

## Color System (palette.ts)

Based on Basalt's 24-color chart palette:

```typescript
// packages/web/src/styles/palette.ts

export const chartColors = {
  1: 'hsl(var(--chart-1))',
  2: 'hsl(var(--chart-2))',
  3: 'hsl(var(--chart-3))',
  4: 'hsl(var(--chart-4))',
  5: 'hsl(var(--chart-5))',
  // ... up to 24
} as const

// CSS variables in globals.css
// --chart-1 through --chart-24 for consistent theming
```

### Theme Variables

```css
/* packages/web/src/styles/globals.css */

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --muted: 210 40% 96%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96%;
    --accent-foreground: 222.2 47.4% 11.2%;
    
    /* Frogie-specific */
    --thinking-bg: 48 96% 89%;      /* amber-50 */
    --success-bg: 142 76% 94%;      /* green-50 */
    --error-bg: 0 86% 97%;          /* red-50 */
    
    /* Chart palette (24 colors) */
    --chart-1: 12 76% 61%;
    --chart-2: 173 58% 39%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;
    /* ... */
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    
    --thinking-bg: 38 92% 16%;      /* amber-950 */
    --success-bg: 143 64% 10%;      /* green-950 */
    --error-bg: 0 63% 13%;          /* red-950 */
  }
}
```

## Key Components

### ChatPanel

```tsx
// packages/web/src/components/chat/chat-panel.tsx

export function ChatPanel() {
  const { messages, isLoading, stats } = useChatStore()
  const { sendMessage, interrupt } = useChatWebSocket()
  const { currentSessionId } = useSessionStore()
  const { currentWorkspaceId } = useWorkspaceStore()
  
  const handleSend = (prompt: string) => {
    if (!currentSessionId || !currentWorkspaceId) return
    sendMessage(prompt, currentSessionId, currentWorkspaceId)
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        <MessageList messages={messages} />
      </div>
      
      <div className="border-t p-4">
        <ChatInput
          onSend={handleSend}
          onStop={interrupt}
          isLoading={isLoading}
        />
        {stats && <StatsBar stats={stats} />}
      </div>
    </div>
  )
}
```

### ThinkingBlock

```tsx
// packages/web/src/components/chat/thinking-block.tsx

import { useState } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ThinkingBlockProps {
  content: string
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="bg-[hsl(var(--thinking-bg))] rounded-lg p-3 border border-amber-200 dark:border-amber-800">
      <button
        className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm font-medium w-full"
        onClick={() => setExpanded(!expanded)}
      >
        <Brain className="h-4 w-4" />
        <span>Thinking</span>
        <ChevronDown className={cn(
          "h-4 w-4 ml-auto transition-transform",
          expanded && "rotate-180"
        )} />
      </button>
      
      {expanded && (
        <div className="mt-2 text-sm text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  )
}
```

### ToolUseCard

```tsx
// packages/web/src/components/chat/tool-use-card.tsx

import { useState } from 'react'
import { ChevronDown, CheckCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TOOL_ICONS } from '@/lib/tool-icons'
import type { ToolResult } from '@/models'

interface ToolUseCardProps {
  id: string
  name: string
  input: unknown
  result?: ToolResult
}

export function ToolUseCard({ id, name, input, result }: ToolUseCardProps) {
  const [expanded, setExpanded] = useState(false)
  
  const Icon = TOOL_ICONS[name] ?? TOOL_ICONS.default
  
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-3 bg-muted/50 hover:bg-muted transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{name}</span>
        <ChevronDown className={cn(
          "ml-auto h-4 w-4 transition-transform",
          expanded && "rotate-180"
        )} />
      </button>
      
      {expanded && (
        <div className="p-3 bg-muted/30 border-t">
          <pre className="text-xs overflow-x-auto">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
      
      {result && (
        <div className={cn(
          "p-3 border-t text-sm",
          result.isError 
            ? "bg-[hsl(var(--error-bg))]" 
            : "bg-[hsl(var(--success-bg))]"
        )}>
          <div className="flex items-center gap-2 mb-2">
            {result.isError ? (
              <XCircle className="h-4 w-4 text-red-500" />
            ) : (
              <CheckCircle className="h-4 w-4 text-green-500" />
            )}
            <span className="text-xs font-medium">
              {result.isError ? 'Error' : 'Result'}
            </span>
          </div>
          <pre className="text-xs overflow-x-auto max-h-60 overflow-y-auto">
            {result.output}
          </pre>
        </div>
      )}
    </div>
  )
}
```

## WebSocket Hook

**Note**: Event types must match the protocol defined in `07-api-protocol.md`.

```tsx
// packages/web/src/hooks/use-chat-websocket.ts

import { useRef, useCallback, useEffect } from 'react'
import { useChatStore } from '@/viewmodels/chat.viewmodel'

const WS_URL = 'ws://localhost:7034/ws/chat'

export function useChatWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const store = useChatStore()
  
  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL)
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      
      switch (msg.type) {
        case 'session_start':
          // Session started, could store model info
          break
        case 'text':
          store.appendText(msg.text)
          break
        case 'thinking':
          // Handle thinking blocks
          break
        case 'tool_use':
          store.addToolUse(msg.id, msg.name, msg.input)
          break
        case 'tool_result':
          store.setToolResult(msg.id, {
            output: msg.output,
            isError: msg.isError,
          })
          break
        case 'compact_start':
          // Could show compacting indicator
          break
        case 'compact_done':
          // Could show summary
          break
        case 'turn_complete':
          store.setLoading(false)
          // Fields are flat, not nested in stats
          store.setStats({
            turns: msg.turns,
            inputTokens: msg.inputTokens,
            outputTokens: msg.outputTokens,
            costUsd: msg.costUsd,
            durationMs: msg.durationMs,
          })
          break
        case 'budget_exceeded':
          store.setLoading(false)
          store.setError(`Budget exceeded: $${msg.costUsd}`)
          break
        case 'session_saved':
          // Session persisted
          break
        case 'error':
          store.setLoading(false)
          store.setError(msg.message)
          break
        case 'interrupted':
          store.setLoading(false)
          break
      }
    }
    
    ws.onclose = () => {
      // Reconnect logic
      setTimeout(connect, 1000)
    }
    
    wsRef.current = ws
  }, [store])
  
  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])
  
  const sendMessage = useCallback((
    prompt: string,
    sessionId: string,
    workspaceId: string
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    
    store.setLoading(true)
    store.addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      created_at: Date.now(),
    })
    
    wsRef.current.send(JSON.stringify({
      type: 'chat',
      sessionId,
      workspaceId,
      prompt,
    }))
  }, [store])
  
  const interrupt = useCallback((sessionId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'interrupt', sessionId }))
  }, [])
  
  return { sendMessage, interrupt }
}
```

## Layout Mockup

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🐸 Frogie                    [~/workspace/my-project ▼]        [⚙️]    │
├─────────────┬────────────────────────────────────────────────────────────┤
│  Sessions   │                                                            │
│  ─────────  │  ┌──────────────────────────────────────────────────────┐ │
│  [+ New]    │  │ 👤 User                                    10:32 AM  │ │
│             │  │ Help me refactor the auth module using JWT           │ │
│  ● Auth fix │  └──────────────────────────────────────────────────────┘ │
│  ○ Debug    │                                                            │
│  ○ Tests    │  ┌──────────────────────────────────────────────────────┐ │
│             │  │ 🤖 Assistant                                          │ │
│ ──────────  │  │                                                        │ │
│  MCP        │  │ ┌────────────────────────────────────────────────┐   │ │
│  ─────────  │  │ │ 💭 Thinking                             [▼]    │   │ │
│  🟢 memory  │  │ │ I need to understand the current auth impl...  │   │ │
│  🟢 linear  │  │ └────────────────────────────────────────────────┘   │ │
│             │  │                                                        │ │
│             │  │ ┌────────────────────────────────────────────────┐   │ │
│             │  │ │ 🔍 Glob                                  [▼]   │   │ │
│             │  │ │ pattern: "src/auth/**/*.ts"                    │   │ │
│             │  │ ├────────────────────────────────────────────────┤   │ │
│             │  │ │ ✓ Found 5 files                                │   │ │
│             │  │ └────────────────────────────────────────────────┘   │ │
│             │  │                                                        │ │
│             │  │ I found 5 auth-related files. Let me read them...    │ │
│             │  │                                                        │ │
│             │  └──────────────────────────────────────────────────────┘ │
│             │                                                            │
│             │  ┌──────────────────────────────────────────────────────┐ │
│             │  │ [____________________________________] [Send] [⏹]   │ │
│             │  │ claude-sonnet-4-6 ▼      3 turns │ $0.02 │ 1.2k tok │ │
│             │  └──────────────────────────────────────────────────────┘ │
└─────────────┴────────────────────────────────────────────────────────────┘
```
