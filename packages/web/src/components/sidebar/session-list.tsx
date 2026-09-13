/**
 * SessionList Component
 *
 * Displays sessions for the current workspace in the sidebar.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { MessageSquare, Plus, Trash2, Loader2 } from 'lucide-react'
import { useSessionStore } from '@/viewmodels/session.viewmodel'
import { useWorkspaceStore } from '@/viewmodels/workspace.viewmodel'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@nocoo/basalt/components/tooltip'
import { Button } from '@nocoo/basalt/components/button'

interface SessionListProps {
  collapsed?: boolean
  onSelection?: (() => void) | undefined
}

export function SessionList({ collapsed = false, onSelection }: SessionListProps) {
  const navigate = useNavigate()
  const { currentWorkspace } = useWorkspaceStore()
  const {
    sessions,
    currentSession,
    isLoading,
    fetchSessions,
    createSession,
    selectSession,
    deleteSession,
  } = useSessionStore()

  // Fetch sessions when workspace changes
  useEffect(() => {
    if (currentWorkspace) {
      void fetchSessions(currentWorkspace.id)
    }
  }, [currentWorkspace, fetchSessions])

  const handleNewSession = async () => {
    if (!currentWorkspace) return

    const session = await createSession(currentWorkspace.id, {
      name: `Session ${String(sessions.length + 1)}`,
      model: 'claude-sonnet-4-20250514',
    })
    if (session) {
      onSelection?.()
    }
  }

  const handleSelectSession = (sessionId: string) => {
    selectSession(sessionId)
    void navigate('/')
    onSelection?.()
  }

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!currentWorkspace) return

    await deleteSession(currentWorkspace.id, sessionId)
  }

  if (!currentWorkspace) {
    return collapsed ? null : (
      <div className="px-4 py-3 text-sm text-basalt-muted-foreground">
        Select a workspace to view sessions
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 px-2 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              onClick={() => {
                void handleNewSession()
              }}
              disabled={isLoading}
              className="h-10 w-10"
              aria-label="New session"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Plus className="h-5 w-5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New Session</TooltipContent>
        </Tooltip>

        {sessions.slice(0, 5).map((session) => (
          <Tooltip key={session.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  handleSelectSession(session.id)
                }}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                  currentSession?.id === session.id
                    ? 'bg-basalt-accent text-basalt-foreground'
                    : 'text-basalt-muted-foreground hover:bg-basalt-accent hover:text-basalt-foreground'
                  )}
                aria-label={session.name ?? 'Session'}
              >
                <MessageSquare className="h-5 w-5" strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{session.name}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    )
  }

  return (
    <div className="py-2">
      <div className="flex items-center justify-between px-4 mb-2">
        <span className="text-sm font-medium text-basalt-muted-foreground">
          Sessions
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            void handleNewSession()
          }}
          disabled={isLoading}
          aria-label="New session"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="space-y-0.5 px-3">
        {sessions.length === 0 ? (
          <Button
            variant="outline"
            onClick={() => {
              void handleNewSession()
            }}
            disabled={isLoading}
            className="group h-auto w-full flex-col border-dashed px-3 py-6"
          >
            <MessageSquare className="h-6 w-6 mx-auto mb-2 text-basalt-muted-foreground/50 group-hover:text-basalt-primary/70 transition-colors" />
            <p className="text-sm font-medium text-basalt-muted-foreground group-hover:text-basalt-foreground transition-colors">
              Start your first session
            </p>
            <p className="text-xs text-basalt-muted-foreground/60 mt-1">
              Click to create
            </p>
          </Button>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group flex w-full items-center rounded-lg text-sm transition-colors',
                currentSession?.id === session.id
                  ? 'bg-basalt-accent text-basalt-foreground'
                  : 'text-basalt-muted-foreground hover:bg-basalt-accent hover:text-basalt-foreground'
              )}
            >
              <Button
                variant="ghost"
                className="min-w-0 flex-1 justify-start gap-3 bg-transparent px-3 py-2.5 hover:bg-transparent"
                onClick={() => {
                  handleSelectSession(session.id)
                }}
              >
                <MessageSquare className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="truncate">{session.name}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  void handleDeleteSession(e, session.id)
                }}
                className="h-7 w-7 shrink-0 opacity-0 hover:bg-basalt-destructive/10 hover:text-basalt-destructive group-hover:opacity-100"
                aria-label="Delete session"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
