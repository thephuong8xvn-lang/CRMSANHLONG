-- ============================================================
-- Migration: Fix Customer RLS for All Roles
-- File: 20260529000015_fix_customer_rls_for_all_roles.sql
-- Mô tả: Vá các lỗ hổng RLS trên bảng khách hàng và bảng phụ thuộc:
--   1. customer_business_info: thêm branch_manager vào manage policy
--   2. customer_personal_info: thêm branch_manager vào manage policy
--   3. customer_contacts DELETE: thêm branch_manager
--   4. farms manage: thêm branch_manager
--   5. herds manage: thêm branch_manager
-- Nguyên nhân: user role branch_manager không thể sửa thông tin KH
--              trong chi nhánh mình dù đã có quyền sửa bảng customers chính
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. FIX: customer_business_info
--    Thêm branch_manager (cùng chi nhánh với KH)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cust_biz_manage_active" ON public.customer_business_info;

CREATE POLICY "cust_biz_manage_active" ON public.customer_business_info
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_business_info.customer_id
        AND (
          c.owner_user_id = auth.uid()
          OR c.team_id    = public.fn_my_team_id()
          OR (public.fn_has_role('branch_manager') AND c.branch_id = public.fn_my_branch_id())
          OR public.fn_is_admin()
        )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 2. FIX: customer_personal_info
--    Thêm branch_manager (cùng chi nhánh với KH)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cust_personal_manage" ON public.customer_personal_info;

CREATE POLICY "cust_personal_manage" ON public.customer_personal_info
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_personal_info.customer_id
        AND (
          c.owner_user_id = auth.uid()
          OR c.team_id    = public.fn_my_team_id()
          OR (public.fn_has_role('branch_manager') AND c.branch_id = public.fn_my_branch_id())
          OR public.fn_is_admin()
        )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 3. FIX: customer_contacts DELETE
--    Thêm branch_manager (chỉ xóa liên hệ của KH trong chi nhánh mình)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contacts_delete_admin_lead" ON public.customer_contacts;

CREATE POLICY "contacts_delete_admin_lead" ON public.customer_contacts
  FOR DELETE USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('team_lead')
      OR (
        public.fn_has_role('branch_manager')
        AND EXISTS (
          SELECT 1 FROM public.customers c
          WHERE c.id = customer_contacts.customer_id
            AND c.branch_id = public.fn_my_branch_id()
        )
      )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 4. FIX: farms manage (INSERT + UPDATE + DELETE)
--    Thêm branch_manager (cùng chi nhánh với KH)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "farms_manage_active" ON public.farms;

CREATE POLICY "farms_manage_active" ON public.farms
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = farms.customer_id
        AND (
          c.owner_user_id = auth.uid()
          OR (public.fn_has_role('team_lead')      AND c.team_id   = public.fn_my_team_id())
          OR (public.fn_has_role('branch_manager') AND c.branch_id = public.fn_my_branch_id())
          OR public.fn_is_admin()
        )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 5. FIX: herds manage (INSERT + UPDATE + DELETE)
--    Thêm branch_manager (kế thừa qua farm → customer)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "herds_manage_active" ON public.herds;

CREATE POLICY "herds_manage_active" ON public.herds
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      JOIN   public.customers c ON c.id = f.customer_id
      WHERE  f.id = herds.farm_id
        AND (
          c.owner_user_id = auth.uid()
          OR (public.fn_has_role('team_lead')      AND c.team_id   = public.fn_my_team_id())
          OR (public.fn_has_role('branch_manager') AND c.branch_id = public.fn_my_branch_id())
          OR public.fn_is_admin()
        )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 6. FIX: disease_history manage
--    Đồng bộ với herds — thêm branch_manager
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "disease_hist_manage_active" ON public.disease_history;

CREATE POLICY "disease_hist_manage_active" ON public.disease_history
  FOR ALL USING (
    public.fn_is_active()
    AND (
      recorded_by = auth.uid()
      OR public.fn_is_admin()
      OR public.fn_has_role('team_lead')
      OR (
        public.fn_has_role('branch_manager')
        AND EXISTS (
          SELECT 1 FROM public.herds h
          JOIN   public.farms f  ON f.id = h.farm_id
          JOIN   public.customers c ON c.id = f.customer_id
          WHERE  h.id = disease_history.herd_id
            AND  c.branch_id = public.fn_my_branch_id()
        )
      )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 7. GRANT: Đảm bảo sales role có permission customers.create
--    (đã có trong migration 009 nhưng thêm để chắc chắn)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT
  (SELECT id FROM public.roles WHERE code = 'sales'),
  p.id
FROM public.permissions p
WHERE p.code IN ('customers.create')
ON CONFLICT (role_id, permission_id) DO NOTHING;
