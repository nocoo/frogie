import { useState } from 'react'
import {
  FolderOpen,
  Settings,
  ChevronUp,
  PanelLeft,
  LogOut,
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { WorkspaceSelector } from '@/components/sidebar/workspace-selector'
import { SessionList } from '@/components/sidebar/session-list'
import { useAuth } from '@/viewmodels/auth.viewmodel'
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
    label: 'System',
    defaultOpen: true,
    items: [
      { title: 'Workspaces', icon: FolderOpen, path: '/workspaces' },
      { title: 'Settings', icon: Settings, path: '/settings' },
    ],
  },
]

// Avatar color palette for fallback
const AVATAR_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-yellow-500',
  'bg-lime-500',
  'bg-green-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-cyan-500',
  'bg-sky-500',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-purple-500',
  'bg-fuchsia-500',
  'bg-pink-500',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? 'bg-blue-500'
}

function getUserInitial(name: string | null, email: string): string {
  if (name) {
    return name.charAt(0).toUpperCase()
  }
  return email.charAt(0).toUpperCase()
}

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
  const { user, logout } = useAuth()

  const userName = user?.name ?? user?.email ?? 'User'
  const userEmail = user?.email ?? ''
  const userImage = user?.image ?? null
  const userInitial = getUserInitial(user?.name ?? null, userEmail)

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'flex flex-col h-screen bg-background transition-all duration-300 ease-in-out shrink-0 overflow-hidden',
          collapsed ? 'w-[68px]' : 'w-[260px]'
        )}
      >
        {/* Header - B-2 Logo 区域 */}
        <div className="px-3 h-14 flex items-center">
          {collapsed ? (
            // 收起态：logo 图标居中
            <div className="flex w-full items-center justify-center animate-[message-in_0.2s_ease-out]">
              <img
                src="/logo-24.png"
                alt="Frogie"
                width={24}
                height={24}
                className="shrink-0"
              />
            </div>
          ) : (
            // 展开态：logo + 品牌名 + 版本 + 收起按钮
            <div className="flex w-full items-center justify-between px-3 animate-[message-in_0.2s_ease-out]">
              <div className="flex items-center gap-3">
                <img
                  src="/logo-24.png"
                  alt="Frogie"
                  width={24}
                  height={24}
                  className="shrink-0"
                />
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

        {/* 收起态展开按钮 */}
        {collapsed && (
          <div className="flex justify-center px-2 mb-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggle}
                  aria-label="Expand sidebar"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Expand</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Workspace Selector */}
        <WorkspaceSelector collapsed={collapsed} />

        {/* Session List */}
        <SessionList collapsed={collapsed} />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <NavGroupSection
              key={group.label}
              group={group}
              currentPath={location.pathname}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Footer - 用户区域 B-2 规范 */}
        <div className={cn('border-t border-border', collapsed ? 'px-2 py-6' : 'px-4 py-6')}>
          {collapsed ? (
            // 收起态：仅头像，点击登出，tooltip 显示用户名
            <div className="flex flex-col items-center animate-[message-in_0.2s_ease-out]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { void logout() }}
                    aria-label="Sign out"
                    className="rounded-full"
                  >
                    <Avatar className="h-9 w-9">
                      {userImage && <AvatarImage src={userImage} alt={userName} />}
                      <AvatarFallback className={cn('text-xs text-white', getAvatarColor(userName))}>
                        {userInitial}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>{userName}</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            // 展开态：头像 + 用户名 + 邮箱 + 登出按钮
            <div className="flex items-center gap-3 animate-[message-in_0.2s_ease-out]">
              <Avatar className="h-9 w-9 shrink-0">
                {userImage && <AvatarImage src={userImage} alt={userName} />}
                <AvatarFallback className={cn('text-xs text-white', getAvatarColor(userName))}>
                  {userInitial}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{userName}</p>
                <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { void logout() }}
                    aria-label="Sign out"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                  >
                    <LogOut className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Sign out</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
