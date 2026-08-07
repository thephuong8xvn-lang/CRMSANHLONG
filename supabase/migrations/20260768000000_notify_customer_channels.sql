-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — ĐỢT A: NỀN KÊNH KHÁCH HÀNG
-- 2026-08-07
--
-- Mô hình user chốt: mỗi KHÁCH và mỗi CHI NHÁNH có một nhóm Telegram riêng do
-- user tạo tay, trong nhóm có khách + user + kế toán. Bot gửi được vào nhóm mà
-- khách không cần bấm Start — đây là cách hợp lệ để vượt hạn chế "bot không
-- nhắn trước". (Bot API không có hàm tạo nhóm nên phải tạo tay; tự động hoá
-- bằng userbot MTProto sẽ bị Telegram khoá tài khoản.)
--
-- ── Ranh giới an toàn quan trọng nhất của cả đợt này ────────────────────
-- Sắp có hàng trăm kênh, trong đó có kênh NGƯỜI NGOÀI đọc được. Một lỗi định
-- tuyến là lộ giá vốn, lợi nhuận, hoặc công nợ của khách khác. Nên tách bằng
-- CẤU TRÚC chứ không bằng việc nhớ:
--
--   notification_rules.audience = 'internal' | 'customer'
--
--   • Luật 'internal' KHÔNG BAO GIỜ giải ra được chat của khách.
--   • Luật 'customer' CHỈ giải ra chat của đúng khách trong sự kiện, và bắt
--     buộc sự kiện phải có customer_id — thiếu thì bỏ qua, tuyệt đối không
--     rơi về kênh mặc định.
--
-- Toàn bộ 23 luật hiện có đều được đặt 'internal'. Muốn gửi cho khách thì phải
-- tạo luật mới và ghi rõ audience — không có đường vô tình.
--
-- ── Chuẩn bị cho việc SỬA TIN ĐÃ GỬI (user yêu cầu) ────────────────────
-- User: "trong trường hợp sai sót thì nhớ id tin đó, khi nhân viên sửa lại thì
-- gửi lại tin, ghi chú thêm là cập nhật tin".
-- ⇒ Đợt này lưu `tg_message_id` + `chat_id` vào notification_log khi thu kết
--   quả. Đợt B sẽ dùng chúng để gọi editMessageText thay vì gửi tin mới.
--
-- ── Nhóm chết ───────────────────────────────────────────────────────────
-- Khách rời nhóm / xoá nhóm / kick bot ⇒ Telegram trả 403 hoặc 400 "chat not
-- found". Không xử thì mỗi ngày lại retry vô ích. Nay tự tắt kênh đó.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Trường idtlg ─────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS telegram_chat_id      TEXT,
  ADD COLUMN IF NOT EXISTS telegram_enabled      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_promo_optout BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.telegram_chat_id IS
  'idtlg — id nhóm Telegram riêng của khách (dạng -100…). User tạo nhóm tay rồi dán vào.';
COMMENT ON COLUMN public.customers.telegram_promo_optout IS
  'true = không nhận tin khuyến mãi, vẫn nhận tin hoá đơn và lịch vaccine.';

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_telegram_chat
  ON public.customers (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- ── 2. Sự kiện mang theo khách hàng ─────────────────────────────────────
ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS customer_id UUID;

-- ── 3. Luật phân theo đối tượng đọc ─────────────────────────────────────
ALTER TABLE public.notification_rules
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'internal';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'notification_rules_audience_check') THEN
    ALTER TABLE public.notification_rules
      ADD CONSTRAINT notification_rules_audience_check
      CHECK (audience IN ('internal','customer'));
  END IF;
END $$;

