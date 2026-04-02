/**
 * Session E2E Tests
 *
 * Tests for session management functionality.
 */

import { test, expect } from '@playwright/test'

test.describe('Session Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to chat page
    await page.goto('/')

    // Create a workspace first
    await page.getByText('Select workspace...').click()
    await page.getByText('Add workspace').click()
    await page.getByLabel('Name').fill('Session Test Workspace')
    await page.getByLabel('Path').fill('/tmp/session-test')
    await page.getByRole('button', { name: 'Create' }).click()
  })

  test('should display session list in sidebar', async ({ page }) => {
    await expect(page.getByText('Sessions')).toBeVisible()
    await expect(page.getByText('No sessions yet')).toBeVisible()
  })

  test('should create a new session', async ({ page }) => {
    // Click the plus button to create a session
    await page.getByRole('button', { name: /\+/ }).first().click()

    // Wait for session to be created
    await expect(page.getByText('Session 1')).toBeVisible()
  })

  test('should select a session', async ({ page }) => {
    // Create a session
    await page.getByRole('button', { name: /\+/ }).first().click()

    // Click on the session
    await page.getByText('Session 1').click()

    // Verify chat panel shows
    await expect(page.getByText('Connected')).toBeVisible()
  })

  test('should delete a session', async ({ page }) => {
    // Create a session
    await page.getByRole('button', { name: /\+/ }).first().click()
    await expect(page.getByText('Session 1')).toBeVisible()

    // Hover over session to reveal delete button
    await page.getByText('Session 1').hover()

    // Click delete button
    await page.getByRole('button', { name: 'Delete session' }).click()

    // Verify session is removed
    await expect(page.getByText('Session 1')).not.toBeVisible()
    await expect(page.getByText('No sessions yet')).toBeVisible()
  })

  test('should create multiple sessions', async ({ page }) => {
    // Create first session
    await page.getByRole('button', { name: /\+/ }).first().click()
    await expect(page.getByText('Session 1')).toBeVisible()

    // Create second session
    await page.getByRole('button', { name: /\+/ }).first().click()
    await expect(page.getByText('Session 2')).toBeVisible()

    // Both should be visible
    await expect(page.getByText('Session 1')).toBeVisible()
    await expect(page.getByText('Session 2')).toBeVisible()
  })
})
