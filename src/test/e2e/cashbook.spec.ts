import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Cashbook Module (Sổ quỹ)
 * AUDIT-2026-05-30 — Sprint S1.5: viết lại để cover thực sự luồng tạo phiếu.
 * Lưu ý: form tạo phiếu là sidebar LUÔN hiển thị trên desktop (không có nút
 * "Tạo phiếu" mở dialog). Test cũ dùng getByRole('button',{name:/tạo phiếu/i})
 * nên return sớm, không cover gì.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@sanhlongvetco.vn'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@SanhLong2026!'
const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD theo giờ địa phương

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto('/')
  
  // Unregister all service workers and clear cache to avoid PWA caching issues in E2E tests
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const reg of registrations) {
        await reg.unregister()
      }
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      for (const key of keys) {
        await caches.delete(key)
      }
    }
  })

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

test.describe('E2E-5: Sổ quỹ & dòng tiền', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()))
    page.on('pageerror', err => console.error('BROWSER PAGE ERROR:', err))
    await loginIfNeeded(page)
    await page.goto('/cashbook')
    await page.waitForURL(/cashbook/)
    await expect(
      page.getByRole('heading', { name: /sổ quỹ|thu chi|cashbook/i }).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('hiển thị các thẻ tổng quan số dư', async ({ page }) => {
    await expect(page.getByText(/Tiền mặt tại quỹ/i).first()).toBeVisible()
    await expect(page.getByText(/Tài khoản Ngân hàng/i).first()).toBeVisible()
    await expect(page.getByText(/phiên ca thu ngân/i).first()).toBeVisible()
  })

  test('form tạo phiếu luôn hiển thị (sidebar) trên desktop', async ({ page }) => {
    await page.getByRole('button', { name: /Phiếu thu \/ chi/i }).click()
    await expect(page.locator('form').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Xác nhận lưu phiếu/i })).toBeVisible()
  })

  test('ô ngày giao dịch mặc định = hôm nay & chặn ngày tương lai', async ({ page }) => {
    await page.getByRole('button', { name: /Phiếu thu \/ chi/i }).click()
    const dateInput = page.locator('form input[type="date"]').first()
    await expect(dateInput).toHaveValue(today)
    await expect(dateInput).toHaveAttribute('max', today)
  })

  test('đổi loại phiếu Thu → Chi vẫn còn danh mục hạng mục', async ({ page }) => {
    await page.getByRole('button', { name: /Phiếu thu \/ chi/i }).click()
    await page.getByRole('button', { name: /Phiếu Chi tiền/i }).click()
    const categorySelect = page.locator('form select').first()
    await expect(categorySelect).toBeVisible()
    await expect(categorySelect.locator('option').first()).toBeAttached({ timeout: 5000 })
    expect(await categorySelect.locator('option').count()).toBeGreaterThan(0)
  })

  test('tạo phiếu chi chuyển khoản (≤10M) → toast thành công', async ({ page }) => {
    await page.getByRole('button', { name: /Phiếu thu \/ chi/i }).click()
    await page.getByRole('button', { name: /Phiếu Chi tiền/i }).click()

    // Đợi các tài khoản thanh toán load xong để tránh race condition
    const accountSelect = page.locator('form select').nth(1)
    await expect(accountSelect.locator('option').first()).toBeAttached({ timeout: 5000 })

    await page.locator('form input[type="number"]').first().fill('250000')
    // Chuyển khoản (ngân hàng) để không vướng ràng buộc mở ca tiền mặt
    await page.locator('form').getByRole('button', { name: /Chuyển khoản/i }).click()
    
    // Đợi select hiển thị tài khoản ngân hàng Vietcombank
    await expect(accountSelect.locator('option').first()).toHaveText(/Vietcombank/i, { timeout: 5000 })
    await page.locator('form textarea').first().fill('E2E test — chi phí văn phòng')
    await page.getByRole('button', { name: /Xác nhận lưu phiếu/i }).click()
    await expect(page.getByText(/thành công/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('tab Phiên quỹ hiển thị lịch sử ca', async ({ page }) => {
    await page.getByRole('button', { name: /Phiên quỹ/i }).click()
    await expect(page.getByText(/mở\/đóng ca/i).first()).toBeVisible()
  })
})
