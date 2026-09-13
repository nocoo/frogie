/**
 * Chat E2E Tests
 *
 * Tests for chat functionality (requires mock or real API).
 */

import { expect, test } from './fixtures'

test.describe('Chat Interface', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to chat page
    await page.goto('/')

    // Create a workspace and session
    await page.getByText('Select workspace...').click()
    await page.getByText('Add workspace').click()
    await page.getByLabel('Name').fill('Chat Test Workspace')
    await page.getByLabel('Path').fill('/tmp/chat-test')
    await page.getByRole('button', { name: 'Create' }).click()

    // Create a session
    await page.getByRole('button', { name: 'New session' }).click()
    await page.getByText('Session 1').click()
  })

  test('should display chat interface', async ({ page }) => {
    // Connection status should show
    await expect(page.getByText(/Connected|Connecting/)).toBeVisible()

    // Input should be visible
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible()

    // Send button should be visible
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  })

  test('should show empty state when no messages', async ({ page }) => {
    await expect(page.getByText('What can I help you build?')).toBeVisible()
    await expect(page.getByText('I can read, write, and run code in your workspace.')).toBeVisible()
  })

  test('should have keyboard shortcut hint', async ({ page }) => {
    // Should show keyboard shortcut for sending
    await expect(page.getByText('Press')).toBeVisible()
    await expect(page.getByText('Enter')).toBeVisible()
    await expect(page.getByText('to send')).toBeVisible()
  })

  test('should disable send button when input is empty', async ({ page }) => {
    const sendButton = page.getByRole('button', { name: 'Send message' })
    await expect(sendButton).toBeDisabled()
  })

  test('should enable send button when input has text', async ({ page }) => {
    const input = page.getByPlaceholder('Type a message...')
    const sendButton = page.getByRole('button', { name: 'Send message' })

    await input.fill('Hello')
    await expect(sendButton).toBeEnabled()
  })

  test('should clear input after attempting to send', async ({ page }) => {
    const input = page.getByPlaceholder('Type a message...')
    const sendButton = page.getByRole('button', { name: 'Send message' })

    await input.fill('Test message')
    await sendButton.click()

    // Input should be cleared
    await expect(input).toHaveValue('')
  })

  test('should display user message in chat', async ({ page }) => {
    const input = page.getByPlaceholder('Type a message...')
    const sendButton = page.getByRole('button', { name: 'Send message' })

    await input.fill('Hello Frogie!')
    await sendButton.click()

    // User message should appear
    await expect(page.getByText('Hello Frogie!')).toBeVisible()
  })

  test('should announce a complete streamed response once the turn finishes', async ({ page }) => {
    const input = page.getByPlaceholder('Type a message...')
    await input.fill('Stream a response')
    await page.getByRole('button', { name: 'Send message' }).click()

    await expect(page.locator('[aria-live="polite"][aria-atomic="true"]'))
      .toHaveText('Mock response complete')
  })

  test('should show connection status', async ({ page }) => {
    // Should show connected status after WebSocket connects
    await expect(page.getByText('Connected')).toBeVisible({ timeout: 10000 })
  })
})
