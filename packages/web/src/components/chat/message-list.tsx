/**
 * MessageList Component
 *
 * Renders the list of chat messages with auto-scroll.
 */

import { useEffect, useRef } from 'react'
import { User, Bot } from 'lucide-react'
import type { Message, MessageContent } from '@/models/events'
import { ThinkingBlock } from './thinking-block'
import { ToolUseCard } from './tool-use-card'
import { MarkdownContent } from './markdown-content'
import { cn } from '@/lib/utils'

interface MessageListProps {
  messages: Message[]
  isLoading?: boolean
}

/**
 * Render a single content block
 */
function ContentBlock({ content, isUser }: { content: MessageContent; isUser: boolean }) {
  switch (content.type) {
    case 'text':
      // User messages: simple text. Assistant messages: markdown
      if (isUser) {
        return (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {content.text}
          </div>
        )
      }
      return <MarkdownContent content={content.text} className="text-sm leading-relaxed" />

    case 'thinking':
      return <ThinkingBlock content={content.content} />

    case 'tool_use':
      return (
        <ToolUseCard
          name={content.name}
          input={content.input}
          result={content.result}
        />
      )

    default:
      return null
  }
}

/**
 * Render a single message with entrance animation
 */
function MessageItem({ message, index }: { message: Message; index: number }) {
  const isUser = message.role === 'user'
  // Stagger animation delay based on index (max 5 messages stagger)
  const staggerDelay = Math.min(index, 5) * 0.05

  return (
    <div
      className={cn(
        'flex gap-3 py-4 animate-[message-in_0.3s_cubic-bezier(0.16,1,0.3,1)_both]',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
      style={{ animationDelay: `${String(staggerDelay)}s` }}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex-1 space-y-2 overflow-hidden',
          isUser ? 'text-right' : 'text-left'
        )}
      >
        <div
          className={cn(
            'inline-block rounded-lg px-4 py-2 max-w-[85%]',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'
          )}
        >
          {message.content.map((content, idx) => (
            <ContentBlock key={idx} content={content} isUser={isUser} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Loading indicator - modern pulse animation
 */
function LoadingIndicator() {
  return (
    <div className="flex gap-3 py-4 animate-[message-in_0.3s_cubic-bezier(0.16,1,0.3,1)]">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted">
        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-[loading-dot_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite]" />
        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-[loading-dot_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite_0.2s]" />
        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-[loading-dot_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite_0.4s]" />
      </div>
    </div>
  )
}

export function MessageList({ messages, isLoading = false }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Start a conversation</p>
          <p className="text-sm">Send a message to begin</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-y-auto px-4"
    >
      <div className="max-w-4xl">
        {messages.map((message, index) => (
          <MessageItem key={message.id} message={message} index={index} />
        ))}

        {isLoading && <LoadingIndicator />}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
