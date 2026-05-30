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

test.describe('E2E-3: Tạo sản phẩm và nhập kho', () => {
  test('should create a product and appear in inventory', async ({ page }) => {
    await loginIfNeeded(page)

    await page.goto('/products')
    await page.waitForURL(/products/)

    const uniqueName = `E2E Sản Phẩm ${Date.now()}`

    await page.locator('main').getByRole('button', { name: 'Thêm mới' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel(/tên sản phẩm|product name|tên/i).fill(uniqueName)

    // Switch to Pricing Tab
    await dialog.getByRole('button', { name: /Giá & Bảng giá/i }).click()

    const priceInput = dialog.getByLabel(/giá|price/i).first()
    await priceInput.fill('50000')

    await dialog.getByRole('button', { name: /lưu|save|tạo/i }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText(uniqueName).first()).toBeVisible({ timeout: 10_000 })
  })

  test('should record stock-in transaction', async ({ page }) => {
    await loginIfNeeded(page)

    await page.goto('/inventory')
    await page.waitForURL(/inventory/)

    const receiptTab = page.getByRole('tab', { name: /nhập kho|nhập hàng|receipt/i })
    if (await receiptTab.isVisible()) {
      await receiptTab.click()
    }

    const addReceiptBtn = page.getByRole('button', { name: /nhập kho thực tế/i }).first()
    if (await addReceiptBtn.isVisible()) {
      await addReceiptBtn.click()
      await page.waitForURL(/\/goods-receipts\/new/)

      // Switch to direct receipt mode
      await page.getByRole('button', { name: 'Nhập trực tiếp (Không PO)' }).click()

      // Select supplier
      await page.getByRole('button', { name: '-- Chọn nhà cung cấp --' }).click()
      await page.locator('button:has-text("Nha cung cap")').first().click()

      // Start receiving
      await page.getByRole('button', { name: 'Bắt đầu nhập hàng' }).click()

      // Add a product
      const productSearchInput = page.getByPlaceholder('Nhập tên sản phẩm hoặc mã SKU...')
      await productSearchInput.fill('PRD')
      await page.locator('button:has-text("SKU:")').first().click()

      // Fill lot number
      await page.getByPlaceholder(/số lô/i).first().fill('LOT-E2E-123')

      // Mark as verified/checked
      await page.locator('tbody tr').first().locator('button').last().click()

      // Click Lưu & Nhập kho
      await page.getByRole('button', { name: /lưu & nhập kho/i }).click()

      // Wait to redirect back to inventory page
      await page.waitForURL(/inventory/, { timeout: 10_000 })
    }
  })
})
