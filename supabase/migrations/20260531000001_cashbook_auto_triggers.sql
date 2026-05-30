-- ============================================================
-- AUDIT-2026-05-30 — Sprint S1.1 + S1.3
-- Migration: Tự động ghi sổ quỹ từ các nghiệp vụ + cập nhật số dư đúng
-- File: 20260531000001_cashbook_auto_triggers.sql
-- Mục đích:
--   (S1.3) Sửa fn_update_fund_balance để cộng/trừ số dư ngay khi
--          INSERT phiếu 'approved' (không còn cần workaround draft→update),
--          và HOÀN số dư khi phiếu approved→cancelled.
--   (S1.1) Tự sinh cashbook_transactions khi:
--            - order_payments INSERT (tiền bán hàng)  → inflow  THU-DON-HANG
--            - debt_payments INSERT (thu công nợ KH)  → inflow  THU-NO
--            - sales_returns → completed (hoàn tiền)  → outflow CHI-HOANTIEN
--   Idempotent qua cặp (source_table, source_id).
-- ⚠️ Chạy thủ công qua Supabase SQL Editor. Phụ thuộc 20260531000000.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. CỘT TRUY VẾT NGUỒN — chống ghi trùng & cho phép backfill an toàn
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.cashbook_transactions
  ADD COLUMN IF NOT EXISTS source_table TEXT,
  ADD COLUMN IF NOT EXISTS source_id    UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cashbook_source
  ON public.cashbook_transactions(source_table, source_id)
  WHERE source_table IS NOT NULL;

COMMENT ON COLUMN public.cashbook_transactions.source_table IS 'Bảng nghiệp vụ sinh ra phiếu tự động: order_payments / debt_payments / sales_returns';
COMMENT ON COLUMN public.cashbook_transactions.source_id IS 'PK của bản ghi nghiệp vụ nguồn — đảm bảo mỗi nghiệp vụ chỉ sinh 1 phiếu';

