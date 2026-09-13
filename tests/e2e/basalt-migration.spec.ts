import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

const mockUser = {
  id: 'basalt-check',
  email: 'basalt@example.test',
  name: 'Basalt Check',
  image: null,
}

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Select workspace' }).click()
  await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Path').fill(`/tmp/${name.toLowerCase().replaceAll(' ', '-')}`)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

test.describe('Basalt migration', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: mockUser }),
    }))
  })

  test('renders the authenticated shell and migrated page headings', async ({ page }) => {
    for (const [path, heading] of [
      ['/workspaces', 'Workspaces'],
      ['/prompts', 'System Prompts'],
      ['/settings', 'Settings'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 }).last()).toBeVisible()
      await expect(page.getByText('Frogie', { exact: true }).first()).toBeVisible()
      await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible()
    }
  })

  test('closes the mobile sheet after selecting the current route', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Open navigation' }).click()

    const navigation = page.getByRole('dialog', { name: 'Navigation' })
    await expect(navigation).toBeVisible()
    await navigation.getByRole('button', { name: 'Settings' }).click()
    await expect(navigation).not.toBeVisible()
  })

  test('supports prompt edit, toggle, revert and preview flows', async ({ page }) => {
    await page.goto('/')
    await createWorkspace(page, 'Prompt Workspace')
    await page.goto('/prompts')

    await page.getByRole('tab', { name: 'Workspace' }).click()
    await page.getByRole('button', { name: /Workspace date/ }).click()
    const editor = page.getByRole('dialog', { name: /Edit Date Context/ })
    await editor.getByLabel('Content').fill('Updated workspace prompt')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).not.toBeVisible()

    await page.getByRole('switch', { name: 'Toggle Date Context' }).click()
    await page.getByRole('button', { name: 'Revert to Global' }).click()
    await expect(page.getByRole('button', { name: 'Revert to Global' })).not.toBeVisible()

    await page.getByRole('button', { name: 'Preview' }).click()
    const preview = page.getByRole('dialog', { name: 'Prompt Preview' })
    await expect(preview.getByText('Preview prompt')).toBeVisible()
    await preview.getByRole('button', { name: 'Close' }).click()
  })

  test('supports workspace editing, color, directory, open and delete actions', async ({ page }) => {
    await page.goto('/workspaces')
    const main = page.locator('#main-content')
    await main.getByRole('button', { name: /Add Workspace/ }).click()
    const create = page.getByRole('dialog', { name: 'Create Workspace' })
    await create.getByRole('button', { name: 'Browse directory' }).click()
    await create.getByLabel('Name').fill('Managed Workspace')
    await create.getByLabel('Path').fill('/tmp/managed-workspace')
    await create.getByRole('button', { name: 'Create' }).click()

    await main.getByLabel('Name').fill('Renamed Workspace')
    await main.getByRole('button', { name: 'Select Blue color' }).click()
    await expect(main.getByRole('button', { name: 'Select Blue color' })).toHaveAttribute('aria-pressed', 'true')
    await main.getByRole('button', { name: 'Save' }).click()
    await main.getByRole('button', { name: 'Open in Finder' }).click()
    await main.getByRole('button', { name: /Delete Renamed Workspace/ }).click()
    await page.getByRole('dialog', { name: 'Delete Workspace' })
      .getByRole('button', { name: 'Delete' }).click()
    await expect(main.getByRole('heading', { name: 'Renamed Workspace' })).not.toBeVisible()
  })
})

test('renders the Basalt login badge in both color schemes', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: null }),
  }))
  await page.goto('/login')

  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await expect(page.locator('[data-basalt-surface-root]')).toBeVisible()
  const theme = page.getByRole('button', { name: 'Change theme' })
  await theme.click()
  await theme.click()
  await expect(page.locator('html')).toHaveClass(/dark/)
})
