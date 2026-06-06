-- ============================================================
-- Migration: Đóng lỗ hổng cô lập chi nhánh khi ĐỌC phiếu nhập kho
-- File: 20260621000000_branch_scope_receipts_select.sql
-- ============================================================
-- Vấn đề (phát hiện 2026-06-06):
--   goods_receipts & goods_receipt_lines có policy "*_manage" kiểu
--   FOR ALL (admin OR warehouse_keeper, KHÔNG kiểm tra chi nhánh).
--   Vì FOR ALL bao gồm cả SELECT và policy permissive được OR với
--   nhau, một warehouse_keeper đọc được phiếu nhập của MỌI chi nhánh,
--   vô hiệu hóa policy SELECT vốn đã lọc theo chi nhánh
--   (receipts_select_warehouse / receipt_lines_select).
--
-- Cách sửa:
--   Tách "*_manage" (FOR ALL) thành các policy theo lệnh
--   INSERT/UPDATE/DELETE với ĐÚNG điều kiện role cũ (admin OR
--   warehouse_keeper) → hành vi GHI giữ nguyên 100%, nhưng KHÔNG
--   còn cấp quyền SELECT xuyên chi nhánh. Sau migration, quyền ĐỌC
--   chỉ do *_select_warehouse (đã lọc chi nhánh) + *_own_draft quyết
--   định.
--
--   stock_movements đã đúng (stock_mov_select_warehouse lọc chi
--   nhánh, không có FOR ALL leak) → không đụng tới.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. goods_receipts: bỏ FOR ALL, tách theo lệnh
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "receipts_manage_warehouse" ON public.goods_receipts;

CREATE POLICY "receipts_insert_warehouse" ON public.goods_receipts
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "receipts_update_warehouse" ON public.goods_receipts
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "receipts_delete_warehouse" ON public.goods_receipts
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

-- ─────────────────────────────────────────────────────────────
-- 2. goods_receipt_lines: bỏ FOR ALL, tách theo lệnh
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "receipt_lines_manage" ON public.goods_receipt_lines;

CREATE POLICY "receipt_lines_insert" ON public.goods_receipt_lines
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "receipt_lines_update" ON public.goods_receipt_lines
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "receipt_lines_delete" ON public.goods_receipt_lines
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

NOTIFY pgrst, 'reload schema';
