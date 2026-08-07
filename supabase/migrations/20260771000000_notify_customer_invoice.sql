-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — ĐỢT C: PHIẾU GIAO HÀNG GỬI KHÁCH
-- 2026-08-07
--
-- User chốt nội dung gửi khách: "gửi hóa đơn và thông báo đơn hàng đã được
-- giao thành công, số tiền thu, công nợ hiện tại".
-- Và: "đơn hàng thành công là đơn hàng được nhân viên xác nhận, bán tại quầy
-- vẫn phải gửi".
--
-- 🔴 KHÔNG gửi tin nhắc công nợ đến hạn — user nói nhạy cảm. Hiện số dư trong
--    phiếu giao thì được (nó là một phần của biên nhận), nhưng tin đòi nợ
--    độc lập thì không bao giờ.
--
-- ── Ba khác biệt so với tin nội bộ ──────────────────────────────────────
-- ① KHÔNG có giá vốn, KHÔNG có lợi nhuận, KHÔNG có số của khách khác.
-- ② Giọng văn hướng tới khách: "Kính gửi", "Cảm ơn quý khách".
-- ③ Có câu mời báo sai — biến khách thành người soát lỗi cho mình.
--
-- ── Vì sao CHỈ phát sự kiện khi khách ĐÃ có nhóm ────────────────────────
-- Nếu phát cho mọi đơn thì 48 đơn/ngày × 1.900 khách chưa cấu hình sẽ đẻ ra
-- một đống sự kiện chỉ để bị bỏ, và nguy hơn: ở CHẾ ĐỘ KHÔ mọi sự kiện đó đều
-- bị dồn về nhóm nội bộ ⇒ nhóm nội bộ nhận gấp đôi tin mỗi ngày.
-- ⇒ Trigger tra `customers.telegram_chat_id` trước (một lần tra có index,
--   rẻ), chưa có nhóm thì không phát gì cả.
--
-- ⏱ `delay_sec = 600`: tin nằm chờ 10 phút. Nhân viên sửa đơn trong khoảng đó
--    thì bản cũ bị ĐÈ và khách không bao giờ thấy bản sai. Quá 10 phút mới sửa
--    thì hệ thống SỬA LẠI đúng tin cũ (đợt B), không gửi tin thứ hai.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.notification_rules
  (event_type, label, severity, channel_code, audience, compose,
   batch_window_sec, delay_sec, min_interval_sec, daily_cap, quiet_hours, threshold)
VALUES
  ('sales.order_customer', 'Phiếu giao hàng gửi khách', 'info', '@customer',
   'customer', 'full', 0, 600, 0, 1000000, false, '{}')
