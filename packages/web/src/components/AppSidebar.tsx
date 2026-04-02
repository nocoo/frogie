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
import { APP_VERSION } from '@/lib/version'

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
                <item.icon className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{item.title}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="px-3 mt-2">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
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
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
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
          'flex flex-col h-screen bg-background border-r border-border transition-all duration-300 ease-in-out shrink-0 overflow-hidden',
          collapsed ? 'w-[68px]' : 'w-[260px]'
        )}
      >
        {/* Header - B-2 Logo 区域 */}
        <div className="px-3 h-14 flex items-center">
          {collapsed ? (
            // 收起态：logo 图标居中 + 展开按钮
            <div className="flex w-full items-center justify-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggle}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    aria-label="Expand sidebar"
                  >
                    <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Expand</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            // 展开态：logo + 品牌名 + 版本 + 收起按钮
            <div className="flex w-full items-center justify-between px-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🐸</span>
                <span className="text-lg font-bold tracking-tighter">Frogie</span>
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground leading-none">
                  v{APP_VERSION}
                </span>
              </div>
              <button
                onClick={onToggle}
                aria-label="Collapse sidebar"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
              >
                <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>

        {/* Workspace Selector */}
        <WorkspaceSelector collapsed={collapsed} />

        {/* Session List */}
        <div className="border-t border-border">
          <SessionList collapsed={collapsed} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto border-t border-border">
          {NAV_GROUPS.map((group) => (
            <NavGroupSection
              key={group.label}
              group={group}
              currentPath={location.pathname}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Footer - 用户区域 */}
        <div className={cn('border-t border-border', collapsed ? 'px-2 py-3' : 'px-4 py-3')}>
          {collapsed ? (
            <div className="flex flex-col items-center">
              <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center text-xs font-medium text-white">
                F
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center text-xs font-medium text-white shrink-0">
                F
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  Frogie Agent
                </p>
                <p className="text-xs text-muted-foreground truncate">Local Mode</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
