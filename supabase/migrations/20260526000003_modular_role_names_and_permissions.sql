-- ============================================================
-- CRM SANHLONGVETCO – MIGRATION: MODULAR ROLE NAMES & PERMISSIONS
-- File: 20260526000003_modular_role_names_and_permissions.sql
-- Description:
--   1. Rename roles to represent modular permissions.
--   2. Strict modular reports permissions: remove reports permissions
--      from other roles (branch_manager, accountant, warehouse_keeper, team_lead)
--      and assign all reports permissions exclusively to 'viewer' (Báo cáo & Phân tích).
-- ============================================================

-- 1. Rename roles in public.roles to descriptive module names
UPDATE public.roles SET name = 'Quản trị hệ thống & Cấu hình' WHERE code = 'admin';
UPDATE public.roles SET name = 'Giám đốc / CEO (Xem toàn bộ)' WHERE code = 'ceo';
UPDATE public.roles SET name = 'Quản trị chi nhánh' WHERE code = 'branch_manager';
UPDATE public.roles SET name = 'Trưởng nhóm kinh doanh' WHERE code = 'team_lead';
UPDATE public.roles SET name = 'Bán hàng & POS' WHERE code = 'sales';
UPDATE public.roles SET name = 'Kho hàng & Sản phẩm' WHERE code = 'warehouse_keeper';
UPDATE public.roles SET name = 'Sổ quỹ & Tài chính' WHERE code = 'accountant';
UPDATE public.roles SET name = 'Chăn nuôi & Kế hoạch thú y' WHERE code = 'vet_consultant';
UPDATE public.roles SET name = 'Báo cáo & Phân tích' WHERE code = 'viewer';

-- 2. Clean up existing report permissions from non-report roles
-- List of reports permission codes to isolate
-- reports.sales, reports.cashflow, reports.inventory, reports.debt, reports.team_kpi, cashbook.view_reports
DELETE FROM public.role_permissions
WHERE role_id IN (
  SELECT id FROM public.roles 
  WHERE code IN ('branch_manager', 'team_lead', 'accountant', 'warehouse_keeper', 'sales', 'vet_consultant')
)
AND permission_id IN (
  SELECT id FROM public.permissions 
  WHERE code IN ('reports.sales', 'reports.cashflow', 'reports.inventory', 'reports.debt', 'reports.team_kpi', 'cashbook.view_reports')
);

-- 3. Assign all reports permissions exclusively to 'viewer' (Báo cáo & Phân tích)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM public.roles WHERE code = 'viewer'),
  id
FROM public.permissions
WHERE code IN (
  'reports.sales', 'reports.cashflow', 'reports.inventory', 'reports.debt', 'reports.team_kpi', 'cashbook.view_reports', 'products.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
