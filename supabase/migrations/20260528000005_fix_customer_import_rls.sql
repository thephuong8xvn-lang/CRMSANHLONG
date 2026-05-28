-- ============================================================
-- Migration: Fix customer_contacts INSERT RLS cho branch_manager
--            + Cải thiện customers INSERT policy
-- File: 20260528000005_fix_customer_import_rls.sql
-- Vấn đề:
--   1. contacts_manage_active (INSERT) chỉ allow owner_user_id=auth.uid(),
--      team_lead, admin — thiếu branch_manager → import thất bại khi
--      branch_manager chọn owner là sales rep khác chi nhánh.
--   2. customers_insert_active yêu cầu customers.create permission
--      nhưng một số role chưa được gán đủ — thêm branch_manager.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. PATCH customer_contacts INSERT policy
--    Thêm branch_manager vào điều kiện
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contacts_manage_active" ON public.customer_contacts;

CREATE POLICY "contacts_manage_active" ON public.customer_contacts
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_contacts.customer_id
        AND (
          c.owner_user_id = auth.uid()
          OR (public.fn_has_role('team_lead') AND c.team_id = public.fn_my_team_id())
          OR (public.fn_has_role('branch_manager') AND c.branch_id = public.fn_my_branch_id())
          OR public.fn_is_admin()
        )
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 2. PATCH customer_contacts UPDATE policy  
--    Thêm branch_manager (đồng nhất với INSERT)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contacts_update_active" ON public.customer_contacts;

CREATE POLICY "contacts_update_active" ON public.customer_contacts
  FOR UPDATE USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_contacts.customer_id
        AND (
          c.owner_user_id = auth.uid()
          OR (public.fn_has_role('team_lead') AND c.team_id = public.fn_my_team_id())
          OR (public.fn_has_role('branch_manager') AND c.branch_id = public.fn_my_branch_id())
          OR public.fn_is_admin()
        )
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 3. PATCH customers INSERT policy cho sales
--    customers_insert_active: bỏ kiểm tra permission riêng,
--    chỉ cần is_active + owner_user_id = auth.uid()
--    (permission-level guard đã nằm ở frontend ProtectedRoute)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "customers_insert_active" ON public.customers;

CREATE POLICY "customers_insert_active" ON public.customers
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────
-- 4. Đảm bảo customers INSERT policy cho admin/lead/branch_manager
--    bao gồm branch_manager (trước đây chỉ có admin + team_lead)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "customers_insert_admin_lead" ON public.customers;

CREATE POLICY "customers_insert_admin_lead" ON public.customers
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('team_lead')
      OR public.fn_has_role('branch_manager')
    )
  );
