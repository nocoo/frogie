import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@nocoo/basalt'

export function HexlyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-[18px] w-[18px] pointer-events-none'}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 2 8.66 5v10L12 22l-8.66-5V7Z" />
      <path d="M12 2v20M3.34 7l17.32 10m0-10L3.34 17" />
    </svg>
  )
}

export function HexlyLink() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          asChild
        >
          <a
            href="https://hexly.ai/projects/frogie"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Frogie on hexly.ai (opens in a new tab)"
          >
            <HexlyIcon />
            <span className="sr-only">Frogie on hexly.ai</span>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Frogie on hexly.ai</TooltipContent>
    </Tooltip>
  )
}
