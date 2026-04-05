/**
 * ChatInput Component
 *
 * Text input for sending messages with keyboard shortcuts.
 */

import { useRef, useEffect, useState, type KeyboardEvent } from 'react'
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
    <div className="relative shrink-0 border-t border-border">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="relative flex-1">
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
              'w-full resize-none rounded-xl border border-input bg-background px-4 py-[15px] text-sm leading-5',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'min-h-[52px] max-h-[200px]'
            )}
          />
          {!isFocused && !value && (
            <kbd className="pointer-events-none absolute right-4 top-[16px] text-sm leading-5 text-muted-foreground/60">/</kbd>
          )}
        </div>

        {isLoading ? (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            onClick={handleStopClick}
            className="shrink-0 h-[52px] w-[52px] rounded-xl"
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
            className="shrink-0 h-[52px] w-[52px] rounded-xl"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
