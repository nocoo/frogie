/**
 * ChatInput Component
 *
 * Text input for sending messages with keyboard shortcuts.
 */

import { useRef, useEffect, useState, type KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'
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
  const [isFocused, setIsFocused] = useState(false)

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

  // Global "/" shortcut to focus input
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // Skip if already focused on an input/textarea or if modifier keys are pressed
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        textareaRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => { window.removeEventListener('keydown', handleGlobalKeyDown) }
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (without Shift for newline)
    // Check isComposing to avoid triggering during IME composition (e.g., Chinese input)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
    <div className="shrink-0 px-4 py-3">
      {/* Unified input container */}
      <div
        className={cn(
          'flex items-end gap-0 rounded-2xl border bg-background transition-colors',
          isFocused
            ? 'border-ring ring-2 ring-ring/20'
            : 'border-input hover:border-muted-foreground/30'
        )}
      >
        {/* Textarea area */}
        <div className="relative flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => { setIsFocused(true) }}
            onBlur={() => { setIsFocused(false) }}
            placeholder={placeholder}
            disabled={disabled || isLoading}
            rows={1}
            className={cn(
              'w-full resize-none bg-transparent px-4 py-3 text-sm leading-6',
              'placeholder:text-muted-foreground',
              'focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'min-h-[48px] max-h-[200px]'
            )}
          />
          {/* Shortcut hint */}
          {!isFocused && !value && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/40 border border-muted/60 rounded px-1.5 py-0.5">/</span>
          )}
        </div>

        {/* Send button */}
        <div className="shrink-0 p-1.5">
          {isLoading ? (
            <button
              type="button"
              onClick={handleStopClick}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              aria-label="Stop generation"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSendClick}
              disabled={disabled || !value.trim()}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
                value.trim()
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
