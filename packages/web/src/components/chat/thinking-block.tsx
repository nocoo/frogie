/**
 * ThinkingBlock Component
 *
 * Displays collapsible thinking/reasoning content from the agent.
 * Uses grid-template-rows for smooth height animation.
 */

import { useId, useState } from 'react'
import { ChevronRight, Brain } from 'lucide-react'
import { Button } from '@nocoo/basalt/components/button'
import { cn } from '@/lib/utils'

interface ThinkingBlockProps {
  content: string
  defaultExpanded?: boolean
}

export function ThinkingBlock({
  content,
  defaultExpanded = false,
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const contentId = useId()

  // Truncate preview to first 100 chars
  const preview =
    content.length > 100 ? `${content.slice(0, 100)}...` : content

  return (
    <div className="my-2 rounded-lg border border-amber-200/50 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 animate-[message-in_0.3s_cubic-bezier(0.16,1,0.3,1)]">
      <Button
        variant="ghost"
        onClick={() => {
          setExpanded(!expanded)
        }}
        className="h-auto w-full justify-start gap-2 whitespace-normal rounded-lg px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-100/50 dark:text-amber-400 dark:hover:bg-amber-900/20"
        aria-expanded={expanded}
        aria-controls={contentId}
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />
        <Brain className="h-4 w-4 shrink-0" />
        <span className="font-medium">Thinking</span>
        {!expanded && (
          <span className="truncate text-amber-600/70 dark:text-amber-500/70 ml-2">
            {preview}
          </span>
        )}
      </Button>

      {/* Expandable content with grid animation */}
      <div
        id={contentId}
        hidden={!expanded}
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0">
            <div className="pl-10 text-sm text-amber-800/80 dark:text-amber-300/80 whitespace-pre-wrap">
              {content}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
