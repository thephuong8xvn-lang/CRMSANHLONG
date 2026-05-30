-- ============================================================
-- AUDIT-2026-05-30 — Sprint S2.4 (backend)
-- Migration: Công nợ phải trả NCC + thanh toán NCC ghi sổ quỹ
-- File: 20260601000002_supplier_payment_triggers.sql
-- Mục đích:
--   - suppliers.current_debt_payable: công nợ phải trả (denormalized),
--     tăng khi tạo goods_receipts, giảm khi supplier_payments.
--     (goods_receipts không có cột status — phiếu nhập = đã xác nhận)
--   - supplier_payments INSERT → tự sinh cashbook outflow (category
--     CHI-NCC) + giảm công nợ NCC, idempotent.
-- ⚠️ Chạy thủ công qua Supabase SQL Editor. Phụ thuộc S1 + S2.1.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. CỘT CÔNG NỢ NCC
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS current_debt_payable NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.suppliers.current_debt_payable IS 'Công nợ phải trả NCC (denormalized): +goods_receipts, −supplier_payments';

-- Liên kết NCC + chi nhánh cho supplier_payments để ghi sổ đúng quỹ.
-- (supplier_payments không có branch_id → suy ra qua người tạo)

-- ─────────────────────────────────────────────────────────────
-- 1b. TỰ SINH MÃ PHIẾU CHI NCC (payment_code: TT-YYYY-NNNNN)
--     code_sequences 'supplier_payment'/'TT' đã seed ở init_schema.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_supplier_payment_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_code IS NULL OR NEW.payment_code = '' THEN
    NEW.payment_code := public.fn_generate_code('supplier_payment', 5);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payment_code ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payment_code
  BEFORE INSERT ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_supplier_payment_code();

-- ─────────────────────────────────────────────────────────────
-- 2. TĂNG CÔNG NỢ KHI NHẬP KHO
--    Lưu ý: goods_receipts KHÔNG có cột status — mỗi phiếu nhập là đã
--    xác nhận ngay khi tạo. Vì vậy: INSERT → tăng nợ; DELETE → giảm nợ;
--    UPDATE total_amount → điều chỉnh chênh lệch.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_supplier_debt_on_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.suppliers
    SET current_debt_payable = current_debt_payable + COALESCE(NEW.total_amount, 0),
        updated_at = now()
    WHERE id = NEW.supplier_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.suppliers
    SET current_debt_payable = current_debt_payable - COALESCE(OLD.total_amount, 0),
        updated_at = now()
    WHERE id = OLD.supplier_id;
    RETURN OLD;
  ELSE -- UPDATE: điều chỉnh theo chênh lệch (xử lý cả khi đổi NCC)
    IF OLD.supplier_id = NEW.supplier_id THEN
      UPDATE public.suppliers
      SET current_debt_payable = current_debt_payable
            + COALESCE(NEW.total_amount, 0) - COALESCE(OLD.total_amount, 0),
          updated_at = now()
      WHERE id = NEW.supplier_id;
    ELSE
      UPDATE public.suppliers
      SET current_debt_payable = current_debt_payable - COALESCE(OLD.total_amount, 0),
          updated_at = now()
      WHERE id = OLD.supplier_id;
      UPDATE public.suppliers
      SET current_debt_payable = current_debt_payable + COALESCE(NEW.total_amount, 0),
          updated_at = now()
      WHERE id = NEW.supplier_id;
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_debt_on_receipt ON public.goods_receipts;
CREATE TRIGGER trg_supplier_debt_on_receipt
  AFTER INSERT OR UPDATE OR DELETE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_supplier_debt_on_receipt();

-- ─────────────────────────────────────────────────────────────
-- 3. THANH TOÁN NCC → CASHBOOK OUTFLOW + GIẢM CÔNG NỢ
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cashbook_from_supplier_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch_id UUID;
  v_cash_fund UUID;
  v_bank_acct UUID;
  v_session   UUID;
  v_cat       UUID;
BEGIN
  -- Giảm công nợ phải trả NCC
  UPDATE public.suppliers
  SET current_debt_payable = current_debt_payable - NEW.amount,
      updated_at = now()
  WHERE id = NEW.supplier_id;

  -- Chỉ tiền mặt / chuyển khoản / quẹt thẻ mới là dòng tiền thật
  IF NEW.payment_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RETURN NEW;
  END IF;

  -- Chi nhánh suy ra từ người tạo phiếu
  SELECT branch_id INTO v_branch_id FROM public.profiles WHERE id = NEW.created_by;

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

  SELECT id INTO v_cat FROM public.expense_categories WHERE code = 'CHI-NCC' LIMIT 1;

  INSERT INTO public.cashbook_transactions (
    flow_type, status, cash_fund_id, bank_account_id, session_id, amount,
    transaction_date, supplier_id, expense_category_id,
    description, reference_no, created_by, approved_by, approved_at,
    source_table, source_id
  ) VALUES (
    'outflow', 'approved', v_cash_fund, v_bank_acct, v_session, NEW.amount,
    NEW.payment_date, NEW.supplier_id, v_cat,
    'Thanh toán nhà cung cấp (tự động từ phiếu chi NCC ' || COALESCE(NEW.payment_code, '') || ')',
    NEW.reference_no, NEW.created_by, NEW.created_by, now(),
    'supplier_payments', NEW.id
  )
  ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payment_cashbook ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payment_cashbook
  AFTER INSERT ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_cashbook_from_supplier_payment();

-- ─────────────────────────────────────────────────────────────
-- 4. BACKFILL công nợ NCC từ lịch sử (idempotent: tính lại từ đầu)
--    current_debt = Σ goods_receipts − Σ supplier_payments
--    (goods_receipts không có status → tính tất cả phiếu nhập)
-- ─────────────────────────────────────────────────────────────
UPDATE public.suppliers s
SET current_debt_payable = COALESCE(gr.total, 0) - COALESCE(sp.total, 0)
FROM
  (SELECT id FROM public.suppliers) s2
  LEFT JOIN (
    SELECT supplier_id, SUM(total_amount) AS total
    FROM public.goods_receipts
    GROUP BY supplier_id
  ) gr ON gr.supplier_id = s2.id
  LEFT JOIN (
    SELECT supplier_id, SUM(amount) AS total
    FROM public.supplier_payments
    GROUP BY supplier_id
  ) sp ON sp.supplier_id = s2.id
WHERE s.id = s2.id;
