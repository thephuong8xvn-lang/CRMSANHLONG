-- ═══════════════════════════════════════════════════════════════════════════
-- KÊNH TELEGRAM CỦA KHÁCH: HIỆN LÝ DO THAY VÌ TẮT IM LẶNG
-- 2026-08-09
--
-- ── Bệnh ────────────────────────────────────────────────────────────────
-- Telegram trả 403 (bot bị đuổi / chưa được thêm / nhóm đã xoá) thì drain
-- `UPDATE customers SET telegram_enabled=false`. Không ghi lại một chữ nào
-- về LÝ DO, cũng không hiện ra đâu cả. Hậu quả thật: vụ khách "Đặng Thế
-- Phương" tối 07/08 — user bật cờ, hệ thống tắt, user bật lại, hệ thống tắt
-- lại, lặp đúng 2 vòng và mất gần một ngày mới hiểu chuyện gì xảy ra.
--
-- ── User chốt 09/08 ─────────────────────────────────────────────────────
-- *"về mặc định thì tính năng này không tự tắt được"* ⇒ MẶC ĐỊNH KHÔNG BAO
-- GIỜ tự tắt kênh của khách. Chỉ GHI LẠI lý do + thời điểm để hiện lên hồ sơ.
-- Ai muốn hành vi cũ thì bật cờ `auto_disable_dead_chat` trong
-- `system_settings.notification_config` — mặc định `false`.
--
-- Đánh đổi đã cân nhắc: nhóm chết mà không tắt thì mỗi sự kiện của khách đó
-- tốn thêm 1 request Telegram rồi hỏng. KHÔNG có vòng lặp vô hạn — dòng log
-- bị đánh 'failed' ngay, không vào diện retry. Vài request/ngày đổi lấy việc
-- không bao giờ im lặng đánh mất một kênh khách là đáng.
--
-- ── Ba thứ đợt này thêm ─────────────────────────────────────────────────
--   1. `customers.telegram_last_error(_at)` + `telegram_auto_disabled_at`
--      → hồ sơ khách hiện được dải đỏ "vì sao không gửi được".
--   2. Tin gửi THÀNH CÔNG thì tự xoá lý do → cảnh báo tự lành, không phải
--      dọn tay, không bao giờ báo động giả về một nhóm đang chạy tốt.
--   3. `fn_tg_check_customer_start/result` — nút "Kiểm tra lại" trên hồ sơ.
--      Dùng **getChatMember**, KHÔNG dùng `getChat`: `getChat` trả HTTP 200
--      cho nhóm thường ngay cả khi bot đã bị đuổi (đã sập bẫy này tối 07/08).
--      user_id của bot = phần trước dấu ':' của token, không cần gọi getMe.
--
-- 🪤 pg_net gửi request SAU KHI transaction commit ⇒ không thể vừa post vừa
--    đọc kết quả trong cùng một hàm. Bắt buộc tách 2 RPC: start → (FE hỏi
--    lại vài lần) → result.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Chỗ chứa lý do ─────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS telegram_last_error       TEXT,
  ADD COLUMN IF NOT EXISTS telegram_last_error_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_auto_disabled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.customers.telegram_last_error IS
  'Lý do lần gửi Telegram gần nhất hỏng, bằng tiếng Việt, hiện thẳng lên hồ sơ khách. '
  'Tự xoá khi có một tin gửi thành công.';
COMMENT ON COLUMN public.customers.telegram_auto_disabled_at IS
  'Thời điểm HỆ THỐNG tự tắt telegram_enabled (chỉ xảy ra khi bật cờ '
  'auto_disable_dead_chat). NULL = do người dùng tự tắt hoặc chưa từng bị tắt. '
  'Phân biệt hai trường hợp này để nút "Kiểm tra lại" chỉ bật lại cái do máy tắt.';

ALTER TABLE public.telegram_channels
  ADD COLUMN IF NOT EXISTS last_error    TEXT,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

