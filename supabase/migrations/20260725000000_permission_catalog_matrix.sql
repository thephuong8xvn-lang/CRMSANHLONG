-- ============================================================
-- 20260725000000_permission_catalog_matrix.sql
-- PHÂN QUYỀN CHI TIẾT THEO MODULE × CHỨC NĂNG (Xem/Thêm/Sửa/Xóa…)
--
-- Mục tiêu (Phase 1 — đã duyệt: tăng dần, pilot 1 module, gán qua role):
--   1. SEED CATALOG đầy đủ vào public.permissions (idempotent UPSERT) — khớp
--      src/lib/permissionCatalog.ts. Thêm chức năng mới = thêm dòng ở 2 nơi.
--   2. SEED baseline role_permissions (ON CONFLICT DO NOTHING) — phản ánh ý
--      định từng role, KHÔNG gỡ quyền cũ. admin/ceo KHÔNG seed (luôn super qua
--      fn_is_admin / hasPermission bypass).
--   3. RPC fn_set_role_permissions(role, codes[]) — admin-only, nguyên tử, cho
--      ma trận UI ghi role_permissions.
--   4. PILOT enforcement permission-based: fn_collect_customer_debt đổi guard
--      sang fn_is_admin() OR fn_has_permission('customers.collect_debt').
--      Seed customers.collect_debt/adjust_debt cho accountant + branch_manager
--      ⇒ GIỮ NGUYÊN quyền hiện tại (admin/ceo/accountant/branch_manager).
--
-- An toàn: thuần idempotent. Không FORCE RLS mới. Không đụng admin/ceo.
-- ⚠️ Apply qua Supabase SQL Editor / Management API (cần token).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. CATALOG: UPSERT toàn bộ permission codes (module, action)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.permissions (code, module, action, description) VALUES
  -- customers
  ('customers.view_all',     'customers', 'view',         'Xem khách hàng'),
  ('customers.create',       'customers', 'create',       'Thêm khách hàng'),
  ('customers.edit',         'customers', 'edit',         'Sửa khách hàng'),
  ('customers.delete',       'customers', 'delete',       'Xóa khách hàng'),
  ('customers.collect_debt', 'customers', 'collect_debt', 'Thu công nợ khách hàng'),
  ('customers.adjust_debt',  'customers', 'adjust_debt',  'Điều chỉnh công nợ khách hàng'),
  ('customers.export',       'customers', 'export',        'Xuất file công nợ'),
  -- orders
  ('orders.view',            'orders', 'view',           'Xem đơn hàng'),
  ('orders.create',          'orders', 'create',         'Bán hàng / tạo đơn'),
  ('orders.edit',            'orders', 'edit',           'Sửa đơn hàng'),
  ('orders.delete',          'orders', 'delete',         'Hủy đơn hàng'),
  ('orders.record_payment',  'orders', 'record_payment', 'Ghi nhận thanh toán đơn'),
  ('orders.approve_return',  'orders', 'approve_return', 'Duyệt trả hàng'),
  -- pipeline
  ('pipeline.view',          'pipeline', 'view',     'Xem cơ hội'),
  ('pipeline.create',        'pipeline', 'create',   'Thêm cơ hội'),
  ('pipeline.edit',          'pipeline', 'edit',     'Sửa cơ hội'),
  ('pipeline.reassign',      'pipeline', 'reassign', 'Phân lại cơ hội'),
  -- promotions
  ('promotions.view',        'promotions', 'view',   'Xem khuyến mãi'),
  ('promotions.manage',      'promotions', 'manage', 'Quản lý khuyến mãi'),
  -- products
  ('products.view',          'products', 'view',   'Xem sản phẩm'),
  ('products.create',        'products', 'create', 'Thêm sản phẩm'),
  ('products.edit',          'products', 'edit',   'Sửa sản phẩm'),
  ('products.delete',        'products', 'delete', 'Xóa sản phẩm'),
  ('products.manage',        'products', 'manage', 'Quản lý danh mục/giá'),
  -- inventory
  ('inventory.view',         'inventory', 'view',     'Xem kho'),
  ('inventory.receive',      'inventory', 'receive',  'Nhập kho'),
  ('inventory.adjust',       'inventory', 'adjust',   'Điều chỉnh kho'),
  ('inventory.transfer',     'inventory', 'transfer', 'Chuyển kho'),
  -- purchase_orders / suppliers
  ('purchase_orders.view',     'purchase_orders', 'view',    'Xem đặt mua'),
  ('purchase_orders.create',   'purchase_orders', 'create',  'Tạo đặt mua'),
  ('purchase_orders.approve',  'purchase_orders', 'approve', 'Duyệt đặt mua'),
  ('suppliers.manage',         'suppliers', 'manage',         'Quản lý nhà cung cấp'),
  -- cashbook
  ('cashbook.view',            'cashbook', 'view',           'Xem sổ quỹ'),
  ('cashbook.create_inflow',   'cashbook', 'create_inflow',  'Lập phiếu thu'),
  ('cashbook.create_outflow',  'cashbook', 'create_outflow', 'Lập phiếu chi'),
  ('cashbook.approve',         'cashbook', 'approve',         'Duyệt phiếu quỹ'),
  ('cashbook.manage_fund',     'cashbook', 'manage_fund',     'Quản lý quỹ/tài khoản'),
  -- herd_projects
  ('herd_projects.view_all',       'herd_projects', 'view',           'Xem chăn nuôi/kế hoạch'),
  ('herd_projects.create',         'herd_projects', 'create',         'Tạo dự án chăn nuôi'),
  ('herd_projects.update',         'herd_projects', 'update',         'Sửa dự án chăn nuôi'),
  ('herd_projects.delete',         'herd_projects', 'delete',         'Xóa dự án chăn nuôi'),
  ('herd_projects.manage_members', 'herd_projects', 'manage_members', 'Quản lý thành viên dự án'),
  -- reports
  ('reports.sales',     'reports', 'sales',     'Báo cáo doanh số'),
  ('reports.cashflow',  'reports', 'cashflow',  'Báo cáo dòng tiền'),
  ('reports.inventory', 'reports', 'inventory', 'Báo cáo tồn kho/giá vốn'),
  ('reports.debt',      'reports', 'debt',      'Báo cáo công nợ'),
  ('reports.team_kpi',  'reports', 'team_kpi',  'Báo cáo KPI đội nhóm'),
  ('reports.strategic', 'reports', 'strategic', 'Báo cáo SP chiến lược'),
  -- system
  ('users.manage',      'system', 'users_manage', 'Quản lý nhân sự'),
  ('users.assign_role', 'system', 'assign_role',  'Gán vai trò'),
  ('roles.manage',      'system', 'roles_manage', 'Quản lý phân quyền (role × permission)'),
  ('settings.manage',   'system', 'settings',     'Cấu hình hệ thống'),
  ('audit.view',        'system', 'audit',        'Xem nhật ký audit')
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module, action = EXCLUDED.action,
      description = COALESCE(public.permissions.description, EXCLUDED.description);

