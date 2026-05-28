-- ============================================================
-- CLEANUP: Xóa toàn bộ dữ liệu SEED DEMO (không phải dữ liệu thực)
-- File: 20260528000006_cleanup_seed_demo_data.sql
-- Mô tả:
--   Xóa tất cả dữ liệu được nạp từ seed.sql (nhận biết qua UUID
--   dạng xxxxxxxx-0000-0000-0000-xxxxxxxxxxxx).
--   Giữ lại: roles, permissions, role_permissions (cấu hình hệ thống).
--   Cascade tự động qua FK.
-- ⚠️  CẢNH BÁO: Script này xóa vĩnh viễn. Không thể hoàn tác.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. XÓA ĐƠN ĐẶT HÀNG NCC (purchase_orders) và chi tiết
--    liên quan tới supplier seed
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.goods_receipt_lines
WHERE receipt_id IN (
  SELECT id FROM public.goods_receipts
  WHERE supplier_id LIKE '99990001-0000-0000-0000-%'
);

DELETE FROM public.goods_receipts
WHERE supplier_id LIKE '99990001-0000-0000-0000-%';

DELETE FROM public.purchase_order_lines
WHERE po_id IN (
  SELECT id FROM public.purchase_orders
  WHERE supplier_id LIKE '99990001-0000-0000-0000-%'
);

DELETE FROM public.purchase_orders
WHERE supplier_id LIKE '99990001-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 2. XÓA SẢN PHẨM SEED và tất cả dữ liệu liên quan
-- ─────────────────────────────────────────────────────────────

-- Stock lots & movements liên quan tới sản phẩm seed
DELETE FROM public.stock_movements
WHERE product_id LIKE '77770001-0000-0000-0000-%';

DELETE FROM public.order_line_allocations
WHERE lot_id IN (
  SELECT id FROM public.stock_lots
  WHERE product_id LIKE '77770001-0000-0000-0000-%'
);

DELETE FROM public.stock_lots
WHERE product_id LIKE '77770001-0000-0000-0000-%';

-- Giá bảng giá của sản phẩm seed
DELETE FROM public.price_list_items
WHERE product_id LIKE '77770001-0000-0000-0000-%';

-- order_line_allocations: lot liên quan tới sản phẩm seed
DELETE FROM public.order_line_allocations
WHERE lot_id IN (
  SELECT id FROM public.stock_lots
  WHERE product_id LIKE '77770001-0000-0000-0000-%'
);

-- stock_lots liên quan tới sản phẩm seed
DELETE FROM public.stock_lots
WHERE product_id LIKE '77770001-0000-0000-0000-%';

-- Xóa sản phẩm seed
DELETE FROM public.products
WHERE id LIKE '77770001-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 3. XÓA BẢNG GIÁ SEED (không xóa bảng giá do user tạo)
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.price_list_items
WHERE price_list_id LIKE '88880001-0000-0000-0000-%';

DELETE FROM public.price_lists
WHERE id LIKE '88880001-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 4. XÓA NHÀ CUNG CẤP SEED
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.suppliers
WHERE id LIKE '99990001-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 5. XÓA KHO HÀNG SEED
-- ─────────────────────────────────────────────────────────────
-- Đảm bảo stock_lots trong kho seed đã xóa (cascade từ bước 2)
DELETE FROM public.stock_lots
WHERE warehouse_id LIKE '22222222-0000-0000-0000-%';

DELETE FROM public.stock_movements
WHERE warehouse_id LIKE '22222222-0000-0000-0000-%';

DELETE FROM public.stock_transfer_lines
WHERE transfer_id IN (
  SELECT id FROM public.stock_transfers
  WHERE from_warehouse_id LIKE '22222222-0000-0000-0000-%'
     OR to_warehouse_id LIKE '22222222-0000-0000-0000-%'
);

DELETE FROM public.stock_transfers
WHERE from_warehouse_id LIKE '22222222-0000-0000-0000-%'
   OR to_warehouse_id LIKE '22222222-0000-0000-0000-%';

DELETE FROM public.inventory_alerts
WHERE warehouse_id LIKE '22222222-0000-0000-0000-%';

DELETE FROM public.warehouses
WHERE id LIKE '22222222-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 6. XÓA NHÓM BÁN HÀNG (TEAMS) SEED
-- ─────────────────────────────────────────────────────────────
-- Cập nhật profiles gán về NULL nếu team_id là seed
UPDATE public.profiles
SET team_id = NULL
WHERE team_id LIKE '55555555-0000-0000-0000-%';

