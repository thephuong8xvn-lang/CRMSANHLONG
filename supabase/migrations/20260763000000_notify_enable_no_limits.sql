-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — BẬT, GỬI TẤT CẢ, KHÔNG GIỚI HẠN
-- 2026-08-07
--
-- User chốt: bật kill-switch, gửi mọi tin, không phân biệt, không giới hạn.
--   • Trần ngày toàn cục và trần từng loại: gỡ (đặt 1.000.000 = thực tế vô hạn).
--   • Giờ im lặng 22h–06h: tắt. Bán đêm cũng báo.
--   • Chống dội (min_interval): vốn đã bằng 0 ở mọi luật.
--   • Cửa sổ gom: vốn đã bằng 0 từ đợt 3.
--
-- ⚠️ MỘT TRẦN KHÔNG GỠ ĐƯỢC — `per_run_cap` = 5
-- Đây KHÔNG phải giới hạn do mình đặt ra mà là trần cứng của Telegram:
-- ~20 tin/phút cho mỗi nhóm, vượt là trả **HTTP 429** và tin bị TỪ CHỐI.
-- Drain chạy mỗi 15 giây ⇒ 5 tin/lượt = đúng 20 tin/phút, kịch trần cho phép.
-- Đặt cao hơn sẽ khiến tin bị Telegram chặn, tức là NHẬN ÍT TIN HƠN chứ không
-- nhiều hơn. Phần vượt không mất: nằm lại hàng đợi và đi ở lượt 15 giây kế tiếp.
-- Với ~77 tin/ngày (≈3 tin/giờ) thì trần này thực tế không bao giờ chạm tới.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.system_settings
   SET value = value || jsonb_build_object(
         'enabled',          true,
         'global_daily_cap', 1000000,
         'per_run_cap',      5,
         'quiet_from',       0,
         'quiet_to',         0
       ),
       updated_at = now()
 WHERE key = 'notification_config';

UPDATE public.notification_rules
   SET enabled          = true,
       daily_cap        = 1000000,
       min_interval_sec = 0,
       batch_window_sec = 0,
       quiet_hours      = false,
       updated_at       = now();

NOTIFY pgrst, 'reload schema';
