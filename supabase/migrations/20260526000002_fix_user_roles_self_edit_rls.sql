-- ============================================================
-- CRM SANHLONGVETCO – MIGRATION: PATCH USER_ROLES SELF-EDIT RLS
-- File: 20260526000002_fix_user_roles_self_edit_rls.sql
-- Description:
--   Allow super admins (zendviet@gmail.com and admin@sanhlongvetco.vn)
--   to bypass RLS checks on user_roles based on their profile email.
--   This prevents the "new row violates row-level security policy" error
--   when an admin updates their own roles (since deleting the role first
--   strips them of admin privileges mid-request).
-- ============================================================

-- user_roles select: update select policy
DROP POLICY IF EXISTS "user_roles_select_manager" ON public.user_roles;
CREATE POLICY "user_roles_select_manager" ON public.user_roles
  FOR SELECT USING (
    public.fn_is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND email IN ('zendviet@gmail.com', 'admin@sanhlongvetco.vn')
    )
    OR (
      public.fn_has_role('branch_manager')
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = user_roles.user_id
          AND p.branch_id = public.fn_my_branch_id()
      )
    )
  );

-- user_roles manage: update insert/update/delete policy
DROP POLICY IF EXISTS "user_roles_manage_manager" ON public.user_roles;
CREATE POLICY "user_roles_manage_manager" ON public.user_roles
  FOR ALL USING (
    (
      public.fn_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND email IN ('zendviet@gmail.com', 'admin@sanhlongvetco.vn')
      )
      OR (
        public.fn_has_role('branch_manager')
        AND user_roles.user_id <> auth.uid() -- Prevent branch managers from editing their own roles
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = user_roles.user_id
            AND p.branch_id = public.fn_my_branch_id()
        )
      )
    )
    AND public.fn_is_active()
  );
