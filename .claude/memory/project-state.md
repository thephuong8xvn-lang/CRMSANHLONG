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

### ✅ P4-4b: KM theo chi nhánh + KM theo hàng hóa gợi ý POS (2026-05-30)
- Migration: `supabase/migrations/20260530000003_product_promotions_and_branch_scope.sql`
  - Thêm cột `promotions.branch_ids UUID[]` (rỗng = toàn hệ thống).
  - Bảng mới `product_promotions` (product_id, promo_type buy_x_get_y/percent/fixed_amount, buy_qty, get_qty, get_product_id, discount_value, min_qty, branch_ids, priority, valid_from/to).
  - RLS scope chi nhánh cho CẢ promotions & product_promotions: admin/ceo mọi CN; nhân viên có `promotions.manage` chỉ tạo/sửa bản ghi `branch_ids = [fn_my_branch_id()]` (WITH CHECK).
- `src/hooks/useProductPromotions.ts` (MỚI): load + lọc branch/hiệu lực + `evaluateProductPromo()` + `promoShortLabel()` + `getTopPromo()`.
- `src/hooks/usePromotionEngine.ts`: `usePromotionEngine(branchId?)` lọc promo theo chi nhánh.
- `src/pages/orders/POSPage.tsx`: badge 🎁 trên thẻ SP cột giữa + banner gợi ý 1-chạm trong giỏ (buy_x_get_y → nút "Tặng N" dùng `applyProductGift`; percent/fixed → nút "Áp giảm %" dùng `setRowDiscount`). Truyền `profile.branch_id` vào cả 2 hook.
- `src/pages/products/ProductPromotionModal.tsx` (MỚI): CRUD KM sản phẩm; admin multi-select chi nhánh, nhân viên khóa CN mình.
- `src/pages/products/ProductDetailPage.tsx`: tab thứ 4 "Khuyến mãi" quản lý product_promotions của SP.
- `src/pages/promotions/PromotionsPage.tsx`: PromotionModal thêm multi-select chi nhánh; danh sách hiển thị chip "Toàn hệ thống / N chi nhánh".
- ⚠️ Chạy migration `20260530000003` qua Supabase SQL Editor. tsc PASS 0 lỗi.

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

## 2026-05-31 — Trang in "dữ liệu thật 100%" + Cấu hình Quỹ/Ngân hàng

- **Sổ quỹ S1–S3 đã xong** (9 migration apply remote). Module Cashbook dùng dữ liệu thật, không còn mock.
- **`PrintPreviewPage.tsx`**: bỏ hẳn `loadMockData()` (không fallback dữ liệu giả khi DB lỗi/thiếu `id` → màn lỗi + disable nút In). Phiếu thu/chi: select thêm `cash_fund_id/bank_account_id` + JOIN `cash_funds`/`bank_accounts` → in đúng tên quỹ/số TK (trước hardcode "Tài khoản ngân hàng ACB").
- **`SystemSettingsPage.tsx`** tab mới `'funds'` ("Quỹ & Ngân hàng"): CRUD `cash_funds` + `bank_accounts`, toggle mặc định (gỡ cờ chi nhánh TRƯỚC khi ghi → tránh unique index), sửa số dư. RLS `*_manage_admin` (admin/accountant) có sẵn — không cần migration. Default flags từ migration `20260531000000`.
- `tsc --noEmit` PASS.

## 2026-05-31 (S4) — Mở/Đóng ca + Đối soát tiền mặt

- **1 chi nhánh = 1 két, mỗi két 1 ca `open`, dùng chung nhiều NV.** Tiền mặt gắn `session_id`; chuyển khoản không → rạch ròi.
- **Migration `20260606000000_cashbook_session_reconcile.sql`** (⚠️ apply remote): hoàn tiền mặt gắn session; danh mục `THU-LECH-QUY`/`CHI-LECH-QUY`; index 1-ca-mở/két + dọn trùng; RLS ca theo chi nhánh.
- **`CashbookPage.tsx`**: `checkActiveSession` theo két; mở ca chặn két đã mở + gợi ý đầu ca + cảnh báo quỹ≠mặc định + `opened_by`; đóng ca có **bảng đối soát** (tồn dự kiến + chênh lệch live + CK tham khảo) + `closed_by`/`variance_reason` + danh mục lệch quỹ; thẻ ca hiện "Tồn quỹ hiện tại".
- `tsc --noEmit` PASS.

## 2026-05-31 (S4) — Hoàn thiện module Dự án Chăn nuôi (Tab Chi phí, Đánh giá, Overview)

- **Chi phí & Lợi nhuận**: Tab Chi phí hoàn chỉnh liên kết bảng `herd_project_costs`. Tự động thêm chi phí vaccine/medicine (loại `medicine`) lấy theo đơn giá vốn (`cost_price`) của lô tương ứng từ database khi hoàn thành bước có sử dụng thuốc. Hỗ trợ CRUD chi phí thủ công (thức ăn, nhân công, chi phí khác) trực tiếp trên tab và hiển thị các khối KPI Doanh thu, Chi phí, Lợi nhuận ròng.
- **Đánh giá & Phân công**: Step modal hỗ trợ gán người thực hiện (`assigned_to`) và đánh giá QL/KH khi hoàn thành (star rating + notes). Các đánh giá này được trực quan hóa trên checklist lịch trình chăn nuôi bên trái.
- **Thống kê nâng cao**: Header trang chi tiết hiển thị live Khu vực, Tuổi đàn (ngày) và Tổng chi phí lấy trực tiếp từ view `herd_project_list_view`.
- `tsc --noEmit` PASS.

