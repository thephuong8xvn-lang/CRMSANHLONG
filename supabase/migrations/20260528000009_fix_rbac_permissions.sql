-- ============================================================
-- Migration: Fix RBAC & RLS Permissions for Normal Roles
-- File: 20260528000009_fix_rbac_permissions.sql
-- Description:
--   1. Seeding missing role-permission mappings for branch_manager,
--      warehouse_keeper, accountant, team_lead, vet_consultant, sales.
--   2. Fixing customer_debts INSERT policy to allow POS credit transactions.
--   3. Fixing orders INSERT policy to allow branch_manager.
--   4. Splitting order_lines_manage_draft policy into INSERT, UPDATE,
--      DELETE to support inserting lines on confirmed orders at checkout.
--   5. Adding cashbook_transactions UPDATE policy for branch_manager approval.
--   6. Fixing herd_projects INSERT and UPDATE policies for branch_manager/vet_consultant.
--   7. Fixing herd_project_steps and herd_project_outcomes RLS.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. SEED MISSING ROLE-PERMISSION MAPPINGS
-- ─────────────────────────────────────────────────────────────

-- 1.1 branch_manager (Quản trị chi nhánh)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'branch_manager'),
  p.id
FROM public.permissions p
WHERE p.code IN (
  'orders.create',
  'orders.record_payment',
  'products.manage',
  'pricing.manage',
  'promotions.manage',
  'users.manage',
  'users.assign_role',
  'audit.view',
  'customers.create',
  'customers.delete',
  'orders.approve_return',
  'quotes.create',
  'opportunities.create',
  'opportunities.reassign',
  'inventory.receive',
  'inventory.adjust',
  'purchase_orders.create',
  'purchase_orders.approve',
  'cashbook.create',
  'cashbook.approve',
  'cashbook.manage_fund',
  'herd_projects.create',
  'herd_projects.view_all'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 1.2 warehouse_keeper (Kho hàng & Sản phẩm)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'warehouse_keeper'),
  p.id
FROM public.permissions p
WHERE p.code IN (
  'products.manage',
  'pricing.manage',
  'purchase_orders.approve'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 1.3 accountant (Sổ quỹ & Tài chính)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'accountant'),
  p.id
FROM public.permissions p
WHERE p.code IN (
  'pricing.manage',
  'promotions.manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 1.4 team_lead (Trưởng nhóm Sales)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'team_lead'),
  p.id
FROM public.permissions p
WHERE p.code IN (
  'promotions.manage',
  'pricing.manage',
  'herd_projects.view_all'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 1.5 vet_consultant (Bác sĩ thú y / Tư vấn)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'vet_consultant'),
  p.id
FROM public.permissions p
WHERE p.code IN (
  'herd_projects.create',
  'customers.create',
  'customers.view_all'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 1.6 sales (Bán hàng & POS)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'sales'),
  p.id
FROM public.permissions p
WHERE p.code IN (
  'customers.view_all',
  'herd_projects.view_all'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 2. PATCH customer_debts RLS FOR INSERT
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "debts_insert_sales" ON public.customer_debts;

CREATE POLICY "debts_insert_sales" ON public.customer_debts
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR public.fn_has_role('branch_manager')
      OR public.fn_has_role('team_lead')
      OR public.fn_has_role('sales')
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 3. PATCH orders INSERT POLICY (ADD branch_manager)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "orders_insert_active" ON public.orders;

CREATE POLICY "orders_insert_active" ON public.orders
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('orders.create')
    AND (
      owner_user_id = auth.uid() 
      OR public.fn_is_admin() 
      OR public.fn_has_role('team_lead') 
      OR public.fn_has_role('branch_manager')
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 4. PATCH order_lines RLS (SPLIT FOR POS CONFIRMED ORDERS)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "order_lines_manage_draft" ON public.order_lines;
DROP POLICY IF EXISTS "order_lines_insert" ON public.order_lines;
DROP POLICY IF EXISTS "order_lines_update" ON public.order_lines;
DROP POLICY IF EXISTS "order_lines_delete" ON public.order_lines;

-- INSERT: Cho phép thêm dòng nếu user là chủ đơn, admin, lead, manager hoặc có quyền tạo đơn
CREATE POLICY "order_lines_insert" ON public.order_lines
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_lines.order_id
        AND (
          o.owner_user_id = auth.uid()
          OR public.fn_is_admin()
          OR public.fn_has_role('team_lead')
          OR public.fn_has_role('branch_manager')
          OR public.fn_has_permission('orders.create')
        )
    )
  );

-- UPDATE: Chỉ khi đơn hàng đang nháp (draft)
CREATE POLICY "order_lines_update" ON public.order_lines
  FOR UPDATE USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_lines.order_id
        AND o.status = 'draft'
        AND (
          o.owner_user_id = auth.uid()
          OR public.fn_is_admin()
          OR public.fn_has_role('team_lead')
          OR public.fn_has_role('branch_manager')
        )
    )
  );

-- DELETE: Chỉ khi đơn hàng đang nháp (draft)
CREATE POLICY "order_lines_delete" ON public.order_lines
  FOR DELETE USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_lines.order_id
        AND o.status = 'draft'
        AND (
          o.owner_user_id = auth.uid()
          OR public.fn_is_admin()
          OR public.fn_has_role('team_lead')
          OR public.fn_has_role('branch_manager')
        )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 5. PATCH cashbook_transactions UPDATE POLICY FOR branch_manager
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cashbook_update_branch_mgr" ON public.cashbook_transactions;

