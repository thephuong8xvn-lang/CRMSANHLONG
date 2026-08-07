-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — ĐÁNH DẤU ĐƠN ĐÃ SỬA, TRÁNH ĐẾM NHẦM HAI LẦN BÁN
-- 2026-08-07
--
-- ── Vấn đề quan sát được trên log thật ──────────────────────────────────
-- `DH-2026-02696` tạo lúc 07:31, tới 08:22 bị sửa (đơn giá 265.000đ → 255.000đ)
-- và bắn ra một tin hoá đơn thứ hai TRÔNG Y HỆT một đơn bán mới. Chủ đọc lướt
-- sẽ đếm thành 2 lần bán.
--
-- Cơ chế chống trùng `fingerprint` chỉ chặn khi sự kiện còn ở trạng thái
-- 'pending' — cố ý như vậy, vì sửa đơn LÀ việc đáng báo. Cái thiếu không phải
-- là chặn, mà là **nói rõ đây là bản sửa**.
--
-- ⇒ Trước khi soạn tin, tra xem đơn này đã từng gửi tin 'sales.order' chưa.
--   Rồi thì gắn nhãn 🔁 ĐƠN ĐÃ SỬA lên đầu tin.
--
-- ⚠️ Index `idx_notification_events_fingerprint` là index MỘT PHẦN, chỉ phủ
--    `status='pending'`. Tra sự kiện ĐÃ GỬI mà dùng nó thì Postgres phải quét
--    toàn bảng. Nên thêm một index đầy đủ trên `fingerprint`.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_notification_events_fp_all
  ON public.notification_events (fingerprint);

CREATE OR REPLACE FUNCTION public.trg_notify_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  o       RECORD;
  v_evt   TEXT;
  v_fp    TEXT;
  v_sua   BOOLEAN := false;
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
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_evt := CASE
             WHEN o.status::text IN ('confirmed','completed') THEN 'sales.order'
             WHEN o.status::text = 'cancelled'                THEN 'sales.cancelled'
             ELSE NULL END;
  IF v_evt IS NULL THEN RETURN NULL; END IF;

  v_fp := v_evt || ':' || o.id;

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
      v_fp || ':' || to_char(now(),'YYYYMMDDHH24MISS'));
    RETURN NULL;
  END IF;

  -- Đã gửi tin cho đơn này trước đó ⇒ lần này là bản sửa.
  v_sua := EXISTS (SELECT 1 FROM public.notification_events
                    WHERE fingerprint = v_fp AND status = 'sent');

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
      CASE WHEN v_sua THEN '🔁 <b>ĐƠN ĐÃ SỬA</b> — bản cập nhật' || E'\n' ELSE '' END
   || '🧾 <b>' || public.fn_tg_escape(o.order_code) || '</b>'
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
                       'ghi_no', COALESCE(o.debt_amount,0),
                       'la_ban_sua', v_sua),
    -- Bản sửa phải có dấu vân tay KHÁC, nếu không lần gửi trước (đã 'sent')
    -- vẫn nằm đó và bản sửa sẽ bị coi là trùng rồi bỏ luôn.
    CASE WHEN v_sua THEN v_fp || ':' || to_char(now(),'YYYYMMDDHH24MISS') ELSE v_fp END);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
