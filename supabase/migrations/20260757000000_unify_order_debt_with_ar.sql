-- ═══════════════════════════════════════════════════════════════════════════
-- HỢP NHẤT SỐ CÒN NỢ CỦA ĐƠN VỚI SỔ CÁI CÔNG NỢ
-- 2026-08-05
--
-- ── Vấn đề ────────────────────────────────────────────────────────────────
-- `orders.debt_amount` là **cột SINH TỰ ĐỘNG** `(grand_total - paid_amount)`.
-- Không hàm nào trong DB đọc nó — nó chỉ hiện trên màn Đơn hàng. Nghĩa là đòn
-- bẩy duy nhất là `orders.paid_amount`.
--
-- `fn_collect_customer_debt` tất toán `customer_debts` nhưng KHÔNG hề đụng
-- `orders.paid_amount` → đơn vẫn báo còn nợ mãi mãi. Đo prod 05/08:
--
--   Đơn báo còn nợ (orders)  : 589 đơn / 785.067.756 ₫
--   Công nợ thật (AR gắn đơn):            293.761.532 ₫
--   ─────────────────────────────────────────────────────
--   Lệch                     :            491.306.224 ₫
--
--   • 294 đơn / 376.935.046 ₫ — AR ĐÃ TẤT TOÁN HẾT mà đơn vẫn báo nợ
--     → nút "Thu tiền" trên đơn vẫn bấm được ⇒ RỦI RO THU TRÙNG
--   •  24 đơn /  45.369.828 ₫ — lệch một phần
--   •  22 đơn /  69.001.350 ₫ — có nợ mà KHÔNG có dòng AR nào (xử riêng)
--   •   0 đơn                — báo đã trả trong khi AR còn nợ (lệch MỘT CHIỀU,
--     nên việc sửa chỉ xoá nợ ảo, không bao giờ giấu nợ thật)
--
-- ── Vì sao KHÔNG dùng trigger trên customer_debts ─────────────────────────
-- `fn_sales_return_apply_effects` và `fn_cancel_sales_return` ĐÃ tự chỉnh
-- `paid_amount` theo phần AR chúng tất toán (cộng/trừ tương đối). Thêm trigger
-- tuyệt đối sẽ ĐẾM TRÙNG với hai hàm đó. Nên ở đây:
--   • Tách ra hàm dùng chung `fn_sync_order_paid_from_debts()`.
--   • Gọi từ đúng 2 đường đang rò (thu nợ, ghi thanh toán trên đơn).
--   • KHÔNG đụng 2 hàm trả hàng — chúng đang đúng.
--   • Thêm phép kiểm vào giám sát hằng ngày để mọi lệch mới TỰ LA LÀNG.
--
-- ⚠️ `paid_amount` ở hệ này mang nghĩa "TỔNG ĐÃ TẤT TOÁN của đơn" (tiền tại
--    quầy + thu nợ sau + bù trừ hàng trả), KHÔNG phải chỉ tiền thu tại quầy.
--    Đây là ngữ nghĩa `fn_sales_return_apply_effects` đã dùng từ trước.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Hàm đồng bộ dùng chung ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_order_paid_from_debts(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_grand  NUMERIC(15,2);
  v_status order_status;
  v_ar     NUMERIC(15,2);
  v_paid   NUMERIC(15,2);
  v_new    order_payment_status;
  v_has_ar BOOLEAN;
BEGIN
  IF p_order_id IS NULL THEN RETURN; END IF;

  SELECT grand_total, status INTO v_grand, v_status
  FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_status IN ('cancelled', 'draft') THEN RETURN; END IF;

  -- Đơn CHƯA TỪNG có dòng AR → không suy ra được gì, để nguyên.
  -- (Nếu không có guard này thì 22 đơn "có nợ nhưng không có AR" sẽ bị xoá
  --  sạch nợ — tức là giấu mất 69tr phải thu thật.)
  SELECT EXISTS (SELECT 1 FROM public.customer_debts WHERE order_id = p_order_id)
    INTO v_has_ar;
  IF NOT v_has_ar THEN RETURN; END IF;

  -- Còn nợ THẬT của đơn = các dòng nợ dương chưa tất toán.
  -- Bỏ qua dòng âm (`advance_from_customer` khi khách trả dư) — đó là số dư có
  -- của KHÁCH, không phải khoản phải thu của đơn này.
  SELECT COALESCE(SUM(amount), 0)::NUMERIC(15,2) INTO v_ar
  FROM public.customer_debts
  WHERE order_id = p_order_id AND is_settled = false AND amount > 0;

  v_paid := LEAST(GREATEST(COALESCE(v_grand, 0) - v_ar, 0), COALESCE(v_grand, 0));

  v_new := CASE
    WHEN v_ar <= 0.005          THEN 'paid'::order_payment_status
    WHEN v_paid > 0             THEN 'partially_paid'::order_payment_status
    ELSE 'unpaid'::order_payment_status
  END;

  -- Chỉ ghi khi thực sự đổi: mỗi UPDATE orders đều kéo theo trigger audit.
  UPDATE public.orders
  SET paid_amount    = v_paid,
      payment_status = v_new,
      updated_at     = now()
  WHERE id = p_order_id
    AND (ABS(COALESCE(paid_amount, 0) - v_paid) > 0.005
         OR payment_status IS DISTINCT FROM v_new);
END $$;

REVOKE ALL ON FUNCTION public.fn_sync_order_paid_from_debts(uuid) FROM public;


-- ── 2. Thu nợ: sau khi tất toán FIFO thì cập nhật lại các đơn liên quan ──
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_collect_customer_debt'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

CREATE FUNCTION public.fn_collect_customer_debt(
  p_customer_id uuid,
  p_amount      numeric,
  p_method      order_payment_method,
  p_date        date,
  p_reference   text,
  p_notes       text,
  p_branch_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_payment_id UUID;
  v_branch     UUID;
  v_remaining  NUMERIC(15,2);
  v_new_total  NUMERIC(15,2);
  v_exists     BOOLEAN;
  v_orders     UUID[] := '{}';
  r            RECORD;
  o            UUID;
BEGIN
  IF NOT (public.fn_is_active()
          AND (public.fn_is_admin()
               OR public.fn_has_permission('customers.collect_debt'))) THEN
    RAISE EXCEPTION 'Không có quyền thu công nợ khách hàng.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Số tiền thu phải lớn hơn 0.';
  END IF;
  IF p_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RAISE EXCEPTION 'Hình thức thu không hợp lệ (chỉ tiền mặt / chuyển khoản / quẹt thẻ).';
  END IF;
  IF COALESCE(p_date, CURRENT_DATE) > CURRENT_DATE THEN
    RAISE EXCEPTION 'Ngày thu không được ở tương lai.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Khách hàng không tồn tại.';
  END IF;

  -- Nơi thu = tham số nếu có, ngược lại chi nhánh của người đăng nhập (20260754)
  v_branch := p_branch_id;
  IF v_branch IS NULL THEN
    SELECT pr.branch_id INTO v_branch FROM public.profiles pr WHERE pr.id = v_uid;
  END IF;
  IF p_branch_id IS NOT NULL AND NOT public.fn_is_admin() THEN
    IF p_branch_id IS DISTINCT FROM (SELECT pr.branch_id FROM public.profiles pr WHERE pr.id = v_uid) THEN
      RAISE EXCEPTION 'Chỉ quản trị viên được ghi phiếu thu cho chi nhánh khác.';
    END IF;
  END IF;

  INSERT INTO public.debt_payments (
    customer_id, amount, payment_method, payment_date, reference_no, notes,
    recorded_by, branch_id
  ) VALUES (
    p_customer_id, p_amount, p_method, COALESCE(p_date, CURRENT_DATE),
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), '')  , 'Thu công nợ khách hàng'),
    v_uid, v_branch
  )
  RETURNING id INTO v_payment_id;

  -- Phân bổ FIFO. KHÔNG lọc chi nhánh — công nợ là công nợ TỔNG toàn công ty.
  v_remaining := p_amount;
  FOR r IN
    SELECT id, amount, order_id
    FROM public.customer_debts
    WHERE customer_id = p_customer_id AND is_settled = false AND amount > 0
    ORDER BY due_date NULLS LAST, created_at
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF r.order_id IS NOT NULL THEN v_orders := v_orders || r.order_id; END IF;

    IF v_remaining >= r.amount THEN
      UPDATE public.customer_debts SET is_settled = true, settled_at = now() WHERE id = r.id;
      v_remaining := v_remaining - r.amount;
    ELSE
      UPDATE public.customer_debts SET amount = amount - v_remaining WHERE id = r.id;
      v_remaining := 0;
    END IF;
  END LOOP;

  -- ⭐ MỚI: kéo số "còn nợ" của từng đơn vừa được trả về khớp sổ cái.
  -- Thiếu bước này chính là gốc của 491tr nợ ảo trên màn Đơn hàng.
  FOREACH o IN ARRAY v_orders LOOP
    PERFORM public.fn_sync_order_paid_from_debts(o);
  END LOOP;

  IF v_remaining > 0 THEN
    INSERT INTO public.customer_debts (
      customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by
    ) VALUES (
      p_customer_id, NULL, 'advance_from_customer', -v_remaining, NULL, false,
      'Khách trả trước (thu vượt công nợ'
        || COALESCE(' — ' || NULLIF(TRIM(COALESCE(p_reference, '')), ''), '') || ')',
      v_uid
    );
  END IF;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(15,2) INTO v_new_total
  FROM public.customer_debts
  WHERE customer_id = p_customer_id AND is_settled = false;

  RETURN jsonb_build_object(
    'payment_id',      v_payment_id,
    'collected',       p_amount,
    'advance',         v_remaining,
    'branch_id',       v_branch,
    'orders_updated',  COALESCE(array_length(v_orders, 1), 0),
    'new_total_debt',  v_new_total
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_collect_customer_debt(uuid, numeric, order_payment_method, date, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_collect_customer_debt(uuid, numeric, order_payment_method, date, text, text, uuid) TO authenticated;


-- ── 3. Ghi thanh toán TRÊN ĐƠN — đường rò thứ hai ────────────────────────
-- Trước: `OrderDetailPage` tự làm 4 bước ở client — chèn `order_payments`, tự
-- cộng `paid_amount`, và CHỈ tất toán AR khi trả ĐỦ. Trả TỪNG PHẦN thì đơn
-- giảm nợ còn sổ cái đứng yên ⇒ lệch tiếp. Nay gom về một RPC nguyên tử.
CREATE OR REPLACE FUNCTION public.fn_record_order_payment(
  p_order_id  uuid,
  p_amount    numeric,
  p_method    order_payment_method,
  p_reference text DEFAULT NULL,
  p_notes     text DEFAULT NULL,
  p_date      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_grand     NUMERIC(15,2);
  v_paid      NUMERIC(15,2);
  v_status    order_status;
  v_con_no    NUMERIC(15,2);
  v_apply     NUMERIC(15,2);
  v_remaining NUMERIC(15,2);
  v_pay_id    UUID;
  r           RECORD;
BEGIN
  IF NOT (public.fn_is_active()
          AND (public.fn_is_admin()
               OR public.fn_has_permission('orders.record_payment'))) THEN
    RAISE EXCEPTION 'Không có quyền ghi nhận thanh toán đơn hàng.';
  END IF;

  SELECT grand_total, paid_amount, status INTO v_grand, v_paid, v_status
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Đơn hàng không tồn tại.'; END IF;
  IF v_status IN ('cancelled', 'draft') THEN
    RAISE EXCEPTION 'Đơn ở trạng thái % — không ghi nhận thanh toán được.', v_status;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Số tiền thanh toán phải lớn hơn 0.';
  END IF;
  IF p_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RAISE EXCEPTION 'Hình thức thanh toán không hợp lệ.';
  END IF;
  IF COALESCE(p_date, CURRENT_DATE) > CURRENT_DATE THEN
    RAISE EXCEPTION 'Ngày thanh toán không được ở tương lai.';
  END IF;

  v_con_no := GREATEST(COALESCE(v_grand, 0) - COALESCE(v_paid, 0), 0);
  IF v_con_no <= 0.005 THEN
    RAISE EXCEPTION 'Đơn này đã tất toán, không còn khoản nào để thu.';
  END IF;
  IF p_amount > v_con_no + 0.005 THEN
    RAISE EXCEPTION 'Số tiền vượt quá số còn nợ của đơn (còn % ₫).', v_con_no;
  END IF;

  -- 1) Tiền thật vào sổ quỹ (trigger sinh phiếu thu, định tuyến theo đơn)
  INSERT INTO public.order_payments (order_id, payment_method, amount, reference_no, notes, payment_date, created_by)
  VALUES (
    p_order_id, p_method, p_amount,
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Thu tiền theo đơn hàng.'),
    COALESCE(p_date, CURRENT_DATE), v_uid
  )
  RETURNING id INTO v_pay_id;

  -- 2) Trừ dần công nợ CỦA CHÍNH ĐƠN NÀY (cũ nhất trước)
  v_remaining := p_amount;
  FOR r IN
    SELECT id, amount FROM public.customer_debts
    WHERE order_id = p_order_id AND is_settled = false AND amount > 0
    ORDER BY due_date NULLS LAST, created_at
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_remaining >= r.amount THEN
      UPDATE public.customer_debts SET is_settled = true, settled_at = now() WHERE id = r.id;
      v_remaining := v_remaining - r.amount;
    ELSE
      UPDATE public.customer_debts SET amount = amount - v_remaining WHERE id = r.id;
      v_remaining := 0;
    END IF;
  END LOOP;
  v_apply := p_amount - v_remaining;

  -- 3) Đồng bộ đơn theo sổ cái. Đơn CHƯA TỪNG có AR (bán chịu ngoài POS) thì
  --    hàm sync tự bỏ qua → cộng tay để không bỏ sót.
  IF EXISTS (SELECT 1 FROM public.customer_debts WHERE order_id = p_order_id) THEN
    PERFORM public.fn_sync_order_paid_from_debts(p_order_id);
  ELSE
    UPDATE public.orders
    SET paid_amount = LEAST(COALESCE(paid_amount, 0) + p_amount, grand_total),
        payment_status = CASE
          WHEN COALESCE(paid_amount, 0) + p_amount >= grand_total THEN 'paid'::order_payment_status
          WHEN COALESCE(paid_amount, 0) + p_amount > 0            THEN 'partially_paid'::order_payment_status
          ELSE 'unpaid'::order_payment_status END,
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  SELECT grand_total - paid_amount INTO v_con_no FROM public.orders WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'payment_id',   v_pay_id,
    'collected',    p_amount,
    'applied_to_ar', v_apply,
    'remaining',    v_con_no
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_record_order_payment(uuid, numeric, order_payment_method, text, text, date) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_record_order_payment(uuid, numeric, order_payment_method, text, text, date) TO authenticated;


