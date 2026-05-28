-- ============================================================
-- Migration: Fix RLS policy cho nhập kho (goods_receipts)
-- File: 20260528000007_fix_goods_receipt_rls.sql
-- Vấn đề:
--   1. receipts_manage_warehouse (FOR ALL USING) không có WITH CHECK
--      riêng → user có quyền inventory.receive nhưng không phải
--      admin/warehouse_keeper vẫn bị chặn INSERT.
--   2. stock_lots_manage_warehouse cần SECURITY DEFINER bypass cho
--      trigger fn_create_stock_lot_on_receipt.
--   3. Thêm branch_manager vào danh sách được nhập kho.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. PATCH goods_receipts RLS
--    Tách SELECT và INSERT/UPDATE/DELETE thành policy riêng
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "receipts_manage_warehouse" ON public.goods_receipts;

-- SELECT: admin, accountant, warehouse_keeper, branch_manager
-- (giữ nguyên policy select hiện tại, không đổi)

-- INSERT: admin, warehouse_keeper, branch_manager
CREATE POLICY "receipts_insert_warehouse" ON public.goods_receipts
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('warehouse_keeper')
      OR public.fn_has_role('branch_manager')
    )
  );

-- UPDATE/DELETE: admin, warehouse_keeper only
CREATE POLICY "receipts_update_delete_warehouse" ON public.goods_receipts
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "receipts_delete_admin" ON public.goods_receipts
  FOR DELETE USING (
    public.fn_is_active()
    AND public.fn_is_admin()
  );

-- ─────────────────────────────────────────────────────────────
-- 2. PATCH goods_receipt_lines RLS
--    Tương tự: tách INSERT thành policy riêng
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "receipt_lines_manage" ON public.goods_receipt_lines;

CREATE POLICY "receipt_lines_insert" ON public.goods_receipt_lines
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('warehouse_keeper')
      OR public.fn_has_role('branch_manager')
    )
  );

CREATE POLICY "receipt_lines_update_delete" ON public.goods_receipt_lines
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "receipt_lines_delete_admin" ON public.goods_receipt_lines
  FOR DELETE USING (
    public.fn_is_active()
    AND public.fn_is_admin()
  );

-- ─────────────────────────────────────────────────────────────
-- 3. PATCH stock_lots RLS
--    Trigger fn_create_stock_lot_on_receipt là SECURITY DEFINER
--    nên bypass RLS. Nhưng để an toàn, thêm branch_manager.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "stock_lots_manage_warehouse" ON public.stock_lots;

-- SELECT giữ nguyên (stock_lots_select_all)

-- INSERT: trigger SECURITY DEFINER bypass policy này
-- Nhưng nếu có direct insert từ UI thì cần policy
CREATE POLICY "stock_lots_insert_warehouse" ON public.stock_lots
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('warehouse_keeper')
      OR public.fn_has_role('branch_manager')
    )
  );

CREATE POLICY "stock_lots_update_warehouse" ON public.stock_lots
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "stock_lots_delete_admin" ON public.stock_lots
  FOR DELETE USING (
    public.fn_is_active()
    AND public.fn_is_admin()
  );

-- ─────────────────────────────────────────────────────────────
-- 4. PATCH purchase_orders SELECT policy
--    Cho phép warehouse_keeper xem PO để chọn khi nhập hàng
-- ─────────────────────────────────────────────────────────────
-- Kiểm tra policy hiện tại và thêm nếu chưa có
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_orders'
      AND policyname = 'po_select_warehouse'
  ) THEN
    EXECUTE '
      CREATE POLICY "po_select_warehouse" ON public.purchase_orders
        FOR SELECT USING (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR public.fn_has_role(''warehouse_keeper'')
            OR public.fn_has_role(''branch_manager'')
            OR public.fn_has_role(''accountant'')
            OR created_by = auth.uid()
          )
        )';
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. PATCH purchase_order_lines SELECT policy
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_order_lines'
      AND policyname = 'po_lines_select_warehouse'
  ) THEN
    EXECUTE '
      CREATE POLICY "po_lines_select_warehouse" ON public.purchase_order_lines
        FOR SELECT USING (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR public.fn_has_role(''warehouse_keeper'')
            OR public.fn_has_role(''branch_manager'')
            OR public.fn_has_role(''accountant'')
            OR EXISTS (
              SELECT 1 FROM public.purchase_orders po
              WHERE po.id = purchase_order_lines.po_id
                AND po.created_by = auth.uid()
            )
          )
        )';
  END IF;
END
$$;