-- ── 2. Cờ cấu hình, MẶC ĐỊNH TẮT ──────────────────────────────────────────
UPDATE public.system_settings
   SET value = jsonb_set(value, '{auto_disable_dead_chat}', 'false'::jsonb, true)
 WHERE key = 'notification_config'
   AND NOT (value ? 'auto_disable_dead_chat');

-- ── 3. Dịch mô tả lỗi của Telegram sang tiếng người ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_tg_reason(p_desc TEXT, p_code INTEGER)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_desc,'') ILIKE '%bot was kicked%'
      THEN 'Bot đã bị xoá khỏi nhóm. Thêm lại @crmsanhlongbot vào nhóm rồi bấm "Kiểm tra lại".'
    WHEN COALESCE(p_desc,'') ILIKE '%bot is not a member%'
      THEN 'Bot không còn trong nhóm. Thêm lại @crmsanhlongbot vào nhóm rồi bấm "Kiểm tra lại".'
    WHEN COALESCE(p_desc,'') ILIKE '%group chat was deleted%'
      THEN 'Nhóm Telegram đã bị xoá. Cần tạo nhóm mới và dán id mới vào hồ sơ.'
    WHEN COALESCE(p_desc,'') ILIKE '%chat not found%'
      THEN 'Không tìm thấy nhóm: id nhóm sai, hoặc bot @crmsanhlongbot CHƯA từng được thêm vào nhóm.'
    WHEN COALESCE(p_desc,'') ILIKE '%not enough rights%'
      OR COALESCE(p_desc,'') ILIKE '%have no rights to send%'
      THEN 'Bot đang bị cấm gửi tin trong nhóm. Vào nhóm mở lại quyền gửi tin cho bot.'
    WHEN COALESCE(p_desc,'') ILIKE '%user is deactivated%'
      THEN 'Tài khoản Telegram này đã bị vô hiệu hoá.'
    WHEN COALESCE(p_desc,'') <> '' THEN 'Telegram báo: ' || p_desc
    ELSE 'Telegram trả lỗi HTTP ' || COALESCE(p_code::text, '?')
  END;
$$;

