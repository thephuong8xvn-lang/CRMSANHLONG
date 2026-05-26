-- ============================================================
-- CRM SANHLONGVETCO – MIGRATION: ASSIGN SUPER ADMIN ROLES
-- File: 20260526000004_assign_super_admin_roles.sql
-- Description:
--   Assign the 'admin' role to admin@sanhlongvetco.vn and zendviet@gmail.com.
-- ============================================================

DO $$
DECLARE
  v_admin_role_id UUID;
  v_user_id UUID;
  v_sales_role_id UUID;
BEGIN
  -- Get admin role ID
  SELECT id INTO v_admin_role_id FROM public.roles WHERE code = 'admin';
  -- Get sales role ID
  SELECT id INTO v_sales_role_id FROM public.roles WHERE code = 'sales';

  IF v_admin_role_id IS NOT NULL THEN
    -- 1. Assign to admin@sanhlongvetco.vn
    SELECT id INTO v_user_id FROM public.profiles WHERE email = 'admin@sanhlongvetco.vn';
    IF v_user_id IS NOT NULL THEN
      -- Remove sales role (if any)
      DELETE FROM public.user_roles WHERE user_id = v_user_id AND role_id = v_sales_role_id;

      -- Insert admin role
      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (v_user_id, v_admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;

    -- 2. Assign to zendviet@gmail.com
    SELECT id INTO v_user_id FROM public.profiles WHERE email = 'zendviet@gmail.com';
    IF v_user_id IS NOT NULL THEN
      -- Insert admin role
      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (v_user_id, v_admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;
  END IF;
END $$;
