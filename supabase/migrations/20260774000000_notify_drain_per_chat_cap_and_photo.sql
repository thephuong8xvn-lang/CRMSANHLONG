-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — TRẦN TỐC ĐỘ THEO TỪNG NHÓM + GỬI ẢNH
-- 2026-08-07
--
-- ── Vì sao phải tách trần ───────────────────────────────────────────────
-- Telegram có HAI giới hạn khác nhau, trước giờ tôi gộp làm một:
--   • ~20 tin/phút cho **MỖI NHÓM**  → chống dội một nhóm
--   • ~30 tin/giây trên **TOÀN BOT** → trần hạ tầng
-- `per_run_cap = 5` (mỗi lượt drain 15 giây) được đặt ra cho giới hạn thứ
-- nhất, nhưng nó đang chặn cả tổng số tin. Hậu quả: broadcast khuyến mãi tới
-- 50 nhóm KHÁC NHAU — vốn chẳng đụng giới hạn nào — vẫn bò mất 2,5 phút.
--
-- ⇒ `per_run_cap`   = trần cho MỖI CHAT trong một lượt (giữ 5)
-- ⇒ `per_run_total` = trần TỔNG một lượt (20) ⇒ 80 tin/phút trên các nhóm
--   khác nhau, vẫn kém xa 30 tin/giây của Telegram.
--
-- Đếm theo chat bằng một biến jsonb dạng {chat_id: số tin đã gửi lượt này}.
--
-- ── Gửi ảnh ─────────────────────────────────────────────────────────────
-- Sự kiện nào có `payload->>'photo'` thì đi qua `fn_tg_send_photo` (sendPhoto
-- kèm chú thích) thay vì sendMessage. `fn_promo_broadcast` đã tự bỏ ảnh khi
-- nội dung vượt 1000 ký tự vì Telegram giới hạn chú thích 1024.
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
  v_run_cap    INTEGER;   -- trần cho MỖI chat trong một lượt
  v_run_total  INTEGER;   -- trần TỔNG một lượt
  v_quiet_from INTEGER;
  v_quiet_to   INTEGER;
  v_edit_hrs   INTEGER;
  v_dry        BOOLEAN;
  v_hour       INTEGER;
  v_quiet      BOOLEAN;
  v_day_start  TIMESTAMPTZ;
  v_sent_today INTEGER;
  v_batches    INTEGER := 0;
  v_recon      INTEGER := 0;
  v_migrated   INTEGER := 0;
  v_dead       INTEGER := 0;
  v_edits      INTEGER := 0;
  v_chat_cnt   JSONB := '{}'::jsonb;
  r            RECORD;
  tg           RECORD;
  v_old_msg    BIGINT;
  v_ids        BIGINT[];
  v_cnt        INTEGER;
  v_msg        TEXT;
  v_photo      TEXT;
  v_lines      TEXT;
  v_last       TIMESTAMPTZ;
  v_day_cnt    INTEGER;
  v_new_chat   TEXT;
  v_old_chat   TEXT;
  v_desc       TEXT;
  v_kh         TEXT;
  v_logid      BIGINT;
