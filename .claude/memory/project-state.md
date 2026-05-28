---
name: project-state
description: Trạng thái dự án CRM Sanh Long Vetco — sprint hiện tại, files quan trọng, kỹ thuật đã áp dụng
metadata:
  type: project
---

## Dự án: CRM/ERP Sanh Long Vetco

**Thư mục**: `E:\CRMSANHLONG`  
**Stack**: React 18 + TypeScript + Vite + Supabase + TanStack Query + Tailwind CSS  
**Ngày cập nhật**: 2026-05-26

---

## Hoàn thành 100%: Phase 1–3 + Sprint P0–P3

10 phân hệ nghiệp vụ đầy đủ (Auth, KH, Sản phẩm, Kho, POS, Đơn hàng, Pipeline, Sổ quỹ, Báo cáo, Chăn nuôi).

Sprint P0–P3 hoàn thành: lazy routes, manualChunks Vite, TanStack Query, server-side pagination, useVirtualizer POS, Skeleton components, ProductImage lazy, self-host font, web-vitals → Supabase, useRealtimeTable, useNotifications, ErrorBoundary.

---

## Sprint P4 — Đang thực hiện (3/10 hoàn thành)

### ✅ P4-1: Test Infrastructure (2026-05-26)
- **37/37 unit tests pass** (`npm test`)
- Vitest + @testing-library/react + @testing-library/jest-dom + MSW + @vitest/coverage-v8
- `vite.config.ts`: đổi sang `import { defineConfig } from 'vitest/config'`; thêm `test.exclude: ['**/e2e/**']`
- Unit tests: `src/test/unit/` — useDebouncedValue (6), logger (3), queryClient (9), cartUtils (18)
- `src/lib/cartUtils.ts` — pure functions tách từ POSPage để testable
- E2E: `src/test/e2e/` — auth, customer, inventory, pos, cashbook spec files
- CI: `.github/workflows/test.yml` — typecheck → vitest → playwright mỗi PR
- Scripts: `npm test`, `npm run test:coverage`, `npm run test:e2e`

### ✅ P4-2: PWA (2026-05-26)
- `vite-plugin-pwa` v1.3.0 với workbox `generateSW`
- Precache 60 assets; NetworkFirst Supabase REST (5s timeout, 24h fallback); CacheFirst Storage (7 ngày)
- `registerType: 'prompt'` — user confirm trước khi update
- `src/components/PwaUpdateBanner.tsx` — import dynamic `virtual:pwa-register`, auto-check mỗi 1h
- Icons: `public/pwa-192.svg`, `public/pwa-512.svg` — theme `#1E5A9C`
- Build sinh `dist/sw.js` + `dist/workbox-*.js`

### ⏭ P4-3: VAT điện tử — BỎ QUA (user yêu cầu)

### ✅ P4-4: Khuyến mãi 6 loại + Voucher + Tích điểm (2026-05-26)
- Migration: `supabase/migrations/20260526000020_promotions_vouchers_loyalty.sql`
  - Extend `promotions.discount_type` CHECK → 6 loại: percent, fixed_amount, buy_x_get_y, combo_price, tiered_quantity, customer_tier_discount
  - Thêm cột: buy_x_qty, get_y_qty, tiers (JSONB), customer_tiers (TEXT[]), priority
  - Tạo bảng `vouchers` (code 6 ký tự, max_uses, current_uses, valid_to)
  - Tạo bảng `loyalty_points` + view `customer_loyalty_summary`
  - Trigger `trg_award_loyalty_points` — tích điểm khi order → paid/completed (rate từ system_settings)
- `src/hooks/usePromotionEngine.ts`:
  - `applyBestPromotion(cart, subtotal, customerTier)` → chọn promo discount cao nhất
  - `applyVoucher(code, subtotal)` → lookup Supabase, validate, tính giảm giá
- `src/pages/promotions/PromotionsPage.tsx` — CRUD 6 loại KM + tab Voucher
- POSPage — auto-apply best promo khi cart thay đổi; voucher input + badge; `clearDiscount()`
- Route `/promotions` (perm: `promotions.manage`); nav link "Khuyến mãi" (icon Tag)

