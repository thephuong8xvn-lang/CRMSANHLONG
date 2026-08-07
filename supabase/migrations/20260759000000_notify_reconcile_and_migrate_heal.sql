-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — VÁ 2 LỖ IM LẶNG PHÁT HIỆN LÚC ĐẤU NỐI NHÓM THẬT
-- 2026-08-05 (ngay sau 20260758000000)
--
-- ── Lỗ 1: kill-switch tắt thì KHÔNG AI thu kết quả gửi ────────────────────
-- `fn_notify_drain` thoát ngay khi kill-switch tắt, nên pha "thu kết quả từ
-- net._http_response" không chạy. Nhưng `fn_send_telegram` (monitor 08:00 +
-- nhắc nợ 08:30) VẪN GỬI THẬT dù kill-switch tắt — vì kill-switch chỉ chặn
-- dòng tin hoạt động, không chặn 2 cron cũ.
--   ⇒ Tin của 2 cron đó nằm mãi ở 'queued', và pg_net xoá phản hồi sau ~6 giờ
--     ⇒ gửi hỏng cũng không ai biết. Đúng loại lỗi mà cả module này sinh ra
--     để diệt.
--   ⇒ Sửa: pha thu kết quả chạy VÔ ĐIỀU KIỆN. Chỉ pha GỬI mới bị kill-switch
--     chặn. Thu kết quả là ghi sổ, không phát sinh tin nhắn nào.
--
-- ── Lỗ 2: nhóm nâng cấp lên supergroup là chết câm ───────────────────────
-- Nhóm SANHLONGVETCO hiện là nhóm PHẲNG (type=group, chat_id=-5426496767).
-- Telegram tự nâng nhóm thường thành supergroup khi bật Topics, khi thêm quá
-- nhiều thành viên, hoặc khi đổi vài thiết lập. Lúc đó **chat_id đổi hẳn** và
-- mọi lần gửi sau trả 400 "group chat was upgraded to a supergroup chat".
--   ⇒ Thông báo tắt ngóm, không ai nhận ra vì chẳng có gì báo động.
--   ⇒ Sửa: Telegram trả kèm `parameters.migrate_to_chat_id`. Bắt lấy con số
--     đó, TỰ cập nhật mọi kênh đang dùng chat_id cũ, rồi xếp lại hàng gửi.
--     Tự lành, không cần ai can thiệp.
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
  v_run_cap    := COALESCE((v_cfg->>'per_run_cap')::int, 12);
  v_quiet_from := COALESCE((v_cfg->>'quiet_from')::int, 22);
  v_quiet_to   := COALESCE((v_cfg->>'quiet_to')::int, 6);

  v_day_start := timezone('Asia/Ho_Chi_Minh',
                   date_trunc('day', timezone('Asia/Ho_Chi_Minh', now())));
  v_hour  := EXTRACT(hour FROM timezone('Asia/Ho_Chi_Minh', now()))::int;
  v_quiet := CASE WHEN v_quiet_from > v_quiet_to
                  THEN v_hour >= v_quiet_from OR v_hour < v_quiet_to
                  ELSE v_hour >= v_quiet_from AND v_hour < v_quiet_to END;

  -- ═══ PHA 1: THU KẾT QUẢ — CHẠY VÔ ĐIỀU KIỆN ═══════════════════════════
  -- Không đặt sau kill-switch. Đây là ghi sổ, không gửi tin. Tin của 2 cron
  -- cũ vẫn chảy qua fn_send_telegram kể cả khi kill-switch tắt, và phản hồi
  -- pg_net tự xoá sau ~6 giờ — không thu ở đây là mất dấu vĩnh viễn.
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
         SET status = 'sent', http_status = r.status_code, sent_at = now()
       WHERE id = r.id;
      v_recon := v_recon + 1;

    ELSIF r.status_code IS NOT NULL OR r.error_msg IS NOT NULL THEN
      -- ── Tự lành khi nhóm bị nâng lên supergroup ──────────────────────
      v_new_chat := NULL;
      BEGIN
        v_new_chat := r.content::jsonb->'parameters'->>'migrate_to_chat_id';
      EXCEPTION WHEN OTHERS THEN
        v_new_chat := NULL;   -- content không phải JSON hợp lệ
      END;

      IF v_new_chat IS NOT NULL THEN
        SELECT chat_id INTO v_old_chat FROM public.telegram_channels
         WHERE code = r.channel_code;

        -- Đổi cho MỌI kênh đang trỏ vào nhóm cũ, không chỉ kênh vừa lỗi:
        -- nhóm phẳng nên cả 7 kênh dùng chung một chat_id.
        UPDATE public.telegram_channels
           SET chat_id = v_new_chat, updated_at = now(),
               note = COALESCE(note,'') || ' [tự đổi sang supergroup '
                      || to_char(now(),'DD/MM HH24:MI') || ']'
         WHERE chat_id = v_old_chat;

        -- Xếp lại hàng, KHÔNG tính là một lần thử hỏng: lỗi này do đổi hạ
        -- tầng chứ không phải nội dung tin sai.
        UPDATE public.notification_log
           SET req_id = NULL, attempts = GREATEST(attempts - 1, 0),
               error = 'nhóm đã nâng lên supergroup → tự chuyển sang ' || v_new_chat
         WHERE id = r.id;

        v_migrated := v_migrated + 1;

      ELSIF r.attempts >= v_max_try THEN
        UPDATE public.notification_log
           SET status = 'failed', http_status = r.status_code,
               error = COALESCE(r.error_msg, 'HTTP ' || r.status_code)
         WHERE id = r.id;
      ELSE
        UPDATE public.notification_log
           SET req_id = NULL, http_status = r.status_code,
               error = COALESCE(r.error_msg, 'HTTP ' || r.status_code)
         WHERE id = r.id;
      END IF;
      v_recon := v_recon + 1;

    ELSIF r.tried_at < now() - interval '10 minutes' THEN
      IF r.attempts >= v_max_try THEN
        UPDATE public.notification_log
           SET status = 'failed', error = 'không có phản hồi từ pg_net'
         WHERE id = r.id;
      ELSE
        UPDATE public.notification_log SET req_id = NULL WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;

  -- ═══ Từ đây trở xuống mới là GỬI — kill-switch chặn ═══════════════════
  IF NOT v_enabled THEN
    PERFORM pg_advisory_unlock(918273645);
    RETURN jsonb_build_object('reconciled', v_recon, 'migrated', v_migrated,
                              'skipped', 'kill-switch đang tắt');
  END IF;

  -- ── Pha 2: gửi lại tin đã rớt, backoff 2^attempts phút ───────────────
  FOR r IN
    SELECT id, message, channel_code, event_type, branch_id, event_ids
    FROM public.notification_log
    WHERE status = 'queued' AND req_id IS NULL
      AND attempts < v_max_try
      AND COALESCE(last_try_at, created_at)
          < now() - (interval '1 minute' * power(2, LEAST(attempts, 5)))
    LIMIT 20
  LOOP
    PERFORM public.fn_tg_send(r.message, r.channel_code, r.event_type,
                              r.branch_id, r.event_ids, r.id);
  END LOOP;

  SELECT count(*) INTO v_sent_today FROM public.notification_log
   WHERE created_at >= v_day_start AND status <> 'skipped';
  IF v_sent_today >= v_gcap THEN
    IF NOT EXISTS (SELECT 1 FROM public.notification_log
                    WHERE event_type = 'system.cap' AND created_at >= v_day_start) THEN
      PERFORM public.fn_tg_send(
        '⚠️ Đã chạm trần ' || v_gcap || ' tin/ngày — tạm dừng gửi tới sáng mai.',
        'ky_thuat', 'system.cap', NULL, '{}');
    END IF;
    PERFORM pg_advisory_unlock(918273645);
    RETURN jsonb_build_object('reconciled', v_recon, 'migrated', v_migrated,
                              'capped', true);
  END IF;

  -- ── Pha 3: gom sự kiện đang chờ thành tin ────────────────────────────
  FOR r IN
    SELECT e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
           ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours, ru.daily_cap,
           min(e.created_at) AS oldest
    FROM public.notification_events e
    JOIN public.notification_rules ru ON ru.event_type = e.event_type
    WHERE e.status = 'pending' AND ru.enabled = true
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
       WHERE event_type = r.event_type
         AND branch_id IS NOT DISTINCT FROM r.branch_id
         AND status <> 'skipped';
      IF v_last IS NOT NULL
         AND v_last > now() - (interval '1 second' * r.min_interval_sec)
      THEN CONTINUE; END IF;
    END IF;

    SELECT count(*) INTO v_day_cnt FROM public.notification_log
     WHERE event_type = r.event_type AND status <> 'skipped'
       AND created_at >= v_day_start;
    IF v_day_cnt >= r.daily_cap THEN CONTINUE; END IF;

    v_chan := public.fn_notify_resolve_channel(r.channel_code, r.branch_id);

    SELECT array_agg(id ORDER BY created_at), count(*)
      INTO v_ids, v_cnt
    FROM (SELECT id, created_at FROM public.notification_events
           WHERE status = 'pending' AND event_type = r.event_type
             AND branch_id IS NOT DISTINCT FROM r.branch_id
           ORDER BY created_at LIMIT 500) t;

    IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN CONTINUE; END IF;

    SELECT string_agg('• ' || public.fn_tg_escape(COALESCE(payload->>'line','(không có mô tả)')),
                      E'\n' ORDER BY created_at)
      INTO v_lines
    FROM (SELECT payload, created_at FROM public.notification_events
           WHERE id = ANY(v_ids) ORDER BY created_at LIMIT v_lines_cap) t2;

    v_msg := CASE r.severity WHEN 'critical' THEN '🔴 ' WHEN 'warn' THEN '🟠 ' ELSE '' END
             || '<b>' || public.fn_tg_escape(r.label) || '</b>'
             || CASE WHEN v_cnt > 1 THEN ' — ' || v_cnt || ' việc' ELSE '' END
             || COALESCE((SELECT ' · ' || public.fn_tg_escape(b.name)
                          FROM public.branches b WHERE b.id = r.branch_id), '')
             || E'\n' || COALESCE(v_lines, '')
             || CASE WHEN v_cnt > v_lines_cap
                     THEN E'\n… và ' || (v_cnt - v_lines_cap) || ' việc tương tự'
                     ELSE '' END;

    IF length(v_msg) > 4000 THEN
      v_msg := left(v_msg, 3950) || E'\n… (đã cắt bớt)';
    END IF;

    PERFORM public.fn_tg_send(v_msg, v_chan, r.event_type, r.branch_id, v_ids);

    UPDATE public.notification_events
       SET status = 'sent', processed_at = now()
     WHERE id = ANY(v_ids);

    v_batches := v_batches + 1;
  END LOOP;

  PERFORM pg_advisory_unlock(918273645);
  RETURN jsonb_build_object('reconciled', v_recon, 'migrated', v_migrated,
                            'batches', v_batches, 'sent_today', v_sent_today);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(918273645);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify_drain() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify_drain() TO service_role;

NOTIFY pgrst, 'reload schema';
