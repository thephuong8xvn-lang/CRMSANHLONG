-- ═══════════════════════════════════════════════════════════════════════
-- ĐỢT G — NHẮC LỊCH VACCINE
--
-- 07:00 VN mỗi ngày:
--   · Mỗi khách có nhóm Telegram nhận lịch vaccine của ĐÀN NHÀ MÌNH
--     (hôm nay + ngày mai, để kịp chuẩn bị vaccine).
--   · Một bản tổng hợp nội bộ vào kênh 📊 Tổng hợp, có đánh dấu khách nào
--     KHÔNG có nhóm Telegram để nhân viên gọi tay, và các bước quá hạn.
--
-- Nguồn lịch là `herd_project_steps` — phác đồ do user tự nhập, hệ thống
-- chỉ đọc. Ngày tuổi = planned_date − herd_projects.start_date.
--
-- 🔴 RANH GIỚI AN TOÀN
--  · Tin gửi khách KHÔNG có giá vốn, giá bán, công nợ, hay tên khách khác.
--    Mỗi khách chỉ thấy dự án do chính `herd_projects.customer_id` trỏ tới.
--  · Bước QUÁ HẠN chỉ vào bản nội bộ. Nhắc khách "anh chưa làm" mỗi sáng
--    là đường ngắn nhất để họ tắt tiếng nhóm — mất luôn cả tin hoá đơn.
--  · Luật `customer` bắt buộc có customer_id; thiếu thì `fn_notify_target`
--    bỏ qua chứ không rơi về kênh mặc định.
--
-- 🪤 Bẫy đã tránh
--  · `herd_project_steps.status` là TEXT tự do, hiện chỉ có 'done'/'skipped'.
--    Lọc bằng NOT IN chứ đừng liệt kê trạng thái "chưa làm" — chưa biết
--    user sẽ dùng chữ gì.
--  · Ngày "hôm nay" phải lấy theo giờ VN; cron chạy UTC.
--  · `fn_tg_escape` trả NULL khi nhận NULL (`20260776`) — COALESCE TRƯỚC
--    khi escape, nếu không cả dòng thành NULL và biến mất khỏi tin.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Luật phát tin ──────────────────────────────────────────────────
INSERT INTO public.notification_rules
  (event_type, label, enabled, severity, channel_code, audience, compose,
   delay_sec, batch_window_sec, min_interval_sec, quiet_hours, daily_cap, threshold)
VALUES
  ('herd.vaccine_due', 'Lịch vaccine gửi khách', true, 'info',
   '@customer', 'customer', 'full', 0, 0, 0, false, 1000000, '{}'::jsonb),
  ('herd.vaccine_digest', 'Lịch vaccine — tổng hợp nội bộ', true, 'info',
   'tong_hop', 'internal', 'full', 0, 0, 0, false, 1000000, '{}'::jsonb)
ON CONFLICT (event_type) DO UPDATE
  SET channel_code = EXCLUDED.channel_code,
      audience     = EXCLUDED.audience,
      compose      = EXCLUDED.compose,
      enabled      = EXCLUDED.enabled;

