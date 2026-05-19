/**
 * AuthProvider Component
 *
 * Provides auth state to the entire app and handles initialization
 */

import { useEffect, type ReactNode } from 'react'
import { useAuth } from '@/viewmodels/auth.viewmodel'

interface AuthProviderProps {
  children: ReactNode
}

/**
 * AuthProvider initializes auth state on mount
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const { fetchUser, isInitialized } = useAuth()

  useEffect(() => {
    if (!isInitialized) {
      void fetchUser()
    }
  }, [fetchUser, isInitialized])

  return <>{children}</>
}
