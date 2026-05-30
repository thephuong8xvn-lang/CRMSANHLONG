-- AUDIT-2026-05-30 — Sprint S3.1
-- File: supabase/migrations/20260605000000_cashbook_rls_align_spec.sql
-- Mô tả:
--   1. Thêm permission mới: cashbook.create_inflow và cashbook.create_outflow
--   2. R1/R6: Giới hạn SELECT/UPDATE cashbook_transactions cho accountant & branch_manager theo chi nhánh
--   3. R2: Cho phép warehouse_keeper SELECT cashbook_transactions giới hạn theo session_id trong ca của họ
--   4. R3: Thắt chặt SELECT/INSERT/UPDATE cho cash_funds và bank_accounts theo chi nhánh
--   5. R4: Phân tách logic INSERT cashbook_transactions theo flow_type
--   6. R5: Ngăn chặn tự phê duyệt (self-approval) đối với accountant và branch manager
--   7. R6: Giới hạn SELECT cho supplier_payments, employee_advances, internal_transfers theo chi nhánh

-- ─────────────────────────────────────────────────────────────
-- 1. THÊM QUYỀN MỚI CHO SỔ QUỸ
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.permissions (id, code, module, action, description)
VALUES 
  (uuid_generate_v4(), 'cashbook.create_inflow', 'cashbook', 'create_inflow', 'Tạo phiếu thu dòng tiền (inflow)'),
  (uuid_generate_v4(), 'cashbook.create_outflow', 'cashbook', 'create_outflow', 'Tạo phiếu chi dòng tiền (outflow)')
ON CONFLICT (code) DO NOTHING;

-- Gán quyền cho admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'admin' AND p.code IN ('cashbook.create_inflow', 'cashbook.create_outflow')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Gán quyền cho accountant
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'accountant' AND p.code IN ('cashbook.create_inflow', 'cashbook.create_outflow')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Gán quyền cho branch_manager
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'branch_manager' AND p.code IN ('cashbook.create_inflow', 'cashbook.create_outflow')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. CÀI ĐẶT LẠI RLS CHO CASHBOOK_TRANSACTIONS
-- ─────────────────────────────────────────────────────────────

-- 2.1 SELECT policies
DROP POLICY IF EXISTS "cashbook_select_accountant" ON public.cashbook_transactions;
DROP POLICY IF EXISTS "cashbook_select_branch_mgr" ON public.cashbook_transactions;
DROP POLICY IF EXISTS "cashbook_select_warehouse_keeper_session" ON public.cashbook_transactions;

-- Admin/CEO: xem toàn bộ
CREATE POLICY "cashbook_select_admin" ON public.cashbook_transactions
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('ceo'))
    AND public.fn_is_active()
  );

-- Accountant/Branch Manager: xem theo chi nhánh
CREATE POLICY "cashbook_select_branch_staff" ON public.cashbook_transactions
  FOR SELECT USING (
    (public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
    AND (
      EXISTS (
        SELECT 1 FROM public.cash_funds cf
        WHERE cf.id = cashbook_transactions.cash_fund_id
          AND cf.branch_id = public.fn_my_branch_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.bank_accounts ba
        WHERE ba.id = cashbook_transactions.bank_account_id
          AND ba.branch_id = public.fn_my_branch_id()
      )
    )
  );

-- Warehouse Keeper: xem trong phiên ca của mình
CREATE POLICY "cashbook_select_warehouse_keeper_session" ON public.cashbook_transactions
  FOR SELECT USING (
    public.fn_has_role('warehouse_keeper')
    AND public.fn_is_active()
    AND session_id IN (
      SELECT id FROM public.cashier_sessions
      WHERE cashier_id = auth.uid()
    )
  );

-- 2.2 INSERT policies (phân tách inflow/outflow)
DROP POLICY IF EXISTS "cashbook_insert_accountant" ON public.cashbook_transactions;

CREATE POLICY "cashbook_insert_staff" ON public.cashbook_transactions
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND created_by = auth.uid()
    AND (
      public.fn_is_admin()
      OR (flow_type = 'inflow' AND (public.fn_has_permission('cashbook.create_inflow') OR public.fn_has_permission('cashbook.create')))
      OR (flow_type = 'outflow' AND (public.fn_has_permission('cashbook.create_outflow') OR public.fn_has_permission('cashbook.create')))
      OR (flow_type = 'internal_transfer') -- Tạo tự động qua trigger hoặc có quyền admin/kế toán
    )
  );

-- 2.3 UPDATE policies (chặn self-approval)
DROP POLICY IF EXISTS "cashbook_update_accountant" ON public.cashbook_transactions;
DROP POLICY IF EXISTS "cashbook_update_branch_mgr" ON public.cashbook_transactions;

CREATE POLICY "cashbook_update_admin" ON public.cashbook_transactions
  FOR UPDATE USING (
    public.fn_is_admin()
    AND public.fn_is_active()
  );