-- ─────────────────────────────────────────────────────────────
-- 1. (S1.3) ÁP DELTA SỐ DƯ — helper dùng chung
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_apply_fund_delta(
  p_cash_fund_id   UUID,
  p_bank_account_id UUID,
  p_delta          NUMERIC
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_cash_fund_id IS NOT NULL THEN
    UPDATE public.cash_funds
    SET balance = balance + p_delta, updated_at = now()
    WHERE id = p_cash_fund_id;
  END IF;
  IF p_bank_account_id IS NOT NULL THEN
    UPDATE public.bank_accounts
    SET balance = balance + p_delta, updated_at = now()
    WHERE id = p_bank_account_id;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. (S1.3) FN_UPDATE_FUND_BALANCE — AFTER INSERT OR UPDATE
--    INSERT approved        → áp delta
--    *→approved (lần đầu)   → áp delta
--    approved→cancelled     → hoàn delta (đảo dấu)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_update_fund_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta NUMERIC(15,2);
BEGIN
  -- internal_transfer xử lý bằng 2 dòng inflow/outflow riêng → bỏ qua ở đây
  IF NEW.flow_type = 'internal_transfer' THEN
    RETURN NEW;
  END IF;

  v_delta := CASE WHEN NEW.flow_type = 'inflow' THEN NEW.amount ELSE -NEW.amount END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.fn_apply_fund_delta(NEW.cash_fund_id, NEW.bank_account_id, v_delta);
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.status IS DISTINCT FROM 'approved' AND NEW.status = 'approved' THEN
    PERFORM public.fn_apply_fund_delta(NEW.cash_fund_id, NEW.bank_account_id, v_delta);
  ELSIF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    PERFORM public.fn_apply_fund_delta(NEW.cash_fund_id, NEW.bank_account_id, -v_delta);
  END IF;

  RETURN NEW;
END;
$$;

-- Gắn lại trigger: mở rộng từ AFTER UPDATE → AFTER INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_cashbook_update_balance ON public.cashbook_transactions;
CREATE TRIGGER trg_cashbook_update_balance
  AFTER INSERT OR UPDATE ON public.cashbook_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_fund_balance();

-- ─────────────────────────────────────────────────────────────
-- 3. (S1.1) THU TIỀN BÁN HÀNG — từ order_payments
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cashbook_from_order_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch_id   UUID;
  v_customer_id UUID;
  v_cash_fund   UUID;
  v_bank_acct   UUID;
  v_session     UUID;
  v_cat         UUID;
BEGIN
  -- Chỉ ghi nhận tiền THẬT: tiền mặt / chuyển khoản / quẹt thẻ.
  -- 'credit' (ghi nợ), 'voucher', 'loyalty_points' không phải dòng tiền.
  IF NEW.payment_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RETURN NEW;
  END IF;

  SELECT o.branch_id, o.customer_id
    INTO v_branch_id, v_customer_id
  FROM public.orders o WHERE o.id = NEW.order_id;

  IF NEW.payment_method = 'cash' THEN
    v_cash_fund := public.fn_default_cash_fund(v_branch_id);
    -- Bám vào ca thu ngân đang mở của quỹ (nếu có) để đối soát đóng ca chính xác
    SELECT id INTO v_session FROM public.cashier_sessions
      WHERE cash_fund_id = v_cash_fund AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
  ELSE
    v_bank_acct := public.fn_default_bank_account(v_branch_id);
  END IF;

  -- Chi nhánh chưa cấu hình quỹ/TK → không chặn bán hàng, bỏ ghi sổ quỹ
  IF v_cash_fund IS NULL AND v_bank_acct IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_cat FROM public.expense_categories WHERE code = 'THU-DON-HANG' LIMIT 1;

  INSERT INTO public.cashbook_transactions (
    flow_type, status, cash_fund_id, bank_account_id, session_id, amount,
    transaction_date, customer_id, order_id, expense_category_id,
    description, reference_no, created_by, approved_by, approved_at,
    source_table, source_id
  ) VALUES (
    'inflow', 'approved', v_cash_fund, v_bank_acct, v_session, NEW.amount,
    NEW.payment_date, v_customer_id, NEW.order_id, v_cat,
    'Thu tiền bán hàng (tự động từ thanh toán đơn hàng)', NEW.reference_no,
    NEW.created_by, NEW.created_by, now(),
    'order_payments', NEW.id
  )
  ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_payment_cashbook ON public.order_payments;
CREATE TRIGGER trg_order_payment_cashbook
  AFTER INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_cashbook_from_order_payment();

-- ─────────────────────────────────────────────────────────────
-- 4. (S1.1) THU CÔNG NỢ KHÁCH HÀNG — từ debt_payments
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cashbook_from_debt_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch_id UUID;
  v_cash_fund UUID;
  v_bank_acct UUID;
  v_session   UUID;
  v_cat       UUID;
BEGIN
  IF NEW.payment_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RETURN NEW;
  END IF;

  SELECT c.branch_id INTO v_branch_id
  FROM public.customers c WHERE c.id = NEW.customer_id;

  IF NEW.payment_method = 'cash' THEN
    v_cash_fund := public.fn_default_cash_fund(v_branch_id);
    SELECT id INTO v_session FROM public.cashier_sessions
      WHERE cash_fund_id = v_cash_fund AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
  ELSE
    v_bank_acct := public.fn_default_bank_account(v_branch_id);
  END IF;

  IF v_cash_fund IS NULL AND v_bank_acct IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_cat FROM public.expense_categories WHERE code = 'THU-NO' LIMIT 1;

  INSERT INTO public.cashbook_transactions (
    flow_type, status, cash_fund_id, bank_account_id, session_id, amount,
    transaction_date, customer_id, expense_category_id,
    description, reference_no, created_by, approved_by, approved_at,
    source_table, source_id
  ) VALUES (
    'inflow', 'approved', v_cash_fund, v_bank_acct, v_session, NEW.amount,
    NEW.payment_date, NEW.customer_id, v_cat,
    'Thu công nợ khách hàng (tự động từ phiếu thu nợ)', NEW.reference_no,
    NEW.recorded_by, NEW.recorded_by, now(),
    'debt_payments', NEW.id
  )
  ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debt_payment_cashbook ON public.debt_payments;
CREATE TRIGGER trg_debt_payment_cashbook
  AFTER INSERT ON public.debt_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_cashbook_from_debt_payment();

-- ─────────────────────────────────────────────────────────────
-- 5. (S1.1) HOÀN TIỀN TRẢ HÀNG — từ sales_returns (→ completed)
--    Chỉ ghi khi hoàn bằng tiền mặt / chuyển khoản (credit_note không
--    phải dòng tiền — chỉ ghi giảm công nợ).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cashbook_from_sales_return()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch_id   UUID;
  v_customer_id UUID;
  v_cash_fund   UUID;
  v_bank_acct   UUID;
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
  ELSE
    v_bank_acct := public.fn_default_bank_account(v_branch_id);
  END IF;

  IF v_cash_fund IS NULL AND v_bank_acct IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_cat FROM public.expense_categories WHERE code = 'CHI-HOANTIEN' LIMIT 1;

  INSERT INTO public.cashbook_transactions (
    flow_type, status, cash_fund_id, bank_account_id, amount,
    transaction_date, customer_id, order_id, expense_category_id,
    description, reference_no, created_by, approved_by, approved_at,
    source_table, source_id
  ) VALUES (
    'outflow', 'approved', v_cash_fund, v_bank_acct, NEW.total_amount,
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

DROP TRIGGER IF EXISTS trg_sales_return_cashbook ON public.sales_returns;
CREATE TRIGGER trg_sales_return_cashbook
  AFTER UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_cashbook_from_sales_return();
