-- ============================================================
-- AUDIT-2026-05-30 — Sprint S4 (Đối soát mở/đóng ca thu ngân)
-- Migration: 20260606000000_cashbook_session_reconcile.sql
-- Mục đích:
--   1. (Bug) Hoàn tiền trả hàng TIỀN MẶT chưa gắn session_id → bổ sung
--      lookup ca đang mở để đối soát đóng ca chính xác.
--   2. Thêm 2 danh mục lệch quỹ: THU-LECH-QUY (thừa), CHI-LECH-QUY (thiếu)
--      để bút toán điều chỉnh cuối ca không làm bẩn báo cáo CHI-NCC.
--   3. Mô hình "1 chi nhánh = 1 két, mỗi két chỉ 1 ca mở": index duy nhất
--      1 phiên 'open' / mỗi cash_fund (kèm dọn dữ liệu trùng).
--   4. RLS: mọi nhân viên trong chi nhánh thấy & đóng được ca chung của két
--      (trước đây chỉ người mở ca thấy ca của mình).
-- ⚠️ Chạy thủ công qua Supabase SQL Editor. Phụ thuộc S1 + S2 + S3.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. DANH MỤC LỆCH QUỸ (điều chỉnh chênh lệch cuối ca)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.expense_categories (id, code, name, flow_type, is_active) VALUES
  ('e0e00001-0000-0000-0000-000000000012', 'THU-LECH-QUY', 'Thừa quỹ khi đối soát ca', 'inflow',  true),
  ('e0e00001-0000-0000-0000-000000000013', 'CHI-LECH-QUY', 'Thiếu quỹ khi đối soát ca', 'outflow', true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. HOÀN TIỀN TRẢ HÀNG — bổ sung gắn session_id cho hoàn tiền MẶT
--    (giữ nguyên logic cũ, chỉ thêm v_session cho refund_method = 'cash')
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cashbook_from_sales_return()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch_id   UUID;
  v_customer_id UUID;
  v_cash_fund   UUID;
  v_bank_acct   UUID;
  v_session     UUID;
  v_cat         UUID;
BEGIN
  -- Chỉ kích hoạt khi chuyển sang 'completed'
  IF NOT (OLD.status IS DISTINCT FROM 'completed' AND NEW.status = 'completed') THEN
    RETURN NEW;
  END IF;

  IF NEW.refund_method NOT IN ('cash', 'bank_transfer') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.total_amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT o.branch_id, o.customer_id
    INTO v_branch_id, v_customer_id
  FROM public.orders o WHERE o.id = NEW.order_id;

  IF NEW.refund_method = 'cash' THEN
    v_cash_fund := public.fn_default_cash_fund(v_branch_id);
    -- Hoàn tiền mặt phải trừ vào ca đang mở của két để đối soát đúng
    SELECT id INTO v_session FROM public.cashier_sessions
      WHERE cash_fund_id = v_cash_fund AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
  ELSE
    v_bank_acct := public.fn_default_bank_account(v_branch_id);
  END IF;

  IF v_cash_fund IS NULL AND v_bank_acct IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_cat FROM public.expense_categories WHERE code = 'CHI-HOANTIEN' LIMIT 1;

  INSERT INTO public.cashbook_transactions (
    flow_type, status, cash_fund_id, bank_account_id, session_id, amount,
    transaction_date, customer_id, order_id, expense_category_id,
    description, reference_no, created_by, approved_by, approved_at,
    source_table, source_id
  ) VALUES (
    'outflow', 'approved', v_cash_fund, v_bank_acct, v_session, NEW.total_amount,
    CURRENT_DATE, v_customer_id, NEW.order_id, v_cat,
    'Hoàn tiền trả hàng khách (tự động từ phiếu trả hàng ' || COALESCE(NEW.return_code, '') || ')',
    NEW.return_code,
    COALESCE(NEW.processed_by, NEW.created_by),
    COALESCE(NEW.processed_by, NEW.created_by), now(),
    'sales_returns', NEW.id
  )
  ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. MỘT KÉT — MỘT CA MỞ: dọn trùng + index duy nhất
--    Nếu 1 quỹ đang có >1 phiên 'open' (dữ liệu cũ), giữ phiên mới nhất,
--    tự đóng các phiên cũ trước khi tạo unique index.
-- ─────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY cash_fund_id ORDER BY opened_at DESC, id) AS rn
  FROM public.cashier_sessions
  WHERE status = 'open'
)
UPDATE public.cashier_sessions s
SET status = 'closed',
    closed_at = COALESCE(s.closed_at, now()),
    notes = COALESCE(s.notes, '') || ' [Auto-đóng: gộp ca trùng két khi nâng cấp S4]'
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_sessions_one_open_per_fund
  ON public.cashier_sessions(cash_fund_id) WHERE status = 'open';

COMMENT ON INDEX public.uq_cashier_sessions_one_open_per_fund
  IS 'Mỗi két (cash_fund) chỉ có tối đa 1 phiên ca đang mở tại một thời điểm — dùng chung cho nhiều nhân viên trong chi nhánh';

-- ─────────────────────────────────────────────────────────────
-- 4. RLS — CHIA SẺ CA THEO CHI NHÁNH (két dùng chung)
--    Mọi nhân viên đang hoạt động trong chi nhánh đều thấy ca của két
--    chi nhánh mình; vai trò vận hành quầy được mở/đóng ca chung.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sessions_select_branch" ON public.cashier_sessions;
CREATE POLICY "sessions_select_branch" ON public.cashier_sessions
  FOR SELECT USING (
    public.fn_is_active()
    AND cash_fund_id IN (
      SELECT id FROM public.cash_funds WHERE branch_id = public.fn_my_branch_id()
    )
  );

DROP POLICY IF EXISTS "sessions_manage_branch" ON public.cashier_sessions;
CREATE POLICY "sessions_manage_branch" ON public.cashier_sessions
  FOR ALL USING (
    public.fn_is_active()
    AND cash_fund_id IN (
      SELECT id FROM public.cash_funds WHERE branch_id = public.fn_my_branch_id()
    )
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR public.fn_has_role('branch_manager')
      OR public.fn_has_role('warehouse_keeper')
      OR public.fn_has_role('cashier')
    )
  )
  WITH CHECK (
    public.fn_is_active()
    AND cash_fund_id IN (
      SELECT id FROM public.cash_funds WHERE branch_id = public.fn_my_branch_id()
    )
    AND (
      public.fn_is_admin()
      OR public.fn_has_role('accountant')
      OR public.fn_has_role('branch_manager')
      OR public.fn_has_role('warehouse_keeper')
      OR public.fn_has_role('cashier')
    )
  );
