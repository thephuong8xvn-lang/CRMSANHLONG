-- ═══════════════════════════════════════════════════════════════════════════
-- NHẮC VACCINE HẰNG NGÀY ĐANG SỬA ĐÈ TIN HÔM TRƯỚC, KHÔNG GỬI TIN MỚI
-- 2026-08-08
--
-- User: "hiện tại tôi không thấy nhắn tin được vào nhóm … bảo ân hậu".
--
-- ── Không phải không gửi. Là GỬI BẰNG CÁCH SỬA TIN CŨ. ──────────────────
-- `notification_log` của nhóm `-5347145958` lúc 07:00:09 hôm nay:
--     mode = 'edit'  ·  tg_message_id = 121  ·  http 200  ·  status sent
-- Tin 121 là bản nhắc vaccine gửi 17:28 HÔM QUA. Bản hôm nay không xuất hiện
-- như một tin mới — nó lặng lẽ ghi đè lên nội dung tin cũ. Trong nhóm không
-- có gì nhảy lên, không có thông báo. Người dùng kết luận "không gửi được"
-- là hoàn toàn hợp lý.
--
-- ── Gốc: NGÀY nằm ở đoạn thứ BA của fingerprint ─────────────────────────
--     'herd.vaccine_due:' || customer_id || ':' || ngay
-- `fn_notify_emit` (`20260769:118`) suy ra `subject_key` = HAI ĐOẠN ĐẦU, tức
-- `herd.vaccine_due:<customer_id>` — **giống hệt nhau mọi ngày**. Drain thấy
-- đã từng gửi thành công cho chủ thể đó trong `edit_window_hours` (168 giờ =
-- 7 ngày) nên chọn nhánh `editMessageText`.
-- ⇒ Nhắc vaccine sẽ đè lên chính nó **mỗi ngày một lần, suốt 7 ngày liền**.
--
-- Đây đúng là cái bẫy đã vá cho tin chốt ngày ở `20260782` — nhưng lần đó
-- chỉ sửa `daily.branch_close` / `daily.company_close`, **bỏ sót vaccine**.
-- Bản tổng hợp nội bộ `herd.vaccine_digest:<ngay>` thì đã đúng sẵn (ngày nằm
-- ở đoạn 2), nên chỉ tin GỬI KHÁCH bị.
--
-- ── Sửa: đẩy ngày lên đoạn thứ HAI bằng gạch dưới ───────────────────────
--     'herd.vaccine_due:' || customer_id || '_' || ngay
-- ⇒ subject_key = `herd.vaccine_due:<customer_id>_<ngay>`, riêng cho từng ngày.
-- Vẫn giữ nguyên ý đồ ban đầu: nhiều mũi nhập trong CÙNG một ngày vẫn chung
-- subject_key nên gộp về một tin duy nhất, và sửa lịch trong ngày thì tin
-- được cập nhật tại chỗ thay vì dội thêm tin mới. Chỉ khác ngày mới tách ra.
--
-- Phải sửa ở CẢ HAI nơi phát tin — bỏ sót một chỗ là lỗi quay lại:
--   ① `fn_notify_vaccine_due()`  — cron 07:00 hằng ngày (`20260778`)
--   ② `fn_notify_herd_step()`    — báo ngay khi nhập/dời lịch (`20260780`)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ① Cron 07:00 ──────────────────────────────────────────────────────
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
        -- NGÀY phải nằm trong subject_key (2 đoạn đầu) ⇒ nối bằng '_', không phải ':'
        'herd.vaccine_due:' || v_c.id || '_' || v_date,
        v_c.id);
    END IF;
    v_out := v_out || v_txt || E'\n\n────────────────────\n\n';
  END LOOP;

  -- (b) Bản tổng hợp nội bộ — đã đúng sẵn, ngày nằm ở đoạn 2.
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

-- ── ② Báo ngay khi nhập / dời lịch ────────────────────────────────────
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
  --    lịch của khách. Fingerprint giữ customer_id VÀ NGÀY ở đoạn 2 (nối
  --    bằng '_') để nhiều mũi nhập cùng một ngày vẫn gộp về một tin duy
  --    nhất, nhưng ngày khác thì KHÔNG đè lên tin của ngày trước.
  IF v_status NOT IN ('done','skipped','cancelled')
     AND v_planned BETWEEN v_today AND v_today + 2 THEN
    v_txt := public.fn_notify_vaccine_due_text(v_cus, v_today);
    IF v_txt IS NOT NULL THEN
      PERFORM public.fn_notify_emit('herd.vaccine_due', NULL,
        jsonb_build_object('text', v_txt, 'line', 'Lịch vaccine sắp tới'),
        'herd.vaccine_due:' || v_cus || '_' || v_today, v_cus);
    END IF;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;   -- không bao giờ chặn nghiệp vụ
END $$;

NOTIFY pgrst, 'reload schema';
