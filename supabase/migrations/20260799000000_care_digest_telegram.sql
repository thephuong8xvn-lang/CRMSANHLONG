-- ═══════════════════════════════════════════════════════════════════════════
-- CHĂM SÓC KH — ĐỢT 2: NHẮC VIỆC QUA TELEGRAM 07:30 & 13:30
-- 2026-08-09 · user chốt: "gộp chung cho nhóm, không cần phân chi nhánh vì
--   khách hàng là tài sản chung" · "chỉ cần hiện số ngày rời bỏ là được"
--
-- ── Vấn đề nó giải ──────────────────────────────────────────────────────
-- Module `/customers/care` chỉ sống khi có người tự mở trang. Toàn DB có ĐÚNG
-- 1 dòng `activities` ⇒ trong ~2 tháng vận hành chưa ai gọi lại khách nào theo
-- danh sách này. 3 người dùng chung 3 tài khoản chi nhánh, không ai nhớ vào.
--
-- ── Quyết định thiết kế ─────────────────────────────────────────────────
-- • MỘT nhóm chung `cham_soc` (-5560046303), KHÔNG tách theo chi nhánh —
--   khách hàng là tài sản chung của công ty. Vẫn ghi tên chi nhánh trong dòng
--   để nhân viên biết ai gần khách hơn.
-- • KHÔNG gửi theo NV phụ trách: 177/193 khách trong danh sách đang gắn owner
--   = "Quản trị viên" (bệnh y hệt module Công nợ) ⇒ chia theo NV là gửi vào
--   khoảng không.
-- • Tin CHIỀU chỉ liệt kê khách CHƯA được ghi nhận gọi trong ngày, kèm một
--   dòng tiến độ — vừa đo được việc vừa tạo áp lực mềm.
-- • Khách đang trong thời gian "tạm lặng" (`customers.care_snooze_until`, do
--   `fn_log_care_call` đặt theo kết quả gọi) thì bỏ qua. Không có lớp này thì
--   sáng nào nhóm cũng nhận lại đúng 15 cái tên và 3 hôm là không ai đọc.
-- • Danh sách rỗng ⇒ KHÔNG gửi gì (im lặng = mọi việc đã xong).
--
-- 🪤 Tin ĐỊNH KỲ phải có NGÀY + PHIÊN trong 2 đoạn đầu fingerprint. `subject_key`
--    = 2 đoạn đầu; trùng thì drain `editMessageText` ĐÈ LÊN tin cũ và nhóm sẽ
--    "không thấy tin mới". Bài học `20260782` / `20260797`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Kênh gửi ───────────────────────────────────────────────────────────
INSERT INTO public.telegram_channels (code, label, chat_id, show_sensitive, note)
VALUES ('cham_soc', '📞 Chăm sóc khách hàng', '-5560046303', false,
        'Nhóm "Chăm sóc KM-SANHLONGVETCO" — danh sách khách cần gọi lại, 07:30 & 13:30. '
        'Chung toàn công ty, không tách chi nhánh.')
ON CONFLICT (code) DO UPDATE
  SET chat_id = COALESCE(public.telegram_channels.chat_id, EXCLUDED.chat_id),
      label   = EXCLUDED.label,
      updated_at = now();

-- ── 2. Luật ───────────────────────────────────────────────────────────────
INSERT INTO public.notification_rules
  (event_type, label, severity, channel_code, audience, compose,
   batch_window_sec, delay_sec, min_interval_sec, daily_cap, quiet_hours, threshold)
VALUES
  ('care.churn_digest', 'Khách cần gọi lại', 'info', 'cham_soc',
   'internal', 'full', 0, 0, 0, 10, false,
   '{"limit": 20, "am_time": "07:30", "pm_time": "13:30"}')
ON CONFLICT (event_type) DO UPDATE
  SET label='Khách cần gọi lại', severity='info', channel_code='cham_soc',
      audience='internal', compose='full', quiet_hours=false, enabled=true,
      updated_at=now();

