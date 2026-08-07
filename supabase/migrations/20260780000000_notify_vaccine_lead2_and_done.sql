-- ═══════════════════════════════════════════════════════════════════════
-- NHẮC VACCINE — BÁO TRƯỚC 2 NGÀY, BÁO NGAY KHI NHẬP LỊCH, BÁO KHI XONG
--
-- User chốt 07/08: "Gửi trước 2 ngày để sắp xếp nhân sự, gửi mỗi ngày lúc
-- 7h sáng, và gửi sau khi hoàn thành task đó."
--
-- Đổi so với `20260778`:
--   ① Cửa sổ nhắc: hôm nay + ngày mai → **hôm nay + 2 ngày tới** (D, D+1, D+2)
--   ② Nhập lịch xong là BÁO NGAY, không đợi 07:00 hôm sau. Lỗ hổng cũ: lịch
--      nhập sau 07:00 cho hôm sau thì tới sáng hôm sau mới báo — đúng ngày
--      tiêm, không còn thời gian sắp người và mua vaccine.
--   ③ Đánh dấu mũi tiêm `done` thì báo cho khách kèm mũi kế tiếp.
--
-- 🔑 CHỐNG DỘI TIN — dựa vào cơ chế có sẵn của `fn_notify_emit`:
--    `subject_key` = hai đoạn đầu của fingerprint, và mỗi lần emit sẽ đánh
--    `skipped` mọi sự kiện CHƯA GỬI cùng subject. Dùng fingerprint dạng
--    `herd.vaccine_due:<customer_id>:<...>` ⇒ nhập 8 mũi một lượt sinh 8 sự
--    kiện nhưng 7 cái bị đè, chỉ 1 tin đi ra. Và vì nội dung được DỰNG LẠI
--    từ DB mỗi lần nên tin sống sót chứa đủ cả 8 mũi.
--    ⚠️ Hệ quả: ĐỪNG nhét step_id vào đoạn thứ 2 của fingerprint, làm vậy
--    mỗi mũi thành một subject riêng và khách lãnh đủ 8 tin.
--
-- 🪤 Vẫn phải CONSTRAINT TRIGGER DEFERRABLE: màn nhập lịch ghi nhiều dòng
--    trong một transaction; đọc sớm thì tin thiếu mũi.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.notification_rules
  (event_type, label, enabled, severity, channel_code, audience, compose,
   delay_sec, batch_window_sec, min_interval_sec, quiet_hours, daily_cap, threshold)
VALUES
  ('herd.step_done', 'Đã tiêm xong — gửi khách', true, 'info',
   '@customer', 'customer', 'full', 0, 0, 0, false, 1000000, '{}'::jsonb)
ON CONFLICT (event_type) DO UPDATE
  SET channel_code = EXCLUDED.channel_code,
      audience     = EXCLUDED.audience,
      compose      = EXCLUDED.compose,
      enabled      = EXCLUDED.enabled;