COMMENT ON COLUMN public.notification_rules.audience IS
  '''internal'' = nhóm nội bộ (chủ, kế toán, chi nhánh). ''customer'' = nhóm riêng của khách. '
  'Luật internal KHÔNG BAO GIỜ giải ra chat khách, và ngược lại. Đây là ranh giới chống lộ '
  'giá vốn/lợi nhuận/công nợ khách khác.';

UPDATE public.notification_rules SET audience = 'internal' WHERE audience IS NULL;

-- ── 4. Nhật ký ghi thêm chat và id tin ──────────────────────────────────
ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS chat_id       TEXT,
  ADD COLUMN IF NOT EXISTS tg_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS customer_id   UUID;

COMMENT ON COLUMN public.notification_log.tg_message_id IS
  'message_id Telegram trả về. Cần để SỬA lại tin đã gửi khi nhân viên sửa đơn (đợt B).';

CREATE INDEX IF NOT EXISTS idx_notification_log_msg
  ON public.notification_log (event_type, customer_id, created_at DESC)
  WHERE tg_message_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. GIẢI ĐÍCH ĐẾN — một cửa duy nhất, tách cứng nội bộ và khách
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
  v_chat  TEXT;
  v_thr   BIGINT;
  v_code  TEXT;
BEGIN
  -- ── Khách hàng: chỉ đúng nhóm của khách đó, không có đường rơi về đâu ──
  IF p_audience = 'customer' THEN
    IF p_customer_id IS NULL THEN RETURN; END IF;   -- thiếu khách ⇒ KHÔNG gửi
    SELECT c.telegram_chat_id INTO v_chat
      FROM public.customers c
     WHERE c.id = p_customer_id
       AND c.telegram_enabled = true
       AND COALESCE(c.telegram_chat_id,'') <> '';
    IF v_chat IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT v_chat, NULL::BIGINT, 'khach'::TEXT;
    RETURN;
  END IF;

  -- ── Nội bộ ────────────────────────────────────────────────────────────
  IF p_channel = '@branch' THEN
    -- Ưu tiên nhóm riêng của chi nhánh (trường user tự điền), rồi mới tới
    -- bảng kênh cố định.
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
    FROM public.telegram_channels t
   WHERE t.code = v_code AND t.enabled = true;

  IF v_chat IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_chat, v_thr, v_code;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. fn_tg_send — nhận chat_id trực tiếp
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 PHẢI DROP CHỮ KÝ CŨ TRƯỚC. `CREATE OR REPLACE` với số tham số khác KHÔNG
--    thay thế hàm cũ mà tạo thêm một NẠP CHỒNG. Khi đó lời gọi 6 đối số khớp
--    cả hai bản (bản mới nhờ tham số mặc định) ⇒ Postgres báo "function is not
--    unique" ⇒ GÃY TOÀN BỘ thông báo đang chạy thật.
DROP FUNCTION IF EXISTS public.fn_tg_send(TEXT,TEXT,TEXT,UUID,BIGINT[],BIGINT);

CREATE OR REPLACE FUNCTION public.fn_tg_send(
  p_text         TEXT,
  p_channel      TEXT DEFAULT 'default',
  p_event_type   TEXT DEFAULT NULL,
  p_branch_id    UUID DEFAULT NULL,
  p_event_ids    BIGINT[] DEFAULT '{}',
  p_retry_log_id BIGINT DEFAULT NULL,
  p_chat_id      TEXT DEFAULT NULL,
  p_thread_id    BIGINT DEFAULT NULL,
  p_customer_id  UUID DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault','net'
AS $$
DECLARE
  v_chat   TEXT;
  v_thread BIGINT;
  v_on     BOOLEAN := true;
  v_token  TEXT;
  v_req    BIGINT;
  v_log    BIGINT;
  v_body   JSONB;
BEGIN
  IF p_chat_id IS NOT NULL THEN
    v_chat := p_chat_id; v_thread := p_thread_id;
  ELSE
    SELECT chat_id, thread_id, enabled INTO v_chat, v_thread, v_on
    FROM public.telegram_channels WHERE code = p_channel;
  END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token';

  IF p_retry_log_id IS NULL THEN
    INSERT INTO public.notification_log
      (event_type, branch_id, customer_id, channel_code, chat_id, message, event_ids, status)
    VALUES (p_event_type, p_branch_id, p_customer_id, p_channel, v_chat,
            p_text, p_event_ids, 'queued')
    RETURNING id INTO v_log;
  ELSE
    v_log := p_retry_log_id;
  END IF;

  IF v_chat IS NULL OR COALESCE(v_on, false) = false OR v_token IS NULL THEN
    UPDATE public.notification_log
       SET status = 'skipped',
           error  = CASE
                      WHEN v_token IS NULL THEN 'thiếu vault secret telegram_bot_token'
                      WHEN v_chat  IS NULL THEN 'chưa cấu hình chat_id'
                      ELSE 'kênh đang tắt'
                    END
     WHERE id = v_log;
    RETURN v_log;
  END IF;

  v_body := jsonb_build_object(
    'chat_id', v_chat, 'text', p_text,
    'parse_mode', 'HTML', 'disable_web_page_preview', true);
  IF v_thread IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('message_thread_id', v_thread);
  END IF;

  SELECT net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := v_body
  ) INTO v_req;

  UPDATE public.notification_log
     SET req_id = v_req, attempts = attempts + 1,
         last_try_at = now(), status = 'queued', chat_id = v_chat
   WHERE id = v_log;

  RETURN v_log;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. fn_notify_emit — mang thêm customer_id
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 Cùng lý do: drop chữ ký 4 đối số, nếu không mọi trigger đang gọi 4 đối số
--    sẽ nhập nhằng giữa bản cũ và bản mới. 8 trigger nghiệp vụ đang chạy thật
--    phụ thuộc vào hàm này — sai ở đây là câm toàn hệ thống.
DROP FUNCTION IF EXISTS public.fn_notify_emit(TEXT,UUID,JSONB,TEXT);

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
  v_sev TEXT;
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

  INSERT INTO public.notification_events
    (event_type, branch_id, customer_id, severity, payload, fingerprint)
  VALUES (p_event_type, p_branch_id, p_customer_id, v_sev, p_payload, p_fingerprint);
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. DRAIN — dùng fn_notify_target, thu message_id, tự tắt nhóm chết
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
  v_dead       INTEGER := 0;
  r            RECORD;
  tg           RECORD;
  v_ids        BIGINT[];
  v_cnt        INTEGER;
  v_msg        TEXT;
  v_lines      TEXT;
  v_last       TIMESTAMPTZ;
  v_day_cnt    INTEGER;
  v_new_chat   TEXT;
  v_old_chat   TEXT;
  v_desc       TEXT;
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
    SELECT l.id, l.req_id, l.attempts, l.channel_code, l.chat_id,
           COALESCE(l.last_try_at, l.created_at) AS tried_at,
           resp.status_code, resp.error_msg, resp.content
    FROM public.notification_log l
    LEFT JOIN net._http_response resp ON resp.id = l.req_id
    WHERE l.status = 'queued' AND l.req_id IS NOT NULL
    LIMIT 200
  LOOP
    IF r.status_code BETWEEN 200 AND 299 THEN
      -- Lưu message_id để đợt B sửa lại được tin này.
      UPDATE public.notification_log
         SET status='sent', http_status=r.status_code, sent_at=now(),
             tg_message_id = NULLIF(r.content::jsonb->'result'->>'message_id','')::bigint
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
        IF v_old_chat IS NULL THEN
          SELECT chat_id INTO v_old_chat FROM public.telegram_channels WHERE code=r.channel_code;
        END IF;
        UPDATE public.telegram_channels
           SET chat_id=v_new_chat, updated_at=now(),
               note=COALESCE(note,'') || ' [tự đổi supergroup ' || to_char(now(),'DD/MM HH24:MI') || ']'
         WHERE chat_id = v_old_chat;
        UPDATE public.customers
           SET telegram_chat_id = v_new_chat WHERE telegram_chat_id = v_old_chat;
        UPDATE public.branches
           SET telegram_chat_id = v_new_chat WHERE telegram_chat_id = v_old_chat;
        UPDATE public.notification_log
           SET req_id=NULL, attempts=GREATEST(attempts-1,0),
               error='nhóm nâng lên supergroup → tự chuyển sang ' || v_new_chat
         WHERE id=r.id;
        v_migrated := v_migrated + 1;

      ELSIF r.status_code IN (403) OR COALESCE(v_desc,'') ILIKE '%chat not found%'
            OR COALESCE(v_desc,'') ILIKE '%bot was kicked%'
            OR COALESCE(v_desc,'') ILIKE '%group chat was deleted%' THEN
        -- Nhóm chết: tắt hẳn, đừng retry mỗi ngày cho tới hết đời.
        UPDATE public.notification_log
           SET status='failed', http_status=r.status_code,
               error='nhóm không còn dùng được: ' || COALESCE(v_desc, r.error_msg, '403')
         WHERE id=r.id;
        IF r.chat_id IS NOT NULL THEN
          UPDATE public.customers SET telegram_enabled = false
           WHERE telegram_chat_id = r.chat_id;
          UPDATE public.telegram_channels SET enabled = false,
                 note = COALESCE(note,'') || ' [tự tắt: nhóm chết ' || to_char(now(),'DD/MM') || ']'
           WHERE chat_id = r.chat_id;
        END IF;
        v_dead := v_dead + 1;

      ELSIF r.attempts >= v_max_try THEN
        UPDATE public.notification_log
           SET status='failed', http_status=r.status_code,
               error=COALESCE(v_desc, r.error_msg,'HTTP ' || r.status_code) WHERE id=r.id;
      ELSE
        UPDATE public.notification_log
           SET req_id=NULL, http_status=r.status_code,
               error=COALESCE(v_desc, r.error_msg,'HTTP ' || r.status_code) WHERE id=r.id;
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
    RETURN jsonb_build_object('reconciled',v_recon,'migrated',v_migrated,
                              'nhom_chet',v_dead,'skipped','kill-switch đang tắt');
  END IF;

  -- ── Pha 2: gửi lại tin đã rớt ───────────────────────────────────────
  FOR r IN
    SELECT id, message, channel_code, event_type, branch_id, customer_id,
           event_ids, chat_id
    FROM public.notification_log
    WHERE status='queued' AND req_id IS NULL AND attempts < v_max_try
      AND COALESCE(last_try_at, created_at)
          < now() - (interval '1 minute' * power(2, LEAST(attempts,5)))
    LIMIT 20
  LOOP
    PERFORM public.fn_tg_send(r.message, r.channel_code, r.event_type,
                              r.branch_id, r.event_ids, r.id,
                              r.chat_id, NULL, r.customer_id);
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
    RETURN jsonb_build_object('reconciled',v_recon,'capped',true);
  END IF;

  -- ═══ PHA 3A: luật 'full' — mỗi sự kiện một tin ══════════════════════
  FOR r IN
    SELECT e.id, e.event_type, e.branch_id, e.customer_id, e.payload,
           ru.channel_code, ru.severity, ru.quiet_hours, ru.daily_cap, ru.audience
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

    SELECT * INTO tg FROM public.fn_notify_target(
      r.audience, r.channel_code, r.branch_id, r.customer_id);

    -- Không giải được đích ⇒ đánh dấu đã xử lý, KHÔNG rơi về kênh khác.
    IF tg.chat_id IS NULL THEN
      UPDATE public.notification_events
         SET status='skipped', processed_at=now() WHERE id = r.id;
      CONTINUE;
    END IF;

    v_msg := COALESCE(r.payload->>'text', r.payload->>'line', '(tin trống)');
    IF length(v_msg) > 4000 THEN v_msg := left(v_msg,3950) || E'\n… (đã cắt bớt)'; END IF;

    PERFORM public.fn_tg_send(v_msg, tg.label, r.event_type, r.branch_id,
                              ARRAY[r.id], NULL, tg.chat_id, tg.thread_id, r.customer_id);
    UPDATE public.notification_events
       SET status='sent', processed_at=now() WHERE id = r.id;
    v_batches := v_batches + 1;
  END LOOP;

  -- ═══ PHA 3B: luật 'list' — gom nhiều sự kiện vào một tin ════════════
  FOR r IN
    SELECT e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
           ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours, ru.daily_cap,
           ru.audience, min(e.created_at) AS oldest
    FROM public.notification_events e
    JOIN public.notification_rules ru ON ru.event_type = e.event_type
    WHERE e.status='pending' AND ru.enabled = true AND ru.compose = 'list'
      AND ru.audience = 'internal'   -- tin gom nhóm không bao giờ gửi cho khách
    GROUP BY e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
             ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours,
             ru.daily_cap, ru.audience
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

    SELECT * INTO tg FROM public.fn_notify_target(
      'internal', r.channel_code, r.branch_id, NULL);
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
                          FROM public.branches b WHERE b.id=r.branch_id), '')
             || E'\n' || COALESCE(v_lines,'')
             || CASE WHEN v_cnt > v_lines_cap
                     THEN E'\n… và ' || (v_cnt - v_lines_cap) || ' việc tương tự' ELSE '' END;

    IF length(v_msg) > 4000 THEN v_msg := left(v_msg,3950) || E'\n… (đã cắt bớt)'; END IF;

    PERFORM public.fn_tg_send(v_msg, tg.label, r.event_type, r.branch_id,
                              v_ids, NULL, tg.chat_id, tg.thread_id, NULL);
    UPDATE public.notification_events
       SET status='sent', processed_at=now() WHERE id = ANY(v_ids);
    v_batches := v_batches + 1;
  END LOOP;

  PERFORM pg_advisory_unlock(918273645);
  RETURN jsonb_build_object('reconciled',v_recon,'migrated',v_migrated,
                            'nhom_chet',v_dead,'batches',v_batches,
                            'sent_today',v_sent_today);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(918273645);
  RAISE;
END;
$$;

-- ── Quyền ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_tg_send(TEXT,TEXT,TEXT,UUID,BIGINT[],BIGINT,TEXT,BIGINT,UUID)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_tg_send(TEXT,TEXT,TEXT,UUID,BIGINT[],BIGINT,TEXT,BIGINT,UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_emit(TEXT,UUID,JSONB,TEXT,UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_target(TEXT,TEXT,UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_notify_drain() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify_drain() TO service_role;

NOTIFY pgrst, 'reload schema';
