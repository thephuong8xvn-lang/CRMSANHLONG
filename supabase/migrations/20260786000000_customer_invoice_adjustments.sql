-- ═══════════════════════════════════════════════════════════════════════════
-- HOÁ ĐƠN GỬI KHÁCH: HOÃN 3 PHÚT + TIN ĐIỀU CHỈNH THAY VÌ SỬA LÉN
-- 2026-08-08
--
-- User: "gởi hóa đơn cho khách sau 3 phút, nếu sai sẽ cập nhật lại và gởi lại
-- cho khách bằng thông báo điều chỉnh hóa đơn, hoặc điều chỉnh công nợ chẳng
-- hạn; trong hóa đơn của khách sẽ gởi tổng công nợ đến thời điểm hiện tại;
-- mọi biến động nợ hoặc hóa đơn, dữ liệu lịch vaccine đều gởi cho khách".
--
-- ── ① HOÃN 600 → 180 GIÂY ───────────────────────────────────────────────
-- Cửa sổ sửa sai thu từ 10 phút xuống 3 phút. Trong 3 phút đó, sửa đơn vẫn
-- ĐÈ bản chưa gửi ⇒ khách không bao giờ thấy bản sai. Quá 3 phút thì sang
-- cơ chế ② dưới đây.
--
-- ── ② HẾT SỬA LÉN — QUÁ HẠN THÌ GỬI TIN ĐIỀU CHỈNH ─────────────────────
-- Trước đây, sửa đơn sau khi tin đã gửi thì `subject_key` vẫn y nguyên nên
-- drain chọn nhánh `editMessageText`: **nội dung tin cũ trong nhóm khách âm
-- thầm đổi**, không có gì nhảy lên báo. Khách không biết hoá đơn vừa đổi.
-- Đúng cái đã làm user tưởng hệ thống chết ở nhóm Bảo Ân Hậu (vá `20260785`).
--
-- ⇒ Nay: đã gửi rồi thì nối mã đơn với `_dc<dấu thời gian>` ⇒ `subject_key`
--   MỚI ⇒ Telegram nhận **một tin mới** tiêu đề "🔁 ĐIỀU CHỈNH HOÁ ĐƠN", nói
--   rõ nó thay thế phiếu đã gửi trước đó. Tin cũ để nguyên làm dấu vết.
--   Chưa gửi thì giữ `subject_key` cũ để cơ chế đè-bản-chưa-gửi còn tác dụng.
--
-- ── ③ 🔴 LỖ HỔNG: HUỶ ĐƠN TRONG 3 PHÚT, KHÁCH VẪN NHẬN HOÁ ĐƠN ─────────
-- Nhánh `sales.cancelled` thoát sớm (`20260772:64-73`) và phát tin nội bộ với
-- fingerprint `sales.cancelled:<id>` ⇒ `subject_key` KHÁC
-- `sales.order_customer:<id>` ⇒ **không đè được tin hoá đơn đang chờ**. Huỷ
-- đơn xong, mấy phút sau khách vẫn nhận phiếu giao hàng của đơn đã huỷ.
-- Chưa nổ ra vì kênh khách mới bật và chưa ai huỷ đơn của khách có nhóm.
-- ⇒ Vá: huỷ đơn thì (a) DẬP tin hoá đơn còn đang chờ, (b) nếu đã lỡ gửi thì
--   phát tin "🚫 HUỶ HOÁ ĐƠN" cho khách.
--
-- ── ④ BIẾN ĐỘNG CÔNG NỢ CŨNG BÁO KHÁCH ─────────────────────────────────
-- Thu nợ nay sinh thêm một tin gửi khách: biên nhận + **tổng công nợ còn lại
-- đến thời điểm hiện tại** (đúng con số mà hoá đơn vẫn đang hiển thị).
-- Tin nội bộ giữ nguyên, không đụng.
-- ⚠️ Đây là chỗ duy nhất trong migration này diễn giải câu chữ của user hơi
--    rộng. Nếu không muốn, TẮT bằng một dòng, không cần sửa code:
--      UPDATE notification_rules SET enabled=false WHERE event_type='debt.payment_customer';
--
-- 🪤 Tất cả tin gửi khách đều đi qua `fn_notify_target('customer', …)` nên vẫn
--    tôn trọng `telegram_enabled` và chế độ khô như mọi tin khách khác.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ① Cửa sổ sửa sai: 3 phút ──────────────────────────────────────────
UPDATE public.notification_rules
   SET delay_sec = 180, updated_at = now()
 WHERE event_type = 'sales.order_customer';

