import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@nocoo/basalt'
import { useTheme } from '@nocoo/basalt/providers/theme'
import { Monitor, Moon, Sun } from 'lucide-react'

export interface ThemeToggleProps {
  'aria-label'?: string
}

export function ThemeToggle({ 'aria-label': ariaLabel = 'Change theme' }: ThemeToggleProps = {}) {
  const { theme, setTheme } = useTheme()
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
  const Icon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun
  const label =
    nextTheme === 'system'
      ? 'Use system theme'
      : nextTheme === 'dark'
        ? 'Switch to dark theme'
        : 'Switch to light theme'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            setTheme(nextTheme)
          }}
          aria-label={ariaLabel}
        >
          <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
          <span className="sr-only">{ariaLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
