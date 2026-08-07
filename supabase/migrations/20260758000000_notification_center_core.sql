-- ═══════════════════════════════════════════════════════════════════════════
-- TRUNG TÂM THÔNG BÁO TELEGRAM — ĐỢT 1: NỀN TẢNG
-- 2026-08-05
--
-- Mục tiêu: chủ theo dõi diễn biến hoạt động 3 chi nhánh trên Telegram
-- (nhập hàng kể cả nháp · xuất hàng · bán hàng · chuyển kho · hóa đơn ·
--  thu nợ · chốt cuối ngày). Đây là DÒNG TIN HOẠT ĐỘNG, không phải hệ cảnh
-- báo ngưỡng, và KHÔNG liên quan module thu nợ `/debts` — digest nhắc nợ
-- 08:30 (`fn_debt_reminder_tick`) giữ nguyên, migration này không đụng vào.
--
-- ── Kiến trúc: OUTBOX ─────────────────────────────────────────────────────
--   Trigger nghiệp vụ → fn_notify_emit() chỉ INSERT 1 dòng (~0,1ms)
--        ↓
--   notification_events  ── pg_cron mỗi 1 phút ──▶ fn_notify_drain()
--        ↓                    gom nhóm · ngưỡng · chống dội · giờ im lặng
--   fn_tg_send(text, channel) → tra telegram_channels → chat_id + thread_id
--        ↓
--   Telegram  →  notification_log (req_id → thu kết quả ở vòng sau → retry)
--
-- Vì sao KHÔNG gọi net.http_post thẳng trong trigger:
--   1. POS đang bán không được chậm đi vì Telegram.
--   2. Gọi thẳng thì không gom được → 150+ tin/ngày, 3 hôm là không ai đọc.
--   3. Có bảng trung gian mới retry và truy vết được "tin này gửi chưa".
--   4. Transaction rollback thì dòng outbox biến mất theo → không bao giờ
--      báo về một đơn thực ra đã bị huỷ giữa chừng.
--
-- ── 4 điều kiện giữ chi phí ở mức không đáng kể (xem docs/15) ─────────────
--   a. Partial index `where status='pending'` → cron không seq-scan 1.440
--      lượt/ngày trên bảng 30 ngày dữ liệu.
--   b. Advisory lock trong drain → Telegram treo >60s thì pg_cron khởi lượt
--      thứ hai song song, gây gửi trùng + tranh khoá.
--   c. Trần retry 5 lần → cấu hình sai chat_id mà retry vô hạn là 1.440
--      request/ngày vào Telegram, bot ăn rate-limit.
--   d. Payload chỉ chứa số đã tính sẵn + 1 dòng chữ dựng sẵn. Copy cả bản
--      ghi vào jsonb là đi lại vết `audit_logs` từng ngốn 60% dung lượng DB.
--
-- ⚠️ KILL-SWITCH MẶC ĐỊNH TẮT. Chưa cấu hình nhóm Telegram thì fn_notify_emit
--    return ngay ở dòng đầu → chi phí bằng 0 và outbox không phình vì chứa
--    những sự kiện không thể gửi. Bật bằng:
--      update system_settings set value = jsonb_set(value,'{enabled}','true')
--       where key = 'notification_config';
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Kênh gửi ───────────────────────────────────────────────────────────
-- Một dòng = một đích đến. Nhóm forum nhiều topic thì cùng chat_id khác
-- thread_id; nhóm riêng từng chi nhánh thì khác chat_id, thread_id NULL.
-- Cả hai bố cục chạy như nhau, không phải sửa code.
CREATE TABLE IF NOT EXISTS public.telegram_channels (
  code           TEXT        PRIMARY KEY,
  label          TEXT        NOT NULL,
  chat_id        TEXT,                     -- NULL = chưa cấu hình → bỏ qua
  thread_id      BIGINT,                   -- message_thread_id của topic
  branch_id      UUID        REFERENCES public.branches(id) ON DELETE SET NULL,
  show_sensitive BOOLEAN     NOT NULL DEFAULT false,
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.telegram_channels.show_sensitive IS
  'true = tin được chứa giá vốn/lợi nhuận. Topic có nhân viên chi nhánh phải để false — '
  'chi nhánh độc lập kiểu nhượng quyền, không xem số của nhau. '
  'LƯU Ý: topic Telegram KHÔNG phân quyền — mọi thành viên nhóm đọc được mọi topic. '
  'Ranh giới thật sự chỉ có nhóm khác nhau.';

-- ── 2. Outbox sự kiện ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_events (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  branch_id    UUID,       -- không FK: giữ trigger nhẹ, dữ liệu là ảnh chụp
  severity     TEXT        NOT NULL DEFAULT 'info'
                 CHECK (severity IN ('info','warn','critical')),
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  fingerprint  TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','sent','skipped')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
COMMENT ON COLUMN public.notification_events.payload IS
  'CHỈ số đã tính sẵn + khoá `line` là dòng chữ dựng sẵn cho tin nhắn. '
  'Tuyệt đối không copy cả bản ghi nghiệp vụ vào đây.';

-- (a) Partial index: chỉ to bằng số dòng đang chờ, tức gần 0.
CREATE INDEX IF NOT EXISTS idx_notification_events_pending
  ON public.notification_events (event_type, branch_id, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notification_events_fingerprint
  ON public.notification_events (fingerprint)
  WHERE status = 'pending' AND fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_events_created
  ON public.notification_events (created_at);

-- ── 3. Luật gửi từng loại sự kiện ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_rules (
  event_type       TEXT        PRIMARY KEY,
  label            TEXT        NOT NULL,
  enabled          BOOLEAN     NOT NULL DEFAULT true,
  severity         TEXT        NOT NULL DEFAULT 'info'
                     CHECK (severity IN ('info','warn','critical')),
  channel_code     TEXT        NOT NULL DEFAULT '@branch',
  threshold        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  batch_window_sec INTEGER     NOT NULL DEFAULT 0,    -- 0 = gửi từng việc
  min_interval_sec INTEGER     NOT NULL DEFAULT 0,    -- chống dội
  quiet_hours      BOOLEAN     NOT NULL DEFAULT true, -- 22h–6h dồn sang sáng
  daily_cap        INTEGER     NOT NULL DEFAULT 50,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.notification_rules.channel_code IS
  '''@branch'' = tự tra kênh theo branch_id của sự kiện, không thấy thì rơi về ''tong_hop''.';

-- ── 4. Nhật ký gửi ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_log (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type   TEXT,
  branch_id    UUID,
  channel_code TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  event_ids    BIGINT[]    NOT NULL DEFAULT '{}',
  req_id       BIGINT,     -- id do pg_net trả về
  http_status  INTEGER,
  error        TEXT,
  attempts     INTEGER     NOT NULL DEFAULT 0,
  status       TEXT        NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','failed','skipped')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_try_at  TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ
);
COMMENT ON COLUMN public.notification_log.last_try_at IS
  'Mốc tính backoff. PHẢI dùng cột này chứ không phải created_at — created_at đứng '
  'yên nên điều kiện chờ luôn đúng sau vài phút, backoff thành vô hiệu.';

CREATE INDEX IF NOT EXISTS idx_notification_log_open
  ON public.notification_log (created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_notification_log_recent
  ON public.notification_log (event_type, branch_id, created_at DESC);

-- ── 5. Cấu hình toàn cục ──────────────────────────────────────────────────
INSERT INTO public.system_settings (key, value) VALUES (
  'notification_config',
  '{"enabled": false, "global_daily_cap": 200, "per_run_cap": 12,
    "quiet_from": 22, "quiet_to": 6, "max_attempts": 5, "batch_lines": 20}'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- HÀM
-- ═══════════════════════════════════════════════════════════════════════════

-- ── fn_tg_escape: parse_mode=HTML nên phải thoát &, <, > ─────────────────
CREATE OR REPLACE FUNCTION public.fn_tg_escape(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(COALESCE(p_text,''), '&','&amp;'), '<','&lt;'), '>','&gt;');
$$;

-- ── fn_tg_send: gửi 1 tin vào 1 kênh, ghi notification_log ───────────────
-- Trả về id của dòng log (không phải req_id) để drain theo dõi tiếp.
-- Thiếu chat_id / kênh tắt / thiếu vault secret → ghi log 'skipped', KHÔNG
-- raise lỗi, để một kênh hỏng không làm chết cả lượt drain.
--
-- ⚠️ p_retry_log_id: gửi lại thì PHẢI dùng lại đúng dòng log cũ. Tạo dòng mới
--    sẽ reset `attempts` về 0 ⇒ trần retry không bao giờ chạm ⇒ cấu hình sai
--    chat_id là quay vòng vô hạn 1.440 request/ngày vào Telegram.
CREATE OR REPLACE FUNCTION public.fn_tg_send(
  p_text         TEXT,
  p_channel      TEXT DEFAULT 'default',
  p_event_type   TEXT DEFAULT NULL,
  p_branch_id    UUID DEFAULT NULL,
  p_event_ids    BIGINT[] DEFAULT '{}',
  p_retry_log_id BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault','net'
AS $$
DECLARE
  v_chat   TEXT;
  v_thread BIGINT;
  v_on     BOOLEAN;
  v_token  TEXT;
  v_req    BIGINT;
  v_log    BIGINT;
  v_body   JSONB;
BEGIN
  SELECT chat_id, thread_id, enabled INTO v_chat, v_thread, v_on
  FROM public.telegram_channels WHERE code = p_channel;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token';

  IF p_retry_log_id IS NULL THEN
    INSERT INTO public.notification_log
      (event_type, branch_id, channel_code, message, event_ids, status)
    VALUES (p_event_type, p_branch_id, p_channel, p_text, p_event_ids, 'queued')
    RETURNING id INTO v_log;
  ELSE
    v_log := p_retry_log_id;   -- giữ nguyên attempts đã đếm
  END IF;

  IF v_chat IS NULL OR COALESCE(v_on, false) = false OR v_token IS NULL THEN
    UPDATE public.notification_log
       SET status = 'skipped',
           error  = CASE
                      WHEN v_token IS NULL THEN 'thiếu vault secret telegram_bot_token'
                      WHEN v_chat  IS NULL THEN 'kênh chưa cấu hình chat_id'
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
         last_try_at = now(), status = 'queued'
   WHERE id = v_log;

  RETURN v_log;
END;
$$;

-- ── fn_send_telegram: GIỮ NGUYÊN CHỮ KÝ ──────────────────────────────────
-- 3 cron đang sống (monitor-integrity-daily, debt-reminder-daily, …) gọi hàm
-- này. Bọc lại để chúng đi qua hạ tầng mới mà không phải sửa dòng nào.
-- Kênh 'default' được seed trỏ về đúng chat_id cũ trong Vault.
CREATE OR REPLACE FUNCTION public.fn_send_telegram(p_text TEXT)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.fn_tg_send(p_text, 'default', 'legacy', NULL, '{}');
END;
$$;

-- ── fn_notify_emit: TRIGGER GỌI HÀM NÀY. Phải rẻ. ───────────────────────
-- Chỉ INSERT 1 dòng. Không tính ngưỡng, không truy vấn nghiệp vụ, không gọi
-- HTTP. Mọi việc nặng để drain làm NGOÀI transaction bán hàng.
CREATE OR REPLACE FUNCTION public.fn_notify_emit(
  p_event_type  TEXT,
  p_branch_id   UUID DEFAULT NULL,
  p_payload     JSONB DEFAULT '{}'::jsonb,
  p_fingerprint TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_sev TEXT;
BEGIN
  -- Kill-switch: chưa bật thì thoát ngay, chi phí gần bằng 0.
  IF NOT COALESCE(
       (SELECT (value->>'enabled')::boolean FROM public.system_settings
         WHERE key = 'notification_config'), false)
  THEN RETURN; END IF;

  -- Loại đang tắt thì không ghi, khỏi phình outbox.
  SELECT severity INTO v_sev FROM public.notification_rules
   WHERE event_type = p_event_type AND enabled = true;
  IF NOT FOUND THEN RETURN; END IF;

  -- Chống trùng: cùng fingerprint mà còn đang chờ thì bỏ.
  IF p_fingerprint IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.notification_events
        WHERE fingerprint = p_fingerprint AND status = 'pending')
  THEN RETURN; END IF;

  INSERT INTO public.notification_events
    (event_type, branch_id, severity, payload, fingerprint)
  VALUES (p_event_type, p_branch_id, v_sev, p_payload, p_fingerprint);
EXCEPTION WHEN OTHERS THEN
  -- Thông báo hỏng TUYỆT ĐỐI không được làm hỏng nghiệp vụ.
  RETURN;
END;
$$;

-- ── fn_notify_resolve_channel: '@branch' → kênh của chi nhánh ────────────
CREATE OR REPLACE FUNCTION public.fn_notify_resolve_channel(
  p_channel_code TEXT, p_branch_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_code TEXT;
BEGIN
  IF p_channel_code <> '@branch' THEN RETURN p_channel_code; END IF;
  IF p_branch_id IS NOT NULL THEN
    SELECT code INTO v_code FROM public.telegram_channels
     WHERE branch_id = p_branch_id AND enabled = true LIMIT 1;
    IF FOUND THEN RETURN v_code; END IF;
  END IF;
  RETURN 'tong_hop';
END;
$$;

-- ── fn_notify_drain: bộ não. pg_cron gọi mỗi 1 phút ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_drain()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','net'
AS $$
DECLARE
  v_cfg        JSONB;
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
  r            RECORD;
  v_chan       TEXT;
  v_ids        BIGINT[];
  v_cnt        INTEGER;
  v_msg        TEXT;
  v_lines      TEXT;
  v_last       TIMESTAMPTZ;
  v_day_cnt    INTEGER;
BEGIN
  -- (b) Không lấy được khoá = lượt trước còn chạy. Thoát, không xếp hàng.
  IF NOT pg_try_advisory_lock(918273645) THEN
    RETURN jsonb_build_object('skipped', 'đang chạy lượt trước');
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'notification_config';
  IF NOT COALESCE((v_cfg->>'enabled')::boolean, false) THEN
    PERFORM pg_advisory_unlock(918273645);
    RETURN jsonb_build_object('skipped', 'kill-switch đang tắt');
  END IF;

  v_max_try    := COALESCE((v_cfg->>'max_attempts')::int, 5);
  v_lines_cap  := COALESCE((v_cfg->>'batch_lines')::int, 20);
  v_gcap       := COALESCE((v_cfg->>'global_daily_cap')::int, 200);
  v_run_cap    := COALESCE((v_cfg->>'per_run_cap')::int, 12);
  v_quiet_from := COALESCE((v_cfg->>'quiet_from')::int, 22);
  v_quiet_to   := COALESCE((v_cfg->>'quiet_to')::int, 6);

  -- ⚠️ Ranh giới ngày phải quay VỀ timestamptz. date_trunc(...) trả timestamp
  -- không múi giờ; so thẳng với created_at (timestamptz) thì Postgres ép kiểu
  -- theo múi giờ phiên — cron chạy ở UTC ⇒ lệch 7 tiếng. Đây đúng loại lỗi đã
  -- làm mất doanh thu ngày cuối tháng ở báo cáo (fix-returns-excluded).
  v_day_start := timezone('Asia/Ho_Chi_Minh',
                   date_trunc('day', timezone('Asia/Ho_Chi_Minh', now())));

  v_hour  := EXTRACT(hour FROM timezone('Asia/Ho_Chi_Minh', now()))::int;
  v_quiet := CASE WHEN v_quiet_from > v_quiet_to
                  THEN v_hour >= v_quiet_from OR v_hour < v_quiet_to
                  ELSE v_hour >= v_quiet_from AND v_hour < v_quiet_to END;

  -- ── Pha 1: thu kết quả lượt trước ────────────────────────────────────
  -- pg_net bất đồng bộ: http_post chỉ trả req_id, kết quả nằm ở
  -- net._http_response và TỰ XOÁ SAU ~6 GIỜ. Không thu ở vòng sau thì gửi
  -- hỏng mà không ai biết — đúng lỗ hổng của fn_send_telegram bản cũ.
  FOR r IN
    SELECT l.id, l.req_id, l.attempts,
           COALESCE(l.last_try_at, l.created_at) AS tried_at,
           resp.status_code, resp.error_msg
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
      -- (c) Trần retry: hết lượt thì bỏ hẳn, không quay vòng vô hạn.
      IF r.attempts >= v_max_try THEN
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
      -- Không thấy phản hồi lẫn lỗi sau 10 phút → coi như mất, thử lại.
      -- Mốc phải là LẦN GỬI GẦN NHẤT, không phải created_at: dòng log cũ đem
      -- gửi lại vẫn mang created_at cũ ⇒ luôn quá 10 phút ⇒ quay vòng liên tục.
      IF r.attempts >= v_max_try THEN
        UPDATE public.notification_log
           SET status = 'failed', error = 'không có phản hồi từ pg_net'
         WHERE id = r.id;
      ELSE
        UPDATE public.notification_log SET req_id = NULL WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;

  -- ── Pha 2: gửi lại các tin đã rớt, backoff 2^attempts phút ───────────
  -- Gửi lại NGAY TRÊN dòng log cũ (p_retry_log_id) để `attempts` cộng dồn.
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

  -- Trần toàn cục: chạm thì dừng, báo đúng 1 tin vào kênh kỹ thuật.
  SELECT count(*) INTO v_sent_today FROM public.notification_log
   WHERE created_at >= v_day_start
     AND status <> 'skipped';
  IF v_sent_today >= v_gcap THEN
    -- Báo đúng MỘT lần/ngày. Không so `= v_gcap` vì đếm có thể nhảy qua mốc
    -- (199 → 201) và tin báo sẽ không bao giờ được gửi.
    IF NOT EXISTS (SELECT 1 FROM public.notification_log
                    WHERE event_type = 'system.cap' AND created_at >= v_day_start) THEN
      PERFORM public.fn_tg_send(
        '⚠️ Đã chạm trần ' || v_gcap || ' tin/ngày — tạm dừng gửi tới sáng mai.',
        'ky_thuat', 'system.cap', NULL, '{}');
    END IF;
    PERFORM pg_advisory_unlock(918273645);
    RETURN jsonb_build_object('reconciled', v_recon, 'capped', true);
  END IF;

  -- ── Pha 3: gom sự kiện đang chờ thành tin ────────────────────────────
  FOR r IN
    SELECT e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
           ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours, ru.daily_cap,
           min(e.created_at) AS oldest, count(*) AS n
    FROM public.notification_events e
    JOIN public.notification_rules ru ON ru.event_type = e.event_type
    WHERE e.status = 'pending' AND ru.enabled = true
    GROUP BY e.event_type, e.branch_id, ru.label, ru.channel_code, ru.severity,
             ru.batch_window_sec, ru.min_interval_sec, ru.quiet_hours,
             ru.daily_cap
    ORDER BY min(e.created_at)
    LIMIT 30
  LOOP
    -- (7) Telegram chặn ~20 tin/phút/nhóm. Drain chạy mỗi phút nên mỗi lượt
    -- chỉ gửi tối đa v_run_cap, phần còn lại để lượt sau — không bao giờ dồn
    -- một phát 30 tin làm bot ăn 429.
    EXIT WHEN v_batches >= v_run_cap;

    -- Chưa hết cửa sổ gom thì để dành cho lượt sau.
    IF r.batch_window_sec > 0
       AND r.oldest > now() - (interval '1 second' * r.batch_window_sec)
    THEN CONTINUE; END IF;

    -- Giờ im lặng: chỉ 'critical' được qua, còn lại nằm chờ tới sáng.
    IF v_quiet AND r.quiet_hours AND r.severity <> 'critical' THEN CONTINUE; END IF;

    -- Chống dội cùng loại + cùng chi nhánh.
    IF r.min_interval_sec > 0 THEN
      SELECT max(created_at) INTO v_last FROM public.notification_log
       WHERE event_type = r.event_type
         AND branch_id IS NOT DISTINCT FROM r.branch_id
         AND status <> 'skipped';
      IF v_last IS NOT NULL
         AND v_last > now() - (interval '1 second' * r.min_interval_sec)
      THEN CONTINUE; END IF;
    END IF;

    -- Trần ngày của riêng loại này.
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

    -- Lượt drain khác vừa dọn sạch nhóm này (hiếm, nhưng array NULL sẽ làm
    -- tin nhắn rỗng vẫn được gửi đi).
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

    -- (7) Telegram từ chối tin > 4096 ký tự.
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
  RETURN jsonb_build_object('reconciled', v_recon, 'batches', v_batches,
                            'sent_today', v_sent_today);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(918273645);
  RAISE;
END;
$$;

-- ── fn_notify_prune: (d) giữ 30 ngày. Bài học audit_logs. ───────────────
CREATE OR REPLACE FUNCTION public.fn_notify_prune()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_e INTEGER; v_l INTEGER;
BEGIN
  DELETE FROM public.notification_events
   WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_e = ROW_COUNT;
  DELETE FROM public.notification_log
   WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_l = ROW_COUNT;
  RETURN jsonb_build_object('events_deleted', v_e, 'logs_deleted', v_l);
END;
$$;

-- ── fn_notify_test: nút "Gửi thử" cho trang cấu hình ────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_test(p_channel TEXT DEFAULT 'default')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_log BIGINT; v_st TEXT; v_err TEXT;
BEGIN
  IF NOT public.fn_is_sysadmin() THEN
    RAISE EXCEPTION 'Chỉ quản trị hệ thống được gửi thử';
  END IF;
  v_log := public.fn_tg_send(
    '✅ <b>Gửi thử</b> — kênh <code>' || public.fn_tg_escape(p_channel) || '</code> lúc '
    || to_char(timezone('Asia/Ho_Chi_Minh', now()), 'HH24:MI DD/MM/YYYY'),
    p_channel, 'system.test', NULL, '{}');
  SELECT status, error INTO v_st, v_err FROM public.notification_log WHERE id = v_log;
  RETURN jsonb_build_object('log_id', v_log, 'status', v_st, 'error', v_err);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SEED
-- ═══════════════════════════════════════════════════════════════════════════

-- Kênh: 'default' giữ nguyên hành vi cũ cho 3 cron đang sống.
INSERT INTO public.telegram_channels (code, label, show_sensitive, note) VALUES
  ('default',  'Kênh cũ (monitor + nhắc nợ)', true,
   'Nạp chat_id đang dùng trong Vault telegram_chat_id vào đây để 3 cron cũ chạy tiếp'),
  ('tong_hop', '📊 Tổng hợp',   true,  'Chốt ngày toàn công ty, so sánh 3 chi nhánh'),
  ('canh_bao', '🔴 Bất thường', true,  'Việc cần chủ nhìn ngay'),
  ('ky_thuat', '⚙️ Kỹ thuật',   true,  'Lỗi hệ thống, tin gửi hỏng, chạm trần')
ON CONFLICT (code) DO NOTHING;

-- ⚠️ BẮT BUỘC: nạp chat_id cũ từ Vault vào kênh 'default'.
-- fn_send_telegram nay đi qua kênh này. Bỏ bước backfill là 2 cron ĐANG SỐNG
-- (monitor-integrity-daily 08:00, debt-reminder-daily 08:30) im lặng ngay sáng
-- hôm sau mà không báo lỗi gì — vì fn_tg_send coi "thiếu chat_id" là bỏ qua.
UPDATE public.telegram_channels c
   SET chat_id = v.decrypted_secret, updated_at = now()
  FROM vault.decrypted_secrets v
 WHERE c.code = 'default' AND c.chat_id IS NULL AND v.name = 'telegram_chat_id';

-- Mỗi chi nhánh đang hoạt động một kênh, show_sensitive = false cho an toàn:
-- nếu nhân viên được thêm vào nhóm thì mặc định họ KHÔNG thấy giá vốn/lợi nhuận.
INSERT INTO public.telegram_channels (code, label, branch_id, show_sensitive, note)
SELECT 'cn_' || lower(regexp_replace(b.code, '[^a-zA-Z0-9]', '_', 'g')),
       '🏢 ' || b.name, b.id, false,
       'Nhịp hoạt động riêng chi nhánh. Bật show_sensitive nếu nhóm chỉ có chủ + admin.'
FROM public.branches b WHERE b.is_active = true
ON CONFLICT (code) DO NOTHING;

-- Luật cho 7 luồng. Trigger của đợt 2–4 chỉ việc emit đúng event_type.
INSERT INTO public.notification_rules
  (event_type, label, severity, channel_code, batch_window_sec, min_interval_sec, daily_cap, threshold) VALUES
  -- 1. Nhập hàng (nháp gom 30' vì import Google Drive sinh hàng loạt)
  ('receipt.draft',        'Phiếu nhập nháp',        'info',    '@branch', 1800, 0, 20, '{}'),
  ('receipt.verified',     'Phiếu nhập đã kiểm',     'info',    '@branch',    0, 0, 30, '{}'),
  ('receipt.completed',    'Nhập kho hoàn tất',      'info',    '@branch',    0, 0, 30, '{}'),
  ('receipt.cancelled',    'Huỷ phiếu nhập',         'warn',    '@branch',    0, 0, 20, '{}'),
  ('receipt.price_anomaly','Giá nhập bất thường',    'critical','canh_bao',   0, 0, 20, '{"pct": 30}'),
  -- 2. Xuất hàng không phải bán
  ('stock.writeoff',       'Xuất hủy / điều chỉnh',  'warn',    '@branch',    0, 0, 20, '{}'),
  ('stock.return_supplier','Trả hàng nhà cung cấp',  'info',    '@branch',    0, 0, 20, '{}'),
  ('stock.oversell',       'Bán âm kho',             'critical','canh_bao',   0, 0, 20, '{}'),
  -- 3. Bán hàng
  ('sales.pulse',          'Nhịp bán hàng',          'info',    '@branch', 7200, 0, 12, '{}'),
  ('sales.big_order',      'Đơn giá trị lớn',        'warn',    'canh_bao',   0, 0, 20, '{"min_amount": 20000000}'),
  ('sales.below_cost',     'Bán dưới giá vốn',       'critical','canh_bao',   0, 0, 20, '{}'),
  ('sales.edited',         'Sửa / huỷ đơn đã chốt',  'critical','canh_bao',   0, 0, 20, '{}'),
  ('sales.discount',       'Chiết khấu bất thường',  'warn',    'canh_bao',   0, 0, 20, '{"pct": 5, "min_amount": 500000}'),
  ('sales.return',         'Khách trả hàng',         'warn',    '@branch',    0, 0, 20, '{"min_amount": 1000000}'),
  -- 4. Chuyển kho
  ('transfer.pending',     'Chuyển kho chờ duyệt',   'critical','canh_bao',   0, 0, 20, '{}'),
  ('transfer.approved',    'Chuyển kho đã duyệt',    'info',    '@branch',    0, 0, 20, '{}'),
  ('transfer.received',    'Chuyển kho đã nhận',     'info',    '@branch',    0, 0, 20, '{}'),
  -- 5. Hóa đơn
  ('invoice.issued',       'Phát hành hóa đơn',      'info',    '@branch',  600, 0, 20, '{}'),
  ('invoice.pending_old',  'Hóa đơn tồn chưa xuất',  'warn',    'tong_hop',   0, 0,  2, '{"days": 7}'),
  -- 6. Thu nợ (sự kiện thu tiền — KHÔNG phải nhắc nợ của module /debts)
  ('debt.payment',         'Thu nợ',                 'info',    '@branch',    0, 0, 30, '{}'),
  -- 7. Chốt ngày
  ('daily.branch_close',   'Chốt ngày chi nhánh',    'info',    '@branch',    0, 0,  2, '{}'),
  ('daily.company_close',  'Chốt ngày toàn công ty', 'info',    'tong_hop',   0, 0,  2, '{}')
ON CONFLICT (event_type) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS + QUYỀN
-- ═══════════════════════════════════════════════════════════════════════════
-- Bốn bảng này chứa chat_id và số liệu kinh doanh tổng hợp → chỉ quản trị hệ
-- thống. Dùng fn_is_sysadmin() (CHỈ vai trò admin), KHÔNG dùng fn_is_admin()
-- vì hàm đó gồm cả ceo.
ALTER TABLE public.telegram_channels   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['telegram_channels','notification_events',
                           'notification_rules','notification_log']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_sysadmin_all ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_sysadmin_all ON public.%I FOR ALL '
      'USING (public.fn_is_sysadmin()) WITH CHECK (public.fn_is_sysadmin())', t, t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.fn_tg_send(TEXT,TEXT,TEXT,UUID,BIGINT[],BIGINT) FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_notify_drain()  FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_notify_prune()  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.fn_tg_send(TEXT,TEXT,TEXT,UUID,BIGINT[],BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_drain()  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_prune()  TO service_role;
-- emit phải gọi được từ trigger của mọi người dùng đang bán hàng:
GRANT EXECUTE ON FUNCTION public.fn_notify_emit(TEXT,UUID,JSONB,TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_test(TEXT)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_escape(TEXT)                   TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- CRON
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-drain') THEN
    PERFORM cron.unschedule('notify-drain');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-prune') THEN
    PERFORM cron.unschedule('notify-prune');
  END IF;
  PERFORM cron.schedule('notify-drain', '* * * * *', 'SELECT public.fn_notify_drain();');
  PERFORM cron.schedule('notify-prune', '45 19 * * *', 'SELECT public.fn_notify_prune();');
END $$;

NOTIFY pgrst, 'reload schema';
