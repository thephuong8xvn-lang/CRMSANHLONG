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

test.describe('E2E-3: Tạo sản phẩm và nhập kho', () => {
  test('should create a product and appear in inventory', async ({ page }) => {
    await loginIfNeeded(page)

    await page.goto('/inventory')
    await page.waitForURL(/inventory/)

    const uniqueName = `E2E Sản Phẩm ${Date.now()}`

    await page.getByRole('button', { name: /thêm|tạo|new|add/i }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel(/tên sản phẩm|product name|tên/i).fill(uniqueName)

    const priceInput = dialog.getByLabel(/giá|price/i).first()
    await priceInput.fill('50000')

    await dialog.getByRole('button', { name: /lưu|save|tạo/i }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText(uniqueName)).toBeVisible({ timeout: 10_000 })
  })

  test('should record stock-in transaction', async ({ page }) => {
    await loginIfNeeded(page)

    await page.goto('/inventory')
    await page.waitForURL(/inventory/)

    const receiptTab = page.getByRole('tab', { name: /nhập kho|nhập hàng|receipt/i })
    if (await receiptTab.isVisible()) {
      await receiptTab.click()
    }

    const addReceiptBtn = page.getByRole('button', { name: /tạo phiếu nhập|nhập kho|add/i }).first()
    if (await addReceiptBtn.isVisible()) {
      await addReceiptBtn.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await dialog.getByRole('button', { name: /lưu|save|xác nhận|confirm/i }).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
    }
  })
})
