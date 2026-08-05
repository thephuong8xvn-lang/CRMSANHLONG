-- ═══════════════════════════════════════════════════════════════════════════
-- ĐỊNH TUYẾN TIỀN THU NỢ THEO NƠI THU, KHÔNG THEO NHÃN KHÁCH
-- 2026-08-05
--
-- Vấn đề (đo prod 05/08): `fn_cashbook_from_debt_payment` chọn quỹ bằng
-- `customers.branch_id` — nhãn chi nhánh của KHÁCH — trong khi 5 trigger sổ quỹ
-- còn lại đều lấy nơi phát sinh. Hậu quả đo được:
--   • 119 phiếu / 471.289.033 ₫ (91% tiền thu nợ) vào nhầm quỹ chi nhánh.
--   • 59 phiếu tiền mặt / 217.423.178 ₫ do Hoài Ân thu bị gắn vào CA THU NGÂN
--     của Phù Mỹ → chi nhánh kia đóng ca phải đối soát tiền chưa từng cầm.
--   • Nhãn khách đã mất nghĩa: 1913/1954 khách gắn Phù Mỹ, nhưng 2124 đơn /
--     1,5 tỷ bán tại Hoài Ân cho chính nhóm khách đó.
--
-- Quyết định của user (05/08): **nhân viên đã gắn chi nhánh khi đăng nhập nên
-- lấy đó làm nơi thu; KHÔNG cần ô chọn "Thu tại chi nhánh" trên giao diện.**
-- → Vẫn thêm tham số `p_branch_id` (mặc định NULL) để sau này muốn gắn ô chọn
--   thì chỉ phải sửa FE, không phải đụng lại DB.
--
-- ⚠️ KHÔNG SỬA LỊCH SỬ. User đã chốt ở [[model-multi-branch-business]]: "Hoài Ân
--    nhập liệu hộ → tiền thu thật ở Phù Mỹ, SỔ QUỸ ĐANG ĐÚNG". Vì vậy 146 phiếu
--    cũ được backfill `branch_id` = chi nhánh của QUỸ/TK đã nhận tiền (tức giữ
--    nguyên ý nghĩa hiện tại), KHÔNG phải chi nhánh người ghi.
--
-- ⚠️ Đánh đổi khi bỏ ô chọn: từ nay ai đăng nhập ghi phiếu thì tiền vào quỹ chi
--    nhánh của người đó. Nếu một chi nhánh còn "nhập liệu hộ" cho nơi khác thì
--    phải bật lại ô chọn (chỉ cần truyền p_branch_id).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Cột nơi thu ───────────────────────────────────────────────────────
ALTER TABLE public.debt_payments
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);

COMMENT ON COLUMN public.debt_payments.branch_id IS
  'Chi nhánh THỰC SỰ nhận tiền. Mặc định = chi nhánh của người ghi phiếu (profiles.branch_id). Quyết định quỹ/TK và ca thu ngân nào ghi nhận khoản thu. KHÔNG dùng để giới hạn quyền — công nợ vẫn là công nợ tổng toàn công ty.';

-- ── 2. Backfill: lấy đúng chi nhánh của quỹ/TK đã nhận tiền ──────────────
UPDATE public.debt_payments dp
SET branch_id = sub.branch_id
FROM (
  SELECT t.source_id AS dp_id,
         COALESCE(cf.branch_id, ba.branch_id) AS branch_id
  FROM public.cashbook_transactions t
  LEFT JOIN public.cash_funds    cf ON cf.id = t.cash_fund_id
  LEFT JOIN public.bank_accounts ba ON ba.id = t.bank_account_id
  WHERE t.source_table = 'debt_payments'
) sub
WHERE dp.id = sub.dp_id
  AND dp.branch_id IS NULL
  AND sub.branch_id IS NOT NULL;

-- Phiếu không sinh ra chứng từ sổ quỹ (hình thức không phải tiền thật) →
-- lấy chi nhánh của người ghi để không bỏ trống.
UPDATE public.debt_payments dp
SET branch_id = pr.branch_id
FROM public.profiles pr
WHERE pr.id = dp.recorded_by
  AND dp.branch_id IS NULL
  AND pr.branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_debt_payments_branch
  ON public.debt_payments (branch_id, payment_date DESC);