-- ── 3. Dựng tin. Trả NULL khi không còn ai để gọi ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_care_digest_text(
  p_session TEXT    DEFAULT 'sang',   -- 'sang' | 'chieu'
  p_limit   INTEGER DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lim      INTEGER;
  v_hnay     DATE;
  v_dau_ngay TIMESTAMPTZ;
  v_n_churn  INTEGER := 0;
  v_n_risk   INTEGER := 0;
  v_n_hien   INTEGER := 0;
  v_goi_hnay INTEGER := 0;
  v_dong     TEXT;
  v_txt      TEXT;
BEGIN
  v_lim  := COALESCE(p_limit,
              (SELECT (threshold->>'limit')::int FROM public.notification_rules
                WHERE event_type = 'care.churn_digest'), 20);
  v_hnay := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  -- Ranh giới ngày phải quay VỀ timestamptz theo giờ VN; cron chạy UTC, so
  -- thẳng là lệch 7 tiếng (đúng loại lỗi từng làm mất doanh thu ngày cuối tháng).
  v_dau_ngay := timezone('Asia/Ho_Chi_Minh', v_hnay::timestamp);

  SELECT count(*)::int INTO v_goi_hnay
    FROM public.activities a
   WHERE a.care_kind IS NOT NULL AND a.created_at >= v_dau_ngay;

  WITH ds AS (
    SELECT m.*, c.farm_name, c.primary_phone, b.name AS chi_nhanh
      FROM public.fn_customer_churn_metrics() m
      JOIN public.customers c      ON c.id = m.customer_id
      LEFT JOIN public.branches b  ON b.id = c.branch_id
     WHERE c.is_active = true
       AND m.lifecycle IN ('at_risk','churned')
       -- Đang trong thời gian tạm lặng sau cuộc gọi trước → chưa réo lại.
       AND (m.snooze_until IS NULL OR m.snooze_until <= now())
       -- Đã ghi nhận gọi trong hôm nay → không liệt kê ở tin chiều nữa.
       AND (m.last_call_at IS NULL OR m.last_call_at < v_dau_ngay)
  )
  SELECT count(*) FILTER (WHERE lifecycle = 'churned'),
         count(*) FILTER (WHERE lifecycle = 'at_risk'),
         LEAST(count(*), v_lim),
         (SELECT string_agg(
                   CASE WHEN t.lifecycle = 'churned' THEN '🔴 ' ELSE '🟠 ' END
                   || '<b>' || public.fn_tg_escape(left(t.farm_name, 34)) || '</b>'
                   || COALESCE(' · <code>' || public.fn_tg_escape(t.primary_phone) || '</code>',
                               ' · <i>(chưa có SĐT)</i>')
                   || E'\n    im lặng <b>' || t.days_since::int || ' ngày</b>'
                   || ' · DT 90n ' || public.fn_notify_vnd(t.revenue_90d)
                   || COALESCE(' · ' || public.fn_tg_escape(t.chi_nhanh), '')
                   || CASE WHEN t.call_count > 0
                           THEN ' · 📞 đã gọi ' || t.call_count || ' lần ('
                                || to_char(timezone('Asia/Ho_Chi_Minh', t.last_call_at), 'DD/MM') || ')'
                           ELSE '' END,
                   E'\n' ORDER BY t.priority DESC, t.days_since DESC)
            FROM (SELECT * FROM ds ORDER BY priority DESC, days_since DESC LIMIT v_lim) t)
    INTO v_n_churn, v_n_risk, v_n_hien, v_dong
    FROM ds;

  IF COALESCE(v_n_churn,0) + COALESCE(v_n_risk,0) = 0 THEN RETURN NULL; END IF;

  v_txt := '📞 <b>KHÁCH CẦN GỌI LẠI</b> — '
        || CASE WHEN p_session = 'chieu' THEN 'Chiều ' ELSE 'Sáng ' END
        || to_char(v_hnay, 'DD/MM')
        || E'\n<i>Danh sách chung toàn công ty</i>'
        || E'\n────────────────';

  IF v_n_churn > 0 THEN
    v_txt := v_txt || E'\n🔴 Đã rời bỏ: <b>' || v_n_churn || ' khách</b>';
  END IF;
  IF v_n_risk > 0 THEN
    v_txt := v_txt || E'\n🟠 Có nguy cơ: <b>' || v_n_risk || ' khách</b>';
  END IF;

  IF p_session = 'chieu' THEN
    v_txt := v_txt || E'\n✅ Hôm nay đã ghi nhận gọi: <b>' || v_goi_hnay || ' cuộc</b>';
  END IF;

  v_txt := v_txt || E'\n\n' || v_dong;

  IF (v_n_churn + v_n_risk) > v_n_hien THEN
    v_txt := v_txt || E'\n\n… và ' || (v_n_churn + v_n_risk - v_n_hien)
                   || ' khách nữa trong CRM';
  END IF;

  v_txt := v_txt
        || E'\n────────────────'
        || E'\n<i>Gọi xong vào CRM → Chăm sóc KH → bấm "Ghi nhận gọi". Khách đã ghi '
        || 'nhận sẽ không hiện lại ở tin sau, và số lần gọi được đếm để biết ai '
        || 'cần bám tiếp.</i>';

  RETURN v_txt;
END $$;

-- ── 4. Phát tin ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_care_digest(
  p_session TEXT DEFAULT 'sang',
  p_mode    TEXT DEFAULT 'send'       -- 'send' | 'preview'
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_txt  TEXT;
  v_date DATE;
BEGIN
  IF p_session NOT IN ('sang','chieu') THEN
    RAISE EXCEPTION 'p_session phải là sang hoặc chieu, nhận: %', p_session;
  END IF;
  IF p_mode NOT IN ('send','preview') THEN
    RAISE EXCEPTION 'p_mode phải là send hoặc preview, nhận: %', p_mode;
  END IF;

  v_txt  := public.fn_care_digest_text(p_session, NULL);
  v_date := (timezone('Asia/Ho_Chi_Minh', now()))::date;

  IF v_txt IS NULL THEN
    RETURN '(Không còn khách nào cần gọi lại — không gửi tin.)';
  END IF;

  IF p_mode = 'send' THEN
    PERFORM public.fn_notify_emit(
      'care.churn_digest', NULL,
      jsonb_build_object('text', v_txt,
                         'line', 'Khách cần gọi lại ' || to_char(v_date,'DD/MM')),
      -- NGÀY + PHIÊN nằm ở đoạn 2 ⇒ tin chiều KHÔNG đè lên tin sáng.
      'care.churn_digest:' || v_date || '_' || p_session,
      NULL);
  END IF;

  RETURN v_txt;
END $$;

-- ── 5. Lịch: 07:30 VN = 00:30 UTC · 13:30 VN = 06:30 UTC ──────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN
  ('notify-care-digest-am','notify-care-digest-pm');

SELECT cron.schedule('notify-care-digest-am', '30 0 * * *',
                     $cron$SELECT public.fn_notify_care_digest('sang');$cron$);
SELECT cron.schedule('notify-care-digest-pm', '30 6 * * *',
                     $cron$SELECT public.fn_notify_care_digest('chieu');$cron$);

-- ═══════════════════════════════════════════════════════════════════════════
-- CẤU HÌNH TỪ GIAO DIỆN (nút ⚙️ trong module Chăm sóc KH)
-- Đi qua RPC chứ KHÔNG cho FE ghi thẳng `telegram_channels`: bảng đó chứa
-- chat_id của MỌI kênh, mở ra là lộ cả nhóm chủ lẫn nhóm kỹ thuật.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_care_config_get()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ch RECORD; v_ru RECORD; v_cfg jsonb;
BEGIN
  IF NOT public.fn_is_sysadmin() THEN
    RAISE EXCEPTION 'Chỉ quản trị hệ thống được xem cấu hình nhắc việc' USING ERRCODE = '42501';
  END IF;

  SELECT chat_id, enabled INTO v_ch
    FROM public.telegram_channels WHERE code = 'cham_soc';
  SELECT threshold, enabled INTO v_ru
    FROM public.notification_rules WHERE event_type = 'care.churn_digest';
  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'churn_config';

  RETURN jsonb_build_object(
    'chat_id',           COALESCE(v_ch.chat_id, ''),
    'enabled',           COALESCE(v_ch.enabled, false) AND COALESCE(v_ru.enabled, false),
    'limit',             COALESCE((v_ru.threshold->>'limit')::int, 20),
    'am_time',           COALESCE(v_ru.threshold->>'am_time', '07:30'),
    'pm_time',           COALESCE(v_ru.threshold->>'pm_time', '13:30'),
    'at_risk_min_days',  COALESCE((v_cfg->>'at_risk_min_days')::int, 21),
    'churned_min_days',  COALESCE((v_cfg->>'churned_min_days')::int, 45),
    'min_interval_days', COALESCE((v_cfg->>'min_interval_days')::int, 7),
    'cron', (SELECT jsonb_object_agg(jobname, schedule) FROM cron.job
              WHERE jobname IN ('notify-care-digest-am','notify-care-digest-pm'))
  );
END $$;

CREATE OR REPLACE FUNCTION public.fn_care_config_set(p_cfg jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_chat  TEXT    := NULLIF(btrim(COALESCE(p_cfg->>'chat_id','')), '');
  v_on    BOOLEAN := COALESCE((p_cfg->>'enabled')::boolean, true);
  v_lim   INTEGER := GREATEST(3, LEAST(30, COALESCE((p_cfg->>'limit')::int, 20)));
  v_am    TEXT    := COALESCE(NULLIF(p_cfg->>'am_time',''), '07:30');
  v_pm    TEXT    := COALESCE(NULLIF(p_cfg->>'pm_time',''), '13:30');
  v_risk  INTEGER := GREATEST(3,  LEAST(180, COALESCE((p_cfg->>'at_risk_min_days')::int, 21)));
  v_churn INTEGER := GREATEST(7,  LEAST(365, COALESCE((p_cfg->>'churned_min_days')::int, 45)));
  v_minin INTEGER := GREATEST(1,  LEAST(90,  COALESCE((p_cfg->>'min_interval_days')::int, 7)));
  v_cron  TEXT    := 'ok';
BEGIN
  IF NOT public.fn_is_sysadmin() THEN
    RAISE EXCEPTION 'Chỉ quản trị hệ thống được sửa cấu hình nhắc việc' USING ERRCODE = '42501';
  END IF;
  -- Regex thôi thì "29:00" vẫn lọt và cron sẽ nhận một giờ vô nghĩa.
  IF v_am !~ '^\d{1,2}:\d{2}$' OR v_pm !~ '^\d{1,2}:\d{2}$'
     OR split_part(v_am,':',1)::int > 23 OR split_part(v_am,':',2)::int > 59
     OR split_part(v_pm,':',1)::int > 23 OR split_part(v_pm,':',2)::int > 59 THEN
    RAISE EXCEPTION 'Giờ gửi phải theo dạng HH:MM trong ngày (vd 07:30)';
  END IF;
  IF v_churn <= v_risk THEN
    RAISE EXCEPTION 'Ngưỡng "rời bỏ" (% ngày) phải lớn hơn ngưỡng "nguy cơ" (% ngày)',
      v_churn, v_risk;
  END IF;

  UPDATE public.telegram_channels
     SET chat_id = v_chat, enabled = v_on, updated_at = now()
   WHERE code = 'cham_soc';

  UPDATE public.notification_rules
     SET enabled   = v_on,
         threshold = COALESCE(threshold,'{}'::jsonb) || jsonb_build_object(
                       'limit', v_lim, 'am_time', v_am, 'pm_time', v_pm),
         updated_at = now()
   WHERE event_type = 'care.churn_digest';

  UPDATE public.system_settings
     SET value = value || jsonb_build_object(
           'at_risk_min_days',  v_risk,
           'churned_min_days',  v_churn,
           'min_interval_days', v_minin)
   WHERE key = 'churn_config';

  -- Đổi giờ gửi = đổi lịch cron luôn, khỏi phải deploy lại.
  -- Giờ nhập là giờ VN; pg_cron chạy theo UTC nên phải trừ 7.
  BEGIN
    PERFORM cron.unschedule(jobid) FROM cron.job
     WHERE jobname IN ('notify-care-digest-am','notify-care-digest-pm');

    PERFORM cron.schedule('notify-care-digest-am',
      split_part(v_am,':',2)::int || ' '
        || ((split_part(v_am,':',1)::int - 7 + 24) % 24) || ' * * *',
      'SELECT public.fn_notify_care_digest(''sang'');');

    PERFORM cron.schedule('notify-care-digest-pm',
      split_part(v_pm,':',2)::int || ' '
        || ((split_part(v_pm,':',1)::int - 7 + 24) % 24) || ' * * *',
      'SELECT public.fn_notify_care_digest(''chieu'');');
  EXCEPTION WHEN OTHERS THEN
    -- Lưu cấu hình đã xong; lịch hỏng thì báo ra chứ không nuốt cả thao tác.
    v_cron := 'Không đổi được lịch cron: ' || SQLERRM;
  END;

  RETURN public.fn_care_config_get() || jsonb_build_object('cron_result', v_cron);
END $$;

-- Xem thử / gửi thử ngay vào nhóm — dùng fingerprint có mốc thời gian nên
-- KHÔNG đè lên tin định kỳ của ngày hôm đó.
CREATE OR REPLACE FUNCTION public.fn_care_digest_preview(p_session TEXT DEFAULT 'sang')
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_is_sysadmin() THEN
    RAISE EXCEPTION 'Chỉ quản trị hệ thống được xem thử' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(public.fn_care_digest_text(p_session, NULL),
                  '(Không còn khách nào cần gọi lại — sẽ không gửi tin.)');
END $$;

CREATE OR REPLACE FUNCTION public.fn_care_digest_send_now(p_session TEXT DEFAULT 'sang')
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_txt TEXT;
BEGIN
  IF NOT public.fn_is_sysadmin() THEN
    RAISE EXCEPTION 'Chỉ quản trị hệ thống được gửi thử' USING ERRCODE = '42501';
  END IF;
  v_txt := public.fn_care_digest_text(p_session, NULL);
  IF v_txt IS NULL THEN
    RETURN jsonb_build_object('sent', false,
             'message', 'Không còn khách nào cần gọi lại — không gửi tin.');
  END IF;
  PERFORM public.fn_notify_emit(
    'care.churn_digest', NULL,
    jsonb_build_object('text', v_txt, 'line', 'Gửi thử danh sách khách cần gọi'),
    'care.churn_digest:test' || extract(epoch FROM now())::bigint,
    NULL);
  RETURN jsonb_build_object('sent', true,
           'message', 'Đã xếp hàng — tin vào nhóm trong khoảng 15 giây.');
END $$;

-- ── 6. Quyền ──────────────────────────────────────────────────────────────
-- Tin chứa SĐT + doanh thu của mọi khách ⇒ hàm dựng tin và hàm phát tin chỉ
-- dành cho cron (chạy bằng postgres). Đừng để lọt xuống anon như 22 hàm đã
-- phát hiện ở đợt soát 08-08.
REVOKE ALL ON FUNCTION public.fn_care_digest_text(TEXT, INTEGER)   FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notify_care_digest(TEXT, TEXT)    FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.fn_care_config_get()                 FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_care_config_set(jsonb)            FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_care_digest_preview(TEXT)         FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_care_digest_send_now(TEXT)        FROM public, anon;

GRANT EXECUTE ON FUNCTION public.fn_care_config_get()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_care_config_set(jsonb)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_care_digest_preview(TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_care_digest_send_now(TEXT)     TO authenticated;

NOTIFY pgrst, 'reload schema';
