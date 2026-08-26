-- ═══════════════════════════════════════════════════════════════════════════
-- VÁ NỢ ẢO DO PHIẾU TRẢ HÀNG + KHÔI PHỤC SỐ DƯ QUỸ / TÀI KHOẢN
-- 2026-08-26
--
-- ── PHẦN 1. Vì sao đơn DH-2026-02760 báo còn nợ 720 dong mà sổ cái đã sạch ──
-- `fn_sales_return_apply_effects` mục 3b cấn trừ công nợ theo FIFO trên TOÀN
-- BỘ dòng nợ chưa tất toán của KHÁCH — không chỉ của đơn gắn với phiếu trả.
-- Nhưng biến `v_order_settled` chỉ cộng khi `r.is_this_order`, và `v_paid_delta`
-- chỉ nâng `paid_amount` cho đúng `v_sr.order_id`.
--
-- ⇒ Mọi đơn KHÁC bị tất toán trong sổ cái đều KHÔNG được nâng `paid_amount`.
--   `orders.debt_amount` là cột SINH TỰ ĐỘNG (`grand_total - paid_amount`) nên
--   nó vẫn báo nợ vĩnh viễn. Đây chính là dạng "2 sổ nợ lệch nhau" mà
--   `20260757` đã dọn 491tr — lần này rò rỉ qua đường trả hàng.
--
-- Bằng chứng: phiếu `TH-2026-00025` (40.000 dong, credit_note) tất toán 3 dòng
-- nợ thuộc 3 đơn khác nhau, nhưng `order_paid_delta` chỉ ghi 430 dong.
--   DH-2026-02583  430 dong  → là đơn của phiếu    → paid_amount ĐÃ nâng ✓
--   DH-2026-02760  720 dong  → đơn khác            → paid_amount KHÔNG nâng ✗
--   DH-2026-03099  cấn một phần                    → đơn khác             ✗
--
-- Cách vá: gom `order_id` trong vòng FIFO rồi gọi `fn_sync_order_paid_from_debts`
-- cho các đơn khác — y hệt `fn_collect_customer_debt` đã làm từ `20260757`.
-- KHÔNG đụng vào `v_paid_delta` để `sales_returns.order_paid_delta` giữ nguyên
-- ý nghĩa cũ (phần cấn trừ cho chính đơn đó).
--
-- 🔑 Vá bằng cách đọc `pg_get_functiondef` của bản ĐANG CHẠY rồi thay 4 đoạn,
--    thay vì chép lại cả hàm 230 dòng. Không tìm thấy đoạn nào thì RAISE.
--
-- ── PHẦN 2. Số dư quỹ / tài khoản lệch với chính sổ phiếu của nó ────────────
-- `cash_funds.balance` và `bank_accounts.balance` chỉ là BỘ NHỚ ĐỆM do trigger
-- `trg_cashbook_update_balance` cộng dồn. Nguồn sự thật là các phiếu đã duyệt.
-- Soát 26/08 thấy 5 chỗ lệch:
--   Quỹ Phù Mỹ          315.000.078 vs 315.424.078 → THIẾU     424.000
--   TK Agribank …6976   220.662.252 vs 219.912.252 → THỪA      750.000
--   Quỹ Cần Thơ          15.000.000 vs           0 → THỪA  15.000.000  (0 phiếu)
--   TK Techcombank …101 200.000.000 vs           0 → THỪA 200.000.000  (0 phiếu)
--   TK Vietcombank …789 500.000.000 vs           0 → THỪA 500.000.000  (0 phiếu)
-- Ba dòng cuối là DỮ LIỆU MẪU lúc dựng hệ thống (cùng dấu thời gian
-- 2026-05-22 16:46:08, id ffff…0001/0002/0003, gắn "Chi nhánh TP. Hồ Chí Minh"
-- không có thật), đều `is_active = false`, chưa bao giờ có một phiếu nào.
-- Quỹ Hoài Ân (980,3tr, kể cả 67,5tr phiếu huỷ), quỹ Mỹ Thành và TK
-- Techcombank 0367383077 khớp TUYỆT ĐỐI ⇒ hệ thống không có quy ước "số dư đầu
-- kỳ" nào cả, nên tính lại từ sổ phiếu là đúng bản chất.
--
-- ⚠️ KHÔNG bù bằng cách tạo phiếu thu như `20260755` đã làm cho khoản 730.000.
--    Lần đó phiếu BỊ THIẾU thật (tiền đã thu mà không vào sổ). Lần này phiếu
--    còn nguyên vẹn, chỉ có con số đệm bị lệch — tạo phiếu mới sẽ thổi phồng
--    doanh thu.
--
-- ── PHẦN 3. Bịt đường lệch lại ─────────────────────────────────────────────
-- `fn_update_fund_balance` chỉ bắt INSERT/UPDATE. Xoá cứng một phiếu đã duyệt
-- thì số dư KHÔNG bị trừ lại — im lặng. Nay thêm nhánh DELETE.
-- Và thêm 2 phép kiểm vào `fn_integrity_check()` để cron 08:00 tự la làng nếu
-- số đệm lại trôi khỏi sổ phiếu.
-- ═══════════════════════════════════════════════════════════════════════════

