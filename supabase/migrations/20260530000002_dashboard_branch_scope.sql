-- ============================================================
-- CRM SANHLONGVETCO – DASHBOARD BRANCH SCOPING (UX Overview)
-- File: 20260530000002_dashboard_branch_scope.sql
-- Mô tả:
--   Khắc phục lỗi "Trang Tổng quan vẫn hiển thị tổng tất cả chi nhánh
--   dù đã phân quyền". Gồm 2 phần:
--     A. Nâng cấp RPC get_dashboard_stats() nhận tham số p_branch_id,
--        lọc tường minh theo chi nhánh ngay trong SQL (không phụ thuộc
--        hoàn toàn vào RLS). admin/ceo có thể chọn chi nhánh (NULL = tất
--        cả); vai trò khác bị KHÓA CỨNG vào chi nhánh của họ.
--     B. Vá các lỗ rò RLS khiến branch_manager đọc được dữ liệu chéo
--        chi nhánh trên cashbook_transactions, activities, customer_debts.
--   Lưu ý schema: cashbook_transactions & customer_debts KHÔNG có cột
--   branch_id → suy ra qua JOIN (cash_funds/bank_accounts, orders/customers).
-- Thứ tự chạy: sau 20260530000001_update_transfer_receiving_cost_price.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A. RPC: get_dashboard_stats(p_branch_id UUID)
--    NULL  → toàn hệ thống (chỉ admin/ceo mới được phép)
--    UUID  → 1 chi nhánh cụ thể
--    Non-admin: bỏ qua p_branch_id, ép về fn_my_branch_id().
-- ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_dashboard_stats();
DROP FUNCTION IF EXISTS public.get_dashboard_stats(UUID);

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_branch_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_start    DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_last_start     DATE := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::DATE;
  v_today          DATE := CURRENT_DATE;
  v_expiry_limit   DATE := CURRENT_DATE + INTERVAL '30 days';
  v_six_months_ago DATE := (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')::DATE;
  -- Phạm vi chi nhánh hiệu lực
  v_is_admin   BOOLEAN := public.fn_is_admin();
  v_branch     UUID;
  v_monthly        NUMERIC(15,2);
  v_last_month     NUMERIC(15,2);
  v_overdue        NUMERIC(15,2);
  v_overdue_cnt    INTEGER;
  v_expiring_cnt   INTEGER;
  v_cashflow       JSONB;
BEGIN
  -- Xác định chi nhánh hiệu lực: admin/ceo tự do chọn (NULL = tất cả);
  -- vai trò khác bị khóa vào chi nhánh trong hồ sơ của họ.
  IF v_is_admin THEN
    v_branch := p_branch_id;
  ELSE
    v_branch := public.fn_my_branch_id();
  END IF;

  -- 1. Doanh thu tháng này
  SELECT COALESCE(SUM(o.grand_total), 0) INTO v_monthly
  FROM public.orders o
  WHERE o.status <> 'cancelled'
    AND o.created_at >= v_month_start
    AND (v_branch IS NULL OR o.branch_id = v_branch);

  -- 2. Doanh thu tháng trước
  SELECT COALESCE(SUM(o.grand_total), 0) INTO v_last_month
  FROM public.orders o
  WHERE o.status <> 'cancelled'
    AND o.created_at >= v_last_start
    AND o.created_at <  v_month_start
    AND (v_branch IS NULL OR o.branch_id = v_branch);

  -- 3. Tổng nợ quá hạn + số khoản (branch suy ra: order → customer fallback)
  SELECT COALESCE(SUM(d.amount), 0), COUNT(*)
    INTO v_overdue, v_overdue_cnt
  FROM public.customer_debts d
  LEFT JOIN public.orders o    ON o.id = d.order_id
  LEFT JOIN public.customers c ON c.id = d.customer_id
  WHERE d.is_settled = false
    AND d.due_date IS NOT NULL
    AND d.due_date < v_today
    AND (v_branch IS NULL OR COALESCE(o.branch_id, c.branch_id) = v_branch);

  -- 4. Số lô sắp hết hạn (0–30 ngày), branch qua warehouse
  SELECT COUNT(*) INTO v_expiring_cnt
  FROM public.stock_lots sl
  LEFT JOIN public.warehouses w ON w.id = sl.warehouse_id
  WHERE sl.quantity_on_hand > 0
    AND sl.expiry_date IS NOT NULL
    AND sl.expiry_date >= v_today
    AND sl.expiry_date <= v_expiry_limit
    AND (v_branch IS NULL OR w.branch_id = v_branch);

  -- 5. Dòng tiền 6 tháng gần nhất (branch qua cash_fund / bank_account)
  WITH months AS (
    SELECT generate_series(
      v_six_months_ago,
      date_trunc('month', CURRENT_DATE)::DATE,
      INTERVAL '1 month'
    )::DATE AS month_start
  ),
  flows AS (
    SELECT
      date_trunc('month', t.transaction_date)::DATE AS month_start,
      t.flow_type,
      SUM(t.amount) AS total
    FROM public.cashbook_transactions t
    LEFT JOIN public.cash_funds    cf ON cf.id = t.cash_fund_id
    LEFT JOIN public.bank_accounts ba ON ba.id = t.bank_account_id
    WHERE t.status = 'approved'
      AND t.transaction_date >= v_six_months_ago
      AND (v_branch IS NULL OR COALESCE(cf.branch_id, ba.branch_id) = v_branch)
    GROUP BY 1, 2
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', to_char(m.month_start, 'YYYY-MM-DD'),
      'name',  'Tháng ' || EXTRACT(MONTH FROM m.month_start)::INT,
      'inflow',  COALESCE((SELECT total FROM flows f WHERE f.month_start = m.month_start AND f.flow_type = 'inflow'),  0),
      'outflow', COALESCE((SELECT total FROM flows f WHERE f.month_start = m.month_start AND f.flow_type = 'outflow'), 0)
    )
    ORDER BY m.month_start
  ), '[]'::jsonb)
  INTO v_cashflow
  FROM months m;

  RETURN jsonb_build_object(
    'branch_id',             v_branch,
    'monthly_revenue',       v_monthly,
    'last_month_revenue',    v_last_month,
    'monthly_revenue_delta', CASE
                               WHEN v_last_month > 0
                                 THEN ROUND(((v_monthly - v_last_month) / v_last_month) * 100, 1)
                               WHEN v_monthly > 0 THEN 100
                               ELSE 0
                             END,
    'overdue_debt',          v_overdue,
    'overdue_debt_count',    v_overdue_cnt,
    'expiring_lots_count',   v_expiring_cnt,
    'cashflow_6m',           v_cashflow
  );
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_stats(UUID) IS
'Số liệu Dashboard gộp, lọc theo chi nhánh. p_branch_id NULL = toàn hệ thống (chỉ admin/ceo); non-admin bị khóa vào fn_my_branch_id(). Tôn trọng RLS qua SECURITY INVOKER.';

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- B. VÁ LỖ RÒ RLS – branch_manager đọc chéo chi nhánh
--    Nguyên tắc: admin/ceo/accountant giữ nguyên toàn hệ thống (thiết
--    kế giám sát tài chính); branch_manager chỉ thấy dữ liệu chi nhánh.
-- ─────────────────────────────────────────────────────────────