DELETE FROM public.teams
WHERE id LIKE '55555555-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 7. XÓA CHI NHÁNH SEED (giữ lại chi nhánh thực)
--    Trước tiên, nullify FK trên profiles và warehouses
-- ─────────────────────────────────────────────────────────────
UPDATE public.profiles
SET branch_id = NULL
WHERE branch_id LIKE '11111111-0000-0000-0000-%';

DELETE FROM public.cash_funds
WHERE id LIKE 'ffff0001-0000-0000-0000-%';

DELETE FROM public.bank_accounts
WHERE id LIKE 'ffff0002-0000-0000-0000-%';

DELETE FROM public.branches
WHERE id LIKE '11111111-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 8. XÓA DANH MỤC SẢN PHẨM & THƯƠNG HIỆU SEED
--    (chỉ xóa seed UUID, giữ lại do migration 20260525000007)
-- ─────────────────────────────────────────────────────────────
UPDATE public.products
SET category_id = NULL
WHERE category_id LIKE '66660001-0000-0000-0000-%';

UPDATE public.products
SET brand_id = NULL
WHERE brand_id LIKE '66660002-0000-0000-0000-%';

DELETE FROM public.product_categories
WHERE id LIKE '66660001-0000-0000-0000-%';

DELETE FROM public.brands
WHERE id LIKE '66660002-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 9. XÓA TỪ ĐIỂN BỆNH, LOÀI VẬT SEED (giữ nếu đang dùng)
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.disease_dictionary
WHERE id LIKE 'bbbb0001-0000-0000-0000-%';

DELETE FROM public.species
WHERE id LIKE 'aaaa0001-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 10. XÓA PIPELINE, STAGES, ACTIVITY TYPES, LOST REASONS SEED
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.pipeline_stages
WHERE pipeline_id LIKE 'cccc0001-0000-0000-0000-%';

DELETE FROM public.pipeline_definitions
WHERE id LIKE 'cccc0001-0000-0000-0000-%';

DELETE FROM public.activity_types
WHERE id LIKE 'dddd0001-0000-0000-0000-%';

-- lost_reasons không có ID cố định trong seed → không xóa (an toàn)

-- ─────────────────────────────────────────────────────────────
-- 11. XÓA LOẠI DỰ ÁN ĐÀN SEED
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.herd_project_type_default_steps
WHERE project_type_id LIKE 'eeee0001-0000-0000-0000-%';

DELETE FROM public.herd_project_types
WHERE id LIKE 'eeee0001-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- 12. XÓA DANH MỤC CHI PHÍ SEED
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.expense_categories
WHERE id LIKE 'e0e00001-0000-0000-0000-%';

-- ─────────────────────────────────────────────────────────────
-- KIỂM TRA KẾT QUẢ
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '✅ Cleanup seed demo data hoàn tất!';
  RAISE NOTICE '   Còn lại:';
  RAISE NOTICE '   - Branches:           %', (SELECT COUNT(*) FROM public.branches);
  RAISE NOTICE '   - Warehouses:         %', (SELECT COUNT(*) FROM public.warehouses);
  RAISE NOTICE '   - Products:           %', (SELECT COUNT(*) FROM public.products);
  RAISE NOTICE '   - Price Lists:        %', (SELECT COUNT(*) FROM public.price_lists);
  RAISE NOTICE '   - Suppliers:          %', (SELECT COUNT(*) FROM public.suppliers);
  RAISE NOTICE '   - Teams:              %', (SELECT COUNT(*) FROM public.teams);
  RAISE NOTICE '   - Product Categories: %', (SELECT COUNT(*) FROM public.product_categories);
  RAISE NOTICE '   - Brands:             %', (SELECT COUNT(*) FROM public.brands);
  RAISE NOTICE '   ⚙️  Giữ lại (cấu hình hệ thống):';
  RAISE NOTICE '   - Roles:              %', (SELECT COUNT(*) FROM public.roles);
  RAISE NOTICE '   - Permissions:        %', (SELECT COUNT(*) FROM public.permissions);
  RAISE NOTICE '   - Role-Permissions:   %', (SELECT COUNT(*) FROM public.role_permissions);
END
$$;

COMMIT;