-- Giữ lại số dư TRƯỚC khi sửa để in ra nghiệm thu ở cuối file.
CREATE TEMP TABLE _bal_before ON COMMIT DROP AS
SELECT 'Quỹ ' || f.name AS ten, f.balance AS truoc,
       COALESCE((SELECT SUM(CASE WHEN t.flow_type = 'inflow' THEN t.amount ELSE -t.amount END)
                   FROM public.cashbook_transactions t
                  WHERE t.cash_fund_id = f.id AND t.status = 'approved'), 0) AS theo_so_phieu
  FROM public.cash_funds f
UNION ALL
SELECT 'TK ' || b.bank_name || ' ' || b.account_no, b.balance,
       COALESCE((SELECT SUM(CASE WHEN t.flow_type = 'inflow' THEN t.amount ELSE -t.amount END)
                   FROM public.cashbook_transactions t
                  WHERE t.bank_account_id = b.id AND t.status = 'approved'), 0)
  FROM public.bank_accounts b;


-- ═══ PHẦN 1 — Vá fn_sales_return_apply_effects ═════════════════════════════
DO $mig$
DECLARE
  v_def TEXT;
  v_new TEXT;
  v_tmp TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_sales_return_apply_effects';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy public.fn_sales_return_apply_effects()';
  END IF;

  v_new := v_def;

  -- (1) Khai báo mảng gom đơn bị cấn trừ.
  v_tmp := replace(v_new,
'  r               RECORD;
BEGIN',
'  r               RECORD;
  v_touched       UUID[] := ARRAY[]::UUID[];
  o               UUID;
BEGIN');
  IF v_tmp = v_new THEN RAISE EXCEPTION 'Vá 1/4 thất bại: không thấy khối DECLARE.'; END IF;
  v_new := v_tmp;

  -- (2) Vòng FIFO phải lấy được order_id để gom.
  v_tmp := replace(v_new,
'      SELECT id, amount, (order_id = v_sr.order_id) AS is_this_order',
'      SELECT id, amount, order_id, (order_id = v_sr.order_id) AS is_this_order');
  IF v_tmp = v_new THEN RAISE EXCEPTION 'Vá 2/4 thất bại: không thấy câu SELECT của vòng FIFO.'; END IF;
  v_new := v_tmp;

  -- (3) Gom order_id của mọi dòng nợ bị đụng tới.
  v_tmp := replace(v_new,
'      EXIT WHEN v_remaining <= 0;
      IF v_remaining >= r.amount THEN',
'      EXIT WHEN v_remaining <= 0;
      IF r.order_id IS NOT NULL THEN v_touched := v_touched || r.order_id; END IF;
      IF v_remaining >= r.amount THEN');
  IF v_tmp = v_new THEN RAISE EXCEPTION 'Vá 3/4 thất bại: không thấy thân vòng FIFO.'; END IF;
  v_new := v_tmp;

  -- (4) Kéo paid_amount của các đơn KHÁC về khớp sổ cái.
  v_tmp := replace(v_new,
'    UPDATE public.sales_returns
    SET debt_offset_total = v_offset_total,',
'    -- 20260801: vòng FIFO trên chạy qua toàn bộ dòng nợ của KHÁCH, nhưng
    -- v_paid_delta chỉ nâng paid_amount cho đơn của chính phiếu trả. Các đơn
    -- khác bị tất toán trong sổ cái mà orders.debt_amount (cột sinh) vẫn báo
    -- nợ — đúng cái đã xảy ra với DH-2026-02760 (720 dong).
    FOREACH o IN ARRAY v_touched LOOP
      IF o IS DISTINCT FROM v_sr.order_id THEN
        PERFORM public.fn_sync_order_paid_from_debts(o);
      END IF;
    END LOOP;

    UPDATE public.sales_returns
    SET debt_offset_total = v_offset_total,');
  IF v_tmp = v_new THEN RAISE EXCEPTION 'Vá 4/4 thất bại: không thấy câu UPDATE sales_returns.'; END IF;
  v_new := v_tmp;

  EXECUTE v_new;
  RAISE NOTICE 'fn_sales_return_apply_effects: đã vá 4/4 đoạn';
END $mig$;


-- ═══ PHẦN 2 — Dọn hậu quả cũ ═══════════════════════════════════════════════
-- Kéo mọi đơn ĐÃ CÓ dòng sổ cái về khớp với sổ cái. Đơn chưa từng có dòng sổ
-- cái thì `fn_sync_order_paid_from_debts` tự bỏ qua (guard v_has_ar) — cố ý,
-- nếu không sẽ xoá sạch 55,7tr phải thu thật của 22 đơn kẹt.
DO $mig$
DECLARE
  v_id  UUID;
  v_n   INT := 0;
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);

  FOR v_id IN
    SELECT o.id
      FROM public.orders o
      JOIN (SELECT order_id,
                   COALESCE(SUM(amount) FILTER (WHERE NOT is_settled AND amount > 0), 0) AS con_no
              FROM public.customer_debts
             WHERE order_id IS NOT NULL
             GROUP BY order_id) d ON d.order_id = o.id
     WHERE o.status NOT IN ('cancelled', 'draft')
       AND ABS(GREATEST(o.grand_total - o.paid_amount, 0) - d.con_no) > 0.5
  LOOP
    PERFORM public.fn_sync_order_paid_from_debts(v_id);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'Đã đồng bộ lại % đơn.', v_n;
END $mig$;

-- Nghiệm thu ngay: luật này phải về 0 vi phạm.
DO $mig$
DECLARE v_n BIGINT;
BEGIN
  SELECT violations INTO v_n FROM public.fn_integrity_check()
   WHERE check_name = 'order_debt_vs_ar_mismatch';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Vá xong mà vẫn còn % đơn lệch sổ cái — dừng lại để soát tay.', v_n;
  END IF;
  RAISE NOTICE 'order_debt_vs_ar_mismatch: 0 vi phạm';
END $mig$;


-- ═══ PHẦN 3 — Trigger số dư: thêm nhánh DELETE ═════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_update_fund_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_delta NUMERIC(15,2);
BEGIN
  -- Xoá cứng một phiếu ĐÃ DUYỆT: phải trả lại số dư, nếu không là lệch im lặng.
  IF TG_OP = 'DELETE' THEN
    IF OLD.flow_type <> 'internal_transfer' AND OLD.status = 'approved' THEN
      PERFORM public.fn_apply_fund_delta(
        OLD.cash_fund_id, OLD.bank_account_id,
        CASE WHEN OLD.flow_type = 'inflow' THEN -OLD.amount ELSE OLD.amount END);
    END IF;
    RETURN OLD;
  END IF;

  -- internal_transfer xử lý bằng 2 dòng inflow/outflow riêng → bỏ qua ở đây
  IF NEW.flow_type = 'internal_transfer' THEN
    RETURN NEW;
  END IF;

  v_delta := CASE WHEN NEW.flow_type = 'inflow' THEN NEW.amount ELSE -NEW.amount END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.fn_apply_fund_delta(NEW.cash_fund_id, NEW.bank_account_id, v_delta);
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.status IS DISTINCT FROM 'approved' AND NEW.status = 'approved' THEN
    PERFORM public.fn_apply_fund_delta(NEW.cash_fund_id, NEW.bank_account_id, v_delta);
  ELSIF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    PERFORM public.fn_apply_fund_delta(NEW.cash_fund_id, NEW.bank_account_id, -v_delta);
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_cashbook_update_balance ON public.cashbook_transactions;
CREATE TRIGGER trg_cashbook_update_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.cashbook_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_fund_balance();


-- ═══ PHẦN 4 — Tính lại số dư từ sổ phiếu ═══════════════════════════════════
UPDATE public.cash_funds f
   SET balance = x.s, updated_at = now()
  FROM (SELECT f2.id,
               COALESCE((SELECT SUM(CASE WHEN t.flow_type = 'inflow' THEN t.amount ELSE -t.amount END)
                           FROM public.cashbook_transactions t
                          WHERE t.cash_fund_id = f2.id AND t.status = 'approved'), 0) AS s
          FROM public.cash_funds f2) x
 WHERE x.id = f.id AND ABS(f.balance - x.s) > 0.005;

UPDATE public.bank_accounts b
   SET balance = x.s, updated_at = now()
  FROM (SELECT b2.id,
               COALESCE((SELECT SUM(CASE WHEN t.flow_type = 'inflow' THEN t.amount ELSE -t.amount END)
                           FROM public.cashbook_transactions t
                          WHERE t.bank_account_id = b2.id AND t.status = 'approved'), 0) AS s
          FROM public.bank_accounts b2) x
 WHERE x.id = b.id AND ABS(b.balance - x.s) > 0.005;


-- ═══ PHẦN 5 — Đưa phép kiểm số dư vào giám sát hằng ngày ═══════════════════
DO $mig$
DECLARE
  v_def TEXT;
  v_new TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_integrity_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy public.fn_integrity_check()';
  END IF;

  IF v_def LIKE '%fund_balance_drift%' THEN
    RAISE NOTICE 'fn_integrity_check đã có phép kiểm số dư — bỏ qua.';
    RETURN;
  END IF;

  v_new := replace(v_def,
'  return query select ''receipt_verified_stuck_7d''::text',
'  -- ── MỚI 20260801: số dư đệm trôi khỏi sổ phiếu ──
  -- cash_funds.balance / bank_accounts.balance chỉ là bộ nhớ đệm do trigger
  -- cộng dồn. Lệch = màn hình đang hiện số tiền sai cho nhân viên.
  return query
    with so_sanh as (
      select ''Quỹ '' || f.name as nm, f.balance as so_du,
             coalesce((select sum(case when t.flow_type = ''inflow'' then t.amount else -t.amount end)
                         from public.cashbook_transactions t
                        where t.cash_fund_id = f.id and t.status = ''approved''), 0) as so_cai,
             (select count(*) from public.cashbook_transactions t where t.cash_fund_id = f.id) as n
        from public.cash_funds f
      union all
      select ''TK '' || b.bank_name || '' '' || b.account_no, b.balance,
             coalesce((select sum(case when t.flow_type = ''inflow'' then t.amount else -t.amount end)
                         from public.cashbook_transactions t
                        where t.bank_account_id = b.id and t.status = ''approved''), 0),
             (select count(*) from public.cashbook_transactions t where t.bank_account_id = b.id)
        from public.bank_accounts b
    ), viphan as (
      select * from so_sanh where n > 0 and abs(so_du - so_cai) > 0.5
    )
    select ''fund_balance_drift''::text, ''warning''::text,
           (select count(*) from viphan),
           coalesce((select jsonb_agg(jsonb_build_object(''ten'', nm, ''so_du'', so_du,
              ''theo_so_phieu'', so_cai, ''lech'', so_du - so_cai))
             from (select * from viphan limit 20) s), ''[]''::jsonb);

  -- Quỹ/TK có số dư nhưng CHƯA TỪNG có phiếu nào ⇒ số dư ma (dữ liệu mẫu).
  return query
    with so_sanh as (
      select ''Quỹ '' || f.name as nm, f.balance as so_du,
             (select count(*) from public.cashbook_transactions t where t.cash_fund_id = f.id) as n
        from public.cash_funds f
      union all
      select ''TK '' || b.bank_name || '' '' || b.account_no, b.balance,
             (select count(*) from public.cashbook_transactions t where t.bank_account_id = b.id)
        from public.bank_accounts b
    ), viphan as (
      select * from so_sanh where n = 0 and abs(coalesce(so_du, 0)) > 0.5
    )
    select ''fund_balance_no_ledger''::text, ''warning''::text,
           (select count(*) from viphan),
           coalesce((select jsonb_agg(jsonb_build_object(''ten'', nm, ''so_du'', so_du))
             from (select * from viphan limit 20) s), ''[]''::jsonb);

  return query select ''receipt_verified_stuck_7d''::text');

  IF v_new = v_def THEN
    RAISE EXCEPTION 'Không thấy mốc receipt_verified_stuck_7d trong fn_integrity_check — phải soát tay.';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'fn_integrity_check: đã thêm fund_balance_drift + fund_balance_no_ledger';
END $mig$;

-- Nghiệm thu: sau khi tính lại, cả 2 phép kiểm mới phải về 0.
DO $mig$
DECLARE v_a BIGINT; v_b BIGINT;
BEGIN
  SELECT violations INTO v_a FROM public.fn_integrity_check() WHERE check_name = 'fund_balance_drift';
  SELECT violations INTO v_b FROM public.fn_integrity_check() WHERE check_name = 'fund_balance_no_ledger';
  IF COALESCE(v_a, -1) <> 0 OR COALESCE(v_b, -1) <> 0 THEN
    RAISE EXCEPTION 'Số dư vẫn lệch sau khi tính lại (drift=%, no_ledger=%).', v_a, v_b;
  END IF;
  RAISE NOTICE 'fund_balance_drift + fund_balance_no_ledger: 0 vi phạm';
END $mig$;


-- ═══ BẢNG NGHIỆM THU ═══════════════════════════════════════════════════════
SELECT b.ten, b.truoc AS so_du_truoc, b.theo_so_phieu, c.sau AS so_du_sau,
       (c.sau - b.truoc) AS dieu_chinh
  FROM _bal_before b
  JOIN (SELECT 'Quỹ ' || name AS ten, balance AS sau FROM public.cash_funds
        UNION ALL
        SELECT 'TK ' || bank_name || ' ' || account_no, balance FROM public.bank_accounts) c
    ON c.ten = b.ten
 ORDER BY ABS(c.sau - b.truoc) DESC, b.ten;
