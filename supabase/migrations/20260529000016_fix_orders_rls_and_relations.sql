-- ============================================================
-- Migration: Fix Orders RLS policies and relations
-- File: 20260529000016_fix_orders_rls_and_relations.sql
-- Description:
--   1. Thêm khóa ngoại cho public.order_line_allocations.lot_id liên kết public.stock_lots(id)
--   2. Bổ sung quyền SELECT cho vai trò branch_manager trên các bảng chi tiết đơn hàng
-- ============================================================

-- 1. THÊM CONSTRAINT KHÓA NGOẠI CHO order_line_allocations
-- Nếu constraint chưa tồn tại, tiến hành thêm mới
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_order_line_allocations_lot' 
          AND table_name = 'order_line_allocations'
    ) THEN
        ALTER TABLE public.order_line_allocations
          ADD CONSTRAINT fk_order_line_allocations_lot
          FOREIGN KEY (lot_id) REFERENCES public.stock_lots(id) ON DELETE RESTRICT;
    END IF;
END
$$;


-- 2. BỔ SUNG QUYỀN SELECT TRÊN public.order_lines CHO branch_manager
DROP POLICY IF EXISTS "order_lines_select_branch_mgr" ON public.order_lines;
CREATE POLICY "order_lines_select_branch_mgr" ON public.order_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_has_role('branch_manager')
      AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_lines.order_id
          AND o.branch_id = public.fn_my_branch_id()
      )
    )
  );


-- 3. BỔ SUNG QUYỀN SELECT TRÊN public.order_payments CHO branch_manager
DROP POLICY IF EXISTS "order_payments_select_branch_mgr" ON public.order_payments;
CREATE POLICY "order_payments_select_branch_mgr" ON public.order_payments
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_has_role('branch_manager')
      AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_payments.order_id
          AND o.branch_id = public.fn_my_branch_id()
      )
    )
  );


-- 4. BỔ SUNG QUYỀN SELECT TRÊN public.order_line_allocations CHO branch_manager
DROP POLICY IF EXISTS "allocations_select_branch_mgr" ON public.order_line_allocations;
CREATE POLICY "allocations_select_branch_mgr" ON public.order_line_allocations
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_has_role('branch_manager')
      AND EXISTS (
        SELECT 1 FROM public.order_lines ol
        JOIN public.orders o ON o.id = ol.order_id
        WHERE ol.id = order_line_allocations.order_line_id
          AND o.branch_id = public.fn_my_branch_id()
      )
    )
  );
