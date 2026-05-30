import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@sanhlongvetco.vn'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@SanhLong2026!'

async function loginIfNeeded(page: import('@playwright/test').Page) {
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
}

test.describe('E2E-2: Tạo khách hàng mới', () => {
  test('should create a new customer and appear in list', async ({ page }) => {
    await loginIfNeeded(page)

    await page.goto('/customers')
    await page.waitForURL(/customers/)

    const uniqueName = `E2E Khách Hàng ${Date.now()}`
    const uniquePhone = `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`

    await page.getByRole('button', { name: 'Thêm khách hàng' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel(/tên|name/i).fill(uniqueName)
    await dialog.getByLabel(/điện thoại|phone|sdt/i).fill(uniquePhone)

    await dialog.getByRole('button', { name: /lưu|save|tạo|tạo mới/i }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText(uniqueName).first()).toBeVisible({ timeout: 10_000 })
  })
})
