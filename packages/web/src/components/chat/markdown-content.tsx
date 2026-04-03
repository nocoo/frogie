/**
 * MarkdownContent Component
 *
 * Renders markdown content with syntax highlighting and proper styling.
 * Uses react-markdown with GFM support and code highlighting.
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'

interface MarkdownContentProps {
  content: string
  className?: string
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn('markdown-content', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children, ...props }) => (
            <pre
              {...props}
              className="rounded-md bg-black/5 dark:bg-white/5 p-3 overflow-x-auto text-sm"
            >
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            // Check if this is inline code (no className from highlight)
            const isInline = !className
            if (isInline) {
              return (
                <code
                  {...props}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm"
                >
                  {children}
                </code>
              )
            }
            return (
              <code {...props} className={className}>
                {children}
              </code>
            )
          },
          a: ({ href, children, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {children}
            </a>
          ),
          // Ensure proper spacing for paragraphs
          p: ({ children, ...props }) => (
            <p {...props} className="my-2 first:mt-0 last:mb-0">
              {children}
            </p>
          ),
          // Style lists properly
          ul: ({ children, ...props }) => (
            <ul {...props} className="my-2 list-disc pl-4">
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol {...props} className="my-2 list-decimal pl-4">
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li {...props} className="my-0.5">
              {children}
            </li>
          ),
          // Style blockquotes
          blockquote: ({ children, ...props }) => (
            <blockquote
              {...props}
              className="my-2 border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground"
            >
              {children}
            </blockquote>
          ),
          // Style tables
          table: ({ children, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table {...props} className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              {...props}
              className="border border-border bg-muted px-3 py-1.5 text-left font-medium"
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td {...props} className="border border-border px-3 py-1.5">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