-- ── 3. Tự điền nơi thu cho MỌI đường ghi (kể cả insert thẳng) ────────────
CREATE OR REPLACE FUNCTION public.fn_debt_payment_fill_branch()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT pr.branch_id INTO NEW.branch_id
    FROM public.profiles pr
    WHERE pr.id = COALESCE(NEW.recorded_by, auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_debt_payment_fill_branch ON public.debt_payments;
CREATE TRIGGER trg_debt_payment_fill_branch
  BEFORE INSERT ON public.debt_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_debt_payment_fill_branch();

-- ── 4. Trigger sổ quỹ: định tuyến theo NƠI THU ──────────────────────────
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

  -- Thứ tự ưu tiên nơi thu:
  --   1) branch_id trên phiếu (RPC truyền vào, hoặc trigger BEFORE tự điền
  --      từ chi nhánh của người ghi)
  --   2) chi nhánh của người ghi phiếu
  --   3) nhãn chi nhánh của khách — CHỈ còn là lưới an toàn cuối cùng cho
  --      trường hợp người ghi không gắn chi nhánh nào (vd tài khoản admin).
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

  -- Chi nhánh nơi thu chưa cấu hình quỹ/TK phù hợp → lùi về nhãn khách thay vì
  -- bỏ ghi sổ quỹ. (Mất tiền im lặng là lỗi nặng hơn ghi hơi lệch chi nhánh;
  -- bịt hẳn nhánh im lặng là việc riêng, chưa làm ở migration này.)
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

-- ── 5. RPC thu nợ: nhận thêm p_branch_id (tùy chọn) ─────────────────────
-- Gỡ theo TÊN để apply lần 2 không vỡ vì đổi chữ ký.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
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
  p_branch_id   uuid DEFAULT NULL   -- NULL = lấy chi nhánh của người đăng nhập
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
  r            RECORD;
