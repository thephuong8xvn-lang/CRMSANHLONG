-- ============================================================
-- Migration: Expiry → Hành động — gợi ý % giảm giá theo mốc hạn dùng
-- File: 20260716000000_expiry_promo_tiers.sql
--
-- Mục tiêu (#3 trong roadmap "Dự báo & hành động"):
--   Trang Hàng sắp hết hạn (/inventory/expiry) bổ sung HÀNH ĐỘNG:
--   gợi ý % giảm giá theo mốc cận date → tạo khuyến mãi sản phẩm thật
--   (product_promotions, được POS áp dụng) để đẩy hàng tồn đọng.
--
--   Migration này CHỈ seed 1 dòng cấu hình system_settings — KHÔNG bảng/
--   view/hàm mới. Tốc độ bán (để ước "bán hết kịp không") lấy lại từ
--   view product_reorder_view sẵn có (security_invoker, tôn trọng RLS).
--
-- RLS: bảng system_settings đã có sẵn (đọc: user active; ghi: admin) từ
--      migration 20260612000000 — không cần thêm policy.
--
-- ⚠️ Đặt tên sort SAU file mới nhất (20260715), KHÔNG theo ngày thật
--    (pseudo-date tăng dần — quy ước dự án). Apply remote qua Management
--    API + INSERT tracking row; KHÔNG dùng `db push --include-all`.
-- ============================================================

-- % giảm giá GỢI Ý theo mốc hạn dùng (khớp EXPIRY_BUCKETS: d10/m1/m3/m6/y1).
-- Càng cận date càng giảm sâu để xả hàng; mốc xa (m6/y1) mặc định 0 = chưa cần.
-- Admin chỉnh trong modal "Cấu hình" của trang Hạn sử dụng.
INSERT INTO public.system_settings (key, value)
VALUES (
  'expiry_discount_tiers',
  '{"d10":30,"m1":15,"m3":5,"m6":0,"y1":0}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
