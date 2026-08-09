-- ═══════════════════════════════════════════════════════════════════════════
-- CHĂM SÓC KH — CHỈNH SỐ KHÁCH MỖI TIN 15 → 20
-- 2026-08-09 · user xem tin thật rồi chốt: "20 người đủ cho nhân viên gọi
--   trong buổi sáng".
--
-- Chỉ sửa ngưỡng, không đụng hàm dựng tin. Vẫn đổi được từ nút ⚙️ Cấu hình
-- trong module (fn_care_config_set kẹp trong khoảng 3–30).
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.notification_rules
   SET threshold  = COALESCE(threshold, '{}'::jsonb) || '{"limit": 20}'::jsonb,
       updated_at = now()
 WHERE event_type = 'care.churn_digest';
