-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — TIN BÁN HÀNG KIỂU HOÁ ĐƠN ĐẦY ĐỦ
-- 2026-08-07
--
-- User: "chỉ cần nhận 1 tin hóa đơn là chuẩn, thông tin ghi đầy đủ đơn hàng,
-- chi nhánh, người bán, thời gian, sản phẩm, tổng tiền thanh toán".
--
-- ── Vì sao phải thêm chế độ soạn tin mới ────────────────────────────────
-- `fn_notify_drain` đang soạn theo kiểu DANH SÁCH: gom mọi sự kiện cùng loại
-- + cùng chi nhánh thành một tin, mỗi sự kiện một dòng "• …" dưới một tiêu đề
-- chung. Kiểu đó hợp với việc thưa (nhập kho, chuyển kho), nhưng không chứa
-- nổi một hoá đơn nhiều dòng.
--
-- ⇒ Thêm cột `notification_rules.compose`:
--     'list' (mặc định) — như cũ, gom nhiều sự kiện vào một tin.
--     'full'            — MỖI sự kiện MỘT tin, lấy nguyên `payload->>'text'`
--                         do trigger soạn sẵn, drain không thêm bớt gì.
--   `sales.order` chuyển sang 'full'. Các luồng khác giữ 'list'.
--
-- ⚠️ Thoát HTML phải làm ở TRIGGER, không làm ở drain: drain không phân biệt
--    được đâu là thẻ <b> mình cố ý đặt, đâu là dấu < trong tên sản phẩm khách
--    nhập. Nên trigger tự escape từng giá trị động rồi mới ghép với thẻ.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notification_rules
  ADD COLUMN IF NOT EXISTS compose TEXT NOT NULL DEFAULT 'list';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'notification_rules_compose_check') THEN
    ALTER TABLE public.notification_rules
      ADD CONSTRAINT notification_rules_compose_check CHECK (compose IN ('list','full'));
  END IF;
END $$;

COMMENT ON COLUMN public.notification_rules.compose IS
  '''list'' = gom nhiều sự kiện vào 1 tin, mỗi sự kiện 1 dòng. '
  '''full'' = mỗi sự kiện 1 tin riêng, dùng nguyên payload->>''text''.';

UPDATE public.notification_rules SET compose = 'full', updated_at = now()
 WHERE event_type = 'sales.order';