-- ── ④ Luật cho tin biến động công nợ gửi khách ────────────────────────
INSERT INTO public.notification_rules
  (event_type, label, severity, channel_code, audience, compose,
   batch_window_sec, delay_sec, min_interval_sec, daily_cap, quiet_hours)
VALUES
  ('debt.payment_customer', 'Biến động công nợ gửi khách', 'info', '@customer',
   'customer', 'full', 0, 180, 0, 1000000, false)
ON CONFLICT (event_type) DO UPDATE
  SET audience='customer', compose='full', channel_code='@customer',
      delay_sec=180, enabled=true, updated_at=now();

-- ═══════════════════════════════════════════════════════════════════════════
-- BÁN HÀNG — tin nội bộ + tin gửi khách (hoá đơn / điều chỉnh / huỷ)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  o RECORD; v_evt TEXT; v_fp TEXT; v_sua BOOLEAN := false;
  v_kh TEXT; v_who TEXT; v_cn TEXT; v_kho TEXT; v_sp TEXT; v_n INTEGER;
  v_thr JSONB; v_big NUMERIC; v_dpct NUMERIC; v_damt NUMERIC; v_pct NUMERIC;
  v_co TEXT := ''; v_text TEXT; v_luc TEXT;
  v_tg TEXT; v_no_ht NUMERIC; v_ktext TEXT; v_kfp TEXT; v_ksua BOOLEAN := false;
  v_ksubj TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;

  SELECT * INTO o FROM public.orders WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_evt := CASE WHEN o.status::text IN ('confirmed','completed') THEN 'sales.order'
                WHEN o.status::text = 'cancelled' THEN 'sales.cancelled' ELSE NULL END;
  IF v_evt IS NULL THEN RETURN NULL; END IF;
  v_fp := v_evt || ':' || o.id;

  SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id = o.customer_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(o.confirmed_by, o.owner_user_id);
  SELECT b.name INTO v_cn  FROM public.branches b   WHERE b.id = o.branch_id;
  SELECT w.name INTO v_kho FROM public.warehouses w WHERE w.id = o.warehouse_id;
  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(o.confirmed_at, o.created_at, now())), 'HH24:MI DD/MM/YYYY');

  -- Chủ thể của tin hoá đơn gửi khách — dùng chung cho cả 3 nhánh dưới.
  v_ksubj := 'sales.order_customer:' || o.id;

  -- ══ HUỶ ĐƠN ═════════════════════════════════════════════════════════
  IF v_evt = 'sales.cancelled' THEN
    PERFORM public.fn_notify_emit(v_evt, o.branch_id,
      jsonb_build_object('line',
        o.order_code || ' · ' || COALESCE(v_kh,'khách lẻ')
        || ' · ' || public.fn_notify_vnd(o.grand_total)
        || COALESCE(' · ' || v_who, '') || COALESCE(' · lý do: ' || o.cancel_reason, '')),
      v_fp || ':' || to_char(now(),'YYYYMMDDHH24MISS'));

    -- (a) Hoá đơn còn đang chờ trong cửa sổ 3 phút ⇒ DẬP, khách không thấy gì.
    UPDATE public.notification_events
       SET status = 'skipped', processed_at = now()
     WHERE subject_key = v_ksubj AND status = 'pending';

    -- (b) Đã lỡ gửi rồi ⇒ phải nói cho khách biết hoá đơn đó không còn giá trị.
    --     Hỏi `notification_log` chứ không phải `notification_events`: sự kiện
    --     `sent` chỉ nghĩa là drain đã xử lý, tin vẫn có thể rớt (403 nhóm chết).
    --     Tin chưa bao giờ tới tay khách thì không có gì để mà huỷ.
    IF EXISTS (SELECT 1 FROM public.notification_log
                WHERE subject_key = v_ksubj AND status = 'sent')
    THEN
      SELECT c.telegram_chat_id INTO v_tg FROM public.customers c
       WHERE c.id = o.customer_id AND c.telegram_enabled = true
         AND COALESCE(c.telegram_chat_id,'') <> '';
      IF v_tg IS NOT NULL THEN
        SELECT COALESCE(sum(d.amount),0) INTO v_no_ht FROM public.customer_debts d
         WHERE d.customer_id = o.customer_id AND d.is_settled = false;

        v_ktext := '🚫 <b>HUỶ HOÁ ĐƠN</b>'
         || E'\n<b>SANH LONG VETCO</b>' || COALESCE(' — ' || public.fn_tg_escape(v_cn), '')
         || E'\n\nKính gửi: <b>' || public.fn_tg_escape(COALESCE(v_kh,'Quý khách')) || '</b>'
         || E'\nPhiếu giao hàng <b>' || public.fn_tg_escape(o.order_code)
         || '</b> đã gửi trước đó <b>không còn giá trị</b>.'
         || COALESCE(E'\nLý do: ' || public.fn_tg_escape(o.cancel_reason), '')
         || E'\n\n────────────────'
         || E'\n📊 Tổng công nợ hiện tại: <b>' || public.fn_notify_vnd(v_no_ht) || '</b>'
         || E'\n\n<i>Rất mong quý khách thông cảm. Có gì chưa đúng, xin nhắn lại ngay '
         || 'trong nhóm này.</i>';

        PERFORM public.fn_notify_emit('sales.order_customer', o.branch_id,
          jsonb_build_object('text', v_ktext,
                             'line', o.order_code || ' · HUỶ', 'cong_no', v_no_ht),
          v_ksubj || '_huy' || to_char(now(),'YYYYMMDDHH24MISS'),
          o.customer_id);
      END IF;
    END IF;

    RETURN NULL;
  END IF;

  -- ══ ĐƠN CHỐT / SỬA ══════════════════════════════════════════════════
  v_sua := EXISTS (SELECT 1 FROM public.notification_events
                    WHERE fingerprint = v_fp AND status = 'sent');
  SELECT count(*) INTO v_n FROM public.order_lines WHERE order_id = o.id;

  SELECT string_agg('· ' || public.fn_tg_escape(pr.name)
           || '  ' || public.fn_notify_qty(l.quantity)
           || ' × ' || public.fn_notify_vnd(l.unit_price)
           || ' = <b>' || public.fn_notify_vnd(l.line_total) || '</b>',
           E'\n' ORDER BY l.created_at)
    INTO v_sp
  FROM (SELECT * FROM public.order_lines WHERE order_id = o.id
         ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id;

  SELECT threshold INTO v_thr FROM public.notification_rules WHERE event_type='sales.order';
  v_big  := COALESCE((v_thr->>'big_amount')::numeric, 5000000);
  v_dpct := COALESCE((v_thr->>'discount_pct')::numeric, 5);
  v_damt := COALESCE((v_thr->>'discount_amount')::numeric, 500000);
  v_pct  := CASE WHEN COALESCE(o.subtotal,0) > 0
                 THEN COALESCE(o.discount_total,0) / o.subtotal * 100 ELSE 0 END;
  IF o.grand_total >= v_big THEN v_co := v_co || E'\n⚠️ <b>ĐƠN GIÁ TRỊ LỚN</b>'; END IF;
  IF COALESCE(o.discount_total,0) > 0 AND (v_pct >= v_dpct OR o.discount_total >= v_damt)
  THEN v_co := v_co || E'\n⚠️ <b>Chiết khấu ' || round(v_pct) || '%</b>'; END IF;

  v_text := CASE WHEN v_sua THEN '🔁 <b>ĐƠN ĐÃ SỬA</b> — bản cập nhật' || E'\n' ELSE '' END
   || '🧾 <b>' || public.fn_tg_escape(o.order_code) || '</b>'
   || E'\n🏢 ' || public.fn_tg_escape(COALESCE(v_cn,'chưa gán chi nhánh'))
   || COALESCE(' — kho ' || public.fn_tg_escape(v_kho), '')
   || E'\n🕐 ' || v_luc
   || E'\n👤 Khách: <b>' || public.fn_tg_escape(COALESCE(v_kh,'Khách lẻ')) || '</b>'
   || E'\n🧑‍💼 Người bán: ' || public.fn_tg_escape(COALESCE(v_who,'—'))
   || E'\n\n📦 <b>Hàng (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
   || COALESCE(v_sp, '(không có dòng hàng)')
   || CASE WHEN COALESCE(v_n,0) > 25 THEN E'\n… và ' || (v_n-25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || CASE WHEN COALESCE(o.discount_total,0) > 0
           THEN E'\nTạm tính: ' || public.fn_notify_vnd(o.subtotal)
                || E'\nChiết khấu: -' || public.fn_notify_vnd(o.discount_total) ELSE '' END
   || CASE WHEN COALESCE(o.shipping_fee,0) > 0
           THEN E'\nPhí giao: ' || public.fn_notify_vnd(o.shipping_fee) ELSE '' END
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(o.grand_total) || '</b>'
   || E'\n💳 ' || public.fn_notify_paymethod(o.payment_method::text)
   || ' · đã trả ' || public.fn_notify_vnd(o.paid_amount)
   || CASE WHEN COALESCE(o.debt_amount,0) > 0
           THEN ' · <b>còn nợ ' || public.fn_notify_vnd(o.debt_amount) || '</b>'
           ELSE ' · <b>đã thanh toán đủ</b>' END
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(o.notes), '') || v_co;

  PERFORM public.fn_notify_emit(v_evt, o.branch_id,
    jsonb_build_object('text', v_text,
                       'line', o.order_code || ' · ' || public.fn_notify_vnd(o.grand_total),
                       'tong_tien', o.grand_total, 'ghi_no', COALESCE(o.debt_amount,0),
                       'la_ban_sua', v_sua),
    CASE WHEN v_sua THEN v_fp || ':' || to_char(now(),'YYYYMMDDHH24MISS') ELSE v_fp END);

  -- ── Tin gửi khách ───────────────────────────────────────────────────
  IF o.customer_id IS NOT NULL THEN
    SELECT c.telegram_chat_id INTO v_tg FROM public.customers c
     WHERE c.id = o.customer_id AND c.telegram_enabled = true
       AND COALESCE(c.telegram_chat_id,'') <> '';

    IF v_tg IS NOT NULL THEN
      SELECT COALESCE(sum(d.amount),0) INTO v_no_ht FROM public.customer_debts d
       WHERE d.customer_id = o.customer_id AND d.is_settled = false;

      -- Hoá đơn đã THỰC SỰ tới tay khách chưa — quyết định "đè bản chờ" hay
      -- "gửi tin điều chỉnh". Căn cứ là `notification_log`, cùng nguồn mà drain
      -- dùng để chọn sửa-hay-gửi; tin rớt 403 thì coi như chưa từng gửi và
      -- khách sẽ nhận một hoá đơn bình thường, không phải bản "điều chỉnh".
      v_ksua := EXISTS (SELECT 1 FROM public.notification_log
                         WHERE subject_key = v_ksubj AND status = 'sent');

      -- CHƯA gửi ⇒ giữ nguyên chủ thể để bản mới ĐÈ bản đang chờ (khách không
      -- thấy bản sai). ĐÃ gửi ⇒ chủ thể MỚI ⇒ Telegram nhận một tin riêng,
      -- không âm thầm sửa tin cũ.
      v_kfp := CASE WHEN v_ksua
                    THEN v_ksubj || '_dc' || to_char(now(),'YYYYMMDDHH24MISS')
                    ELSE v_ksubj END;

      v_ktext := CASE WHEN v_ksua
                      THEN '🔁 <b>ĐIỀU CHỈNH HOÁ ĐƠN</b>'
                           || E'\n<i>Bản này thay thế phiếu giao hàng đã gửi trước đó.</i>'
                           || E'\n\n'
                      ELSE '' END
       || '🧾 <b>PHIẾU GIAO HÀNG</b>' || E'\n<b>SANH LONG VETCO</b>'
       || COALESCE(' — ' || public.fn_tg_escape(v_cn), '')
       || E'\nMã đơn: <b>' || public.fn_tg_escape(o.order_code) || '</b>'
       || E'\nThời gian: ' || v_luc
       || E'\n\nKính gửi: <b>' || public.fn_tg_escape(COALESCE(v_kh,'Quý khách')) || '</b>'
       || E'\nĐơn hàng của quý khách đã được giao thành công.'
       || E'\n\n📦 <b>Hàng đã giao (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
       || COALESCE(v_sp, '(không có dòng hàng)')
       || CASE WHEN COALESCE(v_n,0) > 25 THEN E'\n… và ' || (v_n-25) || ' dòng nữa' ELSE '' END
       || E'\n\n────────────────'
       || CASE WHEN COALESCE(o.discount_total,0) > 0
               THEN E'\nTạm tính: ' || public.fn_notify_vnd(o.subtotal)
                    || E'\nChiết khấu: -' || public.fn_notify_vnd(o.discount_total) ELSE '' END
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
                           'tong_tien', o.grand_total, 'cong_no', v_no_ht,
                           'la_dieu_chinh', v_ksua),
        v_kfp, o.customer_id);
    END IF;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- THU NỢ — tin nội bộ (giữ nguyên) + tin biến động công nợ gửi khách
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_debt_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_kh   TEXT;
  v_who  TEXT;
  v_cn   TEXT;
  v_con  NUMERIC;
  v_tg   TEXT;
  v_luc  TEXT;
  v_text TEXT;
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

  -- ── Biên nhận gửi khách ─────────────────────────────────────────────
  SELECT c.telegram_chat_id INTO v_tg FROM public.customers c
   WHERE c.id = NEW.customer_id AND c.telegram_enabled = true
     AND COALESCE(c.telegram_chat_id,'') <> '';

  IF v_tg IS NOT NULL THEN
    -- `payment_date` là kiểu DATE (không có giờ) ⇒ lấy `created_at` để có giờ thật.
    v_luc := to_char(timezone('Asia/Ho_Chi_Minh', COALESCE(NEW.created_at, now())),
                     'HH24:MI DD/MM/YYYY');

    v_text := '💵 <b>BIÊN NHẬN THANH TOÁN</b>'
     || E'\n<b>SANH LONG VETCO</b>' || COALESCE(' — ' || public.fn_tg_escape(v_cn), '')
     || E'\nThời gian: ' || v_luc
     || E'\n\nKính gửi: <b>' || public.fn_tg_escape(COALESCE(v_kh,'Quý khách')) || '</b>'
     || E'\nChúng tôi đã nhận thanh toán: <b>' || public.fn_notify_vnd(NEW.amount) || '</b>'
     || E'\nHình thức: ' || public.fn_notify_paymethod(NEW.payment_method::text)
     || E'\n\n────────────────'
     || CASE WHEN v_con > 0
             THEN E'\n📊 Tổng công nợ còn lại: <b>' || public.fn_notify_vnd(v_con) || '</b>'
             ELSE E'\n✅ <b>Quý khách đã thanh toán hết công nợ.</b>' END
     || E'\n\n<i>Cảm ơn quý khách. Nếu có sai sót, xin nhắn lại ngay trong nhóm này.</i>';

    PERFORM public.fn_notify_emit('debt.payment_customer', NEW.branch_id,
      jsonb_build_object('text', v_text,
                         'line', COALESCE(v_kh,'?') || ' · ' || public.fn_notify_vnd(NEW.amount),
                         'so_tien', NEW.amount, 'con_no', v_con),
      'debt.payment_customer:' || NEW.id, NEW.customer_id);
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
