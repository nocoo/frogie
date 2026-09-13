import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Sidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@nocoo/basalt'
import { FileText, FolderOpen, LogOut, PanelLeft, Settings } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { SessionList } from '@/components/sidebar/session-list'
import { WorkspaceSelector } from '@/components/sidebar/workspace-selector'
import { APP_VERSION } from '@/lib/version'
import { cn } from '@/lib/utils'
import { useAuth } from '@/viewmodels/auth.viewmodel'

const NAV_ITEMS = [
  { title: 'Workspaces', icon: FolderOpen, path: '/workspaces' },
  { title: 'Prompts', icon: FileText, path: '/prompts' },
  { title: 'Settings', icon: Settings, path: '/settings' },
]

const AVATAR_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-lime-500',
  'bg-green-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-purple-500',
  'bg-pink-500',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let index = 0; index < name.length; index++) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? 'bg-blue-500'
}

function getUserInitial(name: string | null, email: string): string {
  return (name ?? email).charAt(0).toUpperCase()
}

interface AppSidebarProps {
  collapsed: boolean
  onToggle: () => void
  onNavigate?: () => void
}

export function AppSidebar({ collapsed, onToggle, onNavigate }: AppSidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const userName = user?.name ?? user?.email ?? 'User'
  const userEmail = user?.email ?? ''
  const userImage = user?.image ?? null
  const avatar = (
    <Avatar className="h-9 w-9 shrink-0">
      {userImage && <AvatarImage src={userImage} alt={userName} />}
      <AvatarFallback className={cn('text-xs text-white', getAvatarColor(userName))}>
        {getUserInitial(user?.name ?? null, userEmail)}
      </AvatarFallback>
    </Avatar>
  )

  return (
    <Sidebar collapsed={collapsed}>
      <SidebarHeader className={collapsed ? 'justify-center px-0' : undefined}>
        {collapsed ? (
          <img src="/logo-24.png" alt="Frogie" width={24} height={24} className="shrink-0" />
        ) : (
          <div className="flex w-full items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/logo-24.png" alt="Frogie" width={24} height={24} className="shrink-0" />
              <span className="truncate text-lg font-semibold text-basalt-foreground">Frogie</span>
              <span className="shrink-0 rounded-md bg-basalt-secondary px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-basalt-muted-foreground">
                v{APP_VERSION}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={onToggle}
              aria-label="Collapse sidebar"
            >
              <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
            </Button>
          </div>
        )}
      </SidebarHeader>

      {collapsed && (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <SidebarIconItem className="mb-1 self-center" onClick={onToggle} aria-label="Expand sidebar">
              <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
            </SidebarIconItem>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>Expand sidebar</TooltipContent>
        </Tooltip>
      )}

      <WorkspaceSelector collapsed={collapsed} onSelection={onNavigate} />
      <SidebarNav className={collapsed ? 'w-full items-center gap-1 pt-1' : 'pt-1'}>
        <SessionList collapsed={collapsed} onSelection={onNavigate} />
        {collapsed ? (
          NAV_ITEMS.map((item) => (
            <Tooltip key={item.path} delayDuration={0}>
              <TooltipTrigger asChild>
                <SidebarIconItem
                  active={location.pathname === item.path}
                  className="self-center"
                  aria-label={item.title}
                  onClick={() => {
                    void navigate(item.path)
                    onNavigate?.()
                  }}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
                </SidebarIconItem>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>{item.title}</TooltipContent>
            </Tooltip>
          ))
        ) : (
          <SidebarGroup label="System" defaultOpen>
            {NAV_ITEMS.map((item) => (
              <SidebarItem
                key={item.path}
                active={location.pathname === item.path}
                onClick={() => {
                  void navigate(item.path)
                  onNavigate?.()
                }}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.5} />
                <span className="flex-1 truncate text-left">{item.title}</span>
              </SidebarItem>
            ))}
          </SidebarGroup>
        )}
      </SidebarNav>

      <SidebarFooter className={collapsed ? 'flex w-full justify-center px-0' : undefined}>
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full p-0"
                onClick={() => void logout()}
                aria-label="Sign out"
              >
                {avatar}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{userName} · Sign out</TooltipContent>
          </Tooltip>
        ) : (
          <SidebarUser
            name={userName}
            email={userEmail}
            avatar={avatar}
            action={
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => void logout()}
                    aria-label="Sign out"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Sign out</TooltipContent>
              </Tooltip>
            }
          />
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