CREATE POLICY "cashbook_update_branch_staff" ON public.cashbook_transactions
  FOR UPDATE USING (
    (public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
    AND (
      EXISTS (
        SELECT 1 FROM public.cash_funds cf
        WHERE cf.id = cashbook_transactions.cash_fund_id
          AND cf.branch_id = public.fn_my_branch_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.bank_accounts ba
        WHERE ba.id = cashbook_transactions.bank_account_id
          AND ba.branch_id = public.fn_my_branch_id()
      )
    )
  )
  WITH CHECK (
    -- Block self-approval: nếu cập nhật status thành approved, người approve không được trùng người tạo
    (status = 'approved' AND created_by <> auth.uid())
    OR status <> 'approved'
  );

-- ─────────────────────────────────────────────────────────────
-- 3. CÀI ĐẶT LẠI RLS CHO CASH_FUNDS VÀ BANK_ACCOUNTS
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cash_funds_select_accountant" ON public.cash_funds;

CREATE POLICY "cash_funds_select_admin" ON public.cash_funds
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('ceo'))
    AND public.fn_is_active()
  );

CREATE POLICY "cash_funds_select_branch_staff" ON public.cash_funds
  FOR SELECT USING (
    (public.fn_has_role('accountant') OR public.fn_has_role('branch_manager') OR public.fn_has_role('warehouse_keeper'))
    AND public.fn_is_active()
    AND branch_id = public.fn_my_branch_id()
  );

DROP POLICY IF EXISTS "bank_accounts_select_accountant" ON public.bank_accounts;

CREATE POLICY "bank_accounts_select_admin" ON public.bank_accounts
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('ceo'))
    AND public.fn_is_active()
  );

CREATE POLICY "bank_accounts_select_branch_staff" ON public.bank_accounts
  FOR SELECT USING (
    (public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
    AND branch_id = public.fn_my_branch_id()
  );

-- ─────────────────────────────────────────────────────────────
-- 4. CÀI ĐẶT LẠI RLS CHO CÁC BẢNG PHỤ TRỢ (INTERNAL_TRANSFERS, SUPPLIER_PAYMENTS, EMPLOYEE_ADVANCES)
-- ─────────────────────────────────────────────────────────────

-- 4.1 Internal Transfers
DROP POLICY IF EXISTS "internal_transfers_select" ON public.internal_transfers;

CREATE POLICY "internal_transfers_select_admin" ON public.internal_transfers
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('ceo'))
    AND public.fn_is_active()
  );

CREATE POLICY "internal_transfers_select_branch_staff" ON public.internal_transfers
  FOR SELECT USING (
    (public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
    AND (
      EXISTS (
        SELECT 1 FROM public.cash_funds cf WHERE cf.id = internal_transfers.from_fund_id AND cf.branch_id = public.fn_my_branch_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.bank_accounts ba WHERE ba.id = internal_transfers.from_bank_id AND ba.branch_id = public.fn_my_branch_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.cash_funds cf WHERE cf.id = internal_transfers.to_fund_id AND cf.branch_id = public.fn_my_branch_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.bank_accounts ba WHERE ba.id = internal_transfers.to_bank_id AND ba.branch_id = public.fn_my_branch_id()
      )
    )
  );

-- 4.2 Supplier Payments
DROP POLICY IF EXISTS "supplier_pmts_select_accountant" ON public.supplier_payments;

CREATE POLICY "supplier_pmts_select_admin" ON public.supplier_payments
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('ceo'))
    AND public.fn_is_active()
  );

CREATE POLICY "supplier_pmts_select_branch_staff" ON public.supplier_payments
  FOR SELECT USING (
    (public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = supplier_payments.created_by
        AND p.branch_id = public.fn_my_branch_id()
    )
  );

-- 4.3 Supplier Payment Allocations
DROP POLICY IF EXISTS "supplier_alloc_select" ON public.supplier_payment_allocations;

CREATE POLICY "supplier_alloc_select_admin" ON public.supplier_payment_allocations
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('ceo'))
    AND public.fn_is_active()
  );

CREATE POLICY "supplier_alloc_select_branch_staff" ON public.supplier_payment_allocations
  FOR SELECT USING (
    (public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.supplier_payments sp
      JOIN public.profiles p ON p.id = sp.created_by
      WHERE sp.id = supplier_payment_allocations.payment_id
        AND p.branch_id = public.fn_my_branch_id()
    )
  );

-- 4.4 Employee Advances
DROP POLICY IF EXISTS "advances_select_self" ON public.employee_advances;

CREATE POLICY "advances_select_self" ON public.employee_advances
  FOR SELECT USING (
    public.fn_is_active()
    AND employee_id = auth.uid()
  );

CREATE POLICY "advances_select_admin" ON public.employee_advances
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('ceo'))
    AND public.fn_is_active()
  );

CREATE POLICY "advances_select_branch_staff" ON public.employee_advances
  FOR SELECT USING (
    (public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_advances.employee_id
        AND p.branch_id = public.fn_my_branch_id()
    )
  );
