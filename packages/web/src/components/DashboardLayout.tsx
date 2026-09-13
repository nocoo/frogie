import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import {
  Button,
  ContentIsland,
  Sheet,
  SheetContent,
  SheetTitle,
  ThemeToggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@nocoo/basalt'
import { AppHeader } from '@nocoo/basalt/components/app-header'
import { AppMain, AppShell, AppSkipLink } from '@nocoo/basalt/components/app-shell'
import { Menu } from 'lucide-react'
import { AppSidebar } from '@/components/AppSidebar'
import { GithubIcon } from '@/components/GithubIcon'
import { useIsMobile } from '@/hooks/use-mobile'

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Chat',
  '/settings': 'Settings',
  '/workspaces': 'Workspaces',
  '/prompts': 'Prompts',
}

const GITHUB_URL = 'https://github.com/nocoo/frogie'

export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const title = ROUTE_LABELS[location.pathname] ?? 'Frogie'
  const breadcrumbs = location.pathname === '/' ? [] : [{ href: '/', label: 'Home' }]

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <AppShell>
      <AppSkipLink>Skip to main content</AppSkipLink>
      {!isMobile ? (
        <AppSidebar
          collapsed={collapsed}
          onToggle={() => {
            setCollapsed((current) => !current)
          }}
        />
      ) : (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-[260px] max-w-[260px] border-0 bg-basalt-background p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <AppSidebar
              collapsed={false}
              onToggle={() => {
                setMobileOpen(false)
              }}
              onNavigate={() => {
                setMobileOpen(false)
              }}
            />
          </SheetContent>
        </Sheet>
      )}

      <AppMain>
        <AppHeader
          leading={
            isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setMobileOpen(true)
                }}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.5} />
              </Button>
            ) : null
          }
          breadcrumbs={breadcrumbs}
          title={title}
          actions={
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                    <a
                      href={GITHUB_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View on GitHub"
                    >
                      <GithubIcon className="h-[18px] w-[18px]" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>View on GitHub</TooltipContent>
              </Tooltip>
              <ThemeToggle aria-label="Change theme" />
            </div>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
          <ContentIsland className={location.pathname === '/' ? 'p-0' : undefined}>
            <Outlet />
          </ContentIsland>
        </div>
      </AppMain>
    </AppShell>
  )
}
