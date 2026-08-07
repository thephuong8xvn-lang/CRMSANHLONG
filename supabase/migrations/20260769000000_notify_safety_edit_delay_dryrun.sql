-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — ĐỢT B: CÁC LỚP CHỐNG TIN SAI
-- 2026-08-07
--
-- User: "tin nhắn tự động nên đôi khi sẽ bị sai, có cách nào khắc phục không"
-- và "trong trường hợp sai sót thì nhớ id tin đó, khi nhân viên sửa lại thì
-- gửi lại tin, ghi chú thêm là cập nhật tin".
--
-- Bốn lớp, xếp theo thứ tự tin gặp phải:
--
--   ① HOÃN TRƯỚC KHI GỬI (`notification_rules.delay_sec`)
--      Tin gửi khách nằm chờ N giây. Nhân viên sửa trong khoảng đó thì bản
--      sai BIẾN MẤT, khách không bao giờ thấy. Nội bộ vẫn 0 giây.
--
--   ② ĐÈ BẢN CHƯA GỬI (`subject_key`)
--      Cùng một đơn phát sinh sự kiện lần hai khi còn bản cũ đang chờ ⇒ xoá
--      bản cũ, giữ bản mới. Khách nhận đúng MỘT tin, là bản cuối cùng.
--
--   ③ SỬA TIN ĐÃ GỬI (editMessageText)
--      Quá thời gian hoãn rồi mới sửa đơn ⇒ KHÔNG gửi tin mới mà **sửa lại
--      đúng tin cũ** bằng `tg_message_id` đã lưu ở đợt A. Đây là ưu thế
--      Telegram có mà SMS/ZNS không có.
--
--   ④ CHẾ ĐỘ KHÔ (`dry_run_customer`)
--      Mọi tin lẽ ra gửi khách được chuyển hết về một nhóm thử nghiệm, kèm
--      dòng ghi rõ "đáng lẽ gửi cho ai". Chạy một tuần, đọc bằng mắt, yên tâm
--      rồi mới tắt cờ này. Nhóm thử: "Nhóm Gia cầm Ân Mỹ" (-5347145958).
--
--   ⑤ Công tắc riêng cho kênh khách (`customer_enabled`) — tắt tin khách
--      trong 5 giây mà tin nội bộ vẫn chạy.
--
-- ⚠️ `subject_key` SUY RA TỪ `fingerprint`, không thêm tham số cho
--    `fn_notify_emit`. Đổi chữ ký hàm này lần nữa là phải DROP bản cũ, mà 8
--    trigger nghiệp vụ đang sống phụ thuộc vào nó — càng ít đụng càng tốt.
--    Fingerprint đang có dạng `<loại>:<id>[:<dấu thời gian nếu là bản sửa>]`
--    nên hai đoạn đầu chính là "chủ thể" của tin.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS subject_key TEXT,
  ADD COLUMN IF NOT EXISTS mode        TEXT NOT NULL DEFAULT 'send';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notification_log_mode_check') THEN
    ALTER TABLE public.notification_log
      ADD CONSTRAINT notification_log_mode_check CHECK (mode IN ('send','edit'));
  END IF;
END $$;

ALTER TABLE public.notification_rules
  ADD COLUMN IF NOT EXISTS delay_sec INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.notification_rules.delay_sec IS
  'Giữ tin lại N giây trước khi gửi. Trong lúc chờ, sự kiện mới cùng subject_key sẽ '
  'ĐÈ bản cũ ⇒ nhân viên sửa kịp thì khách không bao giờ thấy bản sai. '
  'Nội bộ để 0; tin gửi khách nên 600 (10 phút).';

CREATE INDEX IF NOT EXISTS idx_notification_events_subject
  ON public.notification_events (subject_key) WHERE subject_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_log_subject
  ON public.notification_log (subject_key, created_at DESC)
  WHERE subject_key IS NOT NULL AND tg_message_id IS NOT NULL;

-- ── Cấu hình mới ────────────────────────────────────────────────────────
UPDATE public.system_settings
   SET value = value || jsonb_build_object(
         'customer_enabled',  true,
         'dry_run_customer',  true,             -- BẬT SẴN: chưa ai kiểm mắt thì đừng gửi khách
         'dry_run_chat_id',   '-5347145958',    -- Nhóm Gia cầm Ân Mỹ (thử nghiệm)
         'edit_window_hours', 168               -- quá 7 ngày thì gửi tin mới thay vì sửa
       ), updated_at = now()
 WHERE key = 'notification_config';

-- ── Nhóm thử nghiệm ─────────────────────────────────────────────────────
INSERT INTO public.telegram_channels (code, label, chat_id, show_sensitive, enabled, note)
VALUES ('thu_nghiem', '🧪 Thử nghiệm', '-5347145958', false, true,
        'Nhóm Gia cầm Ân Mỹ — nơi đổ tin ở chế độ khô, KHÔNG phải nhóm khách thật')