BEGIN
  -- 1. Phân quyền THEO PERMISSION. admin/ceo bypass qua fn_is_admin.
  IF NOT (public.fn_is_active()
          AND (public.fn_is_admin()
               OR public.fn_has_permission('customers.collect_debt'))) THEN
    RAISE EXCEPTION 'Không có quyền thu công nợ khách hàng.';
  END IF;

  -- 2. Validate
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

  -- 3. Nơi thu = tham số nếu có, ngược lại chi nhánh của người đăng nhập.
  --    (Nhân viên đã gắn chi nhánh khi đăng nhập — user chốt 05/08.)
  v_branch := p_branch_id;
  IF v_branch IS NULL THEN
    SELECT pr.branch_id INTO v_branch FROM public.profiles pr WHERE pr.id = v_uid;
  END IF;

  -- Chỉ cho chỉ định chi nhánh khác nếu là admin — tránh nhân viên đẩy tiền
  -- sang quỹ chi nhánh khác.
  IF p_branch_id IS NOT NULL AND NOT public.fn_is_admin() THEN
    IF p_branch_id IS DISTINCT FROM (SELECT pr.branch_id FROM public.profiles pr WHERE pr.id = v_uid) THEN
      RAISE EXCEPTION 'Chỉ quản trị viên được ghi phiếu thu cho chi nhánh khác.';
    END IF;
  END IF;

  -- 4. Ghi tiền vào sổ quỹ qua debt_payments (trigger sinh phiếu thu THU-NO)
  INSERT INTO public.debt_payments (
    customer_id, amount, payment_method, payment_date, reference_no, notes,
    recorded_by, branch_id
  ) VALUES (
    p_customer_id, p_amount, p_method, COALESCE(p_date, CURRENT_DATE),
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Thu công nợ khách hàng'),
    v_uid, v_branch
  )
  RETURNING id INTO v_payment_id;

  -- 5. Phân bổ FIFO: settle các dòng nợ dương (cũ nhất / đến hạn trước → trước).
  --    KHÔNG lọc theo chi nhánh — công nợ là công nợ TỔNG toàn công ty, khách
  --    nợ ở chi nhánh nào cũng trả được ở chi nhánh khác.
  v_remaining := p_amount;
  FOR r IN
    SELECT id, amount
    FROM public.customer_debts
    WHERE customer_id = p_customer_id
      AND is_settled = false
      AND amount > 0
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

  -- 6. Thu vượt công nợ → ghi nhận "Khách trả trước" (amount âm)
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

  -- 7. Tổng nợ còn lại sau khi thu
  SELECT COALESCE(SUM(amount), 0)::NUMERIC(15,2) INTO v_new_total
  FROM public.customer_debts
  WHERE customer_id = p_customer_id AND is_settled = false;

  RETURN jsonb_build_object(
    'payment_id',     v_payment_id,
    'collected',      p_amount,
    'advance',        v_remaining,
    'branch_id',      v_branch,
    'new_total_debt', v_new_total
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_collect_customer_debt(uuid, numeric, order_payment_method, date, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_collect_customer_debt(uuid, numeric, order_payment_method, date, text, text, uuid) TO authenticated;

-- ── 6. Sổ chi tiết: hiển thị NƠI THU thật thay vì chi nhánh người ghi ───
CREATE OR REPLACE FUNCTION public.fn_customer_debt_detail(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  IF NOT public.fn_can_view_debts() THEN
    RAISE EXCEPTION 'Không có quyền xem công nợ.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'lines', (SELECT COALESCE(jsonb_agg(x ORDER BY x.uu_tien, x.han_tra NULLS LAST, x.ghi_ngay), '[]'::jsonb) FROM (
        SELECT d.id,
               d.amount                                                     AS so_tien,
               d.due_date                                                   AS han_tra,
               (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date         AS ghi_ngay,
               CASE WHEN d.due_date IS NOT NULL AND d.due_date < v_today
                    THEN v_today - d.due_date ELSE NULL END                 AS so_ngay_qua_han,
               v_today - (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS tuoi_ngay,
               CASE
                 WHEN d.amount < 0                THEN 'Khách trả trước'
                 WHEN d.order_id IS NULL          THEN 'Điều chỉnh tay'
                 ELSE 'Nợ đơn hàng' END                                     AS loai,
               o.order_code                                                 AS ma_don,
               d.order_id,
               COALESCE(d.notes, '')                                        AS ghi_chu,
               COALESCE(pr.full_name, '—')                                  AS nguoi_lap,
               CASE WHEN d.amount < 0 THEN 3
                    WHEN d.due_date IS NULL THEN 2 ELSE 1 END               AS uu_tien
        FROM public.customer_debts d
        LEFT JOIN public.orders   o  ON o.id  = d.order_id
        LEFT JOIN public.profiles pr ON pr.id = d.created_by
        WHERE d.customer_id = p_customer_id AND d.is_settled = false
      ) x),

    'payments', (SELECT COALESCE(jsonb_agg(x ORDER BY x.ngay_thu DESC), '[]'::jsonb) FROM (
        SELECT dp.id,
               dp.amount                        AS so_tien,
               dp.payment_date                  AS ngay_thu,
               dp.payment_method::text          AS hinh_thuc,
               COALESCE(dp.reference_no, '')    AS tham_chieu,
               COALESCE(dp.notes, '')           AS ghi_chu,
               COALESCE(pr.full_name, '—')      AS nguoi_thu,
               -- Nơi THU tiền (quỹ nào nhận), không phải chi nhánh người ghi
               COALESCE(bt.name, bp.name, '—')  AS chi_nhanh
        FROM public.debt_payments dp
        LEFT JOIN public.profiles pr ON pr.id = dp.recorded_by
        LEFT JOIN public.branches bt ON bt.id = dp.branch_id
        LEFT JOIN public.branches bp ON bp.id = pr.branch_id
        WHERE dp.customer_id = p_customer_id
        ORDER BY dp.payment_date DESC
        LIMIT 20
      ) x),

    'settled_recent', (SELECT COALESCE(jsonb_agg(x ORDER BY x.tat_toan DESC), '[]'::jsonb) FROM (
        SELECT d.amount AS so_tien, d.settled_at AS tat_toan, o.order_code AS ma_don
        FROM public.customer_debts d
        LEFT JOIN public.orders o ON o.id = d.order_id
        WHERE d.customer_id = p_customer_id AND d.is_settled = true
        ORDER BY d.settled_at DESC NULLS LAST
        LIMIT 10
      ) x)
  );
END $$;

REVOKE ALL  ON FUNCTION public.fn_customer_debt_detail(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_customer_debt_detail(uuid) TO authenticated;

-- ── Tracking ─────────────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260754000000', 'debt_payment_branch_routing')
ON CONFLICT (version) DO NOTHING;