-- ── 4. Backfill: kéo 589 đơn về khớp sổ cái ──────────────────────────────
-- Chỉ đụng đơn CÓ dòng AR. 22 đơn không có AR giữ nguyên (xử lý riêng, cần
-- quyết định nghiệp vụ vì tạo AR mới là làm TĂNG công nợ phải thu).
DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT o.id
    FROM public.orders o
    WHERE o.status NOT IN ('cancelled', 'draft')
      AND EXISTS (SELECT 1 FROM public.customer_debts d WHERE d.order_id = o.id)
  LOOP
    PERFORM public.fn_sync_order_paid_from_debts(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Đã đồng bộ % đơn.', n;
END $$;


-- ── 5. Giám sát: lệch mới phải TỰ LA LÀNG ────────────────────────────────
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

  -- ── MỚI 20260757: đơn báo còn nợ lệch với sổ cái công nợ ──
  -- Đây là thứ đã âm thầm phình tới 491tr và tạo rủi ro THU TRÙNG.
  --
  -- ⚠️ Hai phép kiểm dưới đây ĐẾM TRÊN TOÀN BỘ tập vi phạm rồi mới lấy mẫu 20
  -- dòng. Các phép kiểm cũ phía trên đặt `limit 20` NGAY TRONG tập nguồn nên
  -- `count(*)` của chúng bị chặn ở 20 — tức là báo thiếu khi vi phạm nhiều hơn.
  return query
    with viphan as (
      select o.order_code as ocode,
             (o.grand_total - o.paid_amount) as theo_don,
             coalesce(d.con_no, 0) as theo_ar
      from public.orders o
      join (select order_id, coalesce(sum(amount) filter (where not is_settled and amount > 0), 0) as con_no
            from public.customer_debts where order_id is not null group by order_id) d
        on d.order_id = o.id
      where o.status not in ('cancelled', 'draft')
        and abs((o.grand_total - o.paid_amount) - coalesce(d.con_no, 0)) > 0.5
    )
    select 'order_debt_vs_ar_mismatch'::text, 'critical'::text,
           (select count(*) from viphan),
           coalesce((select jsonb_agg(jsonb_build_object('order_code', ocode,
              'theo_don', theo_don, 'theo_so_cai', theo_ar))
             from (select * from viphan limit 20) s), '[]'::jsonb);

  -- Đơn còn nợ nhưng chưa từng có dòng công nợ ⇒ vô hình với thu hồi & nhắc nợ
  return query
    with viphan as (
      select o.order_code as ocode, o.status::text as st,
             (o.grand_total - o.paid_amount) as con_no
      from public.orders o
      where o.status not in ('cancelled', 'draft')
        and (o.grand_total - o.paid_amount) > 0.5
        and not exists (select 1 from public.customer_debts d where d.order_id = o.id)
    )
    select 'order_debt_without_ar_row'::text, 'warning'::text,
           (select count(*) from viphan),
           coalesce((select jsonb_agg(jsonb_build_object('order_code', ocode, 'status', st, 'con_no', con_no))
             from (select * from viphan order by con_no desc limit 20) s), '[]'::jsonb);

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

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260757000000', 'unify_order_debt_with_ar')
ON CONFLICT (version) DO NOTHING;