ON CONFLICT (event_type) DO UPDATE
  SET audience = 'customer', compose = 'full', channel_code = '@customer',
      delay_sec = 600, quiet_hours = false, enabled = true, updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger bán hàng — phát THÊM một sự kiện dành cho khách
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  o        RECORD;
  v_evt    TEXT;
  v_fp     TEXT;
  v_sua    BOOLEAN := false;
  v_kh     TEXT;
  v_who    TEXT;
  v_cn     TEXT;
  v_kho    TEXT;
  v_sp     TEXT;
  v_n      INTEGER;
  v_thr    JSONB;
  v_big    NUMERIC;
  v_dpct   NUMERIC;
  v_damt   NUMERIC;
  v_pct    NUMERIC;
  v_co     TEXT := '';
  v_text   TEXT;
  v_luc    TEXT;
  -- phần dành cho khách
  v_tg     TEXT;
  v_no_ht  NUMERIC;
  v_ktext  TEXT;
  v_kfp    TEXT;
  v_ksua   BOOLEAN := false;
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

  SELECT threshold INTO v_thr FROM public.notification_rules WHERE event_type='sales.order';
  v_big  := COALESCE((v_thr->>'big_amount')::numeric, 5000000);
  v_dpct := COALESCE((v_thr->>'discount_pct')::numeric, 5);
  v_damt := COALESCE((v_thr->>'discount_amount')::numeric, 500000);
  v_pct  := CASE WHEN COALESCE(o.subtotal,0) > 0
                 THEN COALESCE(o.discount_total,0) / o.subtotal * 100 ELSE 0 END;

  IF o.grand_total >= v_big THEN v_co := v_co || E'\n⚠️ <b>ĐƠN GIÁ TRỊ LỚN</b>'; END IF;
  IF COALESCE(o.discount_total,0) > 0
     AND (v_pct >= v_dpct OR o.discount_total >= v_damt)
  THEN v_co := v_co || E'\n⚠️ <b>Chiết khấu ' || round(v_pct) || '%</b>'; END IF;

  -- ── ① Tin NỘI BỘ (giữ nguyên như cũ) ────────────────────────────────
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
    CASE WHEN v_sua THEN v_fp || ':' || to_char(now(),'YYYYMMDDHH24MISS') ELSE v_fp END);

  -- ── ② Tin GỬI KHÁCH — chỉ khi khách đã có nhóm Telegram ─────────────
  IF o.customer_id IS NOT NULL THEN
    SELECT c.telegram_chat_id INTO v_tg
      FROM public.customers c
     WHERE c.id = o.customer_id
       AND c.telegram_enabled = true
       AND COALESCE(c.telegram_chat_id,'') <> '';

    IF v_tg IS NOT NULL THEN
      -- Công nợ hiện tại của khách. Trigger này chạy lúc COMMIT (đợt `20260766`)
      -- nên chỗ này đã thấy số sau khi mọi bút toán xong.
      SELECT COALESCE(sum(d.amount), 0) INTO v_no_ht
        FROM public.customer_debts d
       WHERE d.customer_id = o.customer_id AND d.is_settled = false;

      v_kfp  := 'sales.order_customer:' || o.id;
      v_ksua := EXISTS (SELECT 1 FROM public.notification_events
                         WHERE fingerprint = v_kfp AND status = 'sent');

      v_ktext :=
          CASE WHEN v_ksua
               THEN '🔁 <b>ĐÃ CẬP NHẬT</b> — phiếu này vừa được điều chỉnh' || E'\n\n'
               ELSE '' END
       || '🧾 <b>PHIẾU GIAO HÀNG</b>'
       || E'\n<b>SANH LONG VETCO</b>'
       || COALESCE(' — ' || public.fn_tg_escape(v_cn), '')
       || E'\nMã đơn: <b>' || public.fn_tg_escape(o.order_code) || '</b>'
       || E'\nThời gian: ' || v_luc
       || E'\n\nKính gửi: <b>' || public.fn_tg_escape(COALESCE(v_kh,'Quý khách')) || '</b>'
       || E'\nĐơn hàng của quý khách đã được giao thành công.'
       || E'\n\n📦 <b>Hàng đã giao (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
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
       || E'\n💰 <b>TỔNG TIỀN HÀNG: ' || public.fn_notify_vnd(o.grand_total) || '</b>'
       || E'\n💳 Đã thanh toán: ' || public.fn_notify_vnd(o.paid_amount)
       || ' (' || public.fn_notify_paymethod(o.payment_method::text) || ')'
       || CASE WHEN COALESCE(o.debt_amount,0) > 0
               THEN E'\n🧾 Còn nợ đơn này: <b>' || public.fn_notify_vnd(o.debt_amount) || '</b>'
               ELSE E'\n✅ <b>Đã thanh toán đủ đơn này</b>' END
       || E'\n📊 Tổng công nợ hiện tại: <b>' || public.fn_notify_vnd(v_no_ht) || '</b>'
       || E'\n\n<i>Cảm ơn quý khách đã tin dùng Sanh Long Vetco.</i>'
       || E'\n<i>Nếu có sai sót, xin nhắn lại ngay trong nhóm này.</i>';

      PERFORM public.fn_notify_emit('sales.order_customer', o.branch_id,
        jsonb_build_object('text', v_ktext,
                           'line', o.order_code || ' · ' || public.fn_notify_vnd(o.grand_total),
                           'tong_tien', o.grand_total,
                           'cong_no', v_no_ht),
        CASE WHEN v_ksua THEN v_kfp || ':' || to_char(now(),'YYYYMMDDHH24MISS') ELSE v_kfp END,
        o.customer_id);
    END IF;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- không bao giờ được cản việc bán hàng
END;
$$;

NOTIFY pgrst, 'reload schema';
