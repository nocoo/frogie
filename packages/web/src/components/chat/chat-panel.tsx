/**
 * ChatPanel Component
 *
 * Container for the chat interface, composing MessageList and ChatInput.
 */

import { useState, useEffect } from 'react'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'
import { useChatStore } from '@/viewmodels/chat.viewmodel'
import { useSessionStore } from '@/viewmodels/session.viewmodel'
import { useWorkspaceStore } from '@/viewmodels/workspace.viewmodel'
import { AlertCircle, Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ChatPanel() {
  const [inputValue, setInputValue] = useState('')

  // Chat store
  const {
    messages,
    status,
    isProcessing,
    error,
    turnStats,
    connect,
    disconnect,
    sendMessage,
    interrupt,
    clearError,
  } = useChatStore()

  // Session store
  const { currentSession } = useSessionStore()

  // Workspace store
  const { currentWorkspace } = useWorkspaceStore()

  // Connect to WebSocket on mount
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  const handleSend = () => {
    if (!currentWorkspace || !currentSession) {
      return
    }

    const prompt = inputValue.trim()
    if (!prompt) return

    sendMessage(currentWorkspace.id, currentSession.id, prompt)
    setInputValue('')
  }

  const handleStop = () => {
    interrupt()
  }

  const isConnected = status === 'connected'
  const canSend = isConnected && currentWorkspace && currentSession

  return (
    <div className="flex h-full flex-col">
      {/* Connection status */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2 text-sm">
          {status === 'connected' ? (
            <>
              <Wifi className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">Connected</span>
            </>
          ) : status === 'connecting' ? (
            <>
              <Wifi className="h-4 w-4 text-yellow-500 animate-pulse" />
              <span className="text-muted-foreground">Connecting...</span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-red-500" />
              <span className="text-muted-foreground">Disconnected</span>
            </>
          )}
        </div>

        {turnStats && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{turnStats.turns} turns</span>
            <span>{turnStats.inputTokens + turnStats.outputTokens} tokens</span>
            <span>${turnStats.costUsd.toFixed(4)}</span>
            <span>{(turnStats.durationMs / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm',
            'bg-destructive/10 text-destructive border-b border-destructive/20'
          )}
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={clearError}
            className="text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* No session selected */}
      {!currentSession && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-lg font-medium">No session selected</p>
            <p className="text-sm">Select or create a session to start chatting</p>
          </div>
        </div>
      )}

      {/* Messages */}
      {currentSession && (
        <>
          <MessageList messages={messages} isLoading={isProcessing} />

          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            onStop={handleStop}
            isLoading={isProcessing}
            disabled={!canSend}
            placeholder={
              !isConnected
                ? 'Connecting...'
                : !currentWorkspace
                  ? 'Select a workspace...'
                  : 'Type a message...'
            }
          />
        </>
      )}
    </div>
  )
}