ON CONFLICT (code) DO UPDATE
  SET chat_id = EXCLUDED.chat_id, enabled = true, updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_notify_emit — suy ra subject_key và ĐÈ bản chưa gửi
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_notify_emit(
  p_event_type  TEXT,
  p_branch_id   UUID DEFAULT NULL,
  p_payload     JSONB DEFAULT '{}'::jsonb,
  p_fingerprint TEXT DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_sev  TEXT;
  v_subj TEXT;
BEGIN
  IF NOT COALESCE(
       (SELECT (value->>'enabled')::boolean FROM public.system_settings
         WHERE key = 'notification_config'), false)
  THEN RETURN; END IF;

  SELECT severity INTO v_sev FROM public.notification_rules
   WHERE event_type = p_event_type AND enabled = true;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_fingerprint IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.notification_events
        WHERE fingerprint = p_fingerprint AND status = 'pending')
  THEN RETURN; END IF;

  -- Chủ thể của tin = hai đoạn đầu của fingerprint (bỏ dấu thời gian bản sửa).
  IF p_fingerprint IS NOT NULL THEN
    v_subj := split_part(p_fingerprint, ':', 1) || ':' || split_part(p_fingerprint, ':', 2);

    -- ② Bản mới đè bản CHƯA GỬI của cùng chủ thể. Đây là lớp cứu chính:
    --    nhân viên sửa đơn trong thời gian hoãn thì bản sai bốc hơi.
    UPDATE public.notification_events
       SET status = 'skipped', processed_at = now()
     WHERE subject_key = v_subj AND status = 'pending';
  END IF;

  INSERT INTO public.notification_events
    (event_type, branch_id, customer_id, severity, payload, fingerprint, subject_key)
  VALUES (p_event_type, p_branch_id, p_customer_id, v_sev, p_payload, p_fingerprint, v_subj);
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_tg_edit — sửa lại tin đã gửi
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_tg_edit(
  p_chat_id     TEXT,
  p_message_id  BIGINT,
  p_text        TEXT,
  p_event_type  TEXT DEFAULT NULL,
  p_branch_id   UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_subject_key TEXT DEFAULT NULL,
  p_event_ids   BIGINT[] DEFAULT '{}'
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault','net'
AS $$
DECLARE
  v_token TEXT;
  v_req   BIGINT;
  v_log   BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token';

  INSERT INTO public.notification_log
    (event_type, branch_id, customer_id, channel_code, chat_id, message,
     event_ids, status, mode, subject_key, tg_message_id)
  VALUES (p_event_type, p_branch_id, p_customer_id, 'edit', p_chat_id, p_text,
          p_event_ids, 'queued', 'edit', p_subject_key, p_message_id)
  RETURNING id INTO v_log;

  IF v_token IS NULL THEN
    UPDATE public.notification_log SET status='skipped',
           error='thiếu vault secret telegram_bot_token' WHERE id=v_log;
    RETURN v_log;
  END IF;

  SELECT net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/editMessageText',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('chat_id', p_chat_id, 'message_id', p_message_id,
                                  'text', p_text, 'parse_mode', 'HTML',
                                  'disable_web_page_preview', true)
  ) INTO v_req;

  UPDATE public.notification_log
     SET req_id = v_req, attempts = attempts + 1, last_try_at = now()
   WHERE id = v_log;

  RETURN v_log;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_notify_target — thêm chế độ khô cho kênh khách
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_notify_target(
  p_audience    TEXT,
  p_channel     TEXT,
  p_branch_id   UUID,
  p_customer_id UUID
)
RETURNS TABLE (chat_id TEXT, thread_id BIGINT, label TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_chat TEXT;
  v_thr  BIGINT;
  v_code TEXT;
  v_cfg  JSONB;
BEGIN
  SELECT value INTO v_cfg FROM public.system_settings WHERE key='notification_config';

  IF p_audience = 'customer' THEN
    -- Công tắc riêng: tắt tin khách mà nội bộ vẫn chạy.
    IF NOT COALESCE((v_cfg->>'customer_enabled')::boolean, true) THEN RETURN; END IF;

    -- ④ Chế độ khô: dồn hết về nhóm thử nghiệm, không chạm khách thật.
    IF COALESCE((v_cfg->>'dry_run_customer')::boolean, false) THEN
      v_chat := v_cfg->>'dry_run_chat_id';
      IF COALESCE(v_chat,'') = '' THEN RETURN; END IF;
      RETURN QUERY SELECT v_chat, NULL::BIGINT, 'thu_nghiem'::TEXT;
      RETURN;
    END IF;

    IF p_customer_id IS NULL THEN RETURN; END IF;
    SELECT c.telegram_chat_id INTO v_chat
      FROM public.customers c
     WHERE c.id = p_customer_id AND c.telegram_enabled = true
       AND COALESCE(c.telegram_chat_id,'') <> '';
    IF v_chat IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT v_chat, NULL::BIGINT, 'khach'::TEXT;
    RETURN;
  END IF;

  IF p_channel = '@branch' THEN
    SELECT b.telegram_chat_id INTO v_chat
      FROM public.branches b
     WHERE b.id = p_branch_id AND COALESCE(b.telegram_chat_id,'') <> '';
    IF v_chat IS NOT NULL THEN
      RETURN QUERY SELECT v_chat, NULL::BIGINT, 'cn'::TEXT;
      RETURN;
    END IF;
    v_code := public.fn_notify_resolve_channel('@branch', p_branch_id);
  ELSE
    v_code := p_channel;
  END IF;

  SELECT t.chat_id, t.thread_id INTO v_chat, v_thr
    FROM public.telegram_channels t WHERE t.code = v_code AND t.enabled = true;
  IF v_chat IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_chat, v_thr, v_code;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- DRAIN — hoãn theo delay_sec, sửa tin cũ thay vì gửi mới, gắn nhãn bản thử
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
  r            RECORD;
  tg           RECORD;
  -- Dùng biến vô hướng chứ KHÔNG dùng RECORD cho tin cũ: nếu nhánh SELECT INTO
  -- không chạy (subject_key rỗng) thì record chưa được gán, đọc field của nó
  -- sẽ ném lỗi và làm sập cả lượt drain.
  v_old_msg_id BIGINT;
  v_log        BIGINT;
  v_ids        BIGINT[];
  v_cnt        INTEGER;
  v_msg        TEXT;
  v_lines      TEXT;
  v_last       TIMESTAMPTZ;
  v_day_cnt    INTEGER;
  v_new_chat   TEXT;
  v_old_chat   TEXT;
  v_desc       TEXT;
  v_kh         TEXT;
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

  -- ═══ PHA 1: THU KẾT QUẢ ═══════════════════════════════════════════════
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

      -- Sửa tin hỏng (tin gốc bị xoá / quá hạn sửa) ⇒ quay về gửi tin mới.
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
    LIMIT 50
  LOOP
    EXIT WHEN v_batches >= v_run_cap;

    -- ① Chưa hết thời gian hoãn ⇒ để đó, nhân viên còn kịp sửa.
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

    v_msg := COALESCE(r.payload->>'text', r.payload->>'line', '(tin trống)');

    -- Bản thử: ghi rõ đáng lẽ gửi cho ai, để đọc soát không nhầm.
    IF r.audience='customer' AND v_dry THEN
      SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id=r.customer_id;
      v_msg := '🧪 <b>BẢN THỬ</b> — đáng lẽ gửi cho: '
               || public.fn_tg_escape(COALESCE(v_kh,'(chưa gán khách)'))
               || E'\n────────────────\n' || v_msg;
    END IF;

    IF length(v_msg) > 4000 THEN v_msg := left(v_msg,3950) || E'\n… (đã cắt bớt)'; END IF;

    -- ③ Đã từng gửi tin cho chủ thể này vào đúng nhóm này ⇒ SỬA tin cũ.
    v_old_msg_id := NULL;
    IF r.subject_key IS NOT NULL THEN
      SELECT l.tg_message_id INTO v_old_msg_id
      FROM public.notification_log l
      WHERE l.subject_key = r.subject_key
        AND l.chat_id = tg.chat_id
        AND l.tg_message_id IS NOT NULL
        AND l.status = 'sent'
        AND l.created_at > now() - (interval '1 hour' * v_edit_hrs)
      ORDER BY l.created_at DESC LIMIT 1;
    END IF;

    IF v_old_msg_id IS NOT NULL THEN
      PERFORM public.fn_tg_edit(tg.chat_id, v_old_msg_id, v_msg,
                                r.event_type, r.branch_id, r.customer_id,
                                r.subject_key, ARRAY[r.id]);
      v_edits := v_edits + 1;
    ELSE
      -- Lấy id dòng log từ chính hàm gửi, KHÔNG dò bằng max(id) — dò kiểu đó
      -- sai ngay khi có lời gọi gửi khác xen vào.
      v_log := public.fn_tg_send(v_msg, tg.label, r.event_type, r.branch_id,
                                 ARRAY[r.id], NULL, tg.chat_id, tg.thread_id, r.customer_id);
      UPDATE public.notification_log SET subject_key = r.subject_key WHERE id = v_log;
    END IF;

    UPDATE public.notification_events SET status='sent', processed_at=now() WHERE id=r.id;
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
    EXIT WHEN v_batches >= v_run_cap;

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

REVOKE ALL ON FUNCTION public.fn_tg_edit(TEXT,BIGINT,TEXT,TEXT,UUID,UUID,TEXT,BIGINT[])
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_tg_edit(TEXT,BIGINT,TEXT,TEXT,UUID,UUID,TEXT,BIGINT[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_target(TEXT,TEXT,UUID,UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
