/**
 * Login Page
 *
 * Badge card style login following basalt B-1 spec
 */

import { useSearchParams } from 'react-router'
import { Bug } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Barcode } from '@/components/Barcode'
import { GoogleIcon } from '@/components/GoogleIcon'
import { GithubIcon } from '@/components/GithubIcon'

/**
 * Error messages for OAuth errors
 */
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: 'Access denied. Your account is not authorized.',
  InvalidCallback: 'Invalid callback. Please try again.',
  TokenExchangeFailed: 'Authentication failed. Please try again.',
  UserInfoFailed: 'Failed to get user info. Please try again.',
  AuthFailed: 'Authentication failed. Please try again.',
}

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const error = searchParams.get('error')
  const year = new Date().getFullYear()
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google'
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background overflow-hidden">
      {/* Radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse 70% 55% at 50% 50%,',
            'hsl(var(--foreground) / 0.045) 0%,',
            'hsl(var(--foreground) / 0.042) 10%,',
            'hsl(var(--foreground) / 0.036) 20%,',
            'hsl(var(--foreground) / 0.028) 32%,',
            'hsl(var(--foreground) / 0.020) 45%,',
            'hsl(var(--foreground) / 0.012) 58%,',
            'hsl(var(--foreground) / 0.006) 72%,',
            'hsl(var(--foreground) / 0.002) 86%,',
            'transparent 100%)',
          ].join(' '),
        }}
      />

      {/* Top-right controls */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
        <a
          href="https://github.com/nicepkg/frogie"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <GithubIcon className="h-[18px] w-[18px]" />
        </a>
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex flex-col items-center animate-[card-in_0.5s_cubic-bezier(0.16,1,0.3,1)]">
          {/* Badge card — bank card flipped vertical: 54/86 */}
          <div
            className="relative aspect-[54/86] w-72 overflow-hidden rounded-2xl bg-card flex flex-col ring-1 ring-black/[0.08] dark:ring-white/[0.06]"
            style={{
              boxShadow: [
                '0 1px 2px rgba(0,0,0,0.06)',
                '0 4px 8px rgba(0,0,0,0.04)',
                '0 12px 24px rgba(0,0,0,0.06)',
                '0 24px 48px rgba(0,0,0,0.04)',
                '0 0 0 0.5px rgba(0,0,0,0.02)',
                '0 0 60px rgba(0,0,0,0.03)',
              ].join(', '),
            }}
          >
            {/* Header strip with barcode */}
            <div className="bg-primary px-5 py-4">
              <div className="flex items-center justify-between">
                <div
                  className="h-4 w-8 rounded-full bg-background/80"
                  style={{
                    boxShadow:
                      'inset 0 1.5px 3px rgba(0,0,0,0.35), inset 0 -0.5px 1px rgba(255,255,255,0.1)',
                  }}
                />
                <div className="flex items-center gap-2">
                  <Bug className="h-4 w-4 text-primary-foreground" strokeWidth={1.5} />
                  <span className="text-sm font-semibold text-primary-foreground">
                    frogie
                  </span>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-widest text-primary-foreground/60">
                  DEV
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[9px] font-mono text-primary-foreground/40 tracking-wider">
                  ID {year}-{today.slice(4)}
                </span>
                <div className="h-6">
                  <Barcode />
                </div>
              </div>
            </div>

            {/* Badge content */}
            <div className="flex flex-1 flex-col items-center px-6 pt-6 pb-14">
              <div className="h-24 w-24 overflow-hidden rounded-full bg-secondary dark:bg-[#171717] ring-1 ring-border p-2.5 flex items-center justify-center">
                <span className="text-5xl">🐸</span>
              </div>

              <p className="mt-5 text-lg font-semibold text-foreground">AI Coding Agent</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sign in to start coding
              </p>

              {error && (
                <div className="mt-3 w-full rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive text-center">
                  {ERROR_MESSAGES[error] ?? 'Login failed. Please try again.'}
                </div>
              )}

              <div className="mt-5 h-px w-full bg-border" />
              <div className="flex-1" />

              <button
                onClick={handleGoogleLogin}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent cursor-pointer"
              >
                <GoogleIcon />
                Sign in with Google
              </button>

              <p className="mt-3 text-center text-[10px] leading-relaxed text-muted-foreground/60">
                By signing in, you agree to our Terms of Service
              </p>
            </div>

            {/* Footer strip */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center border-t border-border bg-secondary/50 py-2.5">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                <span className="text-[10px] text-muted-foreground">Secure Auth</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by{' '}
          <a
            href="https://github.com/nicepkg/frogie"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary/80 transition-colors"
          >
            Frogie
          </a>
        </p>
      </footer>
    </div>
  )
}
