-- ============================================================
-- AUDIT-2026-05-30 — Sprint S2 (RLS bổ trợ cho UI thanh toán)
-- File: 20260601000004_payment_rls_branch_mgr.sql
-- Mục đích:
--   branch_manager có quyền cashbook.create nên thấy tab Thanh toán NCC /
--   Tạm ứng NV. Bổ sung RLS cho 2 bảng để không bị từ chối thầm lặng.
--   (debt_payments đã có branch_manager trong policy gốc.)
-- ⚠️ Chạy thủ công qua Supabase SQL Editor.
-- ============================================================

-- supplier_payments: cho phép branch_manager tạo
DROP POLICY IF EXISTS "supplier_pmts_manage_branch_mgr" ON public.supplier_payments;
CREATE POLICY "supplier_pmts_manage_branch_mgr" ON public.supplier_payments
  FOR ALL USING (
    public.fn_is_active() AND public.fn_has_role('branch_manager')
  )
  WITH CHECK (
    public.fn_is_active() AND public.fn_has_role('branch_manager')
  );

-- supplier_payment_allocations: tương tự (cho phân bổ PO/GR sau này)
DROP POLICY IF EXISTS "supplier_alloc_manage_branch_mgr" ON public.supplier_payment_allocations;
CREATE POLICY "supplier_alloc_manage_branch_mgr" ON public.supplier_payment_allocations
  FOR ALL USING (
    public.fn_is_active() AND public.fn_has_role('branch_manager')
  )
  WITH CHECK (
    public.fn_is_active() AND public.fn_has_role('branch_manager')
  );

-- employee_advances: cho phép branch_manager tạo tạm ứng
DROP POLICY IF EXISTS "advances_manage_branch_mgr" ON public.employee_advances;
CREATE POLICY "advances_manage_branch_mgr" ON public.employee_advances
  FOR ALL USING (
    public.fn_is_active() AND public.fn_has_role('branch_manager')
  )
  WITH CHECK (
    public.fn_is_active() AND public.fn_has_role('branch_manager')
  );