BEGIN
  IF NOT pg_try_advisory_lock(918273645) THEN
    RETURN jsonb_build_object('skipped','đang chạy lượt trước');
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key='notification_config';
  v_enabled    := COALESCE((v_cfg->>'enabled')::boolean, false);
  v_max_try    := COALESCE((v_cfg->>'max_attempts')::int, 5);
  v_lines_cap  := COALESCE((v_cfg->>'batch_lines')::int, 20);
  v_gcap       := COALESCE((v_cfg->>'global_daily_cap')::int, 200);
  v_run_cap    := COALESCE((v_cfg->>'per_run_cap')::int, 5);
  v_run_total  := COALESCE((v_cfg->>'per_run_total')::int, 20);
  v_quiet_from := COALESCE((v_cfg->>'quiet_from')::int, 22);
  v_quiet_to   := COALESCE((v_cfg->>'quiet_to')::int, 6);
  v_edit_hrs   := COALESCE((v_cfg->>'edit_window_hours')::int, 168);
  v_dry        := COALESCE((v_cfg->>'dry_run_customer')::boolean, false);

  v_day_start := timezone('Asia/Ho_Chi_Minh',
                   date_trunc('day', timezone('Asia/Ho_Chi_Minh', now())));
  v_hour  := EXTRACT(hour FROM timezone('Asia/Ho_Chi_Minh', now()))::int;
  v_quiet := CASE WHEN v_quiet_from = v_quiet_to THEN false
                  WHEN v_quiet_from > v_quiet_to
                  THEN v_hour >= v_quiet_from OR v_hour < v_quiet_to
                  ELSE v_hour >= v_quiet_from AND v_hour < v_quiet_to END;

  -- ═══ PHA 1: THU KẾT QUẢ — VÔ ĐIỀU KIỆN ═══════════════════════════════
  FOR r IN
    SELECT l.id, l.req_id, l.attempts, l.channel_code, l.chat_id, l.mode,
           COALESCE(l.last_try_at, l.created_at) AS tried_at,
           resp.status_code, resp.error_msg, resp.content
    FROM public.notification_log l
    LEFT JOIN net._http_response resp ON resp.id = l.req_id
    WHERE l.status='queued' AND l.req_id IS NOT NULL
    LIMIT 200
  LOOP
    IF r.status_code BETWEEN 200 AND 299 THEN
      UPDATE public.notification_log
         SET status='sent', http_status=r.status_code, sent_at=now(),
             tg_message_id = COALESCE(tg_message_id,
               NULLIF(r.content::jsonb->'result'->>'message_id','')::bigint)
       WHERE id=r.id;
      v_recon := v_recon + 1;

    ELSIF r.status_code IS NOT NULL OR r.error_msg IS NOT NULL THEN
      v_new_chat := NULL; v_desc := NULL;
      BEGIN
        v_new_chat := r.content::jsonb->'parameters'->>'migrate_to_chat_id';
        v_desc     := r.content::jsonb->>'description';
      EXCEPTION WHEN OTHERS THEN v_new_chat := NULL;
      END;

      IF v_new_chat IS NOT NULL THEN
        v_old_chat := r.chat_id;
        UPDATE public.telegram_channels SET chat_id=v_new_chat, updated_at=now(),
               note=COALESCE(note,'') || ' [supergroup ' || to_char(now(),'DD/MM') || ']'
         WHERE chat_id=v_old_chat;
        UPDATE public.customers SET telegram_chat_id=v_new_chat WHERE telegram_chat_id=v_old_chat;
        UPDATE public.branches  SET telegram_chat_id=v_new_chat WHERE telegram_chat_id=v_old_chat;
        UPDATE public.notification_log SET req_id=NULL, attempts=GREATEST(attempts-1,0),
               error='nhóm nâng lên supergroup → ' || v_new_chat WHERE id=r.id;
        v_migrated := v_migrated + 1;

      ELSIF r.mode='edit' THEN
        IF COALESCE(v_desc,'') ILIKE '%not modified%' THEN
          UPDATE public.notification_log SET status='sent', sent_at=now(),
                 error='nội dung không đổi' WHERE id=r.id;
        ELSE
          UPDATE public.notification_log
             SET mode='send', req_id=NULL, tg_message_id=NULL, attempts=0,
                 error='sửa tin không được (' || COALESCE(v_desc,'?') || ') → gửi tin mới'
           WHERE id=r.id;
        END IF;
        v_recon := v_recon + 1;

      ELSIF r.status_code=403 OR COALESCE(v_desc,'') ILIKE '%chat not found%'
            OR COALESCE(v_desc,'') ILIKE '%bot was kicked%'
            OR COALESCE(v_desc,'') ILIKE '%group chat was deleted%' THEN
        UPDATE public.notification_log SET status='failed', http_status=r.status_code,
               error='nhóm không dùng được: ' || COALESCE(v_desc, r.error_msg,'403') WHERE id=r.id;
        IF r.chat_id IS NOT NULL THEN
          UPDATE public.customers SET telegram_enabled=false WHERE telegram_chat_id=r.chat_id;
          UPDATE public.telegram_channels SET enabled=false,
                 note=COALESCE(note,'') || ' [tự tắt ' || to_char(now(),'DD/MM') || ']'
           WHERE chat_id=r.chat_id;
        END IF;
        v_dead := v_dead + 1;

      ELSIF r.attempts >= v_max_try THEN
        UPDATE public.notification_log SET status='failed', http_status=r.status_code,
               error=COALESCE(v_desc, r.error_msg,'HTTP ' || r.status_code) WHERE id=r.id;
      ELSE
        UPDATE public.notification_log SET req_id=NULL, http_status=r.status_code,
               error=COALESCE(v_desc, r.error_msg,'HTTP ' || r.status_code) WHERE id=r.id;
      END IF;
      v_recon := v_recon + 1;

    ELSIF r.tried_at < now() - interval '10 minutes' THEN
      IF r.attempts >= v_max_try THEN
        UPDATE public.notification_log SET status='failed',
               error='không có phản hồi từ pg_net' WHERE id=r.id;
      ELSE
        UPDATE public.notification_log SET req_id=NULL WHERE id=r.id;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_enabled THEN
    PERFORM pg_advisory_unlock(918273645);
    RETURN jsonb_build_object('reconciled',v_recon,'skipped','kill-switch đang tắt');
  END IF;

  -- ── Pha 2: gửi lại tin đã rớt ───────────────────────────────────────
  FOR r IN
    SELECT id, message, channel_code, event_type, branch_id, customer_id,
           event_ids, chat_id, mode, tg_message_id, subject_key
    FROM public.notification_log
    WHERE status='queued' AND req_id IS NULL AND attempts < v_max_try
      AND COALESCE(last_try_at, created_at)
          < now() - (interval '1 minute' * power(2, LEAST(attempts,5)))
    LIMIT 20
  LOOP
    IF r.mode='edit' AND r.tg_message_id IS NOT NULL THEN
      PERFORM public.fn_tg_edit(r.chat_id, r.tg_message_id, r.message, r.event_type,
                                r.branch_id, r.customer_id, r.subject_key, r.event_ids);
      UPDATE public.notification_log SET status='failed',
             error=COALESCE(error,'') || ' (đã thử lại)' WHERE id=r.id;
    ELSE
      PERFORM public.fn_tg_send(r.message, r.channel_code, r.event_type, r.branch_id,
                                r.event_ids, r.id, r.chat_id, NULL, r.customer_id);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_sent_today FROM public.notification_log
   WHERE created_at >= v_day_start AND status <> 'skipped';
  IF v_sent_today >= v_gcap THEN
    PERFORM pg_advisory_unlock(918273645);
    RETURN jsonb_build_object('reconciled',v_recon,'capped',true);
  END IF;

  -- ═══ PHA 3A: 'full' — mỗi sự kiện một tin ═══════════════════════════
  FOR r IN
    SELECT e.id, e.event_type, e.branch_id, e.customer_id, e.payload, e.subject_key,
           e.created_at, ru.channel_code, ru.severity, ru.quiet_hours,
           ru.daily_cap, ru.audience, ru.delay_sec
    FROM public.notification_events e
    JOIN public.notification_rules ru ON ru.event_type = e.event_type
    WHERE e.status='pending' AND ru.enabled = true AND ru.compose='full'
    ORDER BY e.created_at
    LIMIT 200
  LOOP
    EXIT WHEN v_batches >= v_run_total;

    IF r.delay_sec > 0
       AND r.created_at > now() - (interval '1 second' * r.delay_sec)
    THEN CONTINUE; END IF;

    IF v_quiet AND r.quiet_hours AND r.severity <> 'critical' THEN CONTINUE; END IF;

    SELECT count(*) INTO v_day_cnt FROM public.notification_log
     WHERE event_type=r.event_type AND status<>'skipped' AND created_at >= v_day_start;
    IF v_day_cnt >= r.daily_cap THEN CONTINUE; END IF;

    SELECT * INTO tg FROM public.fn_notify_target(
      r.audience, r.channel_code, r.branch_id, r.customer_id);
    IF tg.chat_id IS NULL THEN
      UPDATE public.notification_events SET status='skipped', processed_at=now()
       WHERE id=r.id;
      CONTINUE;
    END IF;

    -- Trần theo TỪNG nhóm: nhóm này đã đủ chỉ tiêu lượt này thì để lượt sau,
    -- nhưng các nhóm khác vẫn được gửi tiếp.
    IF COALESCE((v_chat_cnt->>tg.chat_id)::int, 0) >= v_run_cap THEN CONTINUE; END IF;

    v_msg   := COALESCE(r.payload->>'text', r.payload->>'line', '(tin trống)');
    v_photo := NULLIF(r.payload->>'photo', '');

    IF r.audience='customer' AND v_dry THEN
      SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id=r.customer_id;
      v_msg := '🧪 <b>BẢN THỬ</b> — đáng lẽ gửi cho: '
               || public.fn_tg_escape(COALESCE(v_kh,'(chưa gán khách)'))
               || E'\n────────────────\n' || v_msg;
      v_photo := NULL;   -- bản thử không cần ảnh, tránh chú thích quá dài
    END IF;

    IF length(v_msg) > 4000 THEN v_msg := left(v_msg,3950) || E'\n… (đã cắt bớt)'; END IF;

    -- Đã từng gửi tin cho chủ thể này vào đúng nhóm này ⇒ SỬA tin cũ.
    v_old_msg := NULL;
    IF r.subject_key IS NOT NULL THEN
      SELECT l.tg_message_id INTO v_old_msg
      FROM public.notification_log l
      WHERE l.subject_key = r.subject_key AND l.chat_id = tg.chat_id
        AND l.tg_message_id IS NOT NULL AND l.status = 'sent'
        AND l.created_at > now() - (interval '1 hour' * v_edit_hrs)
      ORDER BY l.created_at DESC LIMIT 1;
    END IF;

    IF v_old_msg IS NOT NULL THEN
      PERFORM public.fn_tg_edit(tg.chat_id, v_old_msg, v_msg, r.event_type,
                                r.branch_id, r.customer_id, r.subject_key, ARRAY[r.id]);
      v_edits := v_edits + 1;
    ELSIF v_photo IS NOT NULL THEN
      PERFORM public.fn_tg_send_photo(tg.chat_id, v_photo, v_msg, r.event_type,
                                      r.branch_id, r.customer_id, ARRAY[r.id], r.subject_key);
    ELSE
      v_logid := public.fn_tg_send(v_msg, tg.label, r.event_type, r.branch_id,
                                   ARRAY[r.id], NULL, tg.chat_id, tg.thread_id, r.customer_id);
      UPDATE public.notification_log SET subject_key = r.subject_key WHERE id = v_logid;
    END IF;

    UPDATE public.notification_events SET status='sent', processed_at=now() WHERE id=r.id;
    v_chat_cnt := jsonb_set(v_chat_cnt, ARRAY[tg.chat_id],
                    to_jsonb(COALESCE((v_chat_cnt->>tg.chat_id)::int,0) + 1));
    v_batches := v_batches + 1;
  END LOOP;

  -- ═══ PHA 3B: 'list' — gom nhiều sự kiện, chỉ nội bộ ═════════════════
  FOR r IN
    SELECT e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
           ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours, ru.daily_cap,
           ru.delay_sec, min(e.created_at) AS oldest
    FROM public.notification_events e
    JOIN public.notification_rules ru ON ru.event_type = e.event_type
    WHERE e.status='pending' AND ru.enabled = true AND ru.compose='list'
      AND ru.audience='internal'
    GROUP BY e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
             ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours,
             ru.daily_cap, ru.delay_sec
    ORDER BY min(e.created_at)
    LIMIT 30
  LOOP
    EXIT WHEN v_batches >= v_run_total;

    IF GREATEST(r.batch_window_sec, r.delay_sec) > 0
       AND r.oldest > now() - (interval '1 second' * GREATEST(r.batch_window_sec, r.delay_sec))
    THEN CONTINUE; END IF;
    IF v_quiet AND r.quiet_hours AND r.severity <> 'critical' THEN CONTINUE; END IF;

    IF r.min_interval_sec > 0 THEN
      SELECT max(created_at) INTO v_last FROM public.notification_log
       WHERE event_type=r.event_type AND branch_id IS NOT DISTINCT FROM r.branch_id
         AND status<>'skipped';
      IF v_last IS NOT NULL
         AND v_last > now() - (interval '1 second' * r.min_interval_sec)
      THEN CONTINUE; END IF;
    END IF;

    SELECT count(*) INTO v_day_cnt FROM public.notification_log
     WHERE event_type=r.event_type AND status<>'skipped' AND created_at >= v_day_start;
    IF v_day_cnt >= r.daily_cap THEN CONTINUE; END IF;

    SELECT * INTO tg FROM public.fn_notify_target('internal', r.channel_code, r.branch_id, NULL);
    IF tg.chat_id IS NULL THEN CONTINUE; END IF;
    IF COALESCE((v_chat_cnt->>tg.chat_id)::int, 0) >= v_run_cap THEN CONTINUE; END IF;

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
                          FROM public.branches b WHERE b.id=r.branch_id),'')
             || E'\n' || COALESCE(v_lines,'')
             || CASE WHEN v_cnt > v_lines_cap
                     THEN E'\n… và ' || (v_cnt - v_lines_cap) || ' việc tương tự' ELSE '' END;

    IF length(v_msg) > 4000 THEN v_msg := left(v_msg,3950) || E'\n… (đã cắt bớt)'; END IF;

    PERFORM public.fn_tg_send(v_msg, tg.label, r.event_type, r.branch_id,
                              v_ids, NULL, tg.chat_id, tg.thread_id, NULL);
    UPDATE public.notification_events SET status='sent', processed_at=now()
     WHERE id = ANY(v_ids);
    v_chat_cnt := jsonb_set(v_chat_cnt, ARRAY[tg.chat_id],
                    to_jsonb(COALESCE((v_chat_cnt->>tg.chat_id)::int,0) + 1));
    v_batches := v_batches + 1;
  END LOOP;

  PERFORM pg_advisory_unlock(918273645);
  RETURN jsonb_build_object('reconciled',v_recon,'migrated',v_migrated,'nhom_chet',v_dead,
                            'batches',v_batches,'sua_tin',v_edits,'sent_today',v_sent_today);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(918273645);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify_drain() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify_drain() TO service_role;

NOTIFY pgrst, 'reload schema';
