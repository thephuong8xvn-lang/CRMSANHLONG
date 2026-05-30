-- ============================================================
-- AUDIT-2026-05-30 — Sprint S1.2
-- Migration: Quỹ/Tài khoản mặc định theo chi nhánh
-- File: 20260531000000_cashbook_default_accounts.sql
-- Mục đích:
--   Đánh dấu 1 quỹ tiền mặt + 1 tài khoản ngân hàng MẶC ĐỊNH cho mỗi
--   chi nhánh, để auto-trigger (S1.1) biết ghi tiền bán hàng/thu nợ/
--   hoàn tiền vào đâu khi POS không chỉ định quỹ cụ thể.
-- ⚠️ Chạy thủ công qua Supabase SQL Editor.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. THÊM CỜ MẶC ĐỊNH
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.cash_funds
  ADD COLUMN IF NOT EXISTS is_default_cash BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS is_default_bank BOOLEAN NOT NULL DEFAULT FALSE;

-- Mỗi chi nhánh chỉ 1 quỹ mặc định + 1 tài khoản mặc định
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_funds_default_per_branch
  ON public.cash_funds(branch_id) WHERE is_default_cash;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_default_per_branch
  ON public.bank_accounts(branch_id) WHERE is_default_bank;

-- ─────────────────────────────────────────────────────────────
-- 2. BACKFILL: chọn quỹ/TK đầu tiên (theo created_at) làm mặc định
--    nếu chi nhánh chưa có cái nào được đánh dấu.
-- ─────────────────────────────────────────────────────────────
WITH ranked_funds AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY branch_id ORDER BY created_at, id) AS rn
  FROM public.cash_funds
  WHERE is_active
    AND branch_id NOT IN (
      SELECT branch_id FROM public.cash_funds WHERE is_default_cash
    )
)
UPDATE public.cash_funds cf
SET is_default_cash = TRUE
FROM ranked_funds rf
WHERE cf.id = rf.id AND rf.rn = 1;

WITH ranked_banks AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY branch_id ORDER BY created_at, id) AS rn
  FROM public.bank_accounts
  WHERE is_active
    AND branch_id NOT IN (
      SELECT branch_id FROM public.bank_accounts WHERE is_default_bank
    )
)
UPDATE public.bank_accounts ba
SET is_default_bank = TRUE
FROM ranked_banks rb
WHERE ba.id = rb.id AND rb.rn = 1;

-- ─────────────────────────────────────────────────────────────
-- 3. HÀM TRA CỨU QUỸ/TK MẶC ĐỊNH CỦA 1 CHI NHÁNH
--    Ưu tiên cờ mặc định; fallback về cái cũ nhất còn hoạt động.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_default_cash_fund(p_branch_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.cash_funds
  WHERE branch_id = p_branch_id AND is_active
  ORDER BY is_default_cash DESC, created_at ASC, id ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_default_bank_account(p_branch_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.bank_accounts
  WHERE branch_id = p_branch_id AND is_active
  ORDER BY is_default_bank DESC, created_at ASC, id ASC
  LIMIT 1;
$$;

COMMENT ON COLUMN public.cash_funds.is_default_cash IS 'Quỹ tiền mặt mặc định của chi nhánh — nơi nhận tiền bán hàng tiền mặt tự động';
COMMENT ON COLUMN public.bank_accounts.is_default_bank IS 'Tài khoản ngân hàng mặc định của chi nhánh — nơi nhận tiền chuyển khoản/quẹt thẻ tự động';

-- ─────────────────────────────────────────────────────────────
-- 4. DANH MỤC HOÀN TIỀN TRẢ HÀNG (dùng cho auto-trigger customer_refund)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.expense_categories (id, code, name, flow_type, is_active) VALUES
  ('e0e00001-0000-0000-0000-000000000011', 'CHI-HOANTIEN', 'Hoàn tiền trả hàng khách', 'outflow', true)
ON CONFLICT (id) DO NOTHING;
