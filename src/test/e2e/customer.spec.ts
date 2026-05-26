import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@sanhlongvetco.vn'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@SanhLong2026!'

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.waitForURL(/\/(login|dashboard)/)
  if (page.url().includes('login')) {
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
    await page.getByLabel(/mật khẩu|password/i).fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: /đăng nhập|login/i }).click()
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

    await page.getByRole('button', { name: /thêm|tạo mới|new|add/i }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel(/tên|name/i).fill(uniqueName)
    await dialog.getByLabel(/điện thoại|phone|sdt/i).fill(uniquePhone)

    await dialog.getByRole('button', { name: /lưu|save|tạo|tạo mới/i }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText(uniqueName)).toBeVisible({ timeout: 10_000 })
  })
})
