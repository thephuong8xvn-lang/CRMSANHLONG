-- ============================================================
-- Migration: Gợi ý đặt hàng theo Thương hiệu / Nhà cung cấp / Nhóm SP
-- File: 20260743000000_reorder_by_dimension.sql
--
-- BỐI CẢNH: fn_reorder_planning (20260718) chỉ trả về SP + số liệu bán,
--   không có chiều phân loại nào → trang Gợi ý đặt hàng là 1 danh sách
--   phẳng 346 dòng, không gom được theo nhà cung cấp để lập phiếu đặt.
--
-- BỔ SUNG (chỉ THÊM cột trả về, không đổi tham số → FE cũ vẫn chạy):
--   • brand_id / brand_name          ← products.brand_id → brands
--   • category_id / category_name    ← products.category_id → product_categories
--   • supplier_id / supplier_name    ← SUY RA từ lịch sử nhập (products KHÔNG
--     có cột NCC). Lấy NCC của lần nhập GẦN NHẤT:
--       (1) goods_receipt_lines → goods_receipts (status='completed') — nguồn chính
--       (2) stock_lots có supplier_id nhưng receipt_id IS NULL — lô nhập thẳng,
--           không qua phiếu (tránh đếm trùng với (1))
--   • last_purchase_at        — nhập gần nhất từ NCC đó (để biết dữ liệu còn mới)
--   • supplier_receipts_12m   — số lần nhập từ NCC đó trong 12 tháng (độ tin cậy)
--
-- LỌC vẫn làm ở client (danh sách trần LIMIT 500, đã tải sẵn) → đổi bộ lọc
-- không tốn round-trip, gom nhóm tức thì.
--
-- ⚠️ Apply remote qua Management API + NOTIFY pgrst reload. KHÔNG db push.
-- ============================================================

-- Lịch sử nhập tra theo product_id chưa có index → thêm trước khi RPC dùng.
CREATE INDEX IF NOT EXISTS idx_grl_product_receipt
  ON public.goods_receipt_lines(product_id, receipt_id);

-- Đổi kiểu trả về → bắt buộc DROP (CREATE OR REPLACE không cho thêm cột OUT).
-- Tham số giữ nguyên (p_min_orders integer) nên FE bản cũ gọi vẫn đúng chữ ký.
DROP FUNCTION IF EXISTS public.fn_reorder_planning(integer);

CREATE FUNCTION public.fn_reorder_planning(p_min_orders integer DEFAULT 3)
RETURNS TABLE (
  product_id            uuid,
  sku                   text,
  name                  text,
  unit                  text,
  min_stock_level       numeric,
  stock_on_hand         numeric,
  sold_30d              numeric,
  sold_90d              numeric,
  orders_90d            integer,
  avg_weekly            numeric,
  days_cover            numeric,
  weekly_stddev         numeric,
  weeks_observed        integer,
  brand_id              uuid,
  brand_name            text,
  category_id           uuid,
  category_name         text,
  supplier_id           uuid,
  supplier_name         text,
  last_purchase_at      timestamptz,
  supplier_receipts_12m integer
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
  ),
  -- ── NCC suy ra từ lịch sử nhập ──
  supplier_src AS (
    -- (1) Phiếu nhập đã hoàn thành = hàng thực sự đã vào kho
    SELECT grl.product_id, gr.supplier_id, gr.receipt_date::timestamptz AS src_at
    FROM public.goods_receipt_lines grl
    JOIN public.goods_receipts gr ON gr.id = grl.receipt_id
    WHERE gr.status = 'completed'
      AND gr.supplier_id IS NOT NULL
    UNION ALL
    -- (2) Lô nhập thẳng không qua phiếu (điều kiện receipt_id IS NULL để
    --     KHÔNG đếm trùng những lô do phiếu ở (1) sinh ra)
    SELECT sl.product_id, sl.supplier_id, sl.received_at
    FROM public.stock_lots sl
    WHERE sl.supplier_id IS NOT NULL
      AND sl.receipt_id IS NULL
  ),
  supplier_agg AS (
    SELECT
      ss.product_id,
      ss.supplier_id,
      MAX(ss.src_at) AS last_at,
      COUNT(*) FILTER (WHERE ss.src_at >= now() - interval '12 months') AS times_12m
    FROM supplier_src ss
    GROUP BY ss.product_id, ss.supplier_id
  ),
  supplier_pick AS (
    -- NCC của lần nhập gần nhất; hoà thì ưu tiên NCC nhập nhiều lần hơn
    SELECT DISTINCT ON (sa.product_id)
      sa.product_id, sa.supplier_id, sa.last_at, sa.times_12m
    FROM supplier_agg sa
    ORDER BY sa.product_id, sa.last_at DESC, sa.times_12m DESC
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
    COALESCE(sg.weeks_observed, 0)::integer,
    p.brand_id,
    b.name,
    p.category_id,
    c.name,
    sp.supplier_id,
    sup.name,
    sp.last_at,
    COALESCE(sp.times_12m, 0)::integer
  FROM public.products p
  JOIN sold  s  ON s.product_id  = p.id        -- chỉ SP có bán
  LEFT JOIN stock st ON st.product_id = p.id
  LEFT JOIN sigma sg ON sg.product_id = p.id
  LEFT JOIN public.brands b             ON b.id   = p.brand_id
  LEFT JOIN public.product_categories c ON c.id   = p.category_id
  LEFT JOIN supplier_pick sp            ON sp.product_id = p.id
  LEFT JOIN public.suppliers sup        ON sup.id = sp.supplier_id
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
  'Gợi ý đặt hàng chuẩn hóa: thống kê bán + σ cầu tuần (12 tuần) + chiều phân loại (thương hiệu, nhóm SP, NCC suy ra từ lần nhập gần nhất) cho SP có ≥ p_min_orders đơn/90n. SECURITY DEFINER (demand toàn công ty, bỏ chi phí RLS) + guard active & inventory.view. ROP/SS và bộ lọc tính ở frontend.';

NOTIFY pgrst, 'reload schema';
