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
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

interface SessionListProps {
  collapsed?: boolean
}

export function SessionList({ collapsed = false }: SessionListProps) {
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

    await createSession(currentWorkspace.id, {
      name: `Session ${String(sessions.length + 1)}`,
      model: 'claude-sonnet-4-20250514',
    })
  }

  const handleSelectSession = (sessionId: string) => {
    selectSession(sessionId)
    void navigate('/')
  }

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!currentWorkspace) return

    await deleteSession(currentWorkspace.id, sessionId)
  }

  if (!currentWorkspace) {
    return collapsed ? null : (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        Select a workspace to view sessions
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 px-2 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => {
                void handleNewSession()
              }}
              disabled={isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Plus className="h-5 w-5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">New Session</TooltipContent>
        </Tooltip>

        {sessions.slice(0, 5).map((session) => (
          <Tooltip key={session.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  handleSelectSession(session.id)
                }}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                  currentSession?.id === session.id
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <MessageSquare className="h-5 w-5" strokeWidth={1.5} />
              </button>
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
        <span className="text-sm font-medium text-muted-foreground">
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
          <button
            onClick={() => {
              void handleNewSession()
            }}
            disabled={isLoading}
            className="w-full px-3 py-6 text-center rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-accent/30 transition-all group"
          >
            <MessageSquare className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50 group-hover:text-primary/70 transition-colors" />
            <p className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
              Start your first session
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Click to create
            </p>
          </button>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => {
                handleSelectSession(session.id)
              }}
              className={cn(
                'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors cursor-pointer',
                currentSession?.id === session.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="flex-1 text-left truncate">{session.name}</span>
              <button
                onClick={(e) => {
                  void handleDeleteSession(e, session.id)
                }}
                className="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                aria-label="Delete session"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
