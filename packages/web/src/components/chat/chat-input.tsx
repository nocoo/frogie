/**
 * ChatInput Component
 *
 * Text input for sending messages with keyboard shortcuts.
 */

import { useRef, useEffect, type KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isLoading = false,
  disabled = false,
  placeholder = 'Type a message...',
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${String(Math.min(textarea.scrollHeight, 200))}px`
    }
  }, [value])

  // Focus on mount
  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [disabled])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (without Shift for newline)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isLoading && !disabled && value.trim()) {
        onSend()
      }
    }
  }

  const handleSendClick = () => {
    if (!isLoading && !disabled && value.trim()) {
      onSend()
    }
  }

  const handleStopClick = () => {
    if (isLoading && onStop) {
      onStop()
    }
  }

  return (
    <div className="relative flex items-end gap-2 p-3 border-t bg-background">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isLoading}
        rows={1}
        className={cn(
          'flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'min-h-[40px] max-h-[200px]'
        )}
      />

      {isLoading ? (
        <Button
          type="button"
          size="icon"
          variant="destructive"
          onClick={handleStopClick}
          className="shrink-0"
          aria-label="Stop generation"
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={handleSendClick}
          disabled={disabled || !value.trim()}
          className="shrink-0"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}

      <div className="absolute bottom-full left-3 mb-1 text-xs text-muted-foreground">
        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Enter</kbd>
        <span className="ml-1">to send</span>
        <span className="mx-2 text-muted-foreground/50">·</span>
        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Shift+Enter</kbd>
        <span className="ml-1">for new line</span>
      </div>
    </div>
  )
}
