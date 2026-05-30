-- ============================================================
-- AUDIT-2026-05-30 — Sprint S2.1
-- Migration: Đồng bộ schema sổ quỹ với spec §9
-- File: 20260601000000_cashbook_schema_align.sql
-- Mục đích:
--   - cashier_sessions: thêm code (auto CS-YYYY-NNNNN), variance_reason,
--     opened_by, closed_by (spec §9.6).
--   - cash_funds: thêm custodian_user_id (thủ quỹ phụ trách, spec §9.3).
--   - cashbook_transactions: thêm posted_at, cancelled_at (spec §9.7).
--   - Sửa fn_auto_cashbook_code: prefix CQ cho internal_transfer (trước
--     đây mượn 'supplier_payment'/TT — sai ngữ nghĩa, D6 trong audit).
-- ⚠️ Chạy thủ công qua Supabase SQL Editor.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. CASHIER_SESSIONS — bổ sung cột theo spec
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.cashier_sessions
  ADD COLUMN IF NOT EXISTS code            TEXT,
  ADD COLUMN IF NOT EXISTS variance_reason TEXT,
  ADD COLUMN IF NOT EXISTS opened_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill opened_by = cashier_id cho dữ liệu cũ
UPDATE public.cashier_sessions SET opened_by = cashier_id WHERE opened_by IS NULL;

-- Mã phiên ca tự sinh: CS-YYYY-NNNNN
INSERT INTO public.code_sequences (code_type, prefix, year_part, current_no) VALUES
  ('cashier_session', 'CS', EXTRACT(YEAR FROM now())::INTEGER, 0)
ON CONFLICT (code_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_auto_cashier_session_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := public.fn_generate_code('cashier_session', 5);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cashier_session_code ON public.cashier_sessions;
CREATE TRIGGER trg_cashier_session_code
  BEFORE INSERT ON public.cashier_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_cashier_session_code();

-- Backfill code cho phiên cũ chưa có
UPDATE public.cashier_sessions
SET code = public.fn_generate_code('cashier_session', 5)
WHERE code IS NULL OR code = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_sessions_code
  ON public.cashier_sessions(code) WHERE code IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. CASH_FUNDS — thủ quỹ phụ trách
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.cash_funds
  ADD COLUMN IF NOT EXISTS custodian_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cash_funds.custodian_user_id IS 'Thủ quỹ phụ trách quỹ này (spec §9.3)';

-- ─────────────────────────────────────────────────────────────
-- 3. CASHBOOK_TRANSACTIONS — posted_at / cancelled_at
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.cashbook_transactions
  ADD COLUMN IF NOT EXISTS posted_at    TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.cashbook_transactions.posted_at IS 'Thời điểm tạo phiếu trong hệ (khác transaction_date = ngày nghiệp vụ)';
COMMENT ON COLUMN public.cashbook_transactions.cancelled_at IS 'Thời điểm hủy phiếu';

-- Tự ghi cancelled_at khi status → cancelled
CREATE OR REPLACE FUNCTION public.fn_cashbook_stamp_cancelled()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cashbook_stamp_cancelled ON public.cashbook_transactions;
CREATE TRIGGER trg_cashbook_stamp_cancelled
  BEFORE UPDATE ON public.cashbook_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_cashbook_stamp_cancelled();

-- ─────────────────────────────────────────────────────────────
-- 4. SỬA fn_auto_cashbook_code — prefix CQ cho internal_transfer
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.code_sequences (code_type, prefix, year_part, current_no) VALUES
  ('internal_transfer', 'CQ', EXTRACT(YEAR FROM now())::INTEGER, 0)
ON CONFLICT (code_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_auto_cashbook_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code_type TEXT;
BEGIN
  IF NEW.transaction_code IS NOT NULL AND NEW.transaction_code <> '' THEN
    RETURN NEW;
  END IF;

  CASE NEW.flow_type
    WHEN 'inflow'            THEN v_code_type := 'cash_receipt';
    WHEN 'outflow'           THEN v_code_type := 'cash_payment';
    WHEN 'internal_transfer' THEN v_code_type := 'internal_transfer';
  END CASE;

  NEW.transaction_code := public.fn_generate_code(v_code_type, 5);
  RETURN NEW;
END;
$$;
