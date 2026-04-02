/**
 * ChatPanel Component
 *
 * Container for the chat interface, composing MessageList and ChatInput.
 * Includes model selector for per-session model override.
 */

import { useState, useEffect } from 'react'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'
import { useChatStore } from '@/viewmodels/chat.viewmodel'
import { useSessionStore } from '@/viewmodels/session.viewmodel'
import { useWorkspaceStore } from '@/viewmodels/workspace.viewmodel'
import { useModelsStore, getModelDisplayInfo } from '@/viewmodels/models.viewmodel'
import { AlertCircle, Wifi, WifiOff, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export function ChatPanel() {
  const [inputValue, setInputValue] = useState('')
  const [selectedModel, setSelectedModel] = useState('')

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

  // Models store
  const {
    models: availableModels,
    defaultModel,
    fetchModels,
    getGroupedModels,
  } = useModelsStore()

  // Connect to WebSocket on mount
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  // Fetch models on mount
  useEffect(() => {
    void fetchModels()
  }, [fetchModels])

  // Reset selected model to default when session changes
  useEffect(() => {
    if (defaultModel) {
      setSelectedModel(defaultModel)
    }
  }, [currentSession?.id, defaultModel])

  // Get model groups and display info
  const modelGroups = getGroupedModels()
  const selectedModelInfo = getModelDisplayInfo(selectedModel, availableModels)

  const handleSend = () => {
    if (!currentWorkspace || !currentSession) {
      return
    }

    const prompt = inputValue.trim()
    if (!prompt) return

    sendMessage(currentWorkspace.id, currentSession.id, prompt, selectedModel || undefined)
    setInputValue('')
  }

  const handleStop = () => {
    interrupt()
  }

  const isConnected = status === 'connected'
  const canSend = isConnected && currentWorkspace && currentSession

  return (
    <div className="flex h-full flex-col">
      {/* Connection status & Model selector */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-4">
          {/* Connection status */}
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

          {/* Model selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-2">
                {selectedModelInfo ? (
                  <>
                    <span>{selectedModelInfo.icon}</span>
                    <span className="max-w-[120px] truncate">{selectedModelInfo.name}</span>
                  </>
                ) : selectedModel ? (
                  <span className="max-w-[150px] truncate font-mono text-xs">{selectedModel}</span>
                ) : (
                  <span className="text-muted-foreground">Select model</span>
                )}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px] max-h-[400px] overflow-y-auto">
              {modelGroups.length > 0 ? (
                modelGroups.map((group, groupIndex) => (
                  <div key={group.label}>
                    {groupIndex > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="flex items-center gap-2">
                      <span>{group.icon}</span>
                      <span>{group.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        ({group.models.length})
                      </span>
                    </DropdownMenuLabel>
                    {group.models.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => { setSelectedModel(m.id) }}
                        className={cn(
                          'flex flex-col items-start gap-0.5 pl-6',
                          selectedModel === m.id && 'bg-accent'
                        )}
                      >
                        <span>{m.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {m.id}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))
              ) : (
                <DropdownMenuItem disabled>
                  No models available
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
