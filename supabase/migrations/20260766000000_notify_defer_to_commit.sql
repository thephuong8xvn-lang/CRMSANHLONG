-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — VÁ SỐ TIỀN SAI DO ĐỌC QUÁ SỚM
-- 2026-08-07
--
-- ── Triệu chứng user báo ─────────────────────────────────────────────────
--   "Thu nợ · ĐL. Hào -TBD PM · 95.000đ · … · còn nợ 95.000đ"
--   Đúng ra phải là **còn nợ 0đ** — khách vừa trả hết.
--
-- ── Nguyên nhân: TRIGGER CHẠY GIỮA CHỪNG NGHIỆP VỤ ──────────────────────
-- `fn_collect_customer_debt` (20260754000000:239-268) làm theo thứ tự:
--     1. INSERT INTO debt_payments        ← trigger AFTER INSERT nổ NGAY ĐÂY
--     2. UPDATE customer_debts SET is_settled = true …
--     3. UPDATE customer_debts SET amount = amount - …
-- Trigger đọc `customer_debts` ở bước 1, tức là TRƯỚC khi bước 2–3 trừ nợ.
-- Nó luôn thấy nguyên khoản nợ chưa trả. Số càng đúng thì tin càng sai.
--
-- Y hệt ở đơn hàng: `DH-2026-02702` báo "Tiền mặt · ghi nợ 290.000đ" — trả
-- tiền mặt mà vẫn ghi nợ nguyên đơn, vì `orders.paid_amount` được cập nhật
-- SAU khi trạng thái chuyển sang completed.
--
-- ── Cách sửa: dời trigger tới lúc COMMIT ────────────────────────────────
-- Đổi sang **CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED**: Postgres
-- gom lại và chỉ chạy khi giao dịch sắp commit, tức là sau khi TOÀN BỘ nghiệp
-- vụ đã xong. Đây cũng đúng tinh thần "báo sau khi hành động vừa kết thúc".
--
-- ⚠️ Một điều dễ sai: trigger hoãn VẪN nhận `NEW` là ảnh chụp lúc câu lệnh
--    chạy, KHÔNG phải trạng thái cuối. Nên chỉ hoãn thôi chưa đủ — bên trong
--    hàm phải **ĐỌC LẠI dòng dữ liệu** từ bảng thì mới thấy số cuối cùng.
--    Đó là lý do `trg_notify_order` dưới đây SELECT lại `orders` thay vì tin
--    vào `NEW.paid_amount`.
--
-- ⚠️ Constraint trigger không nhận `UPDATE OF status`, phải bắt mọi UPDATE
--    rồi tự lọc trong hàm. Chi phí không đáng kể: hàm thoát ngay ở dòng đầu
--    khi trạng thái không đổi.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. BÁN HÀNG ══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  o       RECORD;
  v_evt   TEXT;
  v_kh    TEXT;
  v_who   TEXT;
  v_cn    TEXT;
  v_kho   TEXT;
  v_sp    TEXT;
  v_n     INTEGER;
  v_thr   JSONB;
  v_big   NUMERIC;
  v_dpct  NUMERIC;
  v_damt  NUMERIC;
  v_pct   NUMERIC;
  v_co    TEXT := '';
  v_text  TEXT;
  v_luc   TEXT;
