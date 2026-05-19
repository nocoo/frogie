// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useIsMobile } from './use-mobile'

describe('hooks/use-mobile', () => {
  let listeners: ((e: MediaQueryListEvent) => void)[]
  let originalInnerWidth: number
  let container: HTMLDivElement
  let root: Root

  let unmounted: boolean

  beforeEach(() => {
    listeners = []
    originalInnerWidth = window.innerWidth
    unmounted = false

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_event: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.push(cb)
      },
      removeEventListener: (_event: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners = listeners.filter((l) => l !== cb)
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (!unmounted) {
      act(() => {
        root.unmount()
      })
    }
    container.remove()
    Object.defineProperty(window, 'innerWidth', {
      value: originalInnerWidth,
      writable: true,
      configurable: true,
    })
    vi.unstubAllGlobals()
  })

  function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', {
      value: width,
      writable: true,
      configurable: true,
    })
  }

  function renderHookValue(): { current: boolean } {
    const ref: { current: boolean } = { current: false }
    const Probe = (): React.ReactNode => {
      ref.current = useIsMobile()
      return null
    }
    act(() => {
      root.render(React.createElement(Probe))
    })
    return ref
  }

  it('returns true when viewport is below the mobile breakpoint', () => {
    setWidth(500)
    const ref = renderHookValue()
    expect(ref.current).toBe(true)
  })

  it('returns false when viewport is at or above the breakpoint', () => {
    setWidth(1024)
    const ref = renderHookValue()
    expect(ref.current).toBe(false)
  })

  it('updates when the media query change event fires', () => {
    setWidth(1200)
    const ref = renderHookValue()
    expect(ref.current).toBe(false)

    act(() => {
      setWidth(400)
      for (const cb of listeners) {
        cb({} as MediaQueryListEvent)
      }
    })

    expect(ref.current).toBe(true)
  })

  it('removes its listener on unmount', () => {
    setWidth(1024)
    renderHookValue()
    expect(listeners.length).toBeGreaterThan(0)

    act(() => {
      root.unmount()
    })
    unmounted = true

    expect(listeners.length).toBe(0)
  })
})
