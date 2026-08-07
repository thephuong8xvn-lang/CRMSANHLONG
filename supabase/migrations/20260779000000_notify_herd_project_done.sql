-- ═══════════════════════════════════════════════════════════════════════
-- BÁO HOÀN THÀNH LỨA NUÔI
--
-- User hoàn thành dự án đàn của khách và mong có tin vào nhóm Telegram,
-- nhưng không có gì gửi đi: 6 trigger trên các bảng đàn đều là việc vặt
-- (updated_at, sinh mã, kiểm nhất quán) — chưa cái nào gọi fn_notify_emit.
-- Đợt G chỉ nhắc LỊCH SẮP TỚI lúc 07:00, không phản ứng với đổi trạng thái.
--
-- Migration này lắp luồng còn thiếu: dự án chuyển sang `completed` thì
--   · nhóm của KHÁCH nhận bản tổng kết lứa nuôi
--   · kênh nội bộ nhận bản có thêm doanh số công ty bán cho khách trong kỳ
--
-- 🔴 RANH GIỚI: tin khách không có giá vốn / lợi nhuận / doanh số của công
--    ty. Các con số kinh tế của TRẠI (revenue/cost/fcr trong outcomes) là
--    số của chính khách nên hiện được, nhưng chỉ khi có giá trị.
--
-- 🪤 PHẢI dùng CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED + ĐỌC LẠI
--    dòng. Màn tổng kết ghi `herd_project_outcomes` và đổi `status` trong
--    CÙNG một transaction; AFTER UPDATE thường sẽ chạy TRƯỚC khi dòng
--    outcome kịp có mặt ⇒ tin rỗng. Đây đúng là bẫy đã sập ở
--    `fn_collect_customer_debt` (tin báo "còn nợ" đúng bằng số vừa trả).
--    Constraint trigger KHÔNG nhận `UPDATE OF cột` → bắt mọi UPDATE rồi lọc.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.notification_rules
  (event_type, label, enabled, severity, channel_code, audience, compose,
   delay_sec, batch_window_sec, min_interval_sec, quiet_hours, daily_cap, threshold)
VALUES
  ('herd.project_done', 'Hoàn thành lứa nuôi — gửi khách', true, 'info',
   '@customer', 'customer', 'full', 0, 0, 0, false, 1000000, '{}'::jsonb),
  ('herd.project_done_internal', 'Hoàn thành lứa nuôi — nội bộ', true, 'info',
   'tong_hop', 'internal', 'full', 0, 0, 0, false, 1000000, '{}'::jsonb)
ON CONFLICT (event_type) DO UPDATE
  SET channel_code = EXCLUDED.channel_code,
      audience     = EXCLUDED.audience,
      compose      = EXCLUDED.compose,
      enabled      = EXCLUDED.enabled;

