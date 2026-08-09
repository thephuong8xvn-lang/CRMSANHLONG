-- ═══════════════════════════════════════════════════════════════════════════
-- CẢNH BÁO: ĐƠN CHƯA THU ĐỦ TIỀN & CHƯA HOÀN TẤT — 07:30 mỗi sáng
-- 2026-08-09 · user chốt: "tạo cảnh báo đơn chưa thu tiền và hoàn tất là được"
--
-- ── Vấn đề nó giải ──────────────────────────────────────────────────────
-- Dòng công nợ (`customer_debts`) chỉ sinh ra khi đơn đi tới bước HOÀN TẤT.
-- Đơn nằm ở `confirmed`/`shipping`/`delivered` mà chưa thu tiền thì **không có
-- dòng AR** ⇒ vô hình với module Công nợ, nhắc nợ, tuổi nợ và hạn mức tín dụng.
-- Đo 09/08: **26 đơn / 62.116.705 ₫** đang như vậy, trong đó **15 đơn /
-- 45.141.260 ₫ đã nằm im từ tháng 6–7** — tiền thật, không ai nhắc.
--
-- Phép kiểm `order_debt_without_ar_row` có thấy chuyện này, nhưng
-- `fn_monitor_tick` **chỉ gửi Telegram khi có vi phạm `critical`** ⇒ 26 đơn kia
-- chưa bao giờ được báo ra. Đợt này cho nó một kênh riêng, đúng ngôn ngữ nghiệp
-- vụ chứ không phải tên phép kiểm kỹ thuật.
--
-- ── Quyết định thiết kế ─────────────────────────────────────────────────
-- • Gửi **theo từng chi nhánh** (`@branch`) — chi nhánh độc lập kiểu nhượng
--   quyền, đơn của Hoài Ân không phải việc của Phù Mỹ.
-- • **Bỏ qua đơn lập trong ngày** (`min_days = 1`): đơn vừa bán sáng nay chưa
--   giao xong là bình thường, réo lên chỉ làm nhân viên quen với việc bỏ qua
--   cảnh báo. Sửa ngưỡng bằng `notification_rules.threshold->>'min_days'`.
-- • **Tách riêng phần quá 7 ngày** — đó mới là tiền đang thất lạc, khác hẳn
--   đơn đang trên đường giao.
-- • Chi nhánh không có đơn nào thì **không gửi gì** (im lặng = mọi thứ ổn).
--
-- 🪤 Tin ĐỊNH KỲ phải có NGÀY trong 2 đoạn đầu fingerprint, ghép với id chi
--    nhánh bằng '_' — nếu không, drain sẽ `editMessageText` đè lên tin hôm
--    trước và sáng nào nhóm cũng "không thấy tin mới". Bài học `20260782`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Dựng tin cho MỘT chi nhánh. Trả NULL khi không có đơn nào ──────────
CREATE OR REPLACE FUNCTION public.fn_notify_unpaid_open_text(
  p_branch_id UUID,
  p_min_days  INTEGER DEFAULT 1
) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ten    TEXT;
  v_moc    TIMESTAMPTZ;
  v_hnay   DATE;
  v_n      INTEGER := 0;
  v_tien   NUMERIC := 0;
  v_n_lau  INTEGER := 0;
  v_t_lau  NUMERIC := 0;
  v_dong   TEXT;
  v_txt    TEXT;
BEGIN
  SELECT b.name INTO v_ten FROM public.branches b WHERE b.id = p_branch_id;
  v_hnay := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  -- Ranh giới ngày phải quy về giờ VN rồi mới thành timestamptz; cron chạy UTC
  -- lệch 7 tiếng, so thẳng sẽ cắt nhầm một ngày.
  v_moc  := timezone('Asia/Ho_Chi_Minh',
              (v_hnay - GREATEST(COALESCE(p_min_days, 1), 0))::timestamp + interval '1 day');

  -- Một câu lệnh duy nhất: hàm này STABLE nên không được ghi bảng tạm.
  WITH d AS (
    SELECT o.order_code,
           (timezone('Asia/Ho_Chi_Minh', o.created_at))::date AS ngay,
           (v_hnay - (timezone('Asia/Ho_Chi_Minh', o.created_at))::date) AS so_ngay,
           COALESCE(c.farm_name, '(không gắn khách)') AS khach,
           (o.grand_total - o.paid_amount) AS con_no,
           o.paid_amount AS da_thu,
           CASE o.status::text
             WHEN 'confirmed' THEN 'đã xác nhận'
             WHEN 'shipping'  THEN 'đang giao'
             WHEN 'delivered' THEN 'đã giao'
             ELSE o.status::text
           END AS tt
      FROM public.orders o
      LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE o.branch_id = p_branch_id
       AND o.status::text IN ('confirmed','shipping','delivered')  -- chưa hoàn tất
       AND (o.grand_total - o.paid_amount) > 0.5                   -- chưa thu đủ
       AND o.created_at < v_moc
  )
  SELECT count(*), COALESCE(sum(con_no),0),
         count(*) FILTER (WHERE so_ngay > 7),
         COALESCE(sum(con_no) FILTER (WHERE so_ngay > 7),0),
         (SELECT string_agg(
                   '• <b>' || public.fn_tg_escape(t.order_code) || '</b> · '
                   || to_char(t.ngay,'DD/MM') || ' (' || t.so_ngay || ' ngày) · '
                   || public.fn_tg_escape(left(t.khach, 28)) || ' · <b>'
                   || public.fn_notify_vnd(t.con_no) || '</b> · ' || t.tt
                   || CASE WHEN t.da_thu > 0.5
                           THEN ' (đã thu ' || public.fn_notify_vnd(t.da_thu) || ')'
                           ELSE '' END,
                   E'\n' ORDER BY t.so_ngay DESC, t.con_no DESC)
            FROM (SELECT * FROM d ORDER BY so_ngay DESC, con_no DESC LIMIT 20) t)
    INTO v_n, v_tien, v_n_lau, v_t_lau, v_dong
    FROM d;

  IF v_n = 0 THEN RETURN NULL; END IF;

  v_txt := '🟠 <b>ĐƠN CHƯA THU ĐỦ TIỀN &amp; CHƯA HOÀN TẤT</b>'
        || COALESCE(' · ' || public.fn_tg_escape(v_ten), '')
        || E'\n<i>Tính tới ' || to_char(v_hnay,'DD/MM')
        || CASE WHEN COALESCE(p_min_days,1) > 0
                THEN ', bỏ qua đơn lập trong ' || COALESCE(p_min_days,1) || ' ngày gần nhất'
                ELSE '' END || '</i>'
        || E'\n────────────────'
        || E'\n📦 Tổng: <b>' || v_n || ' đơn</b> · <b>' || public.fn_notify_vnd(v_tien) || '</b>';

  IF v_n_lau > 0 THEN
    v_txt := v_txt || E'\n🔴 Quá 7 ngày: <b>' || v_n_lau || ' đơn</b> · <b>'
                   || public.fn_notify_vnd(v_t_lau) || '</b>';
  END IF;

  v_txt := v_txt || E'\n\n' || v_dong;

  IF v_n > 20 THEN
    v_txt := v_txt || E'\n… và ' || (v_n - 20) || ' đơn nữa';
  END IF;

  v_txt := v_txt
        || E'\n────────────────'
        || E'\n<i>Đơn chưa hoàn tất thì CHƯA có dòng công nợ, nên không hiện ở '
        || 'module Công nợ và không được nhắc nợ. Thu tiền rồi hoàn tất đơn, '
        || 'hoặc huỷ nếu đơn không còn hiệu lực.</i>';

  RETURN v_txt;
