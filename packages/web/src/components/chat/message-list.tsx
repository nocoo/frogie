/**
 * MessageList Component
 *
 * Renders the list of chat messages with auto-scroll.
 */

import { useEffect, useRef } from 'react'
import { User, Bot, Sparkles, Terminal, FileCode, Zap } from 'lucide-react'
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
 * User messages: right-aligned, solid primary color
 * AI messages: left-aligned, subtle background with left accent
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
            : 'bg-secondary text-muted-foreground border border-border'
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
          isUser ? 'flex justify-end' : 'flex justify-start'
        )}
      >
        <div
          className={cn(
            'inline-block max-w-[85%]',
            isUser
              ? 'rounded-2xl rounded-tr-md px-4 py-2.5 bg-primary text-primary-foreground'
              : 'rounded-2xl rounded-tl-md px-4 py-2.5 bg-secondary/50 text-foreground border-l-2 border-primary/30'
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground border border-border">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl rounded-tl-md bg-secondary/50 border-l-2 border-primary/30">
        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-[loading-dot_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite]" />
        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-[loading-dot_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite_0.2s]" />
        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-[loading-dot_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite_0.4s]" />
      </div>
    </div>
  )
}

/**
 * Empty state with teaching UI and example prompts
 */
function EmptyState() {
  const examplePrompts = [
    { icon: FileCode, text: 'Explain this codebase structure' },
    { icon: Terminal, text: 'Run the tests and fix failures' },
    { icon: Zap, text: 'Refactor for better performance' },
  ]

  return (
    <div className="flex-1 flex items-center justify-center px-4 animate-[card-in_0.5s_cubic-bezier(0.16,1,0.3,1)]">
      <div className="max-w-md w-full">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 mb-4">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            What can I help you build?
          </h2>
          <p className="text-sm text-muted-foreground">
            I can read, write, and run code in your workspace.
          </p>
        </div>

        {/* Example prompts */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-3">
            Try asking
          </p>
          {examplePrompts.map((prompt, index) => (
            <button
              key={index}
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all text-left group"
              style={{ animationDelay: `${String(0.1 + index * 0.05)}s` }}
            >
              <prompt.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              <span className="text-sm text-foreground">{prompt.text}</span>
            </button>
          ))}
        </div>

        {/* Keyboard hint */}
        <p className="text-center text-xs text-muted-foreground/60 mt-6">
          Press{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">
            Enter
          </kbd>{' '}
          to send
        </p>
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
    return <EmptyState />
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
