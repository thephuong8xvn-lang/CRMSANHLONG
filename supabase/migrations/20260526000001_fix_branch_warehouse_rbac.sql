-- ============================================================
-- CRM SANHLONGVETCO – MIGRATION: PATCH BRANCH/WAREHOUSE/ROLE RBAC & AUTO-PROMOTION
-- File: 20260526000001_fix_branch_warehouse_rbac.sql
-- Description:
--   1. Patch RLS policies on warehouses, teams, profiles, and user_roles
--      to allow branch_managers to manage their own branch's assets and staff.
--   2. Update fn_handle_new_user() trigger to auto-assign 'admin' role to zendviet@gmail.com.
--   3. Promote zendviet@gmail.com if they already registered.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. PATCH WAREHOUSES & TEAMS RLS (Branch Manager Constraints)
-- ─────────────────────────────────────────────────────────────

-- warehouses: allow branch_managers to manage only their own branch warehouses
DROP POLICY IF EXISTS "warehouses_manage_admin" ON public.warehouses;
CREATE POLICY "warehouses_manage_admin" ON public.warehouses
  FOR ALL USING (
    (public.fn_is_admin() OR (public.fn_has_role('branch_manager') AND branch_id = public.fn_my_branch_id()))
    AND public.fn_is_active()
  );

-- teams: allow branch_managers to manage only their own branch teams
DROP POLICY IF EXISTS "teams_manage_admin" ON public.teams;
CREATE POLICY "teams_manage_admin" ON public.teams
  FOR ALL USING (
    (public.fn_is_admin() OR (public.fn_has_role('branch_manager') AND branch_id = public.fn_my_branch_id()))
    AND public.fn_is_active()
  );

-- ─────────────────────────────────────────────────────────────
-- 2. PATCH PROFILES RLS (Branch Employee Management)
-- ─────────────────────────────────────────────────────────────

-- profiles insert: allow branch_managers to register staff for their branch
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
CREATE POLICY "profiles_insert_manager" ON public.profiles
  FOR INSERT WITH CHECK (
    (public.fn_is_admin() OR (public.fn_has_role('branch_manager') AND branch_id = public.fn_my_branch_id()))
    AND public.fn_is_active()
  );

-- profiles update: allow branch_managers to edit staff for their branch
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_manager" ON public.profiles
  FOR UPDATE USING (
    (public.fn_is_admin() OR (public.fn_has_role('branch_manager') AND branch_id = public.fn_my_branch_id()))
    AND public.fn_is_active()
  );

-- profiles delete: allow branch_managers to delete/deactivate staff for their branch
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_manager" ON public.profiles
  FOR DELETE USING (
    (public.fn_is_admin() OR (public.fn_has_role('branch_manager') AND branch_id = public.fn_my_branch_id()))
    AND public.fn_is_active()
  );

-- ─────────────────────────────────────────────────────────────
-- 3. PATCH USER_ROLES RLS (Branch Employee Role Management)
-- ─────────────────────────────────────────────────────────────

-- user_roles select: allow branch_managers to view roles of users in their branch
DROP POLICY IF EXISTS "user_roles_select_admin" ON public.user_roles;
CREATE POLICY "user_roles_select_manager" ON public.user_roles
  FOR SELECT USING (
    public.fn_is_admin()
    OR user_id = auth.uid()
    OR (
      public.fn_has_role('branch_manager')
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = user_roles.user_id
          AND p.branch_id = public.fn_my_branch_id()
      )
    )
  );

-- user_roles manage: allow branch_managers to assign/strip roles for users in their branch
DROP POLICY IF EXISTS "user_roles_manage_admin" ON public.user_roles;
CREATE POLICY "user_roles_manage_manager" ON public.user_roles
  FOR ALL USING (
    (
      public.fn_is_admin()
      OR (
        public.fn_has_role('branch_manager')
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = user_roles.user_id
            AND p.branch_id = public.fn_my_branch_id()
        )
      )
    )
    AND public.fn_is_active()
  );

-- ─────────────────────────────────────────────────────────────
-- 4. UPDATE fn_handle_new_user() TRIGGER FUNCTION
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider  TEXT;
  v_full_name TEXT;
  v_avatar    TEXT;
  v_default_role_id UUID;
  v_role_code TEXT;
BEGIN
  -- Xác định provider từ metadata
  v_provider := COALESCE(
    NEW.raw_app_meta_data->>'provider',
    'email'
  );

  -- Lấy tên hiển thị (Google trả về qua raw_user_meta_data)
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  v_avatar := NEW.raw_user_meta_data->>'avatar_url';

  -- Tạo profile nếu chưa tồn tại (ON CONFLICT DO NOTHING chống trùng)
  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, auth_providers, is_active
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_avatar,
    ARRAY[v_provider],
    true
  )
  ON CONFLICT (id) DO NOTHING;

  -- Nếu profile đã tồn tại → cập nhật auth_providers nếu provider mới
  UPDATE public.profiles
  SET
    auth_providers = array_append(auth_providers, v_provider),
    updated_at     = now()
  WHERE id = NEW.id
    AND NOT (v_provider = ANY(auth_providers));

  -- Xác định role code: zendviet@gmail.com hoặc admin@sanhlongvetco.vn là admin, còn lại là sales
  IF NEW.email = 'zendviet@gmail.com' OR NEW.email = 'admin@sanhlongvetco.vn' THEN
    v_role_code := 'admin';
  ELSE
    v_role_code := 'sales';
  END IF;

  -- Gán role tương ứng
  SELECT id INTO v_default_role_id
  FROM public.roles
  WHERE code = v_role_code
  LIMIT 1;

  IF v_default_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, v_default_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. UPGRADE EXISTING USER zendviet@gmail.com TO ADMIN
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id   UUID;
  v_admin_role_id UUID;
  v_sales_role_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE email = 'zendviet@gmail.com';

  IF v_user_id IS NOT NULL THEN
    SELECT id INTO v_admin_role_id FROM public.roles WHERE code = 'admin';
    SELECT id INTO v_sales_role_id FROM public.roles WHERE code = 'sales';

    -- Xóa role sales mặc định (nếu có)
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id AND role_id = v_sales_role_id;

    -- Gán role admin
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (v_user_id, v_admin_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;

    -- Kích hoạt tài khoản và thiết đặt chi nhánh mặc định (HCM)
    UPDATE public.profiles
    SET is_active = true,
        branch_id = '11111111-0000-0000-0000-000000000001'
    WHERE id = v_user_id;
  END IF;
END;
$$;
