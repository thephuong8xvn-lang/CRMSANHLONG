-- ═══════════════════════════════════════════════════════════════════════════
-- BỊT "MẤT TIỀN IM LẶNG" KHI GHI SỔ QUỸ
-- 2026-08-05
--
-- Vấn đề: cả 3 trigger sổ quỹ (đơn hàng / thu nợ / thanh toán NCC) đều có nhánh
--   IF v_cash_fund IS NULL AND v_bank_acct IS NULL THEN RETURN NEW;
-- → tiền đã thu nhưng KHÔNG ghi sổ quỹ, KHÔNG báo lỗi, KHÔNG log. Không ai biết.
--
-- ĐÃ XẢY RA THẬT: đơn `DH-2026-02504`, 730.000 ₫ chuyển khoản 02/08/2026 tại
-- Chi Nhánh Mỹ Thành — chi nhánh này có quỹ tiền mặt nhưng KHÔNG có tài khoản
-- ngân hàng → `fn_default_bank_account` trả NULL → phiếu thu bốc hơi. Đây đúng
-- bằng khoản lệch 730.000 ₫ giữa `order_payments` và sổ quỹ.
--
-- Quyết định của user (05/08):
--   • **Tài khoản ngân hàng chỉ dùng tài khoản cá nhân của chủ (Đặng Thế
--     Phương), KHÔNG mở thêm cho chi nhánh nào.** → chi nhánh không có tài
--     khoản riêng thì tiền chuyển khoản rơi về **Techcombank 0367383077**
--     (đang gán CN Phù Mỹ) làm mặc định toàn công ty.
--   • **Bù lại khoản 730.000 ₫** đã mất vào đúng tài khoản đó.
--
-- Nguyên tắc xử lý khi vẫn không định tuyến được: **KHÔNG chặn bán hàng**
-- (chặn POS còn tệ hơn), mà ghi `app_error_logs` + thêm 2 phép kiểm vào
-- `fn_integrity_check()` để cron `monitor-integrity-daily` bắn Telegram.
-- Im lặng đổi thành ồn ào — đó mới là điều cần.
--
-- ⚠️ TIỀN MẶT KHÔNG CÓ ĐƯỜNG LÙI. Quỹ tiền mặt là két sắt vật lý của từng chi
--    nhánh, không thể "rơi về" quỹ chi nhánh khác. Chỉ chuyển khoản mới có
--    tài khoản mặc định toàn công ty.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tài khoản ngân hàng mặc định TOÀN CÔNG TY ─────────────────────────
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS is_company_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bank_accounts.is_company_default IS
  'Tài khoản nhận tiền chuyển khoản khi chi nhánh phát sinh KHÔNG có tài khoản riêng. Chỉ được có tối đa 1 tài khoản bật cờ này (unique index). Khác is_default_bank — cờ đó là mặc định TRONG một chi nhánh.';

-- Tối đa 1 tài khoản mặc định toàn công ty.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_company_default
  ON public.bank_accounts ((true)) WHERE is_company_default;

-- User chốt: Techcombank 0367383077 (Đặng Thế Phương).
UPDATE public.bank_accounts SET is_company_default = false WHERE is_company_default;
UPDATE public.bank_accounts
   SET is_company_default = true, updated_at = now()
 WHERE account_no = '0367383077' AND is_active;

-- ── 2. fn_default_bank_account: lùi về tài khoản mặc định công ty ────────
CREATE OR REPLACE FUNCTION public.fn_default_bank_account(p_branch_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    -- 1) Tài khoản của chính chi nhánh phát sinh
    (SELECT id FROM public.bank_accounts
      WHERE branch_id = p_branch_id AND is_active
      ORDER BY is_default_bank DESC, created_at ASC, id ASC
      LIMIT 1),
    -- 2) Tài khoản mặc định toàn công ty (chi nhánh chưa có TK riêng)
    (SELECT id FROM public.bank_accounts
      WHERE is_company_default AND is_active
      LIMIT 1),
    -- 3) Lưới cuối: tài khoản hoạt động duy nhất / cũ nhất
    (SELECT id FROM public.bank_accounts
      WHERE is_active ORDER BY created_at ASC, id ASC
      LIMIT 1)
  );
