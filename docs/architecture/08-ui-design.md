# 08 - UI Design

## Overview

Frogie's web UI provides a chat interface for interacting with the AI agent, with full visibility into tool executions, thinking processes, and session management.

## Technology Stack

- **Framework**: React 18+
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui
- **State**: Zustand (for global state)
- **Markdown**: react-markdown + remark-gfm + rehype-highlight

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
    <Header>
      <Logo />
      <WorkspaceSelector />
      <SettingsButton />
    </Header>
    
    <Sidebar>
      <SessionList />
      <MCPStatus />
    </Sidebar>
    
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
  </AppShell>
  
  <PermissionDialog />
  <SettingsDialog />
  <WorkspaceDialog />
</App>
```

## Key Components

### ChatPanel

The main chat interface:

```tsx
// packages/web/src/components/ChatPanel.tsx

export function ChatPanel() {
  const { sessionId, workspaceId } = useCurrentSession()
  const { messages, isLoading, stats } = useChatStore()
  const { sendMessage, interrupt } = useChatActions()
  
  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <MessageList messages={messages} />
      </div>
      
      {/* Input */}
      <div className="border-t p-4">
        <ChatInput
          onSend={sendMessage}
          onStop={interrupt}
          isLoading={isLoading}
        />
        {stats && <StatsBar stats={stats} />}
      </div>
    </div>
  )
}
```

### MessageList

Renders the conversation:

```tsx
// packages/web/src/components/MessageList.tsx

export function MessageList({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  
  return (
    <div className="space-y-4">
      {messages.map((msg) => {
        switch (msg.role) {
          case 'user':
            return <UserMessage key={msg.id} message={msg} />
          case 'assistant':
            return <AssistantMessage key={msg.id} message={msg} />
          case 'system':
            return <SystemMessage key={msg.id} message={msg} />
        }
      })}
      <div ref={bottomRef} />
    </div>
  )
}
```

### AssistantMessage

Renders assistant content with thinking, text, and tool use:

```tsx
// packages/web/src/components/AssistantMessage.tsx

export function AssistantMessage({ message }: { message: AssistantMsg }) {
  return (
    <div className="flex gap-3">
      <Avatar className="h-8 w-8">
        <BotIcon className="h-5 w-5" />
      </Avatar>
      
      <div className="flex-1 space-y-2">
        {message.content.map((block, i) => {
          switch (block.type) {
            case 'thinking':
              return <ThinkingBlock key={i} content={block.thinking} />
            case 'text':
              return <TextBlock key={i} text={block.text} />
            case 'tool_use':
              return (
                <ToolUseCard
                  key={i}
                  id={block.id}
                  name={block.name}
                  input={block.input}
                />
              )
          }
        })}
      </div>
    </div>
  )
}
```

### ThinkingBlock

Collapsible thinking content:

```tsx
// packages/web/src/components/ThinkingBlock.tsx

export function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="bg-amber-50 dark:bg-amber-950 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
      <button
        className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm font-medium"
        onClick={() => setExpanded(!expanded)}
      >
        <BrainIcon className="h-4 w-4" />
        Thinking
        <ChevronIcon className={cn("h-4 w-4 transition", expanded && "rotate-180")} />
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

Displays tool invocation with expandable input:

```tsx
// packages/web/src/components/ToolUseCard.tsx

export function ToolUseCard({ id, name, input, result }: ToolUseProps) {
  const [expanded, setExpanded] = useState(false)
  
  const icon = TOOL_ICONS[name] ?? WrenchIcon
  
  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 p-3 bg-muted/50 hover:bg-muted"
        onClick={() => setExpanded(!expanded)}
      >
        <icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{name}</span>
        <ChevronIcon className={cn("ml-auto h-4 w-4", expanded && "rotate-180")} />
      </button>
      
      {/* Input */}
      {expanded && (
        <div className="p-3 bg-muted/30 border-t">
          <pre className="text-xs overflow-x-auto">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
      
      {/* Result */}
      {result && (
        <div className={cn(
          "p-3 border-t text-sm",
          result.isError ? "bg-red-50 dark:bg-red-950" : "bg-green-50 dark:bg-green-950"
        )}>
          <div className="flex items-center gap-2 mb-2">
            {result.isError ? (
              <XCircleIcon className="h-4 w-4 text-red-500" />
            ) : (
              <CheckCircleIcon className="h-4 w-4 text-green-500" />
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

### ChatInput

Input area with model selector:

```tsx
// packages/web/src/components/ChatInput.tsx

export function ChatInput({ onSend, onStop, isLoading }: ChatInputProps) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const handleSubmit = () => {
    if (!input.trim() || isLoading) return
    onSend(input)
    setInput('')
  }
  
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }
  
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="min-h-[80px] resize-none"
          disabled={isLoading}
        />
        
        <div className="flex flex-col gap-2">
          {isLoading ? (
            <Button variant="destructive" size="icon" onClick={onStop}>
              <StopIcon className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={handleSubmit} disabled={!input.trim()}>
              <SendIcon className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <ModelSelector />
      </div>
    </div>
  )
}
```

### PermissionDialog

Modal for confirming dangerous operations:

```tsx
// packages/web/src/components/PermissionDialog.tsx

