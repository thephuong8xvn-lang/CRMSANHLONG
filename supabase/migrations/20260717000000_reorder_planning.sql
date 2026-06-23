-- ============================================================
-- Migration: Reorder chuẩn hóa — Safety Stock + Reorder Point (ROP)
-- File: 20260717000000_reorder_planning.sql
--
-- Mục tiêu (#2 trong roadmap "Dự báo & hành động"):
--   Nâng gợi ý đặt hàng từ heuristic "tần suất bán" lên công thức tồn kho
--   chuẩn: Safety Stock + Reorder Point dùng lead time + độ biến động cầu.
--
--   ROP/SS được tính ở FRONTEND (theo config lead time / mức phục vụ /
--   số ngày phủ → đổi tức thì không refetch). Migration này CHỈ:
--     (1) recreate product_reorder_view + 2 cột thống kê biến động cầu
--         (weekly_stddev, weeks_observed) — GIỮ nguyên mọi cột cũ để
--         Dashboard + trang Hạn sử dụng không vỡ.
--     (2) seed system_settings.reorder_config (lead time mặc định toàn hệ
--         + mức phục vụ + số ngày phủ + ngưỡng bán thường xuyên).
--
-- σ (độ lệch chuẩn cầu theo TUẦN, 12 tuần) tính GỒM cả tuần bán = 0 để
-- không xem nhẹ hàng bán thưa. CROSS JOIN chỉ áp cho SP CÓ phát sinh bán
-- (DISTINCT trong CTE weekly) → tránh nổ toàn catalog.
--
-- RLS: view giữ security_invoker (tôn trọng RLS order_lines/stock_lots như
--      cũ). system_settings RLS sẵn có (đọc active / ghi admin).
--
-- ⚠️ Apply remote qua Management API + INSERT tracking row. KHÔNG db push
--    --include-all. Tên sort SAU 20260716 (pseudo-date — quy ước dự án).
-- ============================================================

CREATE OR REPLACE VIEW public.product_reorder_view
WITH (security_invoker = true) AS
WITH sold AS (
  SELECT
    ol.product_id,
    SUM(ol.quantity) FILTER (WHERE o.created_at >= now() - interval '30 days')  AS sold_30d,
    SUM(ol.quantity) FILTER (WHERE o.created_at >= now() - interval '90 days')  AS sold_90d,
    COUNT(DISTINCT o.id) FILTER (WHERE o.created_at >= now() - interval '90 days') AS orders_90d
  FROM public.order_lines ol
  JOIN public.orders o ON o.id = ol.order_id
  WHERE o.status IN ('confirmed','shipping','delivered','paid','completed')
  GROUP BY ol.product_id
),
stock AS (
  SELECT product_id, COALESCE(SUM(quantity_on_hand), 0) AS soh
  FROM public.stock_lots
  WHERE status = 'active'
  GROUP BY product_id
),
-- Nhu cầu theo tuần trong 12 tuần gần nhất (chỉ SP có phát sinh bán).
weekly AS (
  SELECT
    ol.product_id,
    date_trunc('week', o.created_at) AS wk,
    SUM(ol.quantity) AS qty
  FROM public.order_lines ol
  JOIN public.orders o ON o.id = ol.order_id
  WHERE o.status IN ('confirmed','shipping','delivered','paid','completed')
    AND o.created_at >= date_trunc('week', now()) - interval '11 weeks'
  GROUP BY ol.product_id, date_trunc('week', o.created_at)
),
weeks AS (
  SELECT generate_series(
    date_trunc('week', now()) - interval '11 weeks',
    date_trunc('week', now()),
    interval '1 week'
  ) AS wk
),
-- σ tính trên 12 tuần GỒM tuần bán = 0 (left join + coalesce 0).
sigma AS (
  SELECT
    z.product_id,
    stddev_samp(z.qty)                       AS weekly_stddev,
    COUNT(*) FILTER (WHERE z.qty > 0)        AS weeks_observed
  FROM (
    SELECT pw.product_id, w.wk, COALESCE(wd.qty, 0) AS qty
    FROM (SELECT DISTINCT product_id FROM weekly) pw
    CROSS JOIN weeks w
    LEFT JOIN weekly wd ON wd.product_id = pw.product_id AND wd.wk = w.wk
  ) z
  GROUP BY z.product_id
)
SELECT
  p.id AS product_id,
  p.sku,
  p.name,
  p.unit,
  p.min_stock_level,
  COALESCE(st.soh, 0)         AS stock_on_hand,
  COALESCE(s.sold_30d, 0)     AS sold_30d,
  COALESCE(s.sold_90d, 0)     AS sold_90d,
  COALESCE(s.orders_90d, 0)   AS orders_90d,
  ROUND(COALESCE(s.sold_90d, 0)::numeric / (90.0 / 7.0), 2) AS avg_weekly,
  CASE WHEN COALESCE(s.sold_90d, 0) > 0
    THEN ROUND(COALESCE(st.soh, 0)::numeric / (COALESCE(s.sold_90d, 0)::numeric / 90.0), 1)
    ELSE NULL END AS days_cover,
  -- ── 2 cột MỚI cho reorder chuẩn hóa ──
  ROUND(COALESCE(sg.weekly_stddev, 0)::numeric, 2) AS weekly_stddev,
  COALESCE(sg.weeks_observed, 0)                   AS weeks_observed
FROM public.products p
LEFT JOIN sold  s  ON s.product_id  = p.id
LEFT JOIN stock st ON st.product_id = p.id
LEFT JOIN sigma sg ON sg.product_id = p.id
WHERE p.is_active = true;

GRANT SELECT ON public.product_reorder_view TO authenticated;

-- ── Cấu hình reorder toàn hệ (lead time 1 số mặc định + mức phục vụ) ──
-- service_level 0.95 → Z=1.65 (map ở frontend). cover_days/min_orders là
-- giá trị mặc định cho ô nhập trên trang (user vẫn chỉnh được mỗi phiên).
INSERT INTO public.system_settings (key, value)
VALUES (
  'reorder_config',
  '{"lead_time_days":7,"service_level":0.95,"cover_days":30,"min_orders":3}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
