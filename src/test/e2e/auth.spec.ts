import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@sanhlongvetco.vn'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@SanhLong2026!'

test.describe('E2E-1: Login admin', () => {
  test('should login and reach dashboard', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return !!document.getElementById('login-email') || window.location.pathname.includes('/dashboard')
    }, null, { timeout: 15_000 })

    const emailInput = page.locator('#login-email')
    if (await emailInput.count() > 0) {
      await emailInput.waitFor({ state: 'visible', timeout: 5000 })
      await emailInput.fill(ADMIN_EMAIL)
      await page.locator('#login-password').fill(ADMIN_PASSWORD)
      await page.locator('button[type="submit"]').click()
      await page.waitForURL(/dashboard/, { timeout: 15_000 })
    }

    await expect(page).toHaveURL(/dashboard/)
    await expect(page.getByText(/chào buổi sáng|quản trị viên|doanh thu/i).first()).toBeVisible()
  })
})
