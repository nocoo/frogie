import { expect, test } from './fixtures'

const mockUser = {
  id: 'basalt-check',
  email: 'basalt@example.test',
  name: 'Basalt Check',
  image: null,
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
