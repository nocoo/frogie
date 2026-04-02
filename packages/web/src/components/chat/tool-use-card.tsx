/**
 * ToolUseCard Component
 *
 * Displays tool calls with expandable input/output.
 */

import { useState } from 'react'
import {
  ChevronRight,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToolResult {
  output: string
  isError: boolean
}

interface ToolUseCardProps {
  name: string
  input: unknown
  result?: ToolResult | undefined
}

export function ToolUseCard({ name, input, result }: ToolUseCardProps) {
  const [expanded, setExpanded] = useState(false)

  const isPending = !result
  const isError = result?.isError ?? false
  const isSuccess = result && !result.isError

  // Format input for display
  const inputStr =
    typeof input === 'string' ? input : JSON.stringify(input, null, 2)

  // Truncate input preview
  const inputPreview =
    inputStr.length > 60 ? `${inputStr.slice(0, 60)}...` : inputStr

  return (
    <div
      className={cn(
        'my-2 rounded-lg border',
        isPending && 'border-blue-200/50 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/20',
        isSuccess && 'border-green-200/50 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20',
        isError && 'border-red-200/50 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20'
      )}
    >
      <button
        onClick={() => {
          setExpanded(!expanded)
        }}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm rounded-lg transition-colors',
          isPending && 'text-blue-700 dark:text-blue-400 hover:bg-blue-100/50 dark:hover:bg-blue-900/20',
          isSuccess && 'text-green-700 dark:text-green-400 hover:bg-green-100/50 dark:hover:bg-green-900/20',
          isError && 'text-red-700 dark:text-red-400 hover:bg-red-100/50 dark:hover:bg-red-900/20'
        )}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />

        {isPending && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
        {isSuccess && <CheckCircle2 className="h-4 w-4 shrink-0" />}
        {isError && <XCircle className="h-4 w-4 shrink-0" />}

        <Wrench className="h-4 w-4 shrink-0" />
        <code className="font-mono font-medium">{name}</code>

        {!expanded && (
          <span className="truncate opacity-70 ml-2 font-mono text-xs">
            {inputPreview}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-3">
          {/* Input */}
          <div className="pl-10">
            <div className="text-xs font-medium opacity-60 mb-1">Input</div>
            <pre className="text-xs font-mono bg-black/5 dark:bg-white/5 rounded p-2 overflow-x-auto">
              {inputStr}
            </pre>
          </div>

          {/* Output */}
          {result && (
            <div className="pl-10">
              <div className="text-xs font-medium opacity-60 mb-1">
                {isError ? 'Error' : 'Output'}
              </div>
              <pre
                className={cn(
                  'text-xs font-mono rounded p-2 overflow-x-auto max-h-64 overflow-y-auto',
                  isError
                    ? 'bg-red-100/50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                    : 'bg-black/5 dark:bg-white/5'
                )}
              >
                {result.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
