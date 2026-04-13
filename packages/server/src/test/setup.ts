/**
 * Vitest setup file for server tests
 *
 * This file is run before each test file.
 * Note: Each test should clean up its own database via cleanupTestDb()
 * in afterEach hooks. Global cleanup is not done here to avoid race conditions
 * with parallel test execution.
 */

// Polyfill WebSocket for Node.js test environment (not available globally in Node)
if (typeof globalThis.WebSocket === 'undefined') {
  // Minimal stub so test code can reference WebSocket type and constants (e.g. WebSocket.OPEN)
  class WebSocketStub extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3

    readyState = WebSocketStub.CONNECTING
    binaryType = 'blob'
    bufferedAmount = 0
    extensions = ''
    protocol = ''
    url = ''

    onclose: ((ev: Event) => void) | null = null
    onerror: ((ev: Event) => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null
    onopen: ((ev: Event) => void) | null = null

    constructor(url: string | URL, _protocols?: string | string[]) {
      super()
      this.url = String(url)
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    send(_data: unknown): void {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close(_code?: number, _reason?: string): void {}
  }

  // @ts-expect-error -- stub is compatible enough for test mocking
  globalThis.WebSocket = WebSocketStub
}