-- ── ① Tin cho khách: cửa sổ 3 ngày ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_vaccine_due_text(
  p_customer_id uuid,
  p_date        date
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_khoi text;
BEGIN
  WITH viec AS (
    SELECT p.id AS du_an_id, p.name AS du_an, p.start_date, s.planned_date,
           string_agg('· ' || public.fn_tg_escape(COALESCE(s.step_name,'(chưa đặt tên)')),
                      E'\n' ORDER BY s.sort_order, s.step_name) AS cac_mui
      FROM public.herd_projects p
      JOIN public.herd_project_steps s ON s.project_id = p.id
     WHERE p.customer_id = p_customer_id
       AND p.status = 'active'
       AND s.planned_date BETWEEN p_date AND p_date + 2
       AND s.status NOT IN ('done','skipped','cancelled')
     GROUP BY p.id, p.name, p.start_date, s.planned_date
  ),
  theo_ngay AS (
    SELECT du_an_id, du_an, planned_date,
           '📅 <b>' || CASE planned_date - p_date
                         WHEN 0 THEN 'Hôm nay'
                         WHEN 1 THEN 'Ngày mai'
                         ELSE 'Ngày kia' END
           || ' ' || to_char(planned_date,'DD/MM') || '</b>'
           || CASE WHEN start_date IS NOT NULL
                   THEN ' · <i>' || (planned_date - start_date) || ' ngày tuổi</i>'
                   ELSE '' END
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
      || E'\n\n<i>Nhắc trước để anh/chị kịp sắp xếp nhân sự và chuẩn bị vaccine. '
      || 'Cần tư vấn hoặc đặt hàng, nhắn lại nhóm này.</i>';
END $$;

-- ── ① Bản nội bộ: cửa sổ 3 ngày ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_vaccine_digest_text(
  p_date date
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sap text; v_qua text;
BEGIN
  WITH b AS (
    SELECT s.planned_date, s.step_name, s.sort_order,
           p.name AS du_an,
           COALESCE(c.farm_name,'(chưa gắn khách)') AS khach,
           (c.telegram_chat_id IS NOT NULL) AS co_nhom
      FROM public.herd_project_steps s
      JOIN public.herd_projects p ON p.id = s.project_id
      LEFT JOIN public.customers c ON c.id = p.customer_id
     WHERE p.status = 'active'
       AND s.status NOT IN ('done','skipped','cancelled')
  )
  SELECT
    (SELECT string_agg('· <b>' || CASE planned_date - p_date
                                    WHEN 0 THEN 'Hôm nay' WHEN 1 THEN 'Mai' ELSE 'Kia' END
                       || '</b> ' || public.fn_tg_escape(khach) || ' — '
                       || public.fn_tg_escape(COALESCE(du_an,'—')) || ' — '
                       || public.fn_tg_escape(COALESCE(step_name,'(chưa đặt tên)'))
                       || CASE WHEN co_nhom THEN ' ✅' ELSE ' ⚠️ <i>chưa có nhóm</i>' END,
                       E'\n' ORDER BY planned_date, khach, sort_order)
       FROM b WHERE planned_date BETWEEN p_date AND p_date + 2),
    (SELECT string_agg('· ' || public.fn_tg_escape(khach) || ' — '
                       || public.fn_tg_escape(COALESCE(step_name,'(chưa đặt tên)'))
                       || ' <i>(' || (p_date - planned_date) || ' ngày)</i>',
                       E'\n' ORDER BY planned_date)
       FROM b WHERE planned_date < p_date)
  INTO v_sap, v_qua;

  IF v_sap IS NULL AND v_qua IS NULL THEN RETURN NULL; END IF;

  RETURN '💉 <b>LỊCH VACCINE 3 NGÀY TỚI</b> ' || to_char(p_date,'DD/MM/YYYY')
      || COALESCE(E'\n\n' || v_sap, '')
      || COALESCE(E'\n\n⏰ <b>Quá hạn chưa ghi nhận</b>\n' || v_qua, '')
      || E'\n\n<i>⚠️ = khách chưa có nhóm Telegram, phải gọi tay.</i>';
END $$;

-- ── ③ Tin báo đã tiêm xong ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_step_done_text(
  p_step_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_du_an text; v_mui text; v_ngay date; v_tuoi integer;
  v_ke_ten text; v_ke_ngay date; v_ke_tuoi integer;
BEGIN
  SELECT p.name, s.step_name, COALESCE(s.actual_date, s.planned_date),
         COALESCE(s.actual_date, s.planned_date) - p.start_date
    INTO v_du_an, v_mui, v_ngay, v_tuoi
    FROM public.herd_project_steps s
    JOIN public.herd_projects p ON p.id = s.project_id
   WHERE s.id = p_step_id;

  IF v_mui IS NULL THEN RETURN NULL; END IF;

  SELECT s2.step_name, s2.planned_date, s2.planned_date - p.start_date
    INTO v_ke_ten, v_ke_ngay, v_ke_tuoi
    FROM public.herd_project_steps s2
    JOIN public.herd_projects p  ON p.id = s2.project_id
    JOIN public.herd_project_steps s ON s.project_id = s2.project_id
   WHERE s.id = p_step_id AND s2.id <> p_step_id
     AND s2.status NOT IN ('done','skipped','cancelled')
     AND s2.planned_date >= v_ngay
   ORDER BY s2.planned_date, s2.sort_order
   LIMIT 1;

  RETURN '✅ <b>ĐÃ TIÊM XONG</b>'
      || E'\n🐔 <b>' || public.fn_tg_escape(COALESCE(v_du_an,'Đàn')) || '</b>'
      || E'\n· ' || public.fn_tg_escape(v_mui)
      || E'\n📅 ' || to_char(v_ngay,'DD/MM/YYYY')
      || CASE WHEN v_tuoi IS NOT NULL THEN ' · <i>' || v_tuoi || ' ngày tuổi</i>' ELSE '' END
      || CASE WHEN v_ke_ten IS NOT NULL
              THEN E'\n\n⏭ <b>Mũi tiếp theo</b>' || E'\n· '
                   || public.fn_tg_escape(v_ke_ten)
                   || ' — ' || to_char(v_ke_ngay,'DD/MM')
                   || CASE WHEN v_ke_tuoi IS NOT NULL
                           THEN ' <i>(' || v_ke_tuoi || ' ngày tuổi)</i>' ELSE '' END
              ELSE E'\n\n<i>Đã hoàn tất phác đồ của đàn này.</i>' END;
END $$;

-- ── ②③ Trigger trên các bước ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_herd_step()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today  date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  v_status text; v_planned date; v_cus uuid; v_txt text;
BEGIN
  -- Đọc lại dòng ở thời điểm commit; NEW chỉ là ảnh chụp lúc câu lệnh chạy.
  SELECT s.status, s.planned_date, p.customer_id
    INTO v_status, v_planned, v_cus
    FROM public.herd_project_steps s
    JOIN public.herd_projects p ON p.id = s.project_id
   WHERE s.id = NEW.id AND p.status = 'active';

  IF v_cus IS NULL THEN RETURN NULL; END IF;

  -- ③ Vừa đánh dấu xong một mũi
  IF TG_OP = 'UPDATE' AND v_status = 'done'
     AND COALESCE(OLD.status,'') IS DISTINCT FROM 'done' THEN
    v_txt := public.fn_notify_step_done_text(NEW.id);
    IF v_txt IS NOT NULL THEN
      PERFORM public.fn_notify_emit('herd.step_done', NULL,
        jsonb_build_object('text', v_txt, 'line', 'Đã tiêm xong'),
        'herd.step_done:' || NEW.id, v_cus);
    END IF;
    RETURN NULL;
  END IF;

  -- ② Vừa nhập / dời lịch vào cửa sổ 3 ngày → báo ngay, dựng lại TOÀN BỘ
  --    lịch của khách. Fingerprint giữ customer_id ở đoạn 2 để nhiều mũi
  --    nhập cùng lúc gộp về một tin duy nhất (xem ghi chú đầu file).
  IF v_status NOT IN ('done','skipped','cancelled')
     AND v_planned BETWEEN v_today AND v_today + 2 THEN
    v_txt := public.fn_notify_vaccine_due_text(v_cus, v_today);
    IF v_txt IS NOT NULL THEN
      PERFORM public.fn_notify_emit('herd.vaccine_due', NULL,
        jsonb_build_object('text', v_txt, 'line', 'Lịch vaccine sắp tới'),
        'herd.vaccine_due:' || v_cus || ':' || v_today, v_cus);
    END IF;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;   -- không bao giờ chặn nghiệp vụ
END $$;

DROP TRIGGER IF EXISTS trg_notify_herd_step ON public.herd_project_steps;
CREATE CONSTRAINT TRIGGER trg_notify_herd_step
  AFTER INSERT OR UPDATE ON public.herd_project_steps
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_herd_step();

GRANT EXECUTE ON FUNCTION public.fn_notify_step_done_text(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_notify_vaccine_due_text(uuid, date) IS
  'Lịch vaccine của khách trong 3 ngày (hôm nay + 2 ngày tới), gom theo dự án rồi theo ngày.';
