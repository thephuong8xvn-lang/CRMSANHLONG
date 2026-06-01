-- ============================================================
-- Migration: Product — Gợi ý đặt hàng (tần suất bán) + cấu hình màu hạn dùng
-- File: 20260612000000_product_expiry_reorder.sql
-- ============================================================

-- ── 1. View gợi ý đặt hàng theo tần suất bán ────────────────
-- security_invoker → RLS của orders/order_lines/stock_lots tự lọc theo phạm vi user.
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
    ELSE NULL END AS days_cover
FROM public.products p
LEFT JOIN sold  s  ON s.product_id  = p.id
LEFT JOIN stock st ON st.product_id = p.id
WHERE p.is_active = true;

GRANT SELECT ON public.product_reorder_view TO authenticated;

-- ── 2. Bảng cấu hình hệ thống (key/value) — tạo nếu chưa có ──
-- Trước đây chỉ được tham chiếu (trigger loyalty) chứ chưa từng CREATE → tạo ở đây.
CREATE TABLE IF NOT EXISTS public.system_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Đọc: mọi user đang hoạt động (widget dashboard + trang kho cần cấu hình màu).
DROP POLICY IF EXISTS system_settings_select_active ON public.system_settings;
CREATE POLICY system_settings_select_active ON public.system_settings
  FOR SELECT USING (public.fn_is_active());

-- Ghi: chỉ admin.
DROP POLICY IF EXISTS system_settings_manage_admin ON public.system_settings;
CREATE POLICY system_settings_manage_admin ON public.system_settings
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active())
  WITH CHECK (public.fn_is_admin() AND public.fn_is_active());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO authenticated;

-- ── 3. Seed cấu hình màu mốc hạn dùng (toàn hệ thống) ───────
INSERT INTO public.system_settings (key, value)
VALUES ('expiry_buckets', '{"d10":"#dc2626","m1":"#f97316","m3":"#eab308","m6":"#3b82f6","y1":"#10b981"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
