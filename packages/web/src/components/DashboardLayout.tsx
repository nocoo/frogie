import { useState, useEffect } from 'react'
import { Outlet, useLocation, Link } from 'react-router'
import { AppSidebar } from '@/components/AppSidebar'
import { ThemeToggle } from '@/components/ThemeToggle'
import { GithubIcon } from '@/components/GithubIcon'
import { useIsMobile } from '@/hooks/use-mobile'
import { Menu, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'

// Route labels for breadcrumb generation
const ROUTE_LABELS: Record<string, string> = {
  '/': 'Chat',
  '/settings': 'Settings',
  '/workspaces': 'Workspaces',
}

// GitHub repository URL
const GITHUB_URL = 'https://github.com/nocoo/frogie'

interface BreadcrumbItem {
  label: string
  href?: string
}

function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
      {items.map((item, index) => (
        <div key={item.label} className="flex items-center gap-1">
          {index > 0 && <ChevronRight className="h-3 w-3" />}
          {item.href && index < items.length - 1 ? (
            <Link to={item.href} className="hover:text-foreground transition-colors">
              {item.label}
            </Link>
          ) : (
            <span
              className={cn(index === items.length - 1 && 'text-foreground font-medium')}
              aria-current={index === items.length - 1 ? 'page' : undefined}
            >
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  )
}

export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Generate breadcrumbs from pathname
  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Home', href: '/' },
  ]

  const currentLabel = ROUTE_LABELS[location.pathname]
  if (location.pathname !== '/' && currentLabel) {
    breadcrumbs.push({ label: currentLabel })
  } else if (location.pathname === '/') {
    breadcrumbs[0] = { label: 'Chat' }
  }

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex min-h-screen w-full bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        {/* Desktop sidebar */}
        {!isMobile && (
          <AppSidebar
            collapsed={collapsed}
            onToggle={() => {
              setCollapsed(!collapsed)
            }}
          />
        )}

        {/* Mobile overlay */}
        {isMobile && mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
              onClick={() => {
                setMobileOpen(false)
              }}
            />
            <div className="fixed inset-y-0 left-0 z-50 w-[260px]">
              <AppSidebar
                collapsed={false}
                onToggle={() => {
                  setMobileOpen(false)
                }}
              />
            </div>
          </>
        )}

        <main
          id="main-content"
          className="flex-1 flex flex-col min-h-0 min-w-0 h-screen"
        >
          {/* B-2 顶栏规范 */}
          <header className="flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
            <div className="flex items-center gap-3">
              {isMobile && (
                <button
                  onClick={() => {
                    setMobileOpen(true)
                  }}
                  aria-label="Open navigation"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Menu
                    className="h-5 w-5"
                    aria-hidden="true"
                    strokeWidth={1.5}
                  />
                </button>
              )}
              <Breadcrumbs items={breadcrumbs} />
            </div>
            <div className="flex items-center gap-1">
              {/* GitHub Link - 必选 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    aria-label="View on GitHub"
                  >
                    <GithubIcon className="h-[18px] w-[18px]" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>View on GitHub</TooltipContent>
              </Tooltip>
              {/* ThemeToggle - 必选，始终排在最后 */}
              <ThemeToggle />
            </div>
          </header>
          {/* B-2 内容区域（浮岛式） */}
          <div className={cn('flex-1 min-h-0 px-2 pb-2 md:px-3 md:pb-3')}>
            <div className="h-full rounded-[16px] md:rounded-[20px] bg-card p-3 md:p-5">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