-- ── 4. Drain: ghi lý do, và CHỈ tắt khi được cho phép ──────────────────────
-- Nền là bản 20260774 (trần theo từng nhóm + gửi ảnh). Khác ba chỗ, đều đã
-- đánh dấu 🆕 trong thân hàm.
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
  v_auto_off   BOOLEAN;   -- 🆕 có được phép tự tắt kênh chết không
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
  v_reason     TEXT;      -- 🆕 lý do bằng tiếng Việt
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
  -- 🆕 Mặc định FALSE: không cấu hình gì thì hệ thống KHÔNG tự tắt kênh nào.
  v_auto_off   := COALESCE((v_cfg->>'auto_disable_dead_chat')::boolean, false);

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
           l.customer_id,
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

      -- 🆕 Gửi được rồi thì cảnh báo cũ hết giá trị — tự xoá, khỏi dọn tay.
      IF r.chat_id IS NOT NULL THEN
        UPDATE public.customers
           SET telegram_last_error=NULL, telegram_last_error_at=NULL
         WHERE telegram_chat_id=r.chat_id AND telegram_last_error IS NOT NULL;
        UPDATE public.telegram_channels
           SET last_error=NULL, last_error_at=NULL
         WHERE chat_id=r.chat_id AND last_error IS NOT NULL;
      END IF;
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

        -- 🆕 GHI LÝ DO LUÔN LUÔN; TẮT KÊNH thì chỉ khi user bật cờ.
        v_reason := public.fn_tg_reason(COALESCE(v_desc, r.error_msg), r.status_code);
        IF r.chat_id IS NOT NULL THEN
          UPDATE public.customers
             SET telegram_last_error    = v_reason,
                 telegram_last_error_at = now(),
                 telegram_enabled       = CASE WHEN v_auto_off THEN false ELSE telegram_enabled END,
                 telegram_auto_disabled_at = CASE WHEN v_auto_off AND telegram_enabled
                                                  THEN now() ELSE telegram_auto_disabled_at END
           WHERE telegram_chat_id = r.chat_id;

          UPDATE public.telegram_channels
             SET last_error    = v_reason,
                 last_error_at = now(),
                 enabled       = CASE WHEN v_auto_off THEN false ELSE enabled END,
                 note          = CASE WHEN v_auto_off
                                      THEN COALESCE(note,'') || ' [tự tắt ' || to_char(now(),'DD/MM') || ']'
                                      ELSE note END
           WHERE chat_id = r.chat_id;
        END IF;
        v_dead := v_dead + 1;

      ELSIF r.attempts >= v_max_try THEN
        UPDATE public.notification_log SET status='failed', http_status=r.status_code,
               error=COALESCE(v_desc, r.error_msg,'HTTP ' || r.status_code) WHERE id=r.id;
        -- 🆕 Hết lượt thử cũng là một lần im lặng — cho nó hiện ra hồ sơ.
        IF r.chat_id IS NOT NULL THEN
          v_reason := public.fn_tg_reason(COALESCE(v_desc, r.error_msg), r.status_code)
                      || ' (đã thử ' || r.attempts || ' lần)';
          UPDATE public.customers
             SET telegram_last_error=v_reason, telegram_last_error_at=now()
           WHERE telegram_chat_id=r.chat_id;
          UPDATE public.telegram_channels
             SET last_error=v_reason, last_error_at=now() WHERE chat_id=r.chat_id;
        END IF;
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
                            'tu_tat', v_auto_off,
                            'batches',v_batches,'sua_tin',v_edits,'sent_today',v_sent_today);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(918273645);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify_drain() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify_drain() TO service_role;

-- ── 5. Nút "Kiểm tra lại": bước 1 — hỏi Telegram ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_tg_check_customer_start(p_customer_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault','net'
AS $$
DECLARE
  v_chat  TEXT;
  v_token TEXT;
  v_req   BIGINT;
BEGIN
  IF NOT public.fn_has_permission('customers.edit') THEN
    RAISE EXCEPTION 'Bạn không có quyền kiểm tra kênh Telegram của khách hàng';
  END IF;

  SELECT NULLIF(btrim(telegram_chat_id),'') INTO v_chat
    FROM public.customers WHERE id = p_customer_id;
  IF v_chat IS NULL THEN
    RETURN jsonb_build_object('xong', true, 'ok', false,
      'thong_diep', 'Khách chưa được gán id nhóm Telegram.');
  END IF;

  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token';
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('xong', true, 'ok', false,
      'thong_diep', 'Hệ thống chưa cấu hình token bot Telegram.');
  END IF;

  -- getChatMember chứ KHÔNG phải getChat: getChat trả 200 cả khi bot đã bị
  -- đuổi khỏi nhóm thường. user_id của bot nằm ngay trong token, trước ':'.
  SELECT net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/getChatMember',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('chat_id', v_chat,
                                  'user_id', split_part(v_token, ':', 1)::bigint)
  ) INTO v_req;

  RETURN jsonb_build_object('xong', false, 'req_id', v_req, 'chat_id', v_chat);
END;
$$;

