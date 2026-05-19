/**
 * ProtectedRoute Component
 *
 * Wraps routes that require authentication
 */

import { Navigate } from 'react-router'
import type { ReactNode } from 'react'
import { useAuth } from '@/viewmodels/auth.viewmodel'
import { Loader2 } from 'lucide-react'

interface ProtectedRouteProps {
  children: ReactNode
}

/**
 * Loading spinner for auth check
 */
function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * ProtectedRoute redirects to /login if not authenticated
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isInitialized, isLoading } = useAuth()

  // Show loading while checking auth status
  if (!isInitialized || isLoading) {
    return <AuthLoading />
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

/**
 * PublicOnlyRoute redirects to / if already authenticated
 * (for login page)
 */
export function PublicOnlyRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isInitialized, isLoading } = useAuth()

  // Show loading while checking auth status
  if (!isInitialized || isLoading) {
    return <AuthLoading />
  }

  // Redirect to home if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