-- B.1 cashbook_transactions: tách branch_manager khỏi policy "toàn bộ"
DROP POLICY IF EXISTS "cashbook_select_accountant" ON public.cashbook_transactions;
CREATE POLICY "cashbook_select_accountant" ON public.cashbook_transactions
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

DROP POLICY IF EXISTS "cashbook_select_branch_mgr" ON public.cashbook_transactions;
CREATE POLICY "cashbook_select_branch_mgr" ON public.cashbook_transactions
  FOR SELECT USING (
    public.fn_has_role('branch_manager')
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

-- B.2 activities: tách branch_manager khỏi policy "toàn bộ"
DROP POLICY IF EXISTS "activities_select_admin" ON public.activities;
CREATE POLICY "activities_select_admin" ON public.activities
  FOR SELECT USING (public.fn_is_admin() AND public.fn_is_active());

DROP POLICY IF EXISTS "activities_select_branch_mgr" ON public.activities;
CREATE POLICY "activities_select_branch_mgr" ON public.activities
  FOR SELECT USING (
    public.fn_has_role('branch_manager')
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = activities.customer_id
        AND c.branch_id = public.fn_my_branch_id()
    )
  );

-- B.3 customer_debts: bổ sung policy SELECT cho branch_manager
--     (trước đây hoàn toàn thiếu → branch_manager thấy 0 nợ)
DROP POLICY IF EXISTS "debts_select_branch_mgr" ON public.customer_debts;
CREATE POLICY "debts_select_branch_mgr" ON public.customer_debts
  FOR SELECT USING (
    public.fn_has_role('branch_manager')
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_debts.customer_id
        AND c.branch_id = public.fn_my_branch_id()
    )
  );

-- ============================================================
-- HẾT. Chạy thủ công qua Supabase SQL Editor (theo quy ước dự án).
-- ============================================================