-- ── Dựng tin ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_herd_done_text(
  p_project_id uuid,
  p_for        text DEFAULT 'customer'      -- 'customer' | 'internal'
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ten text; v_bd date; v_kt date; v_dau integer; v_khach text; v_nv text;
  v_ngay integer;
  v_ban integer; v_chet integer; v_kg numeric; v_fcr numeric;
  v_dt numeric; v_cp numeric; v_sao text; v_danhgia text; v_ghichu text;
  v_mui text; v_n_mui integer := 0;
  v_dso numeric := 0; v_don integer := 0;
  v_txt text;
BEGIN
  SELECT p.name, p.start_date, p.end_date, p.head_count,
         c.farm_name, pr.full_name
    INTO v_ten, v_bd, v_kt, v_dau, v_khach, v_nv
    FROM public.herd_projects p
    LEFT JOIN public.customers c ON c.id = p.customer_id
    LEFT JOIN public.profiles pr ON pr.id = p.owner_user_id
   WHERE p.id = p_project_id;

  IF v_ten IS NULL THEN RETURN NULL; END IF;
  v_ngay := COALESCE(v_kt, current_date) - v_bd;

  -- Dòng kết quả mới nhất. Mọi trường đều có thể NULL — chỉ hiện cái có.
  SELECT o.head_sold, o.head_died, o.avg_weight_kg, o.fcr, o.revenue, o.cost,
         CASE WHEN o.notes ~ '^\s*\{' THEN o.notes::jsonb->>'rating'     END,
         CASE WHEN o.notes ~ '^\s*\{' THEN o.notes::jsonb->>'assessment' END,
         CASE WHEN o.notes ~ '^\s*\{' THEN NULLIF(o.notes::jsonb->>'vetNotes','') END
    INTO v_ban, v_chet, v_kg, v_fcr, v_dt, v_cp, v_sao, v_danhgia, v_ghichu
    FROM public.herd_project_outcomes o
   WHERE o.project_id = p_project_id
   ORDER BY o.record_date DESC, o.created_at DESC
   LIMIT 1;

  SELECT count(*), string_agg('· ' || public.fn_tg_escape(COALESCE(s.step_name,'—'))
           || COALESCE(' <i>(' || to_char(s.planned_date,'DD/MM') || ')</i>', ''),
           E'\n' ORDER BY s.planned_date, s.sort_order)
    INTO v_n_mui, v_mui
    FROM public.herd_project_steps s
   WHERE s.project_id = p_project_id AND s.status = 'done';

  IF p_for = 'internal' THEN
    SELECT COALESCE(SUM(o.grand_total),0), count(*)
      INTO v_dso, v_don
      FROM public.orders o
      JOIN public.herd_projects p ON p.customer_id = o.customer_id
     WHERE p.id = p_project_id
       AND o.status NOT IN ('draft','cancelled')
       AND o.created_at >= p.start_date::timestamptz
       AND o.created_at <  (COALESCE(p.end_date, current_date) + 1)::timestamptz;
  END IF;

  v_txt := CASE WHEN p_for = 'internal' THEN '🏁 <b>KẾT THÚC LỨA NUÔI</b>'
                ELSE '🎉 <b>HOÀN THÀNH LỨA NUÔI</b>' END
    || E'\n🐔 <b>' || public.fn_tg_escape(v_ten) || '</b>'
    || CASE WHEN p_for = 'internal'
            THEN E'\n👤 ' || public.fn_tg_escape(COALESCE(v_khach,'—'))
                 || COALESCE(' · phụ trách ' || public.fn_tg_escape(v_nv), '')
            ELSE '' END
    || E'\n📅 ' || to_char(v_bd,'DD/MM') || ' → ' || to_char(COALESCE(v_kt,current_date),'DD/MM/YYYY')
    || ' · <b>' || v_ngay || ' ngày nuôi</b>'
    -- 🪤 KHÔNG dùng mẫu COALESCE('nhãn ' || fn(x), ''): `fn_notify_qty(NULL)`
    -- và `fn_notify_vnd(NULL)` trả chuỗi '0' chứ không trả NULL, nên NULL sẽ
    -- hiện thành "Xuất bán: 0 con" — báo sai cho khách rằng bán được 0 con,
    -- trong khi thực tế là CHƯA GHI. Cùng họ bẫy với fn_tg_escape (20260776).
    -- Phải chốt điều kiện tường minh trên biến gốc.
    || CASE WHEN v_dau  IS NOT NULL THEN E'\n🐣 Vào đàn: <b>'          || public.fn_notify_qty(v_dau) || '</b> con'   ELSE '' END
    || CASE WHEN v_ban  IS NOT NULL THEN E'\n📦 Xuất bán: <b>'         || public.fn_notify_qty(v_ban) || '</b> con'   ELSE '' END
    || CASE WHEN v_chet IS NOT NULL THEN E'\n💀 Hao hụt: <b>'          || public.fn_notify_qty(v_chet)|| '</b> con'   ELSE '' END
    || CASE WHEN v_kg   IS NOT NULL THEN E'\n⚖️ Trọng lượng TB: <b>'   || public.fn_notify_qty(v_kg)  || ' kg</b>'    ELSE '' END
    || CASE WHEN v_fcr  IS NOT NULL THEN E'\n🌾 FCR: <b>'              || public.fn_notify_qty(v_fcr) || '</b>'       ELSE '' END
    || CASE WHEN v_dt   IS NOT NULL THEN E'\n💵 Doanh thu trại: <b>'   || public.fn_notify_vnd(v_dt)  || '</b>'       ELSE '' END
    || CASE WHEN v_cp   IS NOT NULL THEN E'\n💸 Chi phí trại: <b>'     || public.fn_notify_vnd(v_cp)  || '</b>'       ELSE '' END
    || CASE WHEN v_n_mui > 0
            THEN E'\n\n💉 <b>Vaccine đã làm (' || v_n_mui || ' mũi)</b>' || E'\n' || v_mui
            ELSE '' END
    || COALESCE(E'\n\n⭐ Đánh giá: <b>' || v_sao || '/5</b>', '')
    || COALESCE(' — ' || CASE v_danhgia WHEN 'good' THEN 'Tốt'
                                        WHEN 'average' THEN 'Trung bình'
                                        WHEN 'poor' THEN 'Chưa đạt'
                                        ELSE v_danhgia END, '')
    || COALESCE(E'\n📝 ' || public.fn_tg_escape(v_ghichu), '');

  IF p_for = 'internal' THEN
    v_txt := v_txt
      || E'\n\n💰 <b>Công ty bán trong kỳ: ' || public.fn_notify_vnd(v_dso)
      || '</b> · ' || v_don || ' đơn';
  ELSE
    v_txt := v_txt
      || E'\n\n<i>Cảm ơn anh/chị đã đồng hành cùng Sanh Long Vetco. '
      || 'Chuẩn bị lứa mới, nhắn lại nhóm này để được tư vấn phác đồ '
      || 'và đặt vaccine sớm.</i>';
  END IF;

  RETURN v_txt;
END $$;

-- ── Trigger: HOÃN tới commit rồi ĐỌC LẠI ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_herd_project_done()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text; v_cus uuid; v_txt text;
BEGIN
  -- NEW là ảnh chụp lúc câu lệnh chạy; phải đọc lại dòng ở thời điểm commit.
  SELECT p.status::text, p.customer_id INTO v_status, v_cus
    FROM public.herd_projects p WHERE p.id = NEW.id;

  IF v_status IS DISTINCT FROM 'completed' THEN RETURN NULL; END IF;
  IF OLD.status::text = 'completed' THEN RETURN NULL; END IF;   -- đã báo rồi

  IF v_cus IS NOT NULL THEN
    v_txt := public.fn_notify_herd_done_text(NEW.id, 'customer');
    IF v_txt IS NOT NULL THEN
      PERFORM public.fn_notify_emit('herd.project_done', NULL,
        jsonb_build_object('text', v_txt, 'line', 'Hoàn thành lứa nuôi'),
        'herd.project_done:' || NEW.id, v_cus);
    END IF;
  END IF;

  v_txt := public.fn_notify_herd_done_text(NEW.id, 'internal');
  IF v_txt IS NOT NULL THEN
    PERFORM public.fn_notify_emit('herd.project_done_internal', NULL,
      jsonb_build_object('text', v_txt, 'line', 'Kết thúc lứa nuôi'),
      'herd.project_done_internal:' || NEW.id, NULL);
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;   -- không bao giờ chặn nghiệp vụ
END $$;

DROP TRIGGER IF EXISTS trg_notify_herd_done ON public.herd_projects;
CREATE CONSTRAINT TRIGGER trg_notify_herd_done
  AFTER UPDATE ON public.herd_projects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_herd_project_done();

GRANT EXECUTE ON FUNCTION public.fn_notify_herd_done_text(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.fn_notify_herd_done_text(uuid, text) IS
  'Dựng tin tổng kết lứa nuôi. p_for=customer|internal. Chỉ hiện trường có giá trị.';
