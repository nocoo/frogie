/**
 * WorkspaceIcon Component
 *
 * Displays workspace icon:
 * - Auto-detected logo from workspace directory
 * - Colored fallback with workspace initial
 */

import { useState, useEffect } from 'react'
import type { Workspace } from '@/models'
import { DEFAULT_WORKSPACE_COLOR } from '@/constants/colors'
import { cn } from '@/lib/utils'

interface WorkspaceIconProps {
  workspace: Workspace
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-8 w-8 text-sm',
  lg: 'h-12 w-12 text-lg',
}

const borderRadiusClasses = {
  sm: 'rounded',
  md: 'rounded-lg',
  lg: 'rounded-xl',
}

export function WorkspaceIcon({
  workspace,
  size = 'md',
  className,
}: WorkspaceIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [iconError, setIconError] = useState(false)

  const color = workspace.color ?? DEFAULT_WORKSPACE_COLOR
  const initial = workspace.name.charAt(0).toUpperCase()

  // Try to load icon from API
  useEffect(() => {
    setIconError(false)
    setIconUrl(`/api/workspaces/${workspace.id}/icon`)
  }, [workspace.id])

  const handleIconError = () => {
    setIconError(true)
    setIconUrl(null)
  }

  // Show logo if available
  if (iconUrl && !iconError) {
    return (
      <img
        src={iconUrl}
        alt={workspace.name}
        onError={handleIconError}
        className={cn(
          sizeClasses[size],
          borderRadiusClasses[size],
          'object-cover',
          className
        )}
      />
    )
  }

  // Colored fallback with initial
  return (
    <div
      className={cn(
        sizeClasses[size],
        borderRadiusClasses[size],
        'flex items-center justify-center font-medium shrink-0',
        className
      )}
      style={{
        backgroundColor: `${color}20`,
        border: `1.5px solid ${color}`,
        color: color,
      }}
    >
      {initial}
    </div>
  )
}
