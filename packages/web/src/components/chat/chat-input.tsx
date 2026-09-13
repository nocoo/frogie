/**
 * ChatInput Component
 *
 * Text input for sending messages with keyboard shortcuts.
 */

import { useRef, useEffect, useState, type KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@nocoo/basalt/components/button'
import { InputArea } from '@nocoo/basalt/components/input-area'
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
          'flex items-center gap-0 rounded-2xl border bg-basalt-background transition-colors',
          isFocused
            ? 'border-basalt-ring ring-2 ring-basalt-ring/20'
            : 'border-basalt-input hover:border-basalt-muted-foreground/30'
        )}
      >
        {/* Textarea area */}
        <div className="relative flex-1 min-w-0 flex items-center">
          <InputArea
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
              'max-h-[200px] min-h-0 w-full resize-none border-0 bg-transparent px-4 py-3 text-sm leading-6 shadow-none',
              'placeholder:text-basalt-muted-foreground',
              'focus-visible:ring-0',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
          {/* Shortcut hint */}
          {!isFocused && !value && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-basalt-muted-foreground/40 border border-basalt-muted/60 rounded px-1.5 py-0.5">/</span>
          )}
        </div>

        {/* Send button */}
        <div className="shrink-0 p-1.5">
          {isLoading ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={handleStopClick}
              className="h-9 w-9 rounded-xl"
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
              className="h-9 w-9 rounded-xl"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
