-- ═══════════════════════════════════════════════════════════════════════
-- VÁ: NGÀY TUỔI GÀ TÍNH SAI MỐC
--
-- User báo 07/08: tin nhắc vaccine hiện "1 ngày tuổi" cho đàn thực tế đã
-- 32 ngày tuổi.
--
-- Gốc rễ: tuổi được tính từ `herd_projects.start_date` — là ngày LẬP KẾ
-- HOẠCH, không phải ngày đàn vào chuồng. Dự án thường được lập sau khi
-- đàn đã nuôi một thời gian nên hai mốc lệch nhau rất xa:
--
--   DA-2026-00015  đàn vào chuồng 07/07  ·  dự án bắt đầu 07/08  → lệch 31 ngày
--   DA-2026-00012  đàn vào chuồng 12/05  ·  dự án bắt đầu 12/06  → lệch 31 ngày
--
-- Mốc đúng là `herds.entry_date`. Chỉ lùi về `start_date` khi dự án không
-- gắn đàn hoặc đàn chưa có ngày vào chuồng.
--
-- ⚠️ Sai ngày tuổi không phải lỗi hiển thị: phác đồ vaccine chốt theo ngày
--    tuổi, nên con số sai làm người đọc tưởng lịch bị đặt nhầm và có thể
--    tiêm sai thời điểm.
--
-- ❓ CÒN BỎ NGỎ: `herds.avg_age_weeks` (DA-2026-00012 = 1 tuần) chưa được
--    cộng vào. Nếu trường đó nghĩa là "tuổi của đàn LÚC vào chuồng" thì
--    phải cộng thêm avg_age_weeks*7. Chưa rõ nghĩa nên chưa động — hỏi user.
-- ═══════════════════════════════════════════════════════════════════════

-- Một chỗ duy nhất định nghĩa "ngày tuổi", để không lệch nhau giữa các tin.
CREATE OR REPLACE FUNCTION public.fn_herd_age_days(
  p_project_id uuid,
  p_on_date    date
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (p_on_date - COALESCE(h.entry_date, p.start_date))::integer
    FROM public.herd_projects p
    LEFT JOIN public.herds h ON h.id = p.herd_id
   WHERE p.id = p_project_id;
$$;

-- ── Tin nhắc lịch cho khách ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_vaccine_due_text(
  p_customer_id uuid,
  p_date        date
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_khoi text;
BEGIN
  WITH viec AS (
    SELECT p.id AS du_an_id, p.name AS du_an, s.planned_date,
           public.fn_herd_age_days(p.id, s.planned_date) AS tuoi,
           string_agg('· ' || public.fn_tg_escape(COALESCE(s.step_name,'(chưa đặt tên)')),
                      E'\n' ORDER BY s.sort_order, s.step_name) AS cac_mui
      FROM public.herd_projects p
      JOIN public.herd_project_steps s ON s.project_id = p.id
     WHERE p.customer_id = p_customer_id
       AND p.status = 'active'
       AND s.planned_date BETWEEN p_date AND p_date + 2
       AND s.status NOT IN ('done','skipped','cancelled')
     GROUP BY p.id, p.name, s.planned_date
  ),
  theo_ngay AS (
    SELECT du_an_id, du_an, planned_date,
           '📅 <b>' || CASE planned_date - p_date
                         WHEN 0 THEN 'Hôm nay'
                         WHEN 1 THEN 'Ngày mai'
                         ELSE 'Ngày kia' END
           || ' ' || to_char(planned_date,'DD/MM') || '</b>'
           || CASE WHEN tuoi IS NOT NULL AND tuoi >= 0
                   THEN ' · <i>' || tuoi || ' ngày tuổi</i>' ELSE '' END
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

-- ── Tin báo đã tiêm xong ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_step_done_text(
  p_step_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pj uuid; v_du_an text; v_mui text; v_ngay date; v_tuoi integer;
  v_ke_ten text; v_ke_ngay date; v_ke_tuoi integer;
BEGIN
  SELECT p.id, p.name, s.step_name, COALESCE(s.actual_date, s.planned_date)
    INTO v_pj, v_du_an, v_mui, v_ngay
    FROM public.herd_project_steps s
    JOIN public.herd_projects p ON p.id = s.project_id
   WHERE s.id = p_step_id;

  IF v_mui IS NULL THEN RETURN NULL; END IF;
  v_tuoi := public.fn_herd_age_days(v_pj, v_ngay);

  SELECT s2.step_name, s2.planned_date
    INTO v_ke_ten, v_ke_ngay
    FROM public.herd_project_steps s2
   WHERE s2.project_id = v_pj AND s2.id <> p_step_id
     AND s2.status NOT IN ('done','skipped','cancelled')
     AND s2.planned_date >= v_ngay
   ORDER BY s2.planned_date, s2.sort_order
   LIMIT 1;

  IF v_ke_ngay IS NOT NULL THEN
    v_ke_tuoi := public.fn_herd_age_days(v_pj, v_ke_ngay);
  END IF;

  RETURN '✅ <b>ĐÃ TIÊM XONG</b>'
      || E'\n🐔 <b>' || public.fn_tg_escape(COALESCE(v_du_an,'Đàn')) || '</b>'
      || E'\n· ' || public.fn_tg_escape(v_mui)
      || E'\n📅 ' || to_char(v_ngay,'DD/MM/YYYY')
      || CASE WHEN v_tuoi IS NOT NULL AND v_tuoi >= 0
              THEN ' · <i>' || v_tuoi || ' ngày tuổi</i>' ELSE '' END
      || CASE WHEN v_ke_ten IS NOT NULL
              THEN E'\n\n⏭ <b>Mũi tiếp theo</b>' || E'\n· '
                   || public.fn_tg_escape(v_ke_ten)
                   || ' — ' || to_char(v_ke_ngay,'DD/MM')
                   || CASE WHEN v_ke_tuoi IS NOT NULL AND v_ke_tuoi >= 0
                           THEN ' <i>(' || v_ke_tuoi || ' ngày tuổi)</i>' ELSE '' END
              ELSE E'\n\n<i>Đã hoàn tất phác đồ của đàn này.</i>' END;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_herd_age_days(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.fn_herd_age_days(uuid, date) IS
  'Ngày tuổi của đàn tại một ngày. Mốc là herds.entry_date (ngày vào chuồng), KHÔNG phải herd_projects.start_date (ngày lập kế hoạch).';
