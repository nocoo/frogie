import { useState } from 'react'
import {
  MessageSquare,
  FolderOpen,
  Settings,
  ChevronUp,
  PanelLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNavigate, useLocation } from 'react-router'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { WorkspaceSelector } from '@/components/sidebar/workspace-selector'
import { SessionList } from '@/components/sidebar/session-list'

// Navigation data model

interface NavItem {
  title: string
  icon: React.ElementType
  path: string
}

interface NavGroup {
  label: string
  items: NavItem[]
  defaultOpen?: boolean
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Main',
    defaultOpen: true,
    items: [
      { title: 'Chat', icon: MessageSquare, path: '/' },
      { title: 'Workspaces', icon: FolderOpen, path: '/workspaces' },
    ],
  },
  {
    label: 'System',
    defaultOpen: true,
    items: [{ title: 'Settings', icon: Settings, path: '/settings' }],
  },
]

// Sub-components

function NavGroupSection({
  group,
  currentPath,
  collapsed,
}: {
  group: NavGroup
  currentPath: string
  collapsed: boolean
}) {
  const [open, setOpen] = useState(group.defaultOpen ?? true)
  const navigate = useNavigate()

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 px-2">
        {group.items.map((item) => (
          <Tooltip key={item.path}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  void navigate(item.path)
                }}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                  currentPath === item.path
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <item.icon className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.title}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="px-3 mt-2">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2.5">
          <span className="text-sm font-normal text-muted-foreground">
            {group.label}
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center">
            <ChevronUp
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform duration-200',
                !open && 'rotate-180'
              )}
              strokeWidth={1.5}
            />
          </span>
        </CollapsibleTrigger>
      </div>
      <div
        className="grid overflow-hidden"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease-out',
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-0.5 px-3">
            {group.items.map((item) => (
              <button
                key={item.path}
                onClick={() => {
                  void navigate(item.path)
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors',
                  currentPath === item.path
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 text-left">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Collapsible>
  )
}

interface AppSidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const location = useLocation()

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-[width] duration-200 shrink-0',
          collapsed ? 'w-[72px]' : 'w-[260px]'
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'flex h-14 items-center shrink-0 px-4',
            collapsed ? 'justify-center' : 'justify-between'
          )}
        >
          {!collapsed && (
            <span className="text-lg font-semibold text-foreground flex items-center gap-2">
              <span className="text-2xl">🐸</span>
              Frogie
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggle}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <PanelLeft className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? 'Expand' : 'Collapse'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Workspace Selector */}
        <WorkspaceSelector collapsed={collapsed} />

        {/* Session List */}
        <div className="border-t border-sidebar-border">
          <SessionList collapsed={collapsed} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto border-t border-sidebar-border">
          {NAV_GROUPS.map((group) => (
            <NavGroupSection
              key={group.label}
              group={group}
              currentPath={location.pathname}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Footer */}
        <div
          className={cn(
            'border-t border-sidebar-border p-3',
            collapsed && 'p-2'
          )}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-sm font-medium">
                F
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-2 py-1">
              <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-sm font-medium shrink-0">
                F
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  Frogie Agent
                </p>
                <p className="text-xs text-muted-foreground">v0.1.0</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