CREATE POLICY "cashbook_update_branch_mgr" ON public.cashbook_transactions
  FOR UPDATE USING (
    public.fn_is_active()
    AND public.fn_has_role('branch_manager')
    AND (
      -- Quỹ tiền mặt thuộc chi nhánh của quản lý
      EXISTS (
        SELECT 1 FROM public.cash_funds cf
        WHERE cf.id = cashbook_transactions.cash_fund_id
          AND cf.branch_id = public.fn_my_branch_id()
      )
      -- Hoặc tài khoản ngân hàng thuộc chi nhánh của quản lý
      OR EXISTS (
        SELECT 1 FROM public.bank_accounts ba
        WHERE ba.id = cashbook_transactions.bank_account_id
          AND ba.branch_id = public.fn_my_branch_id()
      )
      -- Hoặc được tạo bởi nhân viên thuộc chi nhánh của quản lý
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = cashbook_transactions.created_by
          AND p.branch_id = public.fn_my_branch_id()
      )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 6. PATCH herd_projects INSERT & UPDATE RLS
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "herd_proj_insert_active" ON public.herd_projects;
DROP POLICY IF EXISTS "herd_proj_update_owner" ON public.herd_projects;

CREATE POLICY "herd_proj_insert_active" ON public.herd_projects
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('herd_projects.create')
    AND (
      owner_user_id = auth.uid()
      OR public.fn_is_admin()
      OR public.fn_has_role('team_lead')
      OR public.fn_has_role('branch_manager')
      OR public.fn_has_role('vet_consultant')
    )
  );

CREATE POLICY "herd_proj_update_owner" ON public.herd_projects
  FOR UPDATE USING (
    public.fn_is_active()
    AND (
      owner_user_id = auth.uid()
      OR (public.fn_has_role('team_lead') AND team_id = public.fn_my_team_id())
      OR public.fn_is_admin()
      OR public.fn_has_role('vet_consultant')
      OR (public.fn_has_role('branch_manager') AND EXISTS(
        SELECT 1 FROM public.profiles p 
        WHERE p.id = herd_projects.owner_user_id 
          AND p.branch_id = public.fn_my_branch_id()
      ))
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 7. PATCH herd_project_steps RLS (ADD vet_consultant & branch_manager)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "herd_steps_select" ON public.herd_project_steps;
DROP POLICY IF EXISTS "herd_steps_manage" ON public.herd_project_steps;

CREATE POLICY "herd_steps_select" ON public.herd_project_steps
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_has_role('vet_consultant')
      OR EXISTS (
        SELECT 1 FROM public.herd_projects hp
        LEFT JOIN public.profiles p ON p.id = hp.owner_user_id
        WHERE hp.id = herd_project_steps.project_id
          AND (
            hp.owner_user_id = auth.uid()
            OR hp.team_id = public.fn_my_team_id()
            OR public.fn_is_admin()
            OR (public.fn_has_role('branch_manager') AND p.branch_id = public.fn_my_branch_id())
          )
      )
    )
  );

CREATE POLICY "herd_steps_manage" ON public.herd_project_steps
  FOR ALL USING (
    public.fn_is_active()
    AND (
      public.fn_has_role('vet_consultant')
      OR EXISTS (
        SELECT 1 FROM public.herd_projects hp
        LEFT JOIN public.profiles p ON p.id = hp.owner_user_id
        WHERE hp.id = herd_project_steps.project_id
          AND (
            hp.owner_user_id = auth.uid()
            OR (public.fn_has_role('team_lead') AND hp.team_id = public.fn_my_team_id())
            OR public.fn_is_admin()
            OR (public.fn_has_role('branch_manager') AND p.branch_id = public.fn_my_branch_id())
          )
      )
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 8. PATCH herd_project_outcomes RLS (ADD vet_consultant & branch_manager)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "herd_outcomes_select" ON public.herd_project_outcomes;
DROP POLICY IF EXISTS "herd_outcomes_manage" ON public.herd_project_outcomes;

CREATE POLICY "herd_outcomes_select" ON public.herd_project_outcomes
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_has_role('vet_consultant')
      OR EXISTS (
        SELECT 1 FROM public.herd_projects hp
        LEFT JOIN public.profiles p ON p.id = hp.owner_user_id
        WHERE hp.id = herd_project_outcomes.project_id
          AND (
            hp.owner_user_id = auth.uid()
            OR hp.team_id = public.fn_my_team_id()
            OR public.fn_is_admin()
            OR public.fn_has_role('accountant')
            OR (public.fn_has_role('branch_manager') AND p.branch_id = public.fn_my_branch_id())
          )
      )
    )
  );

CREATE POLICY "herd_outcomes_manage" ON public.herd_project_outcomes
  FOR ALL USING (
    public.fn_is_active()
    AND (
      public.fn_has_role('vet_consultant')
      OR EXISTS (
        SELECT 1 FROM public.herd_projects hp
        LEFT JOIN public.profiles p ON p.id = hp.owner_user_id
        WHERE hp.id = herd_project_outcomes.project_id
          AND (
            hp.owner_user_id = auth.uid()
            OR (public.fn_has_role('team_lead') AND hp.team_id = public.fn_my_team_id())
            OR public.fn_is_admin()
            OR (public.fn_has_role('branch_manager') AND p.branch_id = public.fn_my_branch_id())
          )
      )
    )
  );
