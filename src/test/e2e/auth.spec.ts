import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@sanhlongvetco.vn'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@SanhLong2026!'

test.describe('E2E-1: Login admin', () => {
  test('should login and reach dashboard', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(/\/(login|dashboard)/)

    if (page.url().includes('login')) {
      await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
      await page.getByLabel(/mật khẩu|password/i).fill(ADMIN_PASSWORD)
      await page.getByRole('button', { name: /đăng nhập|login/i }).click()
      await page.waitForURL(/dashboard/, { timeout: 15_000 })
    }

    await expect(page).toHaveURL(/dashboard/)
    await expect(page.getByText(/bảng điều khiển|dashboard/i).first()).toBeVisible()
  })
})