$$;

-- ── 3. Helper: ghi nhật ký khi không định tuyến được (thay vì im lặng) ───
CREATE OR REPLACE FUNCTION public.fn_log_cashbook_routing_failure(
  p_source   text,
  p_source_id uuid,
  p_amount   numeric,
  p_method   text,
  p_branch   uuid,
  p_customer uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.app_error_logs (level, source, message, context, fingerprint)
  VALUES (
    'error', 'cashbook',
    'Không ghi được phiếu sổ quỹ: chi nhánh chưa có quỹ tiền mặt / tài khoản ngân hàng phù hợp. '
      || 'Tiền ĐÃ THU nhưng KHÔNG có trong sổ quỹ — cần tạo phiếu tay và cấu hình lại.',
    jsonb_build_object(
      'source_table', p_source, 'source_id', p_source_id,
      'amount', p_amount, 'payment_method', p_method,
      'branch_id', p_branch, 'customer_id', p_customer),
    'cashbook_routing_failed'
  );
END $$;

-- ── 4. Ba trigger sổ quỹ: log thay vì im lặng ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cashbook_from_order_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_branch_id   UUID;
  v_customer_id UUID;
  v_cash_fund   UUID;
  v_bank_acct   UUID;
  v_session     UUID;
  v_cat         UUID;
BEGIN
  -- Chỉ ghi nhận tiền THẬT: tiền mặt / chuyển khoản / quẹt thẻ.
  IF NEW.payment_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RETURN NEW;
  END IF;

  SELECT o.branch_id, o.customer_id
    INTO v_branch_id, v_customer_id
  FROM public.orders o WHERE o.id = NEW.order_id;

  IF NEW.payment_method = 'cash' THEN
    v_cash_fund := public.fn_default_cash_fund(v_branch_id);
    SELECT id INTO v_session FROM public.cashier_sessions
      WHERE cash_fund_id = v_cash_fund AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
  ELSE
    v_bank_acct := public.fn_default_bank_account(v_branch_id);
  END IF;

  -- Không định tuyến được → KHÔNG chặn bán hàng, nhưng phải để lại dấu vết.
  IF v_cash_fund IS NULL AND v_bank_acct IS NULL THEN
    PERFORM public.fn_log_cashbook_routing_failure(
      'order_payments', NEW.id, NEW.amount, NEW.payment_method::text,
      v_branch_id, v_customer_id);
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
END $$;


CREATE OR REPLACE FUNCTION public.fn_cashbook_from_debt_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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

  -- Nơi thu: branch_id trên phiếu → chi nhánh người ghi → nhãn khách (20260754)
  v_branch_id := NEW.branch_id;

  IF v_branch_id IS NULL THEN
    SELECT pr.branch_id INTO v_branch_id
    FROM public.profiles pr WHERE pr.id = NEW.recorded_by;
  END IF;

  IF v_branch_id IS NULL THEN
    SELECT c.branch_id INTO v_branch_id
    FROM public.customers c WHERE c.id = NEW.customer_id;
  END IF;

  IF NEW.payment_method = 'cash' THEN
    v_cash_fund := public.fn_default_cash_fund(v_branch_id);
    SELECT id INTO v_session FROM public.cashier_sessions
      WHERE cash_fund_id = v_cash_fund AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
  ELSE
    v_bank_acct := public.fn_default_bank_account(v_branch_id);
  END IF;

  -- Chi nhánh nơi thu chưa có quỹ tiền mặt → lùi về nhãn khách (chỉ tiền mặt;
  -- chuyển khoản đã có tài khoản mặc định công ty nên không cần).
  IF v_cash_fund IS NULL AND v_bank_acct IS NULL THEN
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
  END IF;

  IF v_cash_fund IS NULL AND v_bank_acct IS NULL THEN
    PERFORM public.fn_log_cashbook_routing_failure(
      'debt_payments', NEW.id, NEW.amount, NEW.payment_method::text,
      NEW.branch_id, NEW.customer_id);
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
END $$;


CREATE OR REPLACE FUNCTION public.fn_cashbook_from_supplier_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_branch_id UUID;
  v_cash_fund UUID;
  v_bank_acct UUID;
  v_session   UUID;
  v_cat       UUID;
BEGIN
  -- Giảm công nợ phải trả NCC (luôn chạy, kể cả khi không ghi được sổ quỹ)
  UPDATE public.suppliers
  SET current_debt_payable = current_debt_payable - NEW.amount,
      updated_at = now()
  WHERE id = NEW.supplier_id;

  IF NEW.payment_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RETURN NEW;
  END IF;

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
    PERFORM public.fn_log_cashbook_routing_failure(
      'supplier_payments', NEW.id, NEW.amount, NEW.payment_method::text,
      v_branch_id, NULL);
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
END $$;

-- ── 5. Bù khoản 730.000 ₫ đã mất (DH-2026-02504) ────────────────────────
-- Sinh lại đúng phiếu mà trigger lẽ ra phải tạo hôm 02/08, vào tài khoản mặc
-- định công ty. Idempotent nhờ ON CONFLICT (source_table, source_id).
INSERT INTO public.cashbook_transactions (
  flow_type, status, cash_fund_id, bank_account_id, session_id, amount,
  transaction_date, customer_id, order_id, expense_category_id,
  description, reference_no, created_by, approved_by, approved_at,
  source_table, source_id
)
SELECT
  'inflow', 'approved', NULL,
  (SELECT id FROM public.bank_accounts WHERE is_company_default AND is_active LIMIT 1),
  NULL, op.amount, op.payment_date, o.customer_id, o.id,
  (SELECT id FROM public.expense_categories WHERE code = 'THU-DON-HANG' LIMIT 1),
  'Thu tiền bán hàng (bù phiếu thiếu — chi nhánh chưa có tài khoản ngân hàng)',
  op.reference_no, op.created_by, op.created_by, now(),
  'order_payments', op.id
FROM public.order_payments op
JOIN public.orders o ON o.id = op.order_id
WHERE op.payment_method IN ('cash', 'bank_transfer', 'card_pos')
  AND NOT EXISTS (
    SELECT 1 FROM public.cashbook_transactions t
    WHERE t.source_table = 'order_payments' AND t.source_id = op.id)
ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

-- Tương tự cho thu nợ (hiện 0 dòng, để phòng)
INSERT INTO public.cashbook_transactions (
  flow_type, status, cash_fund_id, bank_account_id, session_id, amount,
  transaction_date, customer_id, expense_category_id,
  description, reference_no, created_by, approved_by, approved_at,
  source_table, source_id
)
SELECT
  'inflow', 'approved', NULL,
  (SELECT id FROM public.bank_accounts WHERE is_company_default AND is_active LIMIT 1),
  NULL, dp.amount, dp.payment_date, dp.customer_id,
  (SELECT id FROM public.expense_categories WHERE code = 'THU-NO' LIMIT 1),
  'Thu công nợ khách hàng (bù phiếu thiếu — chi nhánh chưa có tài khoản ngân hàng)',
  dp.reference_no, dp.recorded_by, dp.recorded_by, now(),
  'debt_payments', dp.id
FROM public.debt_payments dp
WHERE dp.payment_method IN ('cash', 'bank_transfer', 'card_pos')
  AND NOT EXISTS (
    SELECT 1 FROM public.cashbook_transactions t
    WHERE t.source_table = 'debt_payments' AND t.source_id = dp.id)
ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

-- ── 6. Thêm 2 phép kiểm vào giám sát hằng ngày ──────────────────────────
-- Cron `monitor-integrity-daily` gọi fn_monitor_tick() → bắn Telegram nếu có
-- vi phạm critical. Từ nay tiền thu mà thiếu phiếu sổ quỹ sẽ tự la làng.
CREATE OR REPLACE FUNCTION public.fn_integrity_check()
  RETURNS TABLE(check_name text, severity text, violations bigint, sample jsonb)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  return query select 'neg_stock'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('lot_id', id, 'qoh', quantity_on_hand)
      order by quantity_on_hand) filter (where true), '[]'::jsonb)
    from (select id, quantity_on_hand from public.stock_lots
          where quantity_on_hand < 0 limit 20) t;

  return query select 'reserved_gt_onhand'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('lot_id', id, 'qoh', quantity_on_hand, 'reserved', quantity_reserved)) , '[]'::jsonb)
    from (select id, quantity_on_hand, quantity_reserved from public.stock_lots
          where quantity_reserved > quantity_on_hand limit 20) t;

  return query select 'orphan_wh_lot'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('lot_id', id, 'warehouse_id', warehouse_id)), '[]'::jsonb)
    from (select sl.id, sl.warehouse_id from public.stock_lots sl
          where sl.quantity_on_hand > 0
            and not exists (select 1 from public.warehouses w where w.id = sl.warehouse_id) limit 20) t;

  return query select 'vat_pending_issued_no_issuance'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'order_id', order_id)), '[]'::jsonb)
    from (select id, order_id from public.vat_pending_sales
          where status = 'issued' and issuance_id is null limit 20) t;

  return query select 'vat_pending_pending_with_issuance'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'issuance_id', issuance_id)), '[]'::jsonb)
    from (select id, issuance_id from public.vat_pending_sales
          where status = 'pending' and issuance_id is not null limit 20) t;

  return query select 'return_completed_no_movement'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('return_id', id, 'return_code', return_code)), '[]'::jsonb)
    from (select sr.id, sr.return_code from public.sales_returns sr
          where sr.status = 'completed'
            and not exists (select 1 from public.stock_movements m
                            where m.reference_type = 'sales_return' and m.reference_id = sr.id) limit 20) t;

  -- ── MỚI 20260755: tiền THẬT đã thu nhưng không có phiếu sổ quỹ ──
  return query select 'order_payment_no_cashbook'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('payment_id', id, 'amount', amount,
      'method', method, 'date', pdate)), '[]'::jsonb)
    from (select op.id, op.amount, op.payment_method::text as method, op.payment_date as pdate
          from public.order_payments op
          where op.payment_method in ('cash','bank_transfer','card_pos')
            and not exists (select 1 from public.cashbook_transactions t
                            where t.source_table = 'order_payments' and t.source_id = op.id)
          limit 20) t;

  return query select 'debt_payment_no_cashbook'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('payment_id', id, 'amount', amount,
      'method', method, 'date', pdate)), '[]'::jsonb)
    from (select dp.id, dp.amount, dp.payment_method::text as method, dp.payment_date as pdate
          from public.debt_payments dp
          where dp.payment_method in ('cash','bank_transfer','card_pos')
            and not exists (select 1 from public.cashbook_transactions t
                            where t.source_table = 'debt_payments' and t.source_id = dp.id)
          limit 20) t;

  -- Chi nhánh đang có khách ĐANG HOẠT ĐỘNG nhưng chưa cấu hình quỹ tiền mặt.
  -- (Chuyển khoản đã có tài khoản mặc định công ty nên không cần kiểm.)
  -- Lọc `is_active` để bản ghi mẫu cũ không làm cảnh báo kêu vĩnh viễn —
  -- cảnh báo lúc nào cũng đỏ thì chẳng ai còn nhìn.
  return query select 'branch_no_cash_fund'::text, 'warning'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('branch', bname, 'customers', ccount)), '[]'::jsonb)
    from (select b.name as bname, count(c.id) as ccount
          from public.branches b
          join public.customers c on c.branch_id = b.id
          where coalesce(c.is_active, true)
            and c.merged_into_id is null
            and not exists (select 1 from public.cash_funds f
                            where f.branch_id = b.id and f.is_active)
          group by b.id, b.name limit 20) t;

  return query select 'receipt_verified_stuck_7d'::text, 'warning'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'receipt_code', receipt_code, 'created_at', created_at)), '[]'::jsonb)
    from (select id, receipt_code, created_at from public.goods_receipts
          where status = 'verified' and created_at < now() - interval '7 days' limit 20) t;
end;
$$;

-- ── Tracking ─────────────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260755000000', 'cashbook_routing_no_silent_loss')
ON CONFLICT (version) DO NOTHING;
