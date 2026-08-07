-- ═══════════════════════════════════════════════════════════════════════
-- CHỐT NGÀY: dời sang 21:00 + VÁ LỖI ĐÈ TIN CŨ
--
-- ① Đổi giờ 17:30 / 17:45 → 21:00 / 21:05 (giờ VN).
--    Lý do: chi nhánh bán tới 20h, chốt lúc 17:30 cắt mất doanh thu tối.
--
-- ② 🔴 VÁ LỖI NGẦM — tin chốt ngày MAI sẽ ĐÈ LÊN tin HÔM NAY.
--    Drain (`20260774`, pha 3A) có luật: nếu `subject_key` của sự kiện
--    trùng với một tin ĐÃ GỬI vào cùng nhóm trong `edit_window_hours`
--    (đang là 168 giờ = 7 ngày) thì gọi `editMessageText` sửa tin cũ,
--    KHÔNG gửi tin mới.
--    `subject_key` = hai đoạn đầu của fingerprint. Fingerprint cũ là
--    `daily.branch_close:<uuid chi nhánh>:<ngày>` ⇒ chủ thể thành
--    `daily.branch_close:<uuid>` — GIỐNG HỆT NHAU MỌI NGÀY.
--    Hôm nay 07/08 là lần chạy đầu tiên nên chưa lộ; từ 08/08 nhóm sẽ
--    thấy tin cũ tự đổi số thay vì có tin mới, suốt 7 ngày liền.
--    Vá: đưa NGÀY lên đoạn thứ hai ⇒ `daily.branch_close:<ngày>_<uuid>`.
--    Mỗi ngày một chủ thể ⇒ ngày mới luôn là tin MỚI, còn chạy lại
--    trong CÙNG ngày vẫn sửa tại chỗ (đúng ý: cập nhật số, không spam).
--    Tin tổng công ty không dính lỗi này — fingerprint của nó vốn đã là
--    `daily.company_close:<ngày>`, đoạn thứ hai chính là ngày.
--
-- ③ Một lần duy nhất: gỡ chủ thể khỏi 2 tin đã gửi lúc 17:30/17:45 hôm
--    nay, để bản 21:00 tối nay ra tin MỚI chứ không sửa đè tin chiều.
--    (User: "tối nay vẫn gởi bình thường".)
--
-- 🪤 pg_cron chạy giờ UTC: 21:00 VN = 14:00 UTC (VN = UTC+7, không DST).
-- 🪤 Giữ 5 phút giữa hai job — đặt trùng phút thì hai job chạy song song,
--    không chắc tin chi nhánh tới trước tin tổng.
-- 🪤 Giờ im lặng là 22h–6h nên 21:00 nằm ngoài; hai luật này lại còn
--    `quiet_hours=false` từ `20260777`.
-- ═══════════════════════════════════════════════════════════════════════

-- ── ② Fingerprint có NGÀY nằm trong chủ thể ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_branch_close(
  p_date date DEFAULT NULL,
  p_mode text DEFAULT 'send'          -- 'send' | 'preview'
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date date;
  v_b    record;
  v_txt  text;
  v_out  text := '';
BEGIN
  IF p_mode NOT IN ('send','preview') THEN
    RAISE EXCEPTION 'p_mode phải là send hoặc preview, nhận: %', p_mode;
  END IF;
  v_date := COALESCE(p_date, (timezone('Asia/Ho_Chi_Minh', now()))::date);

  FOR v_b IN SELECT id, name FROM public.branches WHERE is_active ORDER BY code LOOP
    v_txt := public.fn_notify_branch_close_text(v_b.id, v_date);

    IF p_mode = 'send' THEN
      -- NGÀY phải nằm ở đoạn thứ hai: `subject_key` chỉ lấy 2 đoạn đầu.
      -- Ghép ngày với id bằng '_' (không phải ':') để một chi nhánh khác
      -- trong cùng ngày vẫn là chủ thể khác — nếu để ngày đứng riêng thì
      -- lượt phát của chi nhánh sau sẽ xoá mất bản chờ của chi nhánh trước.
      PERFORM public.fn_notify_emit(
        'daily.branch_close', v_b.id,
        jsonb_build_object('text', v_txt,
                           'line', v_b.name || ' · chốt ngày ' || to_char(v_date,'DD/MM')),
        'daily.branch_close:' || v_date || '_' || v_b.id,
        NULL);
    END IF;

    v_out := v_out || v_txt || E'\n\n────────────────────\n\n';
  END LOOP;

  RETURN v_out;
END $$;

-- ── ③ Tin 17:30/17:45 hôm nay thôi làm mốc sửa đè ─────────────────────
UPDATE public.notification_log
   SET subject_key = subject_key || '#cu'
 WHERE event_type IN ('daily.branch_close','daily.company_close')
   AND subject_key IS NOT NULL
   AND subject_key NOT LIKE '%#cu'
   AND created_at >= timezone('Asia/Ho_Chi_Minh',
         (timezone('Asia/Ho_Chi_Minh', now()))::date::timestamp);

-- ── ① Lịch mới ────────────────────────────────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('notify-branch-close','notify-company-close');

SELECT cron.schedule('notify-branch-close',  '0 14 * * *',
                     $cron$SELECT public.fn_notify_branch_close();$cron$);
SELECT cron.schedule('notify-company-close', '5 14 * * *',
                     $cron$SELECT public.fn_notify_company_close();$cron$);

GRANT EXECUTE ON FUNCTION public.fn_notify_branch_close(date, text) TO authenticated;

COMMENT ON FUNCTION public.fn_notify_branch_close(date, text) IS
  'Chốt ngày theo chi nhánh, 21:00 VN. p_mode=preview để xem trước, không gửi.';
COMMENT ON FUNCTION public.fn_notify_company_close(date, text) IS
  'Chốt ngày toàn công ty, 21:05 VN. p_mode=preview để xem trước, không gửi.';

-- ── Nghiệm thu ────────────────────────────────────────────────────────
DO $$
DECLARE v record; v_n integer := 0;
BEGIN
  FOR v IN SELECT jobname, schedule, active FROM cron.job
            WHERE jobname IN ('notify-branch-close','notify-company-close')
            ORDER BY jobname LOOP
    RAISE NOTICE 'cron % → % (active=%)', v.jobname, v.schedule, v.active;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Chỉ thấy % job chốt ngày, phải có 2', v_n;
  END IF;

  -- Không được còn tin nào hôm nay giữ chủ thể gốc, nếu không tối nay
  -- bản 21:00 sẽ sửa đè tin chiều thay vì gửi mới.
  IF EXISTS (SELECT 1 FROM public.notification_log
              WHERE event_type IN ('daily.branch_close','daily.company_close')
                AND subject_key IS NOT NULL AND subject_key NOT LIKE '%#cu'
                AND created_at >= timezone('Asia/Ho_Chi_Minh',
                      (timezone('Asia/Ho_Chi_Minh', now()))::date::timestamp)) THEN
    RAISE EXCEPTION 'Còn tin chốt ngày hôm nay giữ subject_key gốc';
  END IF;
END $$;
