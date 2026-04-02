/**
 * Workspace E2E Tests
 *
 * Tests for workspace management functionality.
 */

import { test, expect } from '@playwright/test'

test.describe('Workspace Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to workspaces page
    await page.goto('/workspaces')
  })

  test('should display workspaces page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
  })

  test('should show workspace selector in sidebar', async ({ page }) => {
    await expect(page.getByText('Workspace')).toBeVisible()
    await expect(page.getByText('Select workspace...')).toBeVisible()
  })

  test('should open create workspace dialog', async ({ page }) => {
    // Click on workspace selector
    await page.getByText('Select workspace...').click()

    // Click add workspace
    await page.getByText('Add workspace').click()

    // Verify dialog opens
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Create Workspace')).toBeVisible()
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByLabel('Path')).toBeVisible()
  })

  test('should create a new workspace', async ({ page }) => {
    // Open create dialog
    await page.getByText('Select workspace...').click()
    await page.getByText('Add workspace').click()

    // Fill form
    await page.getByLabel('Name').fill('Test Workspace')
    await page.getByLabel('Path').fill('/tmp/test-workspace')

    // Submit
    await page.getByRole('button', { name: 'Create' }).click()

    // Wait for dialog to close
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // Verify workspace appears in selector
    await page.getByText('Test Workspace').click()
    await expect(page.getByText('Test Workspace')).toBeVisible()
  })

  test('should select a workspace', async ({ page }) => {
    // First create a workspace
    await page.getByText('Select workspace...').click()
    await page.getByText('Add workspace').click()
    await page.getByLabel('Name').fill('Select Test')
    await page.getByLabel('Path').fill('/tmp/select-test')
    await page.getByRole('button', { name: 'Create' }).click()

    // Now select it from dropdown
    await page.getByText('Select Test').click()

    // Verify it's selected (shown in button)
    await expect(page.getByRole('button', { name: /Select Test/ })).toBeVisible()
  })
})