END $$;

-- ── 2. Quét mọi chi nhánh và phát tin ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_unpaid_open(
  p_mode     TEXT    DEFAULT 'send',   -- 'send' | 'preview'
  p_min_days INTEGER DEFAULT NULL      -- NULL = lấy từ threshold của luật
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b     RECORD;
  v_txt   TEXT;
  v_out   TEXT := '';
  v_days  INTEGER;
  v_date  DATE;
BEGIN
  IF p_mode NOT IN ('send','preview') THEN
    RAISE EXCEPTION 'p_mode phải là send hoặc preview, nhận: %', p_mode;
  END IF;

  v_days := COALESCE(p_min_days,
              (SELECT (threshold->>'min_days')::int FROM public.notification_rules
                WHERE event_type = 'order.unpaid_open'), 1);
  v_date := (timezone('Asia/Ho_Chi_Minh', now()))::date;

  FOR v_b IN SELECT id, name FROM public.branches WHERE is_active ORDER BY code LOOP
    v_txt := public.fn_notify_unpaid_open_text(v_b.id, v_days);
    CONTINUE WHEN v_txt IS NULL;          -- chi nhánh sạch thì im lặng

    IF p_mode = 'send' THEN
      PERFORM public.fn_notify_emit(
        'order.unpaid_open', v_b.id,
        jsonb_build_object('text', v_txt,
                           'line', v_b.name || ' · đơn chưa thu tiền ' || to_char(v_date,'DD/MM')),
        -- NGÀY ở đoạn 2, ghép id bằng '_' → mỗi ngày một chủ thể mới, và hai
        -- chi nhánh cùng ngày không xoá bản chờ của nhau.
        'order.unpaid_open:' || v_date || '_' || v_b.id,
        NULL);
    END IF;

    v_out := v_out || v_txt || E'\n\n────────────────────\n\n';
  END LOOP;

  RETURN COALESCE(NULLIF(v_out,''), '(Không có đơn nào chưa thu tiền quá hạn.)');
END $$;

-- ── 3. Luật ───────────────────────────────────────────────────────────────
INSERT INTO public.notification_rules
  (event_type, label, severity, channel_code, audience, compose,
   batch_window_sec, delay_sec, min_interval_sec, daily_cap, quiet_hours, threshold)
VALUES
  ('order.unpaid_open', 'Đơn chưa thu tiền & chưa hoàn tất', 'warn', '@branch',
   'internal', 'full', 0, 0, 0, 100, false, '{"min_days": 1}')
ON CONFLICT (event_type) DO UPDATE
  SET label='Đơn chưa thu tiền & chưa hoàn tất', severity='warn',
      channel_code='@branch', audience='internal', compose='full',
      quiet_hours=false, enabled=true, updated_at=now();

-- ── 4. Lịch: 07:30 VN = 00:30 UTC ─────────────────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notify-unpaid-open';
SELECT cron.schedule('notify-unpaid-open', '30 0 * * *',
                     $cron$SELECT public.fn_notify_unpaid_open();$cron$);

-- ── 5. Quyền: cron chạy bằng postgres. Không mở cho anon/authenticated ────
-- Tin này chứa số tiền còn nợ của mọi khách trong chi nhánh.
REVOKE ALL ON FUNCTION public.fn_notify_unpaid_open_text(UUID, INTEGER) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notify_unpaid_open(TEXT, INTEGER)      FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