-- ── 6. Nút "Kiểm tra lại": bước 2 — đọc kết quả ───────────────────────────
-- pg_net chỉ thực sự gửi sau khi transaction của bước 1 commit ⇒ FE hỏi lại
-- hàm này vài lần cho tới khi `xong = true`.
CREATE OR REPLACE FUNCTION public.fn_tg_check_customer_result(
  p_customer_id UUID, p_req_id BIGINT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','net'
AS $$
DECLARE
  v_code   INTEGER;
  v_err    TEXT;
  v_body   TEXT;
  v_desc   TEXT;
  v_status TEXT;
  v_ok     BOOLEAN;
  v_reason TEXT;
  v_bat    BOOLEAN := false;
BEGIN
  IF NOT public.fn_has_permission('customers.edit') THEN
    RAISE EXCEPTION 'Bạn không có quyền kiểm tra kênh Telegram của khách hàng';
  END IF;

  SELECT status_code, error_msg, content INTO v_code, v_err, v_body
    FROM net._http_response WHERE id = p_req_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('xong', false);   -- Telegram chưa trả lời
  END IF;

  BEGIN
    v_desc   := v_body::jsonb->>'description';
    v_status := v_body::jsonb->'result'->>'status';
  EXCEPTION WHEN OTHERS THEN v_status := NULL;
  END;

  -- 'left' / 'kicked' vẫn trả HTTP 200 — phải soi `status`, không tin mã HTTP.
  v_ok := COALESCE(v_code,0) BETWEEN 200 AND 299
          AND v_status IN ('member','administrator','creator');

  IF v_ok THEN
    -- Chỉ bật lại kênh mà HỆ THỐNG đã tắt. Người dùng tự tắt thì tôn trọng.
    UPDATE public.customers
       SET telegram_last_error = NULL,
           telegram_last_error_at = NULL,
           telegram_enabled = CASE WHEN telegram_auto_disabled_at IS NOT NULL
                                   THEN true ELSE telegram_enabled END,
           telegram_auto_disabled_at = NULL
     WHERE id = p_customer_id
     RETURNING telegram_enabled INTO v_bat;

    RETURN jsonb_build_object('xong', true, 'ok', true, 'trang_thai', v_status,
      'dang_bat', v_bat,
      'thong_diep', 'Bot đang ở trong nhóm và gửi tin được'
                    || CASE WHEN v_bat THEN '.' ELSE ', nhưng ô "Gửi thông báo Telegram" đang tắt.' END);
  END IF;

  v_reason := CASE
    WHEN v_status IN ('left','kicked')
      THEN 'Bot KHÔNG còn trong nhóm (trạng thái: ' || v_status ||
           '). Thêm lại @crmsanhlongbot vào nhóm rồi bấm "Kiểm tra lại".'
    ELSE public.fn_tg_reason(COALESCE(v_desc, v_err), v_code)
  END;

  UPDATE public.customers
     SET telegram_last_error = v_reason, telegram_last_error_at = now()
   WHERE id = p_customer_id;

  RETURN jsonb_build_object('xong', true, 'ok', false,
    'trang_thai', v_status, 'thong_diep', v_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tg_check_customer_start(UUID)          FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_tg_check_customer_result(UUID, BIGINT) FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_tg_reason(TEXT, INTEGER)               FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_tg_check_customer_start(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_check_customer_result(UUID, BIGINT) TO authenticated;

-- ── 7. Backfill: những khách đã bị tắt im lặng từ trước ───────────────────
-- Không tự bật lại (không có bằng chứng nhóm đã sống); chỉ nói ra vì sao tắt
-- để user bấm "Kiểm tra lại" và tự quyết.
WITH loi AS (
  SELECT DISTINCT ON (l.chat_id)
         l.chat_id, l.error, l.http_status, l.created_at
    FROM public.notification_log l
   WHERE l.status = 'failed' AND l.chat_id IS NOT NULL
   ORDER BY l.chat_id, l.created_at DESC
)
UPDATE public.customers c
   SET telegram_last_error = public.fn_tg_reason(loi.error, loi.http_status),
       telegram_last_error_at = loi.created_at,
       telegram_auto_disabled_at = COALESCE(c.telegram_auto_disabled_at, loi.created_at)
  FROM loi
 WHERE c.telegram_chat_id = loi.chat_id
   AND c.telegram_enabled = false
   AND c.telegram_last_error IS NULL;

NOTIFY pgrst, 'reload schema';
