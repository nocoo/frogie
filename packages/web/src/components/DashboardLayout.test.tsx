// @vitest-environment jsdom

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardLayout } from './DashboardLayout'

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))

vi.mock('@/components/AppSidebar', () => ({
  AppSidebar: ({ onNavigate }: { onNavigate?: () => void }) => (
    <button type="button" onClick={onNavigate}>Select session</button>
  ),
}))

vi.mock('@nocoo/basalt', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  ContentIsland: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Sheet: ({ children, open }: { children?: ReactNode; open: boolean }) => open ? children : null,
  SheetContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  ThemeToggle: () => <button type="button">Theme</button>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@nocoo/basalt/components/app-header', () => ({
  AppHeader: ({ actions, leading }: { actions?: ReactNode; leading?: ReactNode }) => (
    <header>{leading}{actions}</header>
  ),
}))

vi.mock('@nocoo/basalt/components/app-shell', () => ({
  AppMain: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
  AppShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AppSkipLink: ({ children }: { children?: ReactNode }) => <a href="#main-content">{children}</a>,
}))

describe('DashboardLayout', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('closes the mobile sheet after an in-route sidebar selection', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route element={<DashboardLayout />}>
              <Route path="/settings" element={<div>Settings</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      )
    })

    const openButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Open navigation')
    expect(openButton).toBeTruthy()

    act(() => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const selection = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Select session')
    expect(selection).toBeTruthy()

    act(() => {
      selection?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).not.toContain('Select session')
  })
})
