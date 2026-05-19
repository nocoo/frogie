/**
 * Settings E2E Tests
 *
 * Tests for settings page functionality.
 */

import { test, expect } from '@playwright/test'

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
  })

  test('should display settings page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText('Configure your Frogie instance')).toBeVisible()
  })

  test('should display API configuration section', async ({ page }) => {
    await expect(page.getByText('API Configuration')).toBeVisible()
    await expect(page.getByLabel('API Base URL')).toBeVisible()
    await expect(page.getByLabel('API Key')).toBeVisible()
  })

  test('should display model selection', async ({ page }) => {
    await expect(page.getByText('Model')).toBeVisible()
    await expect(page.getByLabel('Default Model')).toBeVisible()
  })

  test('should display limits section', async ({ page }) => {
    await expect(page.getByText('Limits')).toBeVisible()
    await expect(page.getByLabel('Max Turns per Query')).toBeVisible()
    await expect(page.getByLabel('Max Budget (USD)')).toBeVisible()
  })

  test('should show save button disabled initially', async ({ page }) => {
    // Wait for settings to load
    await page.waitForSelector('text=All changes saved')

    const saveButton = page.getByRole('button', { name: 'Save Changes' })
    await expect(saveButton).toBeDisabled()
  })

  test('should enable save button when form is dirty', async ({ page }) => {
    // Wait for settings to load
    await page.waitForSelector('text=All changes saved')

    // Change a value
    const maxTurns = page.getByLabel('Max Turns per Query')
    await maxTurns.fill('50')

    // Save button should be enabled
    const saveButton = page.getByRole('button', { name: 'Save Changes' })
    await expect(saveButton).toBeEnabled()

    // Should show unsaved changes indicator
    await expect(page.getByText('Unsaved changes')).toBeVisible()
  })

  test('should update max budget', async ({ page }) => {
    // Wait for settings to load
    await page.waitForSelector('text=All changes saved')

    // Change max budget
    const maxBudget = page.getByLabel('Max Budget (USD)')
    await maxBudget.fill('5.00')

    // Save
    const saveButton = page.getByRole('button', { name: 'Save Changes' })
    await saveButton.click()

    // Should show success
    await expect(page.getByText('All changes saved')).toBeVisible()
  })

  test('should select model from dropdown', async ({ page }) => {
    // Wait for settings to load
    await page.waitForSelector('text=All changes saved')

    // Open model dropdown
    await page.getByLabel('Default Model').click()

    // Select a different model
    await page.getByRole('option', { name: 'Claude Opus 4' }).click()

    // Should show unsaved changes
    await expect(page.getByText('Unsaved changes')).toBeVisible()
  })
})
