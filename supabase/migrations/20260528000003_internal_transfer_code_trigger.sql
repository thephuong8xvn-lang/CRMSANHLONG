-- ============================================================
-- CRM SANHLONGVETCO
-- Migration: 20260528000003_internal_transfer_code_trigger.sql
-- Mô tả: Thêm trigger tự sinh transfer_code cho bảng internal_transfers
--        Thêm code_sequence 'internal_transfer' (prefix CQ = Chuyển Quỹ)
-- Thứ tự chạy: sau 20260528000002_atomic_stock_transfer_functions.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Thêm code_sequence cho internal_transfer nếu chưa có
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.code_sequences (code_type, prefix, year_part, current_no)
VALUES ('internal_transfer', 'CQ', EXTRACT(YEAR FROM now())::INTEGER, 0)
ON CONFLICT (code_type) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. Trigger function: tự sinh transfer_code khi INSERT
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_internal_transfer_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transfer_code IS NULL OR NEW.transfer_code = '' THEN
    NEW.transfer_code := public.fn_generate_code('internal_transfer', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_internal_transfer_code
  BEFORE INSERT ON public.internal_transfers
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_internal_transfer_code();