BEGIN
  -- Chỉ quan tâm lần đổi trạng thái, không quan tâm các UPDATE khác.
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  -- ĐỌC LẠI: NEW là ảnh chụp lúc câu lệnh chạy, chưa có tiền đã trả.
  SELECT * INTO o FROM public.orders WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_evt := CASE
             WHEN o.status::text IN ('confirmed','completed') THEN 'sales.order'
             WHEN o.status::text = 'cancelled'                THEN 'sales.cancelled'
             ELSE NULL END;
  IF v_evt IS NULL THEN RETURN NULL; END IF;

  SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id = o.customer_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(o.confirmed_by, o.owner_user_id);
  SELECT b.name INTO v_cn  FROM public.branches b   WHERE b.id = o.branch_id;
  SELECT w.name INTO v_kho FROM public.warehouses w WHERE w.id = o.warehouse_id;

  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(o.confirmed_at, o.created_at, now())), 'HH24:MI DD/MM/YYYY');

  IF v_evt = 'sales.cancelled' THEN
    PERFORM public.fn_notify_emit(v_evt, o.branch_id,
      jsonb_build_object('line',
        o.order_code || ' · ' || COALESCE(v_kh,'khách lẻ')
        || ' · ' || public.fn_notify_vnd(o.grand_total)
        || COALESCE(' · ' || v_who, '')
        || COALESCE(' · lý do: ' || o.cancel_reason, '')),
      v_evt || ':' || o.id);
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_n FROM public.order_lines WHERE order_id = o.id;

  SELECT string_agg(
           '· ' || public.fn_tg_escape(pr.name)
           || '  ' || trim(to_char(l.quantity, 'FM999999990.###'))
           || ' × ' || public.fn_notify_vnd(l.unit_price)
           || ' = <b>' || public.fn_notify_vnd(l.line_total) || '</b>',
           E'\n' ORDER BY l.created_at)
    INTO v_sp
  FROM (SELECT * FROM public.order_lines
         WHERE order_id = o.id ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id;

  SELECT threshold INTO v_thr FROM public.notification_rules WHERE event_type = 'sales.order';
  v_big  := COALESCE((v_thr->>'big_amount')::numeric, 5000000);
  v_dpct := COALESCE((v_thr->>'discount_pct')::numeric, 5);
  v_damt := COALESCE((v_thr->>'discount_amount')::numeric, 500000);
  v_pct  := CASE WHEN COALESCE(o.subtotal,0) > 0
                 THEN COALESCE(o.discount_total,0) / o.subtotal * 100 ELSE 0 END;

  IF o.grand_total >= v_big THEN v_co := v_co || E'\n⚠️ <b>ĐƠN GIÁ TRỊ LỚN</b>'; END IF;
  IF COALESCE(o.discount_total,0) > 0
     AND (v_pct >= v_dpct OR o.discount_total >= v_damt)
  THEN v_co := v_co || E'\n⚠️ <b>Chiết khấu ' || round(v_pct) || '%</b>'; END IF;

  v_text :=
      '🧾 <b>' || public.fn_tg_escape(o.order_code) || '</b>'
   || E'\n🏢 ' || public.fn_tg_escape(COALESCE(v_cn,'chưa gán chi nhánh'))
   || COALESCE(' — kho ' || public.fn_tg_escape(v_kho), '')
   || E'\n🕐 ' || v_luc
   || E'\n👤 Khách: <b>' || public.fn_tg_escape(COALESCE(v_kh,'Khách lẻ')) || '</b>'
   || E'\n🧑‍💼 Người bán: ' || public.fn_tg_escape(COALESCE(v_who,'—'))
   || E'\n\n📦 <b>Hàng (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
   || COALESCE(v_sp, '(không có dòng hàng)')
   || CASE WHEN COALESCE(v_n,0) > 25
           THEN E'\n… và ' || (v_n - 25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || CASE WHEN COALESCE(o.discount_total,0) > 0
           THEN E'\nTạm tính: ' || public.fn_notify_vnd(o.subtotal)
                || E'\nChiết khấu: -' || public.fn_notify_vnd(o.discount_total)
           ELSE '' END
   || CASE WHEN COALESCE(o.shipping_fee,0) > 0
           THEN E'\nPhí giao: ' || public.fn_notify_vnd(o.shipping_fee) ELSE '' END
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(o.grand_total) || '</b>'
   || E'\n💳 ' || public.fn_notify_paymethod(o.payment_method::text)
   || ' · đã trả ' || public.fn_notify_vnd(o.paid_amount)
   || CASE WHEN COALESCE(o.debt_amount,0) > 0
           THEN ' · <b>còn nợ ' || public.fn_notify_vnd(o.debt_amount) || '</b>'
           ELSE ' · <b>đã thanh toán đủ</b>' END
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(o.notes), '')
   || v_co;

  PERFORM public.fn_notify_emit(v_evt, o.branch_id,
    jsonb_build_object('text', v_text,
                       'line', o.order_code || ' · ' || public.fn_notify_vnd(o.grand_total),
                       'tong_tien', o.grand_total,
                       'ghi_no', COALESCE(o.debt_amount,0)),
    v_evt || ':' || o.id);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_order ON public.orders;
CREATE CONSTRAINT TRIGGER trg_notify_order
  AFTER INSERT OR UPDATE ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_order();

-- ═══ 2. THU NỢ ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_debt_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_kh   TEXT;
  v_who  TEXT;
  v_cn   TEXT;
  v_con  NUMERIC;
BEGIN
  SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id = NEW.customer_id;
  SELECT p.full_name INTO v_who FROM public.profiles p WHERE p.id = NEW.recorded_by;
  SELECT b.name INTO v_cn FROM public.branches b WHERE b.id = NEW.branch_id;

  -- Chạy lúc COMMIT nên chỗ này đã thấy công nợ SAU khi tất toán.
  SELECT COALESCE(sum(d.amount), 0) INTO v_con
    FROM public.customer_debts d
   WHERE d.customer_id = NEW.customer_id AND d.is_settled = false;

  PERFORM public.fn_notify_emit('debt.payment', NEW.branch_id,
    jsonb_build_object('line',
      COALESCE(v_kh,'?') || ' · ' || public.fn_notify_vnd(NEW.amount)
      || ' · ' || public.fn_notify_paymethod(NEW.payment_method::text)
      || COALESCE(' · thu tại ' || v_cn, '')
      || COALESCE(' · ' || v_who, '')
      || CASE WHEN v_con > 0
              THEN ' · còn nợ ' || public.fn_notify_vnd(v_con)
              ELSE ' · <b>đã trả hết nợ</b>' END,
      'so_tien', NEW.amount, 'con_no', v_con),
    'dp:' || NEW.id);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_debt_payment ON public.debt_payments;
CREATE CONSTRAINT TRIGGER trg_notify_debt_payment
  AFTER INSERT ON public.debt_payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_debt_payment();

NOTIFY pgrst, 'reload schema';
