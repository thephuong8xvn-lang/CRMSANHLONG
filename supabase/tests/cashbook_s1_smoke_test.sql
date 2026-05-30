-- ============================================================
-- AUDIT-2026-05-30 — Sprint S1.5 — SMOKE TEST sổ quỹ
-- File: supabase/tests/cashbook_s1_smoke_test.sql
-- KHÔNG phải migration. Chạy thủ công trong Supabase SQL Editor để kiểm
-- chứng S1 sau khi đã apply 3 migration 20260531000000/01/02.
--
-- Gồm 2 phần:
--   A. KIỂM TRA CẤU TRÚC (read-only) — cột, trigger, hàm, default per-branch.
--   B. KIỂM TRA HÀNH VI (BEGIN…ROLLBACK) — chèn order_payment giả, xác nhận
--      cashbook tự sinh + số dư quỹ tăng đúng, rồi ROLLBACK (không đổi dữ liệu).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A. KIỂM TRA CẤU TRÚC
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  -- A1. Cột mới
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='cash_funds' AND column_name='is_default_cash')
    THEN v_missing := v_missing || ' cash_funds.is_default_cash'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='bank_accounts' AND column_name='is_default_bank')
    THEN v_missing := v_missing || ' bank_accounts.is_default_bank'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='cashbook_transactions' AND column_name='source_table')
    THEN v_missing := v_missing || ' cashbook_transactions.source_table'; END IF;

  -- A2. Trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_order_payment_cashbook')
    THEN v_missing := v_missing || ' trigger:trg_order_payment_cashbook'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_debt_payment_cashbook')
    THEN v_missing := v_missing || ' trigger:trg_debt_payment_cashbook'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_sales_return_cashbook')
    THEN v_missing := v_missing || ' trigger:trg_sales_return_cashbook'; END IF;

  -- A3. Hàm helper
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='fn_default_cash_fund')
    THEN v_missing := v_missing || ' fn:fn_default_cash_fund'; END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION '❌ THIẾU đối tượng:%', v_missing;
  ELSE
    RAISE NOTICE '✅ A. Cấu trúc đầy đủ: cột + 3 trigger + hàm helper.';
  END IF;
END;
$$;

-- A4. Mỗi chi nhánh (đang có quỹ) phải có đúng 1 quỹ mặc định
SELECT
  b.name AS chi_nhanh,
  COUNT(*) FILTER (WHERE cf.is_default_cash) AS so_quy_mac_dinh,
  COUNT(*)                                   AS tong_quy
FROM public.branches b
JOIN public.cash_funds cf ON cf.branch_id = b.id AND cf.is_active
GROUP BY b.name
ORDER BY b.name;
-- Kỳ vọng: cột so_quy_mac_dinh = 1 ở mọi dòng.

-- ─────────────────────────────────────────────────────────────
-- B. KIỂM TRA HÀNH VI (không làm thay đổi dữ liệu thật)
-- ─────────────────────────────────────────────────────────────
BEGIN;

DO $$
DECLARE
  v_order      RECORD;
  v_fund_id    UUID;
  v_bal_before NUMERIC;
  v_bal_after  NUMERIC;
  v_pay_id     UUID;
  v_cash_rows  INTEGER;
  v_actor      UUID;
BEGIN
  -- Lấy 1 đơn hàng có chi nhánh + chi nhánh đó có quỹ mặc định
  SELECT o.id, o.branch_id, o.customer_id
    INTO v_order
  FROM public.orders o
  WHERE o.branch_id IS NOT NULL
    AND public.fn_default_cash_fund(o.branch_id) IS NOT NULL
  LIMIT 1;

  IF v_order.id IS NULL THEN
    RAISE NOTICE '⚠️  Bỏ qua test B: chưa có đơn hàng nào gắn chi nhánh có quỹ mặc định.';
    RETURN;
  END IF;

  v_fund_id := public.fn_default_cash_fund(v_order.branch_id);
  SELECT created_by INTO v_actor FROM public.orders WHERE id = v_order.id;
  IF v_actor IS NULL THEN
    SELECT id INTO v_actor FROM public.profiles LIMIT 1;
  END IF;

  SELECT balance INTO v_bal_before FROM public.cash_funds WHERE id = v_fund_id;

  -- Chèn 1 thanh toán tiền mặt 123.000đ
  INSERT INTO public.order_payments (order_id, payment_method, amount, reference_no, created_by)
  VALUES (v_order.id, 'cash', 123000, 'SMOKE-TEST', v_actor)
  RETURNING id INTO v_pay_id;

  -- Phải có đúng 1 phiếu cashbook tự sinh từ thanh toán này
  SELECT COUNT(*) INTO v_cash_rows
  FROM public.cashbook_transactions
  WHERE source_table='order_payments' AND source_id=v_pay_id;

  SELECT balance INTO v_bal_after FROM public.cash_funds WHERE id = v_fund_id;

  IF v_cash_rows <> 1 THEN
    RAISE EXCEPTION '❌ B1: kỳ vọng 1 phiếu cashbook tự sinh, thực tế %', v_cash_rows;
  END IF;
  IF v_bal_after - v_bal_before <> 123000 THEN
    RAISE EXCEPTION '❌ B2: số dư quỹ tăng %, kỳ vọng 123000', v_bal_after - v_bal_before;
  END IF;

  RAISE NOTICE '✅ B. Thanh toán tiền mặt → cashbook tự sinh 1 phiếu + số dư +123.000đ ĐÚNG.';
END;
$$;

ROLLBACK;  -- Hoàn tác mọi thay đổi của phần B — dữ liệu thật không đổi.

-- Kết thúc. Nếu chạy không có EXCEPTION ⇒ S1 hoạt động đúng.
