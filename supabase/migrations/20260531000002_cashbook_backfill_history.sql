-- ============================================================
-- AUDIT-2026-05-30 — Sprint S1.1 (BACKFILL — chạy MỘT LẦN, có chủ đích)
-- File: 20260531000002_cashbook_backfill_history.sql
--
-- ⚠️⚠️ CẢNH BÁO QUAN TRỌNG — ĐỌC KỸ TRƯỚC KHI CHẠY ⚠️⚠️
--   Script này tạo phiếu sổ quỹ 'approved' cho TẤT CẢ thanh toán đơn hàng,
--   thu công nợ, và hoàn tiền trả hàng trong QUÁ KHỨ chưa có phiếu tương ứng.
--   Vì trigger trg_cashbook_update_balance (AFTER INSERT) sẽ chạy, số dư
--   cash_funds.balance / bank_accounts.balance SẼ ĐƯỢC CỘNG/TRỪ tương ứng.
--
--   → CHỈ chạy nếu số dư quỹ hiện tại CHƯA phản ánh các giao dịch POS/thu nợ.
--   → Nếu đã từng đối soát quỹ thủ công, cân nhắc điều chỉnh số dư mở trước.
--   → An toàn chạy lại nhiều lần: idempotent qua chỉ mục (source_table, source_id).
--   → Khuyến nghị: chạy trên staging, đối chiếu SUM(order_payments tiền mặt)
--     với chênh lệch cash_funds.balance trước khi chạy production.
--
--   Phụ thuộc: 20260531000000 + 20260531000001 đã chạy.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. BACKFILL THU TIỀN BÁN HÀNG (order_payments)
-- ─────────────────────────────────────────────────────────────
WITH cand AS (
  SELECT
    op.id          AS pay_id,
    op.amount      AS amount,
    op.payment_date,
    op.reference_no,
    op.created_by,
    op.order_id,
    o.customer_id,
    CASE WHEN op.payment_method = 'cash'
         THEN public.fn_default_cash_fund(o.branch_id) END AS cash_fund,
    CASE WHEN op.payment_method IN ('bank_transfer', 'card_pos')
         THEN public.fn_default_bank_account(o.branch_id) END AS bank_acct
  FROM public.order_payments op
  JOIN public.orders o ON o.id = op.order_id
  WHERE op.payment_method IN ('cash', 'bank_transfer', 'card_pos')
)
INSERT INTO public.cashbook_transactions (
  flow_type, status, cash_fund_id, bank_account_id, amount,
  transaction_date, customer_id, order_id, expense_category_id,
  description, reference_no, created_by, approved_by, approved_at,
  source_table, source_id
)
SELECT
  'inflow', 'approved', c.cash_fund, c.bank_acct, c.amount,
  c.payment_date, c.customer_id, c.order_id,
  (SELECT id FROM public.expense_categories WHERE code = 'THU-DON-HANG' LIMIT 1),
  '[BACKFILL] Thu tiền bán hàng (đồng bộ dữ liệu cũ)', c.reference_no,
  c.created_by, c.created_by, now(),
  'order_payments', c.pay_id
FROM cand c
WHERE c.cash_fund IS NOT NULL OR c.bank_acct IS NOT NULL
ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. BACKFILL THU CÔNG NỢ (debt_payments)
-- ─────────────────────────────────────────────────────────────
WITH cand AS (
  SELECT
    dp.id          AS pay_id,
    dp.amount      AS amount,
    dp.payment_date,
    dp.reference_no,
    dp.recorded_by,
    dp.customer_id,
    CASE WHEN dp.payment_method = 'cash'
         THEN public.fn_default_cash_fund(cu.branch_id) END AS cash_fund,
    CASE WHEN dp.payment_method IN ('bank_transfer', 'card_pos')
         THEN public.fn_default_bank_account(cu.branch_id) END AS bank_acct
  FROM public.debt_payments dp
  JOIN public.customers cu ON cu.id = dp.customer_id
  WHERE dp.payment_method IN ('cash', 'bank_transfer', 'card_pos')
)
INSERT INTO public.cashbook_transactions (
  flow_type, status, cash_fund_id, bank_account_id, amount,
  transaction_date, customer_id, expense_category_id,
  description, reference_no, created_by, approved_by, approved_at,
  source_table, source_id
)
SELECT
  'inflow', 'approved', c.cash_fund, c.bank_acct, c.amount,
  c.payment_date, c.customer_id,
  (SELECT id FROM public.expense_categories WHERE code = 'THU-NO' LIMIT 1),
  '[BACKFILL] Thu công nợ khách hàng (đồng bộ dữ liệu cũ)', c.reference_no,
  c.recorded_by, c.recorded_by, now(),
  'debt_payments', c.pay_id
FROM cand c
WHERE c.cash_fund IS NOT NULL OR c.bank_acct IS NOT NULL
ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3. BACKFILL HOÀN TIỀN TRẢ HÀNG (sales_returns đã completed)
-- ─────────────────────────────────────────────────────────────
WITH cand AS (
  SELECT
    sr.id          AS ret_id,
    sr.total_amount,
    sr.return_code,
    COALESCE(sr.processed_by, sr.created_by) AS actor,
    sr.order_id,
    o.customer_id,
    CASE WHEN sr.refund_method = 'cash'
         THEN public.fn_default_cash_fund(o.branch_id) END AS cash_fund,
    CASE WHEN sr.refund_method = 'bank_transfer'
         THEN public.fn_default_bank_account(o.branch_id) END AS bank_acct
  FROM public.sales_returns sr
  JOIN public.orders o ON o.id = sr.order_id
  WHERE sr.status = 'completed'
    AND sr.refund_method IN ('cash', 'bank_transfer')
    AND COALESCE(sr.total_amount, 0) > 0
)
INSERT INTO public.cashbook_transactions (
  flow_type, status, cash_fund_id, bank_account_id, amount,
  transaction_date, customer_id, order_id, expense_category_id,
  description, reference_no, created_by, approved_by, approved_at,
  source_table, source_id
)
SELECT
  'outflow', 'approved', c.cash_fund, c.bank_acct, c.total_amount,
  CURRENT_DATE, c.customer_id, c.order_id,
  (SELECT id FROM public.expense_categories WHERE code = 'CHI-HOANTIEN' LIMIT 1),
  '[BACKFILL] Hoàn tiền trả hàng ' || COALESCE(c.return_code, ''), c.return_code,
  c.actor, c.actor, now(),
  'sales_returns', c.ret_id
FROM cand c
WHERE c.cash_fund IS NOT NULL OR c.bank_acct IS NOT NULL
ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. BÁO CÁO KẾT QUẢ
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.cashbook_transactions
  WHERE description LIKE '[BACKFILL]%';
  RAISE NOTICE '✅ Tổng số phiếu sổ quỹ đã backfill (lũy kế): %', v_count;
END;
$$;
