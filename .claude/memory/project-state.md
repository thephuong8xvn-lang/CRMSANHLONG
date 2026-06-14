---
name: project-state
description: Trạng thái dự án CRM Sanh Long Vetco — sprint hiện tại, files quan trọng, kỹ thuật đã áp dụng
metadata:
  type: project
---

## Dự án: CRM/ERP Sanh Long Vetco

**Thư mục**: `E:\CRMSANHLONG`  
**Stack**: React 18 + TypeScript + Vite + Supabase + TanStack Query + Tailwind CSS  
**Ngày cập nhật**: 2026-06-07

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

## 2026-06-05 — Luồng DUYỆT phiếu nhập kho + sửa UI Inventory + audit cap-1000

- **Duyệt phiếu nhập kho** (giống duyệt đơn giao): `goods_receipts` thêm `status` (draft/verified/completed/cancelled) + audit cols. Migration `20260619000000_goods_receipt_approval.sql` (**apply remote**): gỡ trigger `trg_receipt_lines_create_lot`, thêm 4 RPC `fn_verify/complete/cancel/reopen_goods_receipt` (SECURITY DEFINER), RLS cho người lập sửa nháp của mình. Backfill 34 phiếu cũ → completed.
  - Vòng đời: NV lập → **draft** (sửa toàn quyền) → admin **verify** → người lập HOẶC admin **complete** (RPC tạo lô+thẻ kho+giá vốn+PO, atomic) → hàng vào kho.
  - Frontend: `GoodsReceiptFormPage` lưu nháp + chế độ sửa `?id=`; **`GoodsReceiptDetailPage.tsx` mới** + route `/goods-receipts/:id` (stepper + nút theo trạng thái/quyền); `InventoryPage` tab phiếu nhập có badge trạng thái + click sang trang chi tiết.
  - ⚠️ Lưu ý: `goods_receipts` giờ có 3 FK→profiles (received_by/verified_by/completed_by) → embed PostgREST PHẢI chỉ rõ FK (`profiles!goods_receipts_received_by_fkey`).
- **Sửa UI Inventory**: 3 modal (chuyển kho/phiếu nhập/trả NCC) vỡ chữ do modal hẹp → nới `max-w-4xl` + bảng `min-w` + `overflow-x-auto` + `whitespace-nowrap`.
- **Audit cap-1000**: các picker trọng yếu (PO/OrderEdit/Cashbook/Herd/PriceList) + CustomerMap/Pipeline ĐỀU đã `fetchAllRows` + SmartSearchSelect từ trước → không cần sửa.
- `tsc --noEmit` PASS.

## 2026-06-05 — Gỡ HOÀN TOÀN "Nhập kho / Thêm lô hàng" thủ công (ProductDetailPage)