-- ─────────────────────────────────────────────────────────────
-- 2. BASELINE role_permissions (idempotent — KHÔNG gỡ quyền cũ)
--    Mapping phản ánh ý định từng role (admin/ceo bỏ qua: luôn super).
-- ─────────────────────────────────────────────────────────────
WITH mapping(role_code, perm_code) AS (
  VALUES
    -- sales — Bán hàng & POS
    ('sales','customers.view_all'),('sales','customers.create'),('sales','customers.edit'),('sales','customers.export'),
    ('sales','orders.view'),('sales','orders.create'),('sales','orders.edit'),('sales','orders.record_payment'),
    ('sales','pipeline.view'),('sales','pipeline.create'),('sales','pipeline.edit'),
    ('sales','promotions.view'),('sales','products.view'),('sales','inventory.view'),
    -- team_lead — Trưởng nhóm kinh doanh
    ('team_lead','customers.view_all'),('team_lead','customers.create'),('team_lead','customers.edit'),('team_lead','customers.export'),
    ('team_lead','orders.view'),('team_lead','orders.create'),('team_lead','orders.edit'),('team_lead','orders.record_payment'),('team_lead','orders.approve_return'),
    ('team_lead','pipeline.view'),('team_lead','pipeline.create'),('team_lead','pipeline.edit'),('team_lead','pipeline.reassign'),
    ('team_lead','promotions.view'),('team_lead','products.view'),('team_lead','inventory.view'),
    ('team_lead','reports.sales'),('team_lead','reports.team_kpi'),
    -- warehouse_keeper — Kho hàng & Sản phẩm
    ('warehouse_keeper','products.view'),('warehouse_keeper','products.create'),('warehouse_keeper','products.edit'),('warehouse_keeper','products.manage'),
    ('warehouse_keeper','inventory.view'),('warehouse_keeper','inventory.receive'),('warehouse_keeper','inventory.adjust'),('warehouse_keeper','inventory.transfer'),
    ('warehouse_keeper','purchase_orders.view'),('warehouse_keeper','purchase_orders.create'),('warehouse_keeper','suppliers.manage'),
    ('warehouse_keeper','orders.view'),
    -- accountant — Sổ quỹ & Tài chính
    ('accountant','cashbook.view'),('accountant','cashbook.create_inflow'),('accountant','cashbook.create_outflow'),('accountant','cashbook.approve'),('accountant','cashbook.manage_fund'),
    ('accountant','customers.view_all'),('accountant','customers.export'),('accountant','customers.collect_debt'),('accountant','customers.adjust_debt'),
    ('accountant','orders.view'),('accountant','orders.record_payment'),
    ('accountant','reports.cashflow'),('accountant','reports.debt'),
    -- branch_manager — Quản trị chi nhánh (gần admin trong phạm vi chi nhánh)
    ('branch_manager','customers.view_all'),('branch_manager','customers.create'),('branch_manager','customers.edit'),('branch_manager','customers.delete'),('branch_manager','customers.export'),('branch_manager','customers.collect_debt'),('branch_manager','customers.adjust_debt'),
    ('branch_manager','orders.view'),('branch_manager','orders.create'),('branch_manager','orders.edit'),('branch_manager','orders.delete'),('branch_manager','orders.record_payment'),('branch_manager','orders.approve_return'),
    ('branch_manager','pipeline.view'),('branch_manager','pipeline.create'),('branch_manager','pipeline.edit'),('branch_manager','pipeline.reassign'),
    ('branch_manager','products.view'),('branch_manager','products.manage'),
    ('branch_manager','inventory.view'),('branch_manager','inventory.receive'),('branch_manager','inventory.adjust'),('branch_manager','inventory.transfer'),
    ('branch_manager','purchase_orders.view'),('branch_manager','purchase_orders.create'),('branch_manager','purchase_orders.approve'),('branch_manager','suppliers.manage'),
    ('branch_manager','cashbook.view'),('branch_manager','cashbook.create_inflow'),('branch_manager','cashbook.create_outflow'),('branch_manager','cashbook.approve'),('branch_manager','cashbook.manage_fund'),
    ('branch_manager','promotions.manage'),
    -- vet_consultant — Chăn nuôi & Kế hoạch thú y
    ('vet_consultant','herd_projects.view_all'),('vet_consultant','herd_projects.create'),('vet_consultant','herd_projects.update'),('vet_consultant','herd_projects.delete'),('vet_consultant','herd_projects.manage_members'),
    ('vet_consultant','customers.view_all'),('vet_consultant','products.view'),
    -- viewer — Báo cáo & Phân tích
    ('viewer','reports.sales'),('viewer','reports.cashflow'),('viewer','reports.inventory'),('viewer','reports.debt'),('viewer','reports.team_kpi'),('viewer','reports.strategic'),
    ('viewer','products.view'),('viewer','inventory.view'),('viewer','customers.view_all'),('viewer','cashbook.view')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM mapping m
JOIN public.roles r       ON r.code = m.role_code
JOIN public.permissions p ON p.code = m.perm_code
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: gán lại toàn bộ permission cho 1 role (ma trận UI)
--    Admin-only, nguyên tử (xóa hết + chèn lại theo codes[]).
--    Chặn sửa admin/ceo (luôn toàn quyền, tránh tự khóa).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_role_permissions(
  p_role_id UUID,
  p_codes   TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role_code TEXT;
  v_n         INTEGER;
BEGIN
  IF NOT (public.fn_is_active() AND public.fn_is_admin()) THEN
    RAISE EXCEPTION 'Chỉ quản trị viên được phép chỉnh sửa phân quyền.';
  END IF;

  SELECT code INTO v_role_code FROM public.roles WHERE id = p_role_id;
  IF v_role_code IS NULL THEN
    RAISE EXCEPTION 'Vai trò không tồn tại.';
  END IF;
  IF v_role_code IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Không thể chỉnh phân quyền vai trò % (luôn toàn quyền).', v_role_code;
  END IF;

  DELETE FROM public.role_permissions WHERE role_id = p_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT p_role_id, pm.id
  FROM public.permissions pm
  WHERE pm.code = ANY(COALESCE(p_codes, ARRAY[]::TEXT[]))
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('role_id', p_role_id, 'granted', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[]) TO authenticated;
COMMENT ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[]) IS
'Admin gán lại toàn bộ permission cho 1 role (ma trận phân quyền). Chặn admin/ceo.';

-- ─────────────────────────────────────────────────────────────
-- 4. PILOT enforcement: fn_collect_customer_debt theo PERMISSION
--    Chỉ đổi guard ở đầu hàm; phần còn lại GIỮ NGUYÊN logic 20260614.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_collect_customer_debt(
  p_customer_id UUID,
  p_amount      NUMERIC,
  p_method      order_payment_method,
  p_date        DATE,
  p_reference   TEXT,
  p_notes       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_payment_id UUID;
  v_remaining  NUMERIC(15,2);
  v_new_total  NUMERIC(15,2);
  v_exists     BOOLEAN;
  r            RECORD;
BEGIN
  -- 1. Phân quyền THEO PERMISSION (pilot). admin/ceo bypass qua fn_is_admin.
  IF NOT (public.fn_is_active()
          AND (public.fn_is_admin()
               OR public.fn_has_permission('customers.collect_debt'))) THEN
    RAISE EXCEPTION 'Không có quyền thu công nợ khách hàng.';
  END IF;

  -- 2. Validate
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Số tiền thu phải lớn hơn 0.';
  END IF;
  IF p_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RAISE EXCEPTION 'Hình thức thu không hợp lệ (chỉ tiền mặt / chuyển khoản / quẹt thẻ).';
  END IF;
  IF COALESCE(p_date, CURRENT_DATE) > CURRENT_DATE THEN
    RAISE EXCEPTION 'Ngày thu không được ở tương lai.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Khách hàng không tồn tại.';
  END IF;

  -- 3. Ghi tiền vào sổ quỹ qua debt_payments (trigger sinh phiếu thu THU-NO)
  INSERT INTO public.debt_payments (
    customer_id, amount, payment_method, payment_date, reference_no, notes, recorded_by
  ) VALUES (
    p_customer_id, p_amount, p_method, COALESCE(p_date, CURRENT_DATE),
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Thu công nợ khách hàng'),
    v_uid
  )
  RETURNING id INTO v_payment_id;

  -- 4. Phân bổ FIFO: settle các dòng nợ dương (cũ nhất / đến hạn trước → trước)
  v_remaining := p_amount;
  FOR r IN
    SELECT id, amount
    FROM public.customer_debts
    WHERE customer_id = p_customer_id
      AND is_settled = false
      AND amount > 0
    ORDER BY due_date NULLS LAST, created_at
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_remaining >= r.amount THEN
      UPDATE public.customer_debts SET is_settled = true, settled_at = now() WHERE id = r.id;
      v_remaining := v_remaining - r.amount;
    ELSE
      UPDATE public.customer_debts SET amount = amount - v_remaining WHERE id = r.id;
      v_remaining := 0;
    END IF;
  END LOOP;

  -- 5. Thu vượt công nợ → ghi nhận "Khách trả trước" (amount âm)
  IF v_remaining > 0 THEN
    INSERT INTO public.customer_debts (
      customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by
    ) VALUES (
      p_customer_id, NULL, 'advance_from_customer', -v_remaining, NULL, false,
      'Khách trả trước (thu vượt công nợ'
        || COALESCE(' — ' || NULLIF(TRIM(COALESCE(p_reference, '')), ''), '') || ')',
      v_uid
    );
  END IF;

  -- 6. Tổng nợ còn lại sau khi thu
  SELECT COALESCE(SUM(amount), 0)::NUMERIC(15,2) INTO v_new_total
  FROM public.customer_debts
  WHERE customer_id = p_customer_id AND is_settled = false;

  RETURN jsonb_build_object(
    'payment_id',    v_payment_id,
    'collected',     p_amount,
    'advance',       v_remaining,
    'new_total_debt', v_new_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_collect_customer_debt(UUID, NUMERIC, order_payment_method, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_collect_customer_debt(UUID, NUMERIC, order_payment_method, DATE, TEXT, TEXT) TO authenticated;
COMMENT ON FUNCTION public.fn_collect_customer_debt(UUID, NUMERIC, order_payment_method, DATE, TEXT, TEXT) IS
'Thu công nợ KH nguyên tử. Quyền: admin/ceo OR permission customers.collect_debt (pilot permission-based).';
