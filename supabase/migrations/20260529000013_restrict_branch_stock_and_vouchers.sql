-- Migration: Restrict stock_lots and voucher tables to user's branch
-- File: 20260529000013_restrict_branch_stock_and_vouchers.sql

-- 1. stock_lots SELECT policy
DROP POLICY IF EXISTS "stock_lots_select_all" ON public.stock_lots;
CREATE POLICY "stock_lots_select_all" ON public.stock_lots
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR EXISTS (
        SELECT 1 FROM public.warehouses w
        WHERE w.id = stock_lots.warehouse_id
          AND w.branch_id = public.fn_my_branch_id()
      )
    )
  );

-- 2. invoices SELECT policy
DROP POLICY IF EXISTS "invoices_select_all" ON public.invoices;
CREATE POLICY "invoices_select_all" ON public.invoices
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = invoices.order_id
          AND (
            (public.fn_has_role('branch_manager') AND o.branch_id = public.fn_my_branch_id())
            OR (public.fn_has_role('team_lead') AND o.team_id = public.fn_my_team_id())
            OR (public.fn_has_role('sales') AND o.owner_user_id = auth.uid())
          )
      )
    )
  );

-- 3. purchase_orders SELECT policy
DROP POLICY IF EXISTS "po_select_warehouse" ON public.purchase_orders;
CREATE POLICY "po_select_warehouse" ON public.purchase_orders
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR created_by = auth.uid()
      OR (
        (public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
        AND EXISTS (
          SELECT 1 FROM public.warehouses w
          WHERE w.id = purchase_orders.warehouse_id
            AND w.branch_id = public.fn_my_branch_id()
        )
      )
    )
  );

-- 4. purchase_order_lines SELECT policy
DROP POLICY IF EXISTS "po_lines_select" ON public.purchase_order_lines;
DROP POLICY IF EXISTS "po_lines_select_warehouse" ON public.purchase_order_lines;
CREATE POLICY "po_lines_select_warehouse" ON public.purchase_order_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR EXISTS (
        SELECT 1 FROM public.purchase_orders po
        JOIN public.warehouses w ON w.id = po.warehouse_id
        WHERE po.id = purchase_order_lines.po_id
          AND (
            po.created_by = auth.uid()
            OR (
              (public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
              AND w.branch_id = public.fn_my_branch_id()
            )
          )
      )
    )
  );

-- 5. goods_receipts SELECT policy
DROP POLICY IF EXISTS "receipts_select_warehouse" ON public.goods_receipts;
CREATE POLICY "receipts_select_warehouse" ON public.goods_receipts
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR (
        (public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
        AND EXISTS (
          SELECT 1 FROM public.warehouses w
          WHERE w.id = goods_receipts.warehouse_id
            AND w.branch_id = public.fn_my_branch_id()
        )
      )
    )
  );

-- 6. goods_receipt_lines SELECT policy
DROP POLICY IF EXISTS "receipt_lines_select" ON public.goods_receipt_lines;
CREATE POLICY "receipt_lines_select" ON public.goods_receipt_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR EXISTS (
        SELECT 1 FROM public.goods_receipts gr
        JOIN public.warehouses w ON w.id = gr.warehouse_id
        WHERE gr.id = goods_receipt_lines.receipt_id
          AND (
            (public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
            AND w.branch_id = public.fn_my_branch_id()
          )
      )
    )
  );

-- 7. stock_transfers SELECT policy
DROP POLICY IF EXISTS "stock_transfers_select" ON public.stock_transfers;
CREATE POLICY "stock_transfers_select" ON public.stock_transfers
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.warehouses w
        WHERE (w.id = stock_transfers.from_warehouse OR w.id = stock_transfers.to_warehouse)
          AND (
            (public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
            AND w.branch_id = public.fn_my_branch_id()
          )
      )
    )
  );

-- 8. stock_transfer_lines SELECT policy
DROP POLICY IF EXISTS "transfer_lines_select" ON public.stock_transfer_lines;
CREATE POLICY "transfer_lines_select" ON public.stock_transfer_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.stock_transfers st
        JOIN public.warehouses w ON (w.id = st.from_warehouse OR w.id = st.to_warehouse)
        WHERE st.id = stock_transfer_lines.transfer_id
          AND (
            (public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
            AND w.branch_id = public.fn_my_branch_id()
          )
      )
    )
  );

-- 9. sales_returns SELECT policy
DROP POLICY IF EXISTS "returns_select_active" ON public.sales_returns;
CREATE POLICY "returns_select_active" ON public.sales_returns
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = sales_returns.order_id
          AND (
            (public.fn_has_role('branch_manager') AND o.branch_id = public.fn_my_branch_id())
            OR (public.fn_has_role('team_lead') AND o.team_id = public.fn_my_team_id())
            OR (public.fn_has_role('sales') AND o.owner_user_id = auth.uid())
          )
      )
    )
  );

-- 10. sales_return_lines SELECT policy
DROP POLICY IF EXISTS "return_lines_select_active" ON public.sales_return_lines;
CREATE POLICY "return_lines_select_active" ON public.sales_return_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR EXISTS (
        SELECT 1 FROM public.sales_returns sr
        JOIN public.orders o ON o.id = sr.order_id
        WHERE sr.id = sales_return_lines.return_id
          AND (
            sr.created_by = auth.uid()
            OR (public.fn_has_role('branch_manager') AND o.branch_id = public.fn_my_branch_id())
            OR (public.fn_has_role('team_lead') AND o.team_id = public.fn_my_team_id())
            OR (public.fn_has_role('sales') AND o.owner_user_id = auth.uid())
          )
      )
    )
  );

-- 11. stock_movements SELECT policy
DROP POLICY IF EXISTS "stock_mov_select_warehouse" ON public.stock_movements;
CREATE POLICY "stock_mov_select_warehouse" ON public.stock_movements
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      (public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
      AND EXISTS (
        SELECT 1 FROM public.warehouses w
        WHERE w.id = stock_movements.warehouse_id
          AND w.branch_id = public.fn_my_branch_id()
      )
    )
  );