- **Lý do (toàn vẹn dữ liệu):** nút này tạo `stock_lots` thủ công, bỏ qua Phiếu nhập NCC (không NCC/PO/chứng từ). Đã gỡ bỏ hoàn toàn; đường tăng tồn kho duy nhất nay là `GoodsReceiptFormPage`.
- **Frontend `ProductDetailPage.tsx`**: gỡ 2 nút (header + "Thêm lô hàng đầu tiên"), modal nhập lô, `handleAddLotSubmit`, state lô, gate `canReceiveStock`, state+fetch `warehouses`, import thừa (`Check`/`Calendar`/`FileText`/`settings`).
- **DB (toàn diện):** Migration `20260618000000_drop_fn_add_manual_lot.sql` `DROP FUNCTION fn_add_manual_lot(...)` — **ĐÃ APPLY remote** + verify + reload schema. RPC này từng tạo ở phiên 2026-05-31 (Products #2), nay thu hồi.
- **Dữ liệu cũ giữ nguyên**; RLS `stock_lots`/`stock_movements` + perm `inventory.receive` không đổi (vẫn dùng cho GoodsReceipt). `tsc --noEmit` PASS.

## 2026-06-07 — Vá lỗi "Phiếu nhập Hoàn tất nhưng tồn kho = 0" + khoá toàn vẹn status

- **Gốc lỗi (đã xác minh trên DB thật):** Migration duyệt `20260619000000` ĐÃ apply (gỡ trigger `trg_receipt_lines_create_lot`, kho chỉ sinh qua RPC `fn_complete_goods_receipt`). Nhưng frontend live (commit `c8791fb`) vẫn **nhét thẳng `status:'completed'` khi INSERT** → phiếu "Hoàn tất" mà không chạy RPC → **không có stock_lots/stock_movements → tồn kho = 0**. 4 phiếu dính: GR-879217, GR-532466, GR-752693, GR-837193 (cái cuối tạo 2026-06-07 → lỗi vẫn đang tiếp diễn).
- **Lỗ hổng bảo mật:** RLS goods_receipts KHÔNG ràng buộc `status` ở INSERT/UPDATE → client (anon key public) tự đặt completed / tự nâng cấp draft→verified→completed, bỏ qua duyệt + sinh kho. Workflow duyệt trước đó chỉ là "khuyến nghị".
- **Đã làm — Migration `20260622000000_harden_receipt_status.sql` (ĐÃ apply remote qua Management API):**
  1. Trigger `fn_guard_receipt_status` (BEFORE INSERT/UPDATE): INSERT **ép về 'draft'** + xoá cờ duyệt (an toàn cho frontend cũ, không lỗi); UPDATE đổi status trực tiếp **bị từ chối**. Miễn trừ qua cờ phiên `app.receipt_rpc='on'`.
  2. 4 RPC `fn_verify/complete/cancel/reopen` thêm `set_config('app.receipt_rpc','on',true)` → chỉ RPC mới đổi được status.
  3. Sửa dữ liệu: 4 phiếu hỏng (completed, completed_at NULL, không kho) → trả về **'verified'** để người lập/Admin bấm Hoàn thành trên UI → sinh kho qua RPC. (Verify: 0 phiếu completed-thiếu-kho còn lại.)
- **Frontend:** working-tree `GoodsReceiptFormPage` (lưu draft, không set status) + `GoodsReceiptDetailPage.tsx` (UI duyệt) **CẦN COMMIT + DEPLOY** mới có UX đầy đủ. Sửa `InventoryPage:960` fallback `|| 'completed'` → `|| 'draft'`. Build PASS.
- **Công nợ NCC — ĐÃ sửa theo "ghi nợ khi Hoàn thành"** (user chọn). Migration `20260623000000_supplier_debt_on_completion.sql` (ĐÃ apply remote): `fn_supplier_debt_on_receipt` viết lại — đóng góp công nợ = total_amount CHỈ khi status='completed', điều chỉnh theo chênh lệch ở mọi insert/update/đổi-NCC/sửa-total/delete. Đối soát 1 lần: trừ phần đóng góp của phiếu không-completed mà trigger cũ lỡ cộng. Kết quả MAVIN 4.833.210 → 2.779.460 (loại nợ ảo 2.053.750 của phiếu huỷ GR-532466). Huỷ phiếu giờ tự hoàn nợ; nháp/verified không tính nợ.
- **Người dùng đã tự nghiệm thu:** 3 phiếu (GR-879217/752693/837193) đã bấm Hoàn thành → có lô + thẻ kho; GR-532466 đã Huỷ. 37 completed (đều có kho), 1 cancelled. Frontend do user tự commit & deploy.

## 2026-06-09 — Kho: nén bảng danh sách còn 1 dòng/phiếu (thuần UI)
- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `src/pages/inventory/InventoryPage.tsx`.
- User báo (ảnh tab Phiếu nhập): mỗi phiếu cao 4-6 dòng. Yêu cầu mỗi phiếu 1 dòng, CHỈ tối ưu UI.
- **Gốc:** padding `px-6 py-4` lớn + text wrap (tên NCC/kho/người dài) + trạng thái TRÙNG 2 chỗ (badge dưới mã + cột "Trạng thái").
- **Đã làm (6 tab desktop — user duyệt toàn module + gộp trạng thái):** `px-6 py-4`→`px-4 py-2.5`; cột tên `max-w-[..] truncate`+`title`, cột ngắn `whitespace-nowrap`; tab Phiếu nhập gộp về 1 badge `RECEIPT_STATUS` ở cột Trạng thái, bỏ badge trùng dưới mã.
- Card mobile giữ nguyên. `GoodsReceiptDetailPage` đã tối ưu sẵn — không sửa. KHÔNG đụng query/RPC/RLS/branch filter/isAdmin/phân trang.

---

## 2026-06-09 (tiếp) — Kho: XÓA HẲN cuộn ngang bảng (table-fixed, thuần UI)
- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `InventoryPage.tsx`.
- User: nén 1 dòng rồi vẫn còn thanh cuộn ngang → kéo qua mới thấy hết, chậm thao tác. Yêu cầu xóa hẳn cuộn ngang.
- **Kỹ thuật:** bỏ `overflow-x-auto` (6 wrapper → `hidden md:block`); mọi bảng `table-fixed w-full` (cột chia theo khung, nội dung dài cắt `…`); ô `truncate`+`title`; `px-4`→`px-3`; cột phụ `text-tiny`; cột ngắn đặt `w-[..px]`, cột tên co giãn.
- **Phiếu nhập:** "Mã phiếu nhập"→"Code", "Nhà cung cấp"→"NCC"; bỏ cột Hành động; **Code = hyperlink** `navigate('/goods-receipts/:id')`.
- **Chuyển kho/Trả NCC:** Code = button mở modal chi tiết (chuyển onClick từ cột Hành động), bỏ cột Hành động. **PO/Lots/Định mức:** GIỮ cột thao tác (chức năng thật — Nhập kho/Sửa-Xóa).
- KHÔNG đụng query/RPC/RLS/branch/isAdmin/phân trang. Nút Code gọi đúng hàm cũ.

## 2026-06-09 (tiếp 2) — Phiếu nhập: bỏ Ghi chú, Ngày nhập+giờ, tab mặc định
- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `InventoryPage.tsx`.
- Bỏ cột "Ghi chú" bảng desktop Phiếu nhập (giữ `notes` ở card mobile + query).
- "Ngày nhận"→"Ngày nhập" hiển thị ngày+giờ từ `created_at` (TIMESTAMPTZ; `receipt_date` là DATE không giờ); sắp xếp `.order('created_at', desc)` → mới nhất lên đầu. Thêm `created_at` vào select+interface+card.
- Tab mặc định /inventory = `'receipts'` (đổi từ `'lots'`) → "Về Kho hàng" ở trang chi tiết cũng về Phiếu nhập.
- KHÔNG đụng RLS/branch/RPC/phân trang.

## 2026-06-09 (tiếp 3) — Đơn hàng: bảng 1 dòng/đơn, xóa cuộn ngang (thuần UI)
- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `OrderListPage.tsx`.
- Cùng pattern Kho: bỏ `overflow-x-auto`; `table-fixed w-full`; `px-4 py-2.5`; cột Mã/KH/NV `truncate`+`title`, cột ngắn `whitespace-nowrap`+`w-[..px]`.
- Badge status/payment thêm `whitespace-nowrap` (thủ phạm wrap 2 dòng). Row vẫn onClick navigate. KHÔNG đụng query/RLS/lọc/phân trang.

## 2026-06-09 (tiếp 4) — Đơn hàng: header gọn, fix đè cột, phân trang 20/trang
- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `OrderListPage.tsx`.
- Header: Code/Khách hàng/Time/NV/Tổng. **Fix đè:** ô nowrap cột hẹp → tràn đè; thêm `overflow-hidden`+nới `w-[..]` (Code148/Time150/TT160/TThái150). `itemsPerPage` 8→20.
- Không đụng query/RLS/branch/realtime/điều hướng.

## 2026-06-09 (tiếp 5) — Đơn hàng: trị tận gốc đè cột (spacer + giảm font)
- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `OrderListPage.tsx`.
- Gốc rễ: 1 cột flex duy nhất (Khách hàng) nuốt hết width dư → cột khác bị bóp/đè. Fix: width cố định cả 7 cột + spacer auto cuối; font 5 cột → `text-[11px]`, badge `px-2 text-[11px]`.

## 2026-06-09 (tiếp 6) — Đơn hàng: bỏ spacer, cân bằng bảng lấp đầy body
- **Frontend-only. `tsc -b --noEmit` PASS.** Chỉ `OrderListPage.tsx`. Bỏ spacer; cột Khách hàng co giãn lại (`min-w-[240px]`) → lấp đầy body cân bằng; 6 cột phụ width cố định + `text-[11px]`.
- Pattern cuối: 1 cột chính co giãn + cột phụ width cố định + font nhỏ; KHÔNG spacer.

## 2026-06-09 (tiếp 7) — LAYOUT BẢNG CHUẨN: DataTable (Phase 1)
- **Frontend-only. `tsc -b` + `vite build` PASS.** Component MỚI `src/components/DataTable.tsx` = bảng danh sách chuẩn kế thừa toàn cục (table-fixed không cuộn ngang, 1 cột flex + cột phụ width cố định, loading/empty/card mobile tự sinh/phân trang 20). Khai báo qua `columns`.
- OrderListPage + InventoryPage (6 tab) đã dùng DataTable (xóa bảng/mobile/pagination thủ công). Hành vi giữ nguyên. KHÔNG đụng fetch/RLS/quyền.
- **Phase 2 còn:** Khách hàng/Sản phẩm/NCC/Sổ quỹ. **Phase 3:** Báo cáo/Pipeline/Herd. Mọi bảng danh sách MỚI dùng DataTable.

## 2026-06-09 (tiếp 8) — DataTable Phase 2: Khách hàng · Sản phẩm · Sổ quỹ
- **Frontend-only. `tsc -b` + `vite build` PASS.** NCC giữ card grid (không phải bảng).
- DataTable thêm: `manualPagination` (server-side), `expandedRowRender(row, collapse)` (dòng mở rộng, render nhận arg2 `expanded`), `headerSummary` (dòng tổng). Tương thích ngược.
- Convert: Customer (expand QuickView + dropdown), Product (expand + headerSummary tổng + chevron/sao/ảnh), Cashbook (history manualPagination + click→modal; sessions client). Giữ nguyên query/RLS/quyền.
- **Phase 3 còn:** Báo cáo/Pipeline/Herd + bảng chi tiết/modal.

## 2026-06-10 — Báo cáo Kho hàng theo Giá vốn (admin-only) + vá lộ view báo cáo
- **Có migration `20260626000000_inventory_valuation_report.sql` (ĐÃ apply remote + smoke-test). `tsc -b` + `vite build` PASS.** Tài liệu: `docs/09-INVENTORY-VALUATION-REPORT.md`.
- View `v_stock_lot_valuation` + 3 RPC admin-only (`fn_inventory_valuation_summary/_by_product/_by_group`) — giá vốn TB = **bình quân gia quyền theo lô active** (`Σqty×cost/Σqty`); vòng quay từ `stock_movements` sale 90 ngày (turnover = sold_90d/tồn hiện tại — xấp xỉ, có footnote); index mới `idx_stockmov_product_type_created`.
- Trang `/reports/inventory-valuation` (`InventoryValuationReportPage.tsx`): 4 KPI + banner cảnh báo (SP thiếu giá vốn, lô quá hạn còn active) + 2 chart Recharts + 7 tab DataTable (SP manualPagination 50 / brand / category / warehouse / top50 / vòng quay / tồn lâu-dead stock) + lọc kho-SP-brand-category + CSV. Hook `useInventoryValuation.ts` + `qk.reports.*`. **DataTable Phase 3 đã bắt đầu cho Báo cáo.**
- **🔒 Lỗ hổng đã vá:** Supabase `ALTER DEFAULT PRIVILEGES` tự GRANT anon/authenticated lên view mới → `v_order_line_profit` (profit report) từng lộ qua PostgREST cho mọi user + anon. Đã REVOKE cả 2 view. **Quy ước: view "chỉ dùng nội bộ RPC" PHẢI REVOKE tường minh trong cùng migration.**
- **Lưu ý migration:** dự án dùng pseudo-date tăng dần (đã tới `20260626`, VƯỢT ngày thật) — migration mới phải đặt tên sort SAU file mới nhất, KHÔNG theo ngày thật.
- Smoke-test qua Management API + `set_config('request.jwt.claims', '{"sub":"<admin-id>",...}')` để giả lập admin (RPC check `fn_has_role`). Số liệu khớp 100% SQL trực tiếp.

## 2026-06-12 — Khách hàng: sort công nợ + cột Tuổi nợ + Tần suất mua/tháng
- **Có migration `20260701000000_customer_list_sort_metrics.sql` (ĐÃ apply remote qua Management API + ghi history + verify dữ liệu). `tsc --noEmit` PASS.**
- View `customer_summary_view` recreate (giữ `security_invoker`) thêm 2 cột: `debt_age_days` (ngày từ khoản nợ chưa thanh toán cũ nhất, `amount > 0`, NULL nếu không nợ) + `orders_per_month` (số đơn 90 ngày ÷ 3, loại đơn hủy — định nghĩa user đã duyệt). Thêm partial index `idx_customer_debts_customer_unsettled` (bảng này trước đó KHÔNG có index theo customer_id).
- `useCustomersList` nhận `sortKey`/`sortDir` (`total_debt | debt_age_days | orders_per_month`) → `.order(key, { nullsFirst: false })` + created_at phụ. `CustomerListPage`: 3 cột sortable (key cột = tên cột DB), cột Tuổi nợ màu ≤10 xám / 11–20 vàng / **>20 đỏ**, sort reset trang 1 + reset trong Bỏ lọc; export CSV thêm 2 cột + áp sort + **vá CSV formula injection** (prefix `'` cho ô bắt đầu `=+-@`, bỏ qua số hợp lệ như nợ âm).
- **Lưu ý migration history remote:** các file `20260610(thứ 2)→20260627` đã chạy trên DB nhưng KHÔNG có trong `supabase_migrations.schema_migrations` (chỉ 20260628/29/30 được ghi) → `supabase db push` đòi `--include-all` (NGUY HIỂM, sẽ chạy lại file cũ). **Quy ước: apply migration lẻ qua Management API `POST /v1/projects/gdotgcrtivjdpkcchrro/database/query` rồi INSERT version vào `supabase_migrations.schema_migrations`.** Trùng version cần tránh: đã có 2 file `20260610000000*` và lúc đầu suýt trùng `20260630000000_product_movements_rpc.sql`.
- **Audit phân quyền (ghi nhận, không đổi hành vi):** RLS `customers` SELECT mở cho mọi user, nhưng `customer_debts`/`orders` lọc theo owner/team → role sales thấy nợ 0 / tuổi nợ `—` / tần suất 0 với KH người khác (an toàn, không rò rỉ, nhưng "0 đ" có thể gây hiểu lầm). Export CSV xuất SĐT đầy đủ (bỏ qua maskData) — chấp nhận, cân nhắc permission riêng sau.

## 2026-06-14 — Kho: nén & gọn hóa 5 modal (chi tiết + tạo phiếu), 1 màn hình — thuần UI
- **Frontend-only, KHÔNG migration. `tsc -b` + `vite build` PASS.** Chỉ `src/pages/inventory/InventoryPage.tsx`. Cần user commit + deploy.
- User báo modal "Chi tiết chuyển kho" (và các modal kho) bố trí dư thừa: khối thông tin chiếm quá nhiều chiều cao → phải cuộn mới thấy bảng sản phẩm; chữ to, dòng thưa, dễ đè.
- **Gốc rễ:** class `text-body-md/body-lg/tiny/mono` **không được định nghĩa** (no-op → render ~16px). Xem [[ui-undefined-font-tokens]]. Đã fix bằng class cỡ thật kế thừa `DataTable.tsx`.
- **Đã làm (phạm vi user duyệt = 3 modal chi tiết + 2 modal tạo phiếu):** khung `max-w-5xl→6xl` + `max-h-85/90vh→92vh`; thân `p-6 space-y-6→p-4 sm:p-5 space-y-4`; khối metadata `grid-cols-2 gap-y-4→grid-cols-2 sm:3 xl:4 gap-x-5 gap-y-2.5 p-3` (nhãn `text-[11px]`, giá trị `text-[13px]`, ghi chú `col-span-full`); bảng SP header `text-[11px]` + ô `text-[13px]` + padding `px-4 py-3 / px-4 py-2.5 → px-3 py-2.5`; SKU/badge/mã phiếu/tiêu đề/label form thu nhỏ tương ứng.
- KHÔNG đụng handler/điều kiện hiển thị theo `status`/RLS/query.

## 2026-06-14 (tiếp) — TRỊ TẬN GỐC type scale toàn app trong tailwind.config.js
- **Frontend-only, KHÔNG migration. `tsc -b` + `vite build` PASS** (verify token đã vào CSS build). Chỉ `tailwind.config.js`. Cần user commit + deploy.
- User duyệt fix tận gốc. Khảo sát: class chữ tuỳ biến dùng **~2.760 lần** nhưng KHÔNG định nghĩa → Tailwind v3 bỏ qua → mọi chữ ~16px mặc định. Xem [[ui-undefined-font-tokens]].
- **Thêm `theme.extend.fontSize`** (MERGE, `text-sm/base/lg` chuẩn vẫn chạy): `tiny` 11/15 · `body-sm` 12/16 · `label-md` 13/18 · **`body-md` 14/20** · `body-lg` 16/24 · `headline-sm` 18/26 · `headline-md` 20/28 · `headline-lg` 24/30 · `display-xs` 28/34 · `display-sm` 32/38. Calib theo px thật (241× `text-[11px]`, 35× `text-[13px]`).
- Tác động lớn nhất: `body-md` 16→14 (1251 chỗ) và `tiny` 16→11 (979 chỗ) → app gọn lại đúng thiết kế. `body-lg` giữ 16.
- ⚠️ Màu tuỳ biến `gray-755/850/550`, `red-650/750` vẫn no-op (chữ inherit màu) — task nhỏ riêng nếu cần.

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
