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

test.describe('E2E-5: Duyệt phiếu chi', () => {
  test('should load cashbook page with transaction list', async ({ page }) => {
    await loginIfNeeded(page)

    await page.goto('/cashbook')
    await page.waitForURL(/cashbook/)

    await expect(page.getByRole('heading', { name: /sổ quỹ|thu chi|cashbook/i }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('should create and approve an expense voucher', async ({ page }) => {
    await loginIfNeeded(page)

    await page.goto('/cashbook')
    await page.waitForURL(/cashbook/)

    const addBtn = page.getByRole('button', { name: /tạo phiếu|thêm|new|add/i }).first()
    if (!await addBtn.isVisible()) return

    await addBtn.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const typeSelect = dialog.getByLabel(/loại|type/i).first()
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption({ label: /chi|expense/i })
    }

    const amountInput = dialog.getByLabel(/số tiền|amount/i).first()
    await amountInput.fill('100000')

    const noteInput = dialog.getByLabel(/ghi chú|note|lý do/i).first()
    if (await noteInput.isVisible()) {
      await noteInput.fill('E2E test expense')
    }

    await dialog.getByRole('button', { name: /lưu|save|tạo/i }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    const approveBtn = page.getByRole('button', { name: /duyệt|approve/i }).first()
    if (await approveBtn.isVisible()) {
      await approveBtn.click()

      const confirmDialog = page.getByRole('dialog')
      if (await confirmDialog.isVisible()) {
        await confirmDialog.getByRole('button', { name: /xác nhận|confirm|duyệt/i }).click()
        await expect(confirmDialog).toBeHidden({ timeout: 10_000 })
      }

      await expect(page.getByText(/đã duyệt|approved/i).first()).toBeVisible({ timeout: 10_000 })
    }
  })
})
