/**
 * Workspace E2E Tests
 *
 * Tests for workspace management functionality.
 */

import { expect, test } from './fixtures'

test.describe('Workspace Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to workspaces page
    await page.goto('/workspaces')
  })

  test('should display workspaces page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Workspaces', level: 1 }).last()).toBeVisible()
  })

  test('should show workspace selector in sidebar', async ({ page }) => {
    await expect(page.getByText('Workspace', { exact: true })).toBeVisible()
    await expect(page.getByText('Select workspace...')).toBeVisible()
  })

  test('should open create workspace dialog', async ({ page }) => {
    // Click on workspace selector
    await page.getByText('Select workspace...').click()

    // Click add workspace
    await page.getByRole('button', { name: 'Add workspace', exact: true }).click()

    // Verify dialog opens
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Create Workspace')).toBeVisible()
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByLabel('Path')).toBeVisible()
  })

  test('should create a new workspace', async ({ page }) => {
    // Open create dialog
    await page.getByText('Select workspace...').click()
    await page.getByRole('button', { name: 'Add workspace', exact: true }).click()

    // Fill form
    await page.getByLabel('Name').fill('Test Workspace')
    await page.getByLabel('Path').fill('/tmp/test-workspace')

    // Submit
    await page.getByRole('button', { name: 'Create' }).click()

    // Wait for dialog to close
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // The newly created workspace is selected immediately.
    await expect(page.getByRole('button', { name: 'Select workspace' })).toContainText('Test Workspace')
  })

  test('should select a workspace', async ({ page }) => {
    // First create a workspace
    await page.getByText('Select workspace...').click()
    await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
    await page.getByLabel('Name').fill('Select Test')
    await page.getByLabel('Path').fill('/tmp/select-test')
    await page.getByRole('button', { name: 'Create' }).click()

    // Verify it is selected after creation.
    await expect(page.getByRole('button', { name: 'Select workspace' })).toContainText('Select Test')
  })
})