-- ── 2. Tin cho MỘT khách ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_vaccine_due_text(
  p_customer_id uuid,
  p_date        date
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_khoi text;
BEGIN
  -- Gom HAI TẦNG: dự án → ngày. Nếu gom một tầng thì tiêu đề "Hôm nay"
  -- lặp lại cho từng mũi khi một ngày có nhiều mũi.
  WITH viec AS (
    SELECT p.id AS du_an_id, p.name AS du_an, p.start_date, s.planned_date,
           string_agg('· ' || public.fn_tg_escape(COALESCE(s.step_name,'(chưa đặt tên)')),
                      E'\n' ORDER BY s.sort_order, s.step_name) AS cac_mui
      FROM public.herd_projects p
      JOIN public.herd_project_steps s ON s.project_id = p.id
     WHERE p.customer_id = p_customer_id
       AND p.status = 'active'
       AND s.planned_date IN (p_date, p_date + 1)
       AND s.status NOT IN ('done','skipped','cancelled')
     GROUP BY p.id, p.name, p.start_date, s.planned_date
  ),
  theo_ngay AS (
    SELECT du_an_id, du_an, planned_date,
           '📅 <b>' || CASE WHEN planned_date = p_date THEN 'Hôm nay' ELSE 'Ngày mai' END
           || ' ' || to_char(planned_date,'DD/MM') || '</b>'
           || COALESCE(' · <i>' || (planned_date - start_date) || ' ngày tuổi</i>', '')
           || E'\n' || cac_mui AS khoi_ngay
      FROM viec
  )
  SELECT string_agg(x.khoi, E'\n\n' ORDER BY x.du_an)
    INTO v_khoi
    FROM (SELECT du_an,
                 '🐔 <b>' || public.fn_tg_escape(COALESCE(du_an,'Đàn')) || '</b>' || E'\n'
                 || string_agg(khoi_ngay, E'\n' ORDER BY planned_date) AS khoi
            FROM theo_ngay GROUP BY du_an_id, du_an) x;

  IF v_khoi IS NULL THEN RETURN NULL; END IF;

  RETURN '💉 <b>LỊCH VACCINE</b>'
      || E'\n\n' || v_khoi
      || E'\n\n<i>Cần tư vấn hoặc đặt vaccine, nhắn lại nhóm này.</i>';
END $$;

-- ── 3. Bản tổng hợp nội bộ ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_vaccine_digest_text(
  p_date date
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hom_nay text; v_mai text; v_qua text; v_txt text;
BEGIN
  -- Một dòng cho mỗi bước, kèm cờ khách có nhận được tin tự động hay không.
  WITH b AS (
    SELECT s.planned_date, s.step_name, s.sort_order,
           p.name AS du_an, p.start_date,
           COALESCE(c.farm_name,'(chưa gắn khách)') AS khach,
           (c.telegram_chat_id IS NOT NULL) AS co_nhom
      FROM public.herd_project_steps s
      JOIN public.herd_projects p ON p.id = s.project_id
      LEFT JOIN public.customers c ON c.id = p.customer_id
     WHERE p.status = 'active'
       AND s.status NOT IN ('done','skipped','cancelled')
  )
  SELECT
    (SELECT string_agg('· ' || public.fn_tg_escape(khach) || ' — '
                       || public.fn_tg_escape(COALESCE(du_an,'—')) || ' — <b>'
                       || public.fn_tg_escape(COALESCE(step_name,'(chưa đặt tên)')) || '</b>'
                       || CASE WHEN co_nhom THEN ' ✅' ELSE ' ⚠️ <i>chưa có nhóm</i>' END,
                       E'\n' ORDER BY khach, sort_order)
       FROM b WHERE planned_date = p_date),
    (SELECT string_agg('· ' || public.fn_tg_escape(khach) || ' — '
                       || public.fn_tg_escape(COALESCE(step_name,'(chưa đặt tên)'))
                       || CASE WHEN co_nhom THEN ' ✅' ELSE ' ⚠️ <i>chưa có nhóm</i>' END,
                       E'\n' ORDER BY khach, sort_order)
       FROM b WHERE planned_date = p_date + 1),
    (SELECT string_agg('· ' || public.fn_tg_escape(khach) || ' — '
                       || public.fn_tg_escape(COALESCE(step_name,'(chưa đặt tên)'))
                       || ' <i>(' || (p_date - planned_date) || ' ngày)</i>',
                       E'\n' ORDER BY planned_date)
       FROM b WHERE planned_date < p_date)
  INTO v_hom_nay, v_mai, v_qua;

  IF v_hom_nay IS NULL AND v_mai IS NULL AND v_qua IS NULL THEN
    RETURN NULL;   -- không có gì để báo thì im lặng, đừng gửi tin rỗng
  END IF;

  v_txt := '💉 <b>LỊCH VACCINE</b> ' || to_char(p_date,'DD/MM/YYYY')
        || COALESCE(E'\n\n📅 <b>Hôm nay</b>\n'  || v_hom_nay, '')
        || COALESCE(E'\n\n📅 <b>Ngày mai</b>\n' || v_mai, '')
        || COALESCE(E'\n\n⏰ <b>Quá hạn chưa ghi nhận</b>\n' || v_qua, '')
        || E'\n\n<i>⚠️ = khách chưa có nhóm Telegram, phải gọi tay.</i>';
  RETURN v_txt;
END $$;

-- ── 4. Phát tin ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_vaccine_due(
  p_date date DEFAULT NULL,
  p_mode text DEFAULT 'send'          -- 'send' | 'preview'
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date date;
  v_c    record;
  v_txt  text;
  v_out  text := '';
  v_n    integer := 0;
BEGIN
  IF p_mode NOT IN ('send','preview') THEN
    RAISE EXCEPTION 'p_mode phải là send hoặc preview, nhận: %', p_mode;
  END IF;
  v_date := COALESCE(p_date, (timezone('Asia/Ho_Chi_Minh', now()))::date);

  -- (a) Từng khách CÓ nhóm Telegram và CÓ việc trong 2 ngày tới.
  FOR v_c IN
    SELECT DISTINCT c.id, c.farm_name
      FROM public.customers c
      JOIN public.herd_projects p ON p.customer_id = c.id AND p.status = 'active'
      JOIN public.herd_project_steps s ON s.project_id = p.id
     WHERE c.telegram_chat_id IS NOT NULL
       AND s.planned_date IN (v_date, v_date + 1)
       AND s.status NOT IN ('done','skipped','cancelled')
     ORDER BY c.farm_name
  LOOP
    v_txt := public.fn_notify_vaccine_due_text(v_c.id, v_date);
    CONTINUE WHEN v_txt IS NULL;
    v_n := v_n + 1;

    IF p_mode = 'send' THEN
      PERFORM public.fn_notify_emit(
        'herd.vaccine_due', NULL,
        jsonb_build_object('text', v_txt,
                           'line', v_c.farm_name || ' · lịch vaccine'),
        'herd.vaccine_due:' || v_c.id || ':' || v_date,
        v_c.id);
    END IF;
    v_out := v_out || v_txt || E'\n\n────────────────────\n\n';
  END LOOP;

  -- (b) Bản tổng hợp nội bộ.
  v_txt := public.fn_notify_vaccine_digest_text(v_date);
  IF v_txt IS NOT NULL THEN
    IF p_mode = 'send' THEN
      PERFORM public.fn_notify_emit(
        'herd.vaccine_digest', NULL,
        jsonb_build_object('text', v_txt, 'line', 'Lịch vaccine ' || to_char(v_date,'DD/MM')),
        'herd.vaccine_digest:' || v_date,
        NULL);
    END IF;
    v_out := v_out || v_txt;
  END IF;

  RETURN COALESCE(NULLIF(v_out,''),
                  '(không có lịch vaccine nào trong ngày ' || v_date || ')');
END $$;

-- ── 5. Lịch chạy: 07:00 VN = 00:00 UTC ───────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notify-vaccine-due';
SELECT cron.schedule('notify-vaccine-due', '0 0 * * *',
                     $cron$SELECT public.fn_notify_vaccine_due();$cron$);

GRANT EXECUTE ON FUNCTION public.fn_notify_vaccine_due_text(uuid, date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_vaccine_digest_text(date)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_vaccine_due(date, text)       TO authenticated;

COMMENT ON FUNCTION public.fn_notify_vaccine_due(date, text) IS
  'Nhắc lịch vaccine 07:00 VN: tin riêng cho từng khách có nhóm + bản tổng hợp nội bộ. p_mode=preview để xem trước.';
