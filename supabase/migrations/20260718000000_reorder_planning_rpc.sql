-- ============================================================
-- Migration: Reorder chuẩn hóa (sửa hiệu năng) — tách σ/ROP sang RPC
-- File: 20260718000000_reorder_planning_rpc.sql
--
-- VẤN ĐỀ: migration 20260717 nhồi tính σ (CROSS JOIN 12 tuần) vào
--   product_reorder_view (security_invoker). Dưới RLS của order_lines,
--   query + ORDER/LIMIT ép tính toàn bộ view → "statement timeout" trên
--   PostgREST. View này còn được Dashboard + trang Hạn sử dụng dùng → làm
--   nặng cả 3 nơi.
--
-- SỬA:
--   (1) Trả product_reorder_view về BẢN NHẸ nguyên gốc (bỏ 2 cột σ) →
--       Dashboard + Expiry nhanh lại như cũ.
--   (2) Tách phần σ/ROP sang RPC fn_reorder_planning SECURITY DEFINER
--       (bỏ chi phí RLS per-row trên order_lines → nhanh). Demand tính
--       ĐẦY ĐỦ toàn công ty — đúng cho nghiệp vụ mua hàng (trước đây
--       security_invoker khiến sales/branch_manager thấy demand thiếu).
--       Guard quyền: active + (admin OR inventory.view).
--
-- ⚠️ Apply remote + NOTIFY pgrst reload + tracking. KHÔNG db push.
-- ============================================================

-- ── (1) product_reorder_view trở lại bản nhẹ (giống 20260612) ──
-- DROP rồi CREATE (không REPLACE) vì cần BỎ 2 cột σ đã thêm ở 20260717
-- (CREATE OR REPLACE không cho drop cột). Không có view/object nào phụ
-- thuộc → drop an toàn; Dashboard/Expiry chỉ query lúc chạy.
DROP VIEW IF EXISTS public.product_reorder_view;
CREATE VIEW public.product_reorder_view
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

-- ── (2) RPC SECURITY DEFINER cho trang Gợi ý đặt hàng (σ + ROP) ──
CREATE OR REPLACE FUNCTION public.fn_reorder_planning(p_min_orders integer DEFAULT 3)
RETURNS TABLE (
  product_id      uuid,
  sku             text,
  name            text,
  unit            text,
  min_stock_level numeric,
  stock_on_hand   numeric,
  sold_30d        numeric,
  sold_90d        numeric,
  orders_90d      integer,
  avg_weekly      numeric,
  days_cover      numeric,
  weekly_stddev   numeric,
  weeks_observed  integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- Chỉ user active có quyền xem kho mới gọi được (khớp gate trang).
  IF NOT (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('inventory.view'))) THEN
    RAISE EXCEPTION 'Không có quyền xem gợi ý đặt hàng' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
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
    SELECT s2.product_id, COALESCE(SUM(s2.quantity_on_hand), 0) AS soh
    FROM public.stock_lots s2
    WHERE s2.status = 'active'
    GROUP BY s2.product_id
  ),
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
  sigma AS (
    SELECT
      z.product_id,
      stddev_samp(z.qty)                AS weekly_stddev,
      COUNT(*) FILTER (WHERE z.qty > 0) AS weeks_observed
    FROM (
      SELECT pw.product_id, w.wk, COALESCE(wd.qty, 0) AS qty
      FROM (SELECT DISTINCT product_id FROM weekly) pw
      CROSS JOIN weeks w
      LEFT JOIN weekly wd ON wd.product_id = pw.product_id AND wd.wk = w.wk
    ) z
    GROUP BY z.product_id
  )
  SELECT
    p.id,
    p.sku,
    p.name,
    p.unit,
    p.min_stock_level::numeric,
    COALESCE(st.soh, 0)::numeric,
    COALESCE(s.sold_30d, 0)::numeric,
    COALESCE(s.sold_90d, 0)::numeric,
    COALESCE(s.orders_90d, 0)::integer,
    ROUND(COALESCE(s.sold_90d, 0)::numeric / (90.0 / 7.0), 2),
    ROUND(COALESCE(st.soh, 0)::numeric / (COALESCE(s.sold_90d, 0)::numeric / 90.0), 1),
    ROUND(COALESCE(sg.weekly_stddev, 0)::numeric, 2),
    COALESCE(sg.weeks_observed, 0)::integer
  FROM public.products p
  JOIN sold  s  ON s.product_id  = p.id        -- chỉ SP có bán
  LEFT JOIN stock st ON st.product_id = p.id
  LEFT JOIN sigma sg ON sg.product_id = p.id
  WHERE p.is_active = true
    AND COALESCE(s.sold_90d, 0) > 0
    AND COALESCE(s.orders_90d, 0) >= p_min_orders
  ORDER BY (COALESCE(st.soh, 0)::numeric / NULLIF(COALESCE(s.sold_90d, 0)::numeric / 90.0, 0)) ASC NULLS LAST
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reorder_planning(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reorder_planning(integer) TO authenticated;

COMMENT ON FUNCTION public.fn_reorder_planning(integer) IS
  'Gợi ý đặt hàng chuẩn hóa: thống kê bán + σ cầu tuần (12 tuần, gồm tuần 0) cho SP có ≥ p_min_orders đơn/90n. SECURITY DEFINER (demand toàn công ty, bỏ chi phí RLS) + guard active & inventory.view. ROP/SS tính ở frontend.';
