import { BrowserRouter, Routes, Route } from 'react-router'
import { DashboardLayout } from '@/components/DashboardLayout'
import { AuthProvider } from '@/components/AuthProvider'
import { ProtectedRoute, PublicOnlyRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ChatPanel } from '@/components/chat'
import { Toaster } from '@/components/ui/sonner'

// Pages
function ChatPage() {
  return <ChatPanel />
}

function WorkspacesPage() {
  return (
    <div className="h-full">
      <h2 className="text-xl font-semibold mb-4">Workspaces</h2>
      <p className="text-muted-foreground">Manage your project workspaces</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
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
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  )
}
