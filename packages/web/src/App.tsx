import type { ComponentType, ReactNode } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import {
  LinkProvider,
  ThemeProvider,
  Toaster,
  TooltipProvider,
} from '@nocoo/basalt'
import { AccentProvider } from '@nocoo/basalt/providers/accent'
import { DashboardLayout } from '@/components/DashboardLayout'
import { AuthProvider } from '@/components/AuthProvider'
import { ProtectedRoute, PublicOnlyRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { WorkspacesPage } from '@/pages/WorkspacesPage'
import { PromptsPage } from '@/pages/PromptsPage'
import { ChatPanel } from '@/components/chat'

const AppLink: ComponentType<{
  href: string
  className?: string
  children?: ReactNode
}> = ({ href, className, children }) => {
  const external = /^(?:https?:)?\/\//.test(href) || /^(?:mailto|tel):/.test(href)
  return external ? (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <Link to={href} className={className}>
      {children}
    </Link>
  )
}

const FROGIE_ACCENT = {
  primary: { light: '142 71% 45%', dark: '142 71% 50%' },
} as const

// Pages
function ChatPage() {
  return <ChatPanel />
}

export default function App() {
  return (
    <ThemeProvider>
      <AccentProvider defaultAccent="primary" paletteOverrides={FROGIE_ACCENT}>
        <BrowserRouter>
          <LinkProvider render={AppLink}>
            <TooltipProvider delayDuration={200}>
              <AuthProvider>
                <Routes>
          {/* Public route - login page */}
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />

          {/* Protected routes */}
          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<ChatPage />} />
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
                </Routes>
                <Toaster />
              </AuthProvider>
            </TooltipProvider>
          </LinkProvider>
        </BrowserRouter>
      </AccentProvider>
    </ThemeProvider>
  )
}
