import { BrowserRouter, Routes, Route } from 'react-router'
import { DashboardLayout } from '@/components/DashboardLayout'
import { Toaster } from '@/components/ui/sonner'

// Pages
function ChatPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-2">Start a conversation</h2>
        <p className="text-muted-foreground">
          Type a message to begin chatting with Frogie
        </p>
      </div>
    </div>
  )
}

function WorkspacesPage() {
  return (
    <div className="h-full">
      <h2 className="text-xl font-semibold mb-4">Workspaces</h2>
      <p className="text-muted-foreground">Manage your project workspaces</p>
    </div>
  )
}

function SettingsPage() {
  return (
    <div className="h-full">
      <h2 className="text-xl font-semibold mb-4">Settings</h2>
      <p className="text-muted-foreground">Configure your Frogie instance</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