export function PermissionDialog() {
  const { pendingPermission, respond } = usePermission()
  
  if (!pendingPermission) return null
  
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="h-5 w-5 text-amber-500" />
            Permission Required
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The agent wants to execute:
          </p>
          
          <div className="bg-muted p-3 rounded-lg">
            <div className="font-medium">{pendingPermission.toolName}</div>
            <pre className="text-xs mt-2 overflow-x-auto">
              {JSON.stringify(pendingPermission.input, null, 2)}
            </pre>
          </div>
        </div>
        
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => respond(false)}>
            Deny
          </Button>
          <Button onClick={() => respond(true)}>
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

## State Management

### Chat Store

```tsx
// packages/web/src/stores/chat.ts

import { create } from 'zustand'

interface ChatState {
  messages: Message[]
  isLoading: boolean
  stats: TurnStats | null
  error: string | null
  
  // Actions
  addMessage: (msg: Message) => void
  appendText: (text: string) => void
  setToolResult: (id: string, result: ToolResult) => void
  setLoading: (loading: boolean) => void
  setStats: (stats: TurnStats) => void
  setError: (error: string | null) => void
  clear: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  stats: null,
  error: null,
  
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  
  appendText: (text) => set((s) => {
    const messages = [...s.messages]
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant') {
      // Append to last assistant message
      const lastContent = last.content[last.content.length - 1]
      if (lastContent?.type === 'text') {
        lastContent.text += text
      } else {
        last.content.push({ type: 'text', text })
      }
    }
    return { messages }
  }),
  
  setToolResult: (id, result) => set((s) => {
    // Find and update tool result...
  }),
  
  setLoading: (isLoading) => set({ isLoading }),
  setStats: (stats) => set({ stats }),
  setError: (error) => set({ error }),
  clear: () => set({ messages: [], stats: null, error: null }),
}))
```

### WebSocket Hook

```tsx
// packages/web/src/hooks/useChatWebSocket.ts

export function useChatWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const store = useChatStore()
  
  const connect = useCallback(() => {
    const ws = new WebSocket('ws://localhost:7025/ws/chat')
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      
      switch (msg.type) {
        case 'text':
          store.appendText(msg.text)
          break
        case 'thinking':
          store.appendThinking(msg.content)
          break
        case 'tool_use':
          store.addToolUse(msg.id, msg.name, msg.input)
          break
        case 'tool_result':
          store.setToolResult(msg.id, msg)
          break
        case 'turn_complete':
          store.setLoading(false)
          store.setStats(msg.stats)
          break
        case 'error':
          store.setLoading(false)
          store.setError(msg.message)
          break
      }
    }
    
    wsRef.current = ws
  }, [store])
  
  const sendMessage = useCallback((prompt: string, sessionId: string, workspaceId: string) => {
    if (!wsRef.current) return
    
    store.setLoading(true)
    store.addMessage({ role: 'user', content: [{ type: 'text', text: prompt }] })
    
    wsRef.current.send(JSON.stringify({
      type: 'chat',
      sessionId,
      workspaceId,
      prompt,
    }))
  }, [store])
  
  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'interrupt' }))
  }, [])
  
  return { connect, sendMessage, interrupt }
}
```

## Visual Design

### Color Scheme

```css
/* Light mode */
--background: white;
--foreground: #0f172a;
--muted: #f1f5f9;
--accent: #6366f1;

/* Dark mode */
--background: #0f172a;
--foreground: #f8fafc;
--muted: #1e293b;
--accent: #818cf8;

/* Tool colors */
--thinking-bg: #fefce8;  /* amber-50 */
--success-bg: #f0fdf4;   /* green-50 */
--error-bg: #fef2f2;     /* red-50 */
```

### Layout Mockup

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