### ⏭ P4-5: Chấm công — BỎ QUA (user yêu cầu)

### ✅ Cấu hình in ấn (2026-05-28)
- 9 cột `print_*` cấu hình in được thêm vào `display_settings`.
- Form admin cấu hình header công ty + giấy/hướng in tại tab "Cấu hình in ấn".
- Tích hợp xem trước và in chứng từ động cho hóa đơn, phiếu thu, chi, chuyển kho tại `/print-preview`.

### ✅ Phân quyền RBAC & RLS (2026-05-28)
- Sửa lỗi phân quyền RBAC & RLS cho các vai trò nhân viên.
- Thêm quyền còn thiếu cho: `branch_manager`, `warehouse_keeper`, `accountant`, `team_lead`, `vet_consultant`, `sales` vào bảng `role_permissions`.
- Cập nhật các chính sách RLS cho: `customer_debts`, `orders`, `order_lines`, `cashbook_transactions`, `herd_projects`, `herd_project_steps`, `herd_project_outcomes`.
- Migration file: [20260528000009_fix_rbac_permissions.sql](file:///E:/CRMSANHLONG/supabase/migrations/20260528000009_fix_rbac_permissions.sql)

### ✅ Vá lỗi layout bảng nhập kho (2026-05-28)
- Khắc phục lỗi co giãn cột và che khuất dữ liệu ở bảng kê chi tiết kiểm kho hàng loạt (cột Giá nhập, Mã số lô, Kho & Vị trí) trong [GoodsReceiptFormPage.tsx](file:///E:/CRMSANHLONG/src/pages/goods-receipts/GoodsReceiptFormPage.tsx) bằng các lớp `min-w` cố định.

### ✅ Đồng bộ giá vốn & Chi tiết phiếu nhập (2026-05-28)
- Thêm cơ chế đồng bộ giá vốn tự động từ phiếu nhập kho vào bảng giá qua trigger `fn_create_stock_lot_on_receipt`.
- Nâng cấp view `product_stock_summary_view` tự động fallback lấy giá vốn từ lô hàng gần nhất nếu giá vốn trong bảng giá chưa cấu hình.
- Triển khai cột hành động và Modal chi tiết phiếu nhập kho tại tab "Phiếu nhập kho" trong `InventoryPage.tsx` để xem chi tiết danh sách sản phẩm đã nhập.

### 🔲 Còn lại: P4-6, P4-7, P4-8, P4-9, P4-10

**Bước tiếp theo gợi ý**: P4-6 (Excel export kế toán VN) → P4-7 (2FA + Audit log) → P4-10 (Onboarding + docs)

---

## Files quan trọng cần biết

| File | Vai trò |
|---|---|
| `roadmap_tasks.md` | Nguồn sự thật duy nhất — đọc trước khi làm task mới |
| `docs/05-PERFORMANCE-PLAYBOOK.md` | 10 quy tắc performance, bundle budget |
| `src/lib/queryClient.ts` | TanStack QueryClient + key factory `qk.*` |
| `src/lib/cartUtils.ts` | Pure functions cart — không import React/Supabase |
| `src/hooks/useRealtimeTable.ts` | Generic Supabase realtime subscription |
| `src/hooks/usePromotionEngine.ts` | Engine tính discount 6 loại + voucher |
| `supabase/migrations/` | Tất cả migration — đặt tên `YYYYMMDDXXXXXX_*.sql` |
| `vite.config.ts` | Import từ `vitest/config`, có VitePWA + manualChunks |
| `.github/workflows/test.yml` | CI: typecheck + vitest + playwright |

**Why:** Các file này ảnh hưởng toàn bộ kiến trúc — sửa sai một chỗ có thể break nhiều nơi.  
**How to apply:** Đọc file tương ứng trước khi thêm feature liên quan đến testing, cart, promotion, hoặc DB migration.
