-- ============================================================
-- AUDIT-2026-05-30 — Sprint S2.2
-- Migration: Chuyển quỹ nội bộ atomic 2 bút toán (trigger DB)
-- File: 20260601000001_internal_transfer_triggers.sql
-- Mục đích:
--   Thay luồng frontend 3-roundtrip (insert internal_transfers + 2 insert
--   cashbook + 2 update→approved — D7 trong audit) bằng 1 trigger DB:
--   chỉ cần INSERT internal_transfers, trigger tự sinh 2 cashbook đối ứng
--   (outflow ở TK nguồn + inflow ở TK đích), atomic trong cùng transaction.
--   Số dư cập nhật tự động qua fn_update_fund_balance (S1.3).
-- ⚠️ Chạy thủ công qua Supabase SQL Editor. Phụ thuộc S1 + S2.1.
-- ============================================================

-- Cột truy vết 2 bút toán đối ứng (spec §9.12)
ALTER TABLE public.internal_transfers
  ADD COLUMN IF NOT EXISTS from_cashbook_id UUID REFERENCES public.cashbook_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_cashbook_id   UUID REFERENCES public.cashbook_transactions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.fn_cashbook_from_internal_transfer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_fund  UUID := NEW.from_fund_id;
  v_from_bank  UUID := NEW.from_bank_id;
  v_to_fund    UUID := NEW.to_fund_id;
  v_to_bank    UUID := NEW.to_bank_id;
  v_from_sess  UUID;
  v_to_sess    UUID;
  v_out_id     UUID;
  v_in_id      UUID;
  v_now        TIMESTAMPTZ := now();
BEGIN
  -- Ca thu ngân đang mở (nếu nguồn/đích là quỹ tiền mặt) để đối soát đúng
  IF v_from_fund IS NOT NULL THEN
    SELECT id INTO v_from_sess FROM public.cashier_sessions
      WHERE cash_fund_id = v_from_fund AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
  END IF;
  IF v_to_fund IS NOT NULL THEN
    SELECT id INTO v_to_sess FROM public.cashier_sessions
      WHERE cash_fund_id = v_to_fund AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
  END IF;

  -- Bút toán CHI ở tài khoản nguồn
  INSERT INTO public.cashbook_transactions (
    flow_type, status, cash_fund_id, bank_account_id, session_id, amount,
    transaction_date, description, reference_no,
    created_by, approved_by, approved_at, source_table, source_id
  ) VALUES (
    'outflow', 'approved', v_from_fund, v_from_bank, v_from_sess, NEW.amount,
    NEW.transfer_date,
    'Chuyển quỹ nội bộ (chi) ' || COALESCE(NEW.transfer_code, '') ||
      CASE WHEN NEW.notes IS NOT NULL THEN ' — ' || NEW.notes ELSE '' END,
    NEW.transfer_code,
    NEW.created_by, COALESCE(NEW.approved_by, NEW.created_by), v_now,
    'internal_transfer_out', NEW.id
  )
  ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING
  RETURNING id INTO v_out_id;

  -- Bút toán THU ở tài khoản đích
  INSERT INTO public.cashbook_transactions (
    flow_type, status, cash_fund_id, bank_account_id, session_id, amount,
    transaction_date, description, reference_no,
    created_by, approved_by, approved_at, source_table, source_id
  ) VALUES (
    'inflow', 'approved', v_to_fund, v_to_bank, v_to_sess, NEW.amount,
    NEW.transfer_date,
    'Chuyển quỹ nội bộ (thu) ' || COALESCE(NEW.transfer_code, '') ||
      CASE WHEN NEW.notes IS NOT NULL THEN ' — ' || NEW.notes ELSE '' END,
    NEW.transfer_code,
    NEW.created_by, COALESCE(NEW.approved_by, NEW.created_by), v_now,
    'internal_transfer_in', NEW.id
  )
  ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING
  RETURNING id INTO v_in_id;

  -- Liên kết ngược 2 bút toán vào phiếu chuyển
  UPDATE public.internal_transfers
  SET from_cashbook_id = COALESCE(v_out_id, from_cashbook_id),
      to_cashbook_id   = COALESCE(v_in_id, to_cashbook_id)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_internal_transfer_cashbook ON public.internal_transfers;
CREATE TRIGGER trg_internal_transfer_cashbook
  AFTER INSERT ON public.internal_transfers
  FOR EACH ROW EXECUTE FUNCTION public.fn_cashbook_from_internal_transfer();
