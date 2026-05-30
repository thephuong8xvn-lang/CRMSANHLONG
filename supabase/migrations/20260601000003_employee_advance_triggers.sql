-- ============================================================
-- AUDIT-2026-05-30 — Sprint S2.5 (backend)
-- Migration: Tạm ứng nhân viên ghi sổ quỹ
-- File: 20260601000003_employee_advance_triggers.sql
-- Mục đích:
--   employee_advances INSERT → tự sinh cashbook outflow (category
--   CHI-TAM-UNG) + link transaction_id, idempotent.
--   Hoàn ứng: ghi nhận qua trường settled_amount (UI cập nhật) + 1 phiếu
--   THU tay category THU-KHAC — không cần bảng riêng ở phase này.
-- ⚠️ Chạy thủ công qua Supabase SQL Editor. Phụ thuộc S1 + S2.1.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. TỰ SINH MÃ PHIẾU TẠM ỨNG (advance_code: TU-YYYY-NNNNN)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.code_sequences (code_type, prefix, year_part, current_no) VALUES
  ('employee_advance', 'TU', EXTRACT(YEAR FROM now())::INTEGER, 0)
ON CONFLICT (code_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_auto_employee_advance_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.advance_code IS NULL OR NEW.advance_code = '' THEN
    NEW.advance_code := public.fn_generate_code('employee_advance', 5);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_advance_code ON public.employee_advances;
CREATE TRIGGER trg_employee_advance_code
  BEFORE INSERT ON public.employee_advances
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_employee_advance_code();

CREATE OR REPLACE FUNCTION public.fn_cashbook_from_employee_advance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch_id UUID;
  v_cash_fund UUID;
  v_session   UUID;
  v_cat       UUID;
  v_tx_id     UUID;
BEGIN
  -- Tạm ứng chi bằng tiền mặt từ quỹ mặc định của chi nhánh người tạo
  SELECT branch_id INTO v_branch_id FROM public.profiles WHERE id = NEW.created_by;
  v_cash_fund := public.fn_default_cash_fund(v_branch_id);

  IF v_cash_fund IS NULL THEN
    RETURN NEW; -- Chi nhánh chưa có quỹ → bỏ ghi sổ (không chặn tạo tạm ứng)
  END IF;

  SELECT id INTO v_session FROM public.cashier_sessions
    WHERE cash_fund_id = v_cash_fund AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;

  SELECT id INTO v_cat FROM public.expense_categories WHERE code = 'CHI-TAM-UNG' LIMIT 1;

  INSERT INTO public.cashbook_transactions (
    flow_type, status, cash_fund_id, session_id, amount,
    transaction_date, employee_id, expense_category_id,
    description, created_by, approved_by, approved_at,
    source_table, source_id
  ) VALUES (
    'outflow', 'approved', v_cash_fund, v_session, NEW.amount,
    NEW.advance_date, NEW.employee_id, v_cat,
    'Tạm ứng nhân viên (' || COALESCE(NEW.advance_code, '') || '): ' || COALESCE(NEW.purpose, ''),
    NEW.created_by, NEW.created_by, now(),
    'employee_advances', NEW.id
  )
  ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING
  RETURNING id INTO v_tx_id;

  -- Link giao dịch cashbook vào phiếu tạm ứng
  IF v_tx_id IS NOT NULL THEN
    UPDATE public.employee_advances SET transaction_id = v_tx_id WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_advance_cashbook ON public.employee_advances;
CREATE TRIGGER trg_employee_advance_cashbook
  AFTER INSERT ON public.employee_advances
  FOR EACH ROW EXECUTE FUNCTION public.fn_cashbook_from_employee_advance();