## 2026-05-31 (S4) — Sửa lỗi tạo dự án chăn nuôi (Trigger fill_org)

- **Sửa lỗi cơ sở dữ liệu**: Sửa bug trigger `public.fn_fill_org_from_owner()` do cố gắng gán `NEW.branch_id` khi chèn/cập nhật vào bảng `herd_projects` (không có cột `branch_id`), gây ra lỗi `record "new" has no field "branch_id"`. Hàm trigger mới được bọc khối `BEGIN ... EXCEPTION WHEN undefined_column THEN ... END` để động hóa và bỏ qua lỗi nếu cột `branch_id` hoặc `team_id` không tồn tại trong bảng đích.
- **Áp dụng Migration**: Đã repair các migration cũ trên bảng Remote history của Supabase bằng `npx supabase migration repair` và tự động push thành công migration `20260610000000_fix-fill-org-trigger.sql`.
- **Cải tiến UI**: Thay đổi thông báo lỗi trong catch block của `HerdProjectFormPage.tsx` để hiển thị chi tiết thông báo lỗi thực tế từ cơ sở dữ liệu thay vì thông báo lỗi chung chung.

## 2026-06-01 (tiếp) — Fix xuất PDF "Could not resolve font"

- **Bug**: `src/lib/exporters/documentPdf.tsx` chỉ `Font.register` biến thể normal (Regular-400, SemiBold-600), nhưng styles `words`/`signHint` dùng `fontStyle:'italic'`. react-pdf không nghiêng giả lập → `resolve()` không tìm thấy nguồn italic → throw `Could not resolve font for BeVietnamPro, fontWeight 400`. Khối chữ ký có ở cả 6 loại chứng từ ⇒ PDF luôn fail.
- **Fix**: thêm 2 dòng `Font.register` `fontStyle:'italic'` trỏ lại Regular/SemiBold sẵn có (không thêm asset; chữ hiển thị đứng — chuẩn chứng từ VN). Verify: tsc PASS + render thử react-pdf OK 11KB.
- **Rà soát**: phiếu chuyển kho `quantityActual = quantity` là đúng (`stock_transfer_lines` chỉ 1 cột `quantity`, chuyển atomic). `/print-preview` chỉ `ProtectedRoute` — ranh giới thật là RLS, giữ nguyên.

## 2026-06-01 (tiếp) — Nâng cấp orders/pos: 2 luồng bán + RPC atomic

- **Migration `20260613000000_pos_order_rpcs.sql`** ⚠️ **CHƯA APPLY REMOTE** (cần token): cột `orders.sale_channel` (pos_quick/delivery) + 5 RPC SECURITY DEFINER (`fn_pos_quick_sale`, `fn_create_delivery_draft`, `fn_confirm_order` chỉ admin, `fn_advance_delivery`, `fn_complete_delivery_payment`) + 2 helper nội bộ (`fn_pos_build_draft`, `fn_pos_settle_payment`). Atomic hoá tạo đơn, giữ chiết khấu cấp hoá đơn, check hạn mức server-side. **Phải apply mới chạy được POS mới.**
- **Luồng**: bán nhanh quầy = draft→confirmed→completed (1 RPC, thu tiền ngay, hỗ trợ trả một phần→ghi nợ). Giao hàng = draft(NV)→confirmed(Admin duyệt giá, trừ kho)→shipping→delivered→completed+thu tiền(chủ đơn/Admin).
- **POSPage**: toggle chế độ bán thật (trước là `<span>` giả), mặc định ẩn danh mục + tắt tự in, ô Khách trả ghi nợ phần thiếu, gọi RPC, bỏ receipt/Zalo/công ty giả → modal thành công + mở `/print-preview`.
- **OrderDetailPage**: admin sửa giá/CK dòng inline + xác nhận đơn; chủ đơn/Admin đang giao/đã giao/thu tiền qua RPC; badge loại đơn. **OrderListPage**: quick view "Đơn giao chờ xác nhận".
- Trigger `order_payments`→sổ quỹ + gắn session ca thu ngân (sẵn có) tự lo "thu tiền trong đơn vẫn báo cáo". tsc + build PASS.

## 2026-06-01 (tiếp) — Fix POS không tìm thấy SP/KH (cap 1000 dòng PostgREST)

- **Gốc lỗi:** query nạp `products`/`customers` trong POSPage & MobileOrderPage không `.order()`/`.limit()` → dính **giới hạn 1000 dòng mặc định PostgREST**. Thực tế 1002 SP / 1907 KH active → rớt SP mới + ~907 KH khỏi POS. Mọi tìm kiếm/grid/gợi ý lọc client-side trên mảng bị cắt.
- **Fix (Cách A):** helper `fetchAllRows()` lặp `.range()` theo lô 1000 + `.order('name'/'farm_name').order('id')`, áp cho products+customers ở cả 2 trang. Xác minh DB thật: nạp đủ 1002 SP (3 SKU đều found) + 1907 KH. tsc+build PASS.
- **Bài học:** mọi chỗ preload danh sách lớn rồi lọc client-side đều có nguy cơ cap 1000 — cần `fetchAllRows` hoặc search server-side. Catalog lớn về sau nên chuyển search server-side (`ilike`+limit).

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