-- ── Tiền chính xác từng đồng (hoá đơn thì không rút gọn "5,3tr") ─────────
CREATE OR REPLACE FUNCTION public.fn_notify_vnd(p NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(to_char(round(COALESCE(p,0)), 'FM999,999,999,999'), ',', '.') || 'đ';
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER BÁN HÀNG — soạn nguyên tin hoá đơn
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
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
  IF TG_OP = 'INSERT' THEN
    v_evt := CASE WHEN NEW.status::text IN ('confirmed','completed') THEN 'sales.order'
                  WHEN NEW.status::text = 'cancelled' THEN 'sales.cancelled'
                  ELSE NULL END;
  ELSE
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_evt := CASE WHEN NEW.status::text = 'completed' THEN 'sales.order'
                  WHEN NEW.status::text = 'cancelled' THEN 'sales.cancelled'
                  ELSE NULL END;
  END IF;
  IF v_evt IS NULL THEN RETURN NEW; END IF;

  SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id = NEW.customer_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.confirmed_by, NEW.owner_user_id);
  SELECT b.name INTO v_cn  FROM public.branches b   WHERE b.id = NEW.branch_id;
  SELECT w.name INTO v_kho FROM public.warehouses w WHERE w.id = NEW.warehouse_id;

  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(NEW.confirmed_at, NEW.created_at, now())), 'HH24:MI DD/MM/YYYY');

  -- ── Huỷ đơn: tin ngắn, vẫn đi đường 'list' ──────────────────────────
  IF v_evt = 'sales.cancelled' THEN
    PERFORM public.fn_notify_emit(v_evt, NEW.branch_id,
      jsonb_build_object('line',
        NEW.order_code || ' · ' || COALESCE(v_kh,'khách lẻ')
        || ' · ' || public.fn_notify_vnd(NEW.grand_total)
        || COALESCE(' · ' || v_who, '')
        || COALESCE(' · lý do: ' || NEW.cancel_reason, '')),
      v_evt || ':' || NEW.id);
    RETURN NEW;
  END IF;

  -- ── Danh sách hàng ──────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.order_lines WHERE order_id = NEW.id;

  SELECT string_agg(
           '· ' || public.fn_tg_escape(pr.name)
           || '  ' || trim(to_char(l.quantity, 'FM999999990.###'))
           || ' × ' || public.fn_notify_vnd(l.unit_price)
           || ' = <b>' || public.fn_notify_vnd(l.line_total) || '</b>',
           E'\n' ORDER BY l.created_at)
    INTO v_sp
  FROM (SELECT * FROM public.order_lines
         WHERE order_id = NEW.id ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id;

  -- ── Dấu bất thường ──────────────────────────────────────────────────
  SELECT threshold INTO v_thr FROM public.notification_rules WHERE event_type = 'sales.order';
  v_big  := COALESCE((v_thr->>'big_amount')::numeric, 5000000);
  v_dpct := COALESCE((v_thr->>'discount_pct')::numeric, 5);
  v_damt := COALESCE((v_thr->>'discount_amount')::numeric, 500000);
  v_pct  := CASE WHEN COALESCE(NEW.subtotal,0) > 0
                 THEN COALESCE(NEW.discount_total,0) / NEW.subtotal * 100 ELSE 0 END;

  IF NEW.grand_total >= v_big THEN v_co := v_co || E'\n⚠️ <b>ĐƠN GIÁ TRỊ LỚN</b>'; END IF;
  IF COALESCE(NEW.discount_total,0) > 0
     AND (v_pct >= v_dpct OR NEW.discount_total >= v_damt)
  THEN v_co := v_co || E'\n⚠️ <b>Chiết khấu ' || round(v_pct) || '%</b>'; END IF;

  -- ── Soạn tin hoá đơn ────────────────────────────────────────────────
  v_text :=
      '🧾 <b>' || public.fn_tg_escape(NEW.order_code) || '</b>'
   || E'\n🏢 ' || public.fn_tg_escape(COALESCE(v_cn, 'chưa gán chi nhánh'))
   || COALESCE(' — kho ' || public.fn_tg_escape(v_kho), '')
   || E'\n🕐 ' || v_luc
   || E'\n👤 Khách: <b>' || public.fn_tg_escape(COALESCE(v_kh, 'Khách lẻ')) || '</b>'
   || E'\n🧑‍💼 Người bán: ' || public.fn_tg_escape(COALESCE(v_who, '—'))
   || E'\n\n📦 <b>Hàng (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
   || COALESCE(v_sp, '(không có dòng hàng)')
   || CASE WHEN COALESCE(v_n,0) > 25
           THEN E'\n… và ' || (v_n - 25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || CASE WHEN COALESCE(NEW.discount_total,0) > 0
           THEN E'\nTạm tính: ' || public.fn_notify_vnd(NEW.subtotal)
                || E'\nChiết khấu: -' || public.fn_notify_vnd(NEW.discount_total)
           ELSE '' END
   || CASE WHEN COALESCE(NEW.shipping_fee,0) > 0
           THEN E'\nPhí giao: ' || public.fn_notify_vnd(NEW.shipping_fee) ELSE '' END
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(NEW.grand_total) || '</b>'
   || E'\n💳 ' || public.fn_notify_paymethod(NEW.payment_method::text)
   || ' · đã trả ' || public.fn_notify_vnd(NEW.paid_amount)
   || CASE WHEN COALESCE(NEW.debt_amount,0) > 0
           THEN ' · <b>còn nợ ' || public.fn_notify_vnd(NEW.debt_amount) || '</b>'
           ELSE '' END
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(NEW.notes), '')
   || v_co;

  PERFORM public.fn_notify_emit(v_evt, NEW.branch_id,
    jsonb_build_object('text', v_text,
                       'line', NEW.order_code || ' · ' || public.fn_notify_vnd(NEW.grand_total),
                       'tong_tien', NEW.grand_total,
                       'ghi_no', COALESCE(NEW.debt_amount,0)),
    v_evt || ':' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;   -- không bao giờ được cản việc bán hàng
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- DRAIN — thêm nhánh 'full': mỗi sự kiện một tin, gửi nguyên văn
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_notify_drain()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','net'
AS $$
DECLARE
  v_cfg        JSONB;
  v_enabled    BOOLEAN;
  v_max_try    INTEGER;
  v_lines_cap  INTEGER;
  v_gcap       INTEGER;
  v_run_cap    INTEGER;
  v_quiet_from INTEGER;
  v_quiet_to   INTEGER;
  v_hour       INTEGER;
  v_quiet      BOOLEAN;
  v_day_start  TIMESTAMPTZ;
  v_sent_today INTEGER;
  v_batches    INTEGER := 0;
  v_recon      INTEGER := 0;
  v_migrated   INTEGER := 0;
  r            RECORD;
  v_chan       TEXT;
  v_ids        BIGINT[];
  v_cnt        INTEGER;
  v_msg        TEXT;
  v_lines      TEXT;
  v_last       TIMESTAMPTZ;
  v_day_cnt    INTEGER;
  v_new_chat   TEXT;
  v_old_chat   TEXT;
BEGIN
  IF NOT pg_try_advisory_lock(918273645) THEN
    RETURN jsonb_build_object('skipped', 'đang chạy lượt trước');
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'notification_config';
  v_enabled    := COALESCE((v_cfg->>'enabled')::boolean, false);
  v_max_try    := COALESCE((v_cfg->>'max_attempts')::int, 5);
  v_lines_cap  := COALESCE((v_cfg->>'batch_lines')::int, 20);
  v_gcap       := COALESCE((v_cfg->>'global_daily_cap')::int, 200);
  v_run_cap    := COALESCE((v_cfg->>'per_run_cap')::int, 5);
  v_quiet_from := COALESCE((v_cfg->>'quiet_from')::int, 22);
  v_quiet_to   := COALESCE((v_cfg->>'quiet_to')::int, 6);

  v_day_start := timezone('Asia/Ho_Chi_Minh',
                   date_trunc('day', timezone('Asia/Ho_Chi_Minh', now())));
  v_hour  := EXTRACT(hour FROM timezone('Asia/Ho_Chi_Minh', now()))::int;
  v_quiet := CASE WHEN v_quiet_from = v_quiet_to THEN false
                  WHEN v_quiet_from > v_quiet_to
                  THEN v_hour >= v_quiet_from OR v_hour < v_quiet_to
                  ELSE v_hour >= v_quiet_from AND v_hour < v_quiet_to END;

  -- ═══ PHA 1: THU KẾT QUẢ — VÔ ĐIỀU KIỆN ═══════════════════════════════
  FOR r IN
    SELECT l.id, l.req_id, l.attempts, l.channel_code,
           COALESCE(l.last_try_at, l.created_at) AS tried_at,
           resp.status_code, resp.error_msg, resp.content
    FROM public.notification_log l
    LEFT JOIN net._http_response resp ON resp.id = l.req_id
    WHERE l.status = 'queued' AND l.req_id IS NOT NULL
    LIMIT 200
  LOOP
    IF r.status_code BETWEEN 200 AND 299 THEN
      UPDATE public.notification_log
         SET status='sent', http_status=r.status_code, sent_at=now() WHERE id=r.id;
      v_recon := v_recon + 1;

    ELSIF r.status_code IS NOT NULL OR r.error_msg IS NOT NULL THEN
      v_new_chat := NULL;
      BEGIN
        v_new_chat := r.content::jsonb->'parameters'->>'migrate_to_chat_id';
      EXCEPTION WHEN OTHERS THEN v_new_chat := NULL;
      END;

      IF v_new_chat IS NOT NULL THEN
        SELECT chat_id INTO v_old_chat FROM public.telegram_channels WHERE code=r.channel_code;
        UPDATE public.telegram_channels
           SET chat_id=v_new_chat, updated_at=now(),
               note=COALESCE(note,'') || ' [tự đổi sang supergroup '
                    || to_char(now(),'DD/MM HH24:MI') || ']'
         WHERE chat_id = v_old_chat;
        UPDATE public.notification_log
           SET req_id=NULL, attempts=GREATEST(attempts-1,0),
               error='nhóm đã nâng lên supergroup → tự chuyển sang ' || v_new_chat
         WHERE id=r.id;
        v_migrated := v_migrated + 1;

      ELSIF r.attempts >= v_max_try THEN
        UPDATE public.notification_log
           SET status='failed', http_status=r.status_code,
               error=COALESCE(r.error_msg,'HTTP ' || r.status_code) WHERE id=r.id;
      ELSE
        UPDATE public.notification_log
           SET req_id=NULL, http_status=r.status_code,
               error=COALESCE(r.error_msg,'HTTP ' || r.status_code) WHERE id=r.id;
      END IF;
      v_recon := v_recon + 1;

    ELSIF r.tried_at < now() - interval '10 minutes' THEN
      IF r.attempts >= v_max_try THEN
        UPDATE public.notification_log
           SET status='failed', error='không có phản hồi từ pg_net' WHERE id=r.id;
      ELSE
        UPDATE public.notification_log SET req_id=NULL WHERE id=r.id;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_enabled THEN
    PERFORM pg_advisory_unlock(918273645);
    RETURN jsonb_build_object('reconciled', v_recon, 'migrated', v_migrated,
                              'skipped', 'kill-switch đang tắt');
  END IF;

  -- ── Pha 2: gửi lại tin đã rớt ───────────────────────────────────────
  FOR r IN
    SELECT id, message, channel_code, event_type, branch_id, event_ids
    FROM public.notification_log
    WHERE status='queued' AND req_id IS NULL AND attempts < v_max_try
      AND COALESCE(last_try_at, created_at)
          < now() - (interval '1 minute' * power(2, LEAST(attempts,5)))
    LIMIT 20
  LOOP
    PERFORM public.fn_tg_send(r.message, r.channel_code, r.event_type,
                              r.branch_id, r.event_ids, r.id);
  END LOOP;

  SELECT count(*) INTO v_sent_today FROM public.notification_log
   WHERE created_at >= v_day_start AND status <> 'skipped';
  IF v_sent_today >= v_gcap THEN
    IF NOT EXISTS (SELECT 1 FROM public.notification_log
                    WHERE event_type='system.cap' AND created_at >= v_day_start) THEN
      PERFORM public.fn_tg_send(
        '⚠️ Đã chạm trần ' || v_gcap || ' tin/ngày — tạm dừng gửi tới sáng mai.',
        'ky_thuat','system.cap',NULL,'{}');
    END IF;
    PERFORM pg_advisory_unlock(918273645);
    RETURN jsonb_build_object('reconciled',v_recon,'migrated',v_migrated,'capped',true);
  END IF;

  -- ═══ PHA 3A: luật 'full' — MỖI SỰ KIỆN MỘT TIN, GỬI NGUYÊN VĂN ══════
  FOR r IN
    SELECT e.id, e.event_type, e.branch_id, e.payload,
           ru.channel_code, ru.severity, ru.quiet_hours, ru.daily_cap
    FROM public.notification_events e
    JOIN public.notification_rules ru ON ru.event_type = e.event_type
    WHERE e.status='pending' AND ru.enabled = true AND ru.compose = 'full'
    ORDER BY e.created_at
    LIMIT 50
  LOOP
    EXIT WHEN v_batches >= v_run_cap;

    IF v_quiet AND r.quiet_hours AND r.severity <> 'critical' THEN CONTINUE; END IF;

    SELECT count(*) INTO v_day_cnt FROM public.notification_log
     WHERE event_type = r.event_type AND status <> 'skipped' AND created_at >= v_day_start;
    IF v_day_cnt >= r.daily_cap THEN CONTINUE; END IF;

    v_chan := public.fn_notify_resolve_channel(r.channel_code, r.branch_id);
    v_msg  := COALESCE(r.payload->>'text', r.payload->>'line', '(tin trống)');
    IF length(v_msg) > 4000 THEN
      v_msg := left(v_msg, 3950) || E'\n… (đã cắt bớt)';
    END IF;

    PERFORM public.fn_tg_send(v_msg, v_chan, r.event_type, r.branch_id, ARRAY[r.id]);
    UPDATE public.notification_events
       SET status='sent', processed_at=now() WHERE id = r.id;
    v_batches := v_batches + 1;
  END LOOP;

  -- ═══ PHA 3B: luật 'list' — gom nhiều sự kiện vào một tin ════════════
  FOR r IN
    SELECT e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
           ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours, ru.daily_cap,
           min(e.created_at) AS oldest
    FROM public.notification_events e
    JOIN public.notification_rules ru ON ru.event_type = e.event_type
    WHERE e.status='pending' AND ru.enabled = true AND ru.compose = 'list'
    GROUP BY e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
             ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours, ru.daily_cap
    ORDER BY min(e.created_at)
    LIMIT 30
  LOOP
    EXIT WHEN v_batches >= v_run_cap;

    IF r.batch_window_sec > 0
       AND r.oldest > now() - (interval '1 second' * r.batch_window_sec)
    THEN CONTINUE; END IF;

    IF v_quiet AND r.quiet_hours AND r.severity <> 'critical' THEN CONTINUE; END IF;

    IF r.min_interval_sec > 0 THEN
      SELECT max(created_at) INTO v_last FROM public.notification_log
       WHERE event_type=r.event_type AND branch_id IS NOT DISTINCT FROM r.branch_id
         AND status <> 'skipped';
      IF v_last IS NOT NULL
         AND v_last > now() - (interval '1 second' * r.min_interval_sec)
      THEN CONTINUE; END IF;
    END IF;

    SELECT count(*) INTO v_day_cnt FROM public.notification_log
     WHERE event_type=r.event_type AND status <> 'skipped' AND created_at >= v_day_start;
    IF v_day_cnt >= r.daily_cap THEN CONTINUE; END IF;

    v_chan := public.fn_notify_resolve_channel(r.channel_code, r.branch_id);

    SELECT array_agg(id ORDER BY created_at), count(*) INTO v_ids, v_cnt
    FROM (SELECT id, created_at FROM public.notification_events
           WHERE status='pending' AND event_type=r.event_type
             AND branch_id IS NOT DISTINCT FROM r.branch_id
           ORDER BY created_at LIMIT 500) t;

    IF v_ids IS NULL OR cardinality(v_ids)=0 THEN CONTINUE; END IF;

    SELECT string_agg('• ' || public.fn_tg_escape(COALESCE(payload->>'line','(không có mô tả)')),
                      E'\n' ORDER BY created_at)
      INTO v_lines
    FROM (SELECT payload, created_at FROM public.notification_events
           WHERE id = ANY(v_ids) ORDER BY created_at LIMIT v_lines_cap) t2;

    v_msg := CASE r.severity WHEN 'critical' THEN '🔴 ' WHEN 'warn' THEN '🟠 ' ELSE '' END
             || '<b>' || public.fn_tg_escape(r.label) || '</b>'
             || CASE WHEN v_cnt > 1 THEN ' — ' || v_cnt || ' việc' ELSE '' END
             || COALESCE((SELECT ' · ' || public.fn_tg_escape(b.name)
                          FROM public.branches b WHERE b.id=r.branch_id), '')
             || E'\n' || COALESCE(v_lines,'')
             || CASE WHEN v_cnt > v_lines_cap
                     THEN E'\n… và ' || (v_cnt - v_lines_cap) || ' việc tương tự'
                     ELSE '' END;

    IF length(v_msg) > 4000 THEN v_msg := left(v_msg,3950) || E'\n… (đã cắt bớt)'; END IF;

    PERFORM public.fn_tg_send(v_msg, v_chan, r.event_type, r.branch_id, v_ids);
    UPDATE public.notification_events
       SET status='sent', processed_at=now() WHERE id = ANY(v_ids);
    v_batches := v_batches + 1;
  END LOOP;

  PERFORM pg_advisory_unlock(918273645);
  RETURN jsonb_build_object('reconciled',v_recon,'migrated',v_migrated,
                            'batches',v_batches,'sent_today',v_sent_today);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(918273645);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify_drain() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify_drain() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_vnd(NUMERIC) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
