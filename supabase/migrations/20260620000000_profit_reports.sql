-- ─────────────────────────────────────────────────────────────
-- CRM SANHLONGVETCO – BÁO CÁO LỢI NHUẬN (Profit Reports)
-- File: 20260620000000_profit_reports.sql
-- Mô tả: View tính lợi nhuận cấp dòng đơn + 4 RPC tổng hợp
--        (tổng quan / theo KH / theo SP / theo thương hiệu).
--        CHỈ role admin (fn_has_role('admin')) được gọi → bảo mật tầng DB.
--
-- Giá vốn (COGS) mỗi dòng đơn:
--   COGS = Σ(allocation.quantity × stock_lots.cost_price)          -- phần đã phân bổ lô
--        + (quantity − Σallocation.quantity) × retail_cost_fallback -- phần không có lô
--   retail_cost_fallback = product_stock_summary_view.retail_cost
--     (chuỗi fallback: GIA-LE → bảng giá đầu tiên → lô mới nhất → 0)
--   revenue = order_lines.line_total = (unit_price − discount) × quantity
--   Lưu ý: doanh thu tính ở CẤP DÒNG, không gồm CK cấp hóa đơn/phí ship.
-- ─────────────────────────────────────────────────────────────

-- 1. VIEW lợi nhuận cấp dòng đơn (chỉ đơn đã chốt)
DROP VIEW IF EXISTS public.v_order_line_profit;
CREATE VIEW public.v_order_line_profit AS
WITH alloc AS (
  SELECT
    ola.order_line_id,
    SUM(ola.quantity)                    AS alloc_qty,
    SUM(ola.quantity * sl.cost_price)    AS alloc_cogs
  FROM public.order_line_allocations ola
  JOIN public.stock_lots sl ON sl.id = ola.lot_id
  GROUP BY ola.order_line_id
)
SELECT
  ol.id                                  AS order_line_id,
  o.id                                   AS order_id,
  o.created_at                           AS created_at,
  o.status                               AS status,
  o.customer_id                          AS customer_id,
  o.branch_id                            AS branch_id,
  ol.product_id                          AS product_id,
  p.brand_id                             AS brand_id,
  ol.quantity                            AS quantity,
  ol.line_total                          AS revenue,
  (
    COALESCE(a.alloc_cogs, 0)
    + GREATEST(ol.quantity - COALESCE(a.alloc_qty, 0), 0) * COALESCE(pss.retail_cost, 0)
  )::NUMERIC(15,2)                       AS cogs
FROM public.order_lines ol
JOIN public.orders o   ON o.id = ol.order_id
JOIN public.products p ON p.id = ol.product_id
LEFT JOIN alloc a ON a.order_line_id = ol.id
LEFT JOIN public.product_stock_summary_view pss ON pss.id = ol.product_id
WHERE o.status IN ('confirmed', 'shipping', 'delivered', 'paid', 'completed');

COMMENT ON VIEW public.v_order_line_profit IS 'Lợi nhuận cấp dòng đơn (revenue=line_total, cogs=allocation×cost_price + fallback). Chỉ truy cập qua RPC báo cáo (admin-only).';

-- ─────────────────────────────────────────────────────────────
-- 2. RPC: Tổng quan lợi nhuận
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_profit_summary(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  total_revenue  NUMERIC,
  total_cogs     NUMERIC,
  total_profit   NUMERIC,
  profit_margin  NUMERIC,
  order_count    BIGINT,
  customer_count BIGINT,
  product_count  BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(v.revenue), 0)::NUMERIC,
    COALESCE(SUM(v.cogs), 0)::NUMERIC,
    COALESCE(SUM(v.revenue - v.cogs), 0)::NUMERIC,
    CASE WHEN COALESCE(SUM(v.revenue), 0) > 0
         THEN ROUND(SUM(v.revenue - v.cogs) / SUM(v.revenue) * 100, 2)
         ELSE 0 END::NUMERIC,
    COUNT(DISTINCT v.order_id)::BIGINT,
    COUNT(DISTINCT v.customer_id)::BIGINT,
    COUNT(DISTINCT v.product_id)::BIGINT
  FROM public.v_order_line_profit v
  WHERE v.created_at >= p_from AND v.created_at <= p_to;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: Lợi nhuận theo khách hàng
--    p_sort: 'revenue' (mặc định) | 'profit' | 'margin'
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_profit_by_customer(
  p_from   TIMESTAMPTZ,
  p_to     TIMESTAMPTZ,
  p_search TEXT    DEFAULT NULL,
  p_sort   TEXT    DEFAULT 'revenue',
  p_limit  INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  customer_id   UUID,
  customer_name TEXT,
  customer_code TEXT,
  revenue       NUMERIC,
  cogs          NUMERIC,
  profit        NUMERIC,
  margin        NUMERIC,
  order_count   BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.farm_name,
    c.code,
    SUM(v.revenue)::NUMERIC,
    SUM(v.cogs)::NUMERIC,
    SUM(v.revenue - v.cogs)::NUMERIC,
    CASE WHEN SUM(v.revenue) > 0
         THEN ROUND(SUM(v.revenue - v.cogs) / SUM(v.revenue) * 100, 2)
         ELSE 0 END::NUMERIC,
    COUNT(DISTINCT v.order_id)::BIGINT
  FROM public.v_order_line_profit v
  JOIN public.customers c ON c.id = v.customer_id
  WHERE v.created_at >= p_from AND v.created_at <= p_to
    AND (
      p_search IS NULL OR p_search = ''
      OR unaccent(lower(c.farm_name)) LIKE '%' || unaccent(lower(p_search)) || '%'
      OR c.code ILIKE '%' || p_search || '%'
    )
  GROUP BY c.id, c.farm_name, c.code
  ORDER BY
    CASE p_sort
      WHEN 'profit' THEN SUM(v.revenue - v.cogs)
      WHEN 'margin' THEN CASE WHEN SUM(v.revenue) > 0
                              THEN SUM(v.revenue - v.cogs) / SUM(v.revenue)
                              ELSE 0 END
      ELSE SUM(v.revenue)
    END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: Lợi nhuận theo sản phẩm (dùng chung cho 3 tab Top-100)
--    p_sort: 'revenue' | 'profit' | 'profit_ratio' | 'qty' | 'customer_count'
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_profit_by_product(
  p_from   TIMESTAMPTZ,
  p_to     TIMESTAMPTZ,
  p_search TEXT    DEFAULT NULL,
  p_sort   TEXT    DEFAULT 'revenue',
  p_limit  INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  product_id     UUID,
  sku            TEXT,
  product_name   TEXT,
  brand_name     TEXT,
  qty_sold       BIGINT,
  revenue        NUMERIC,
  cogs           NUMERIC,
  profit         NUMERIC,
  margin         NUMERIC,
  customer_count BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.sku,
    p.name,
    b.name,
    SUM(v.quantity)::BIGINT,
    SUM(v.revenue)::NUMERIC,
    SUM(v.cogs)::NUMERIC,
    SUM(v.revenue - v.cogs)::NUMERIC,
    CASE WHEN SUM(v.revenue) > 0
         THEN ROUND(SUM(v.revenue - v.cogs) / SUM(v.revenue) * 100, 2)
         ELSE 0 END::NUMERIC,
    COUNT(DISTINCT v.customer_id)::BIGINT
  FROM public.v_order_line_profit v
  JOIN public.products p ON p.id = v.product_id
  LEFT JOIN public.brands b ON b.id = p.brand_id
  WHERE v.created_at >= p_from AND v.created_at <= p_to
    AND (
      p_search IS NULL OR p_search = ''
      OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(p_search)) || '%'
      OR p.sku ILIKE '%' || p_search || '%'
    )
  GROUP BY p.id, p.sku, p.name, b.name
  ORDER BY
    CASE p_sort
      WHEN 'profit'         THEN SUM(v.revenue - v.cogs)
      WHEN 'profit_ratio'   THEN CASE WHEN SUM(v.revenue) > 0
                                      THEN SUM(v.revenue - v.cogs) / SUM(v.revenue)
                                      ELSE 0 END
      WHEN 'qty'            THEN SUM(v.quantity)::NUMERIC
      WHEN 'customer_count' THEN COUNT(DISTINCT v.customer_id)::NUMERIC
      ELSE SUM(v.revenue)
    END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. RPC: Lợi nhuận theo thương hiệu
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_profit_by_brand(
  p_from   TIMESTAMPTZ,
  p_to     TIMESTAMPTZ,
  p_sort   TEXT    DEFAULT 'revenue',
  p_limit  INTEGER DEFAULT 200,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  brand_id      UUID,
  brand_name    TEXT,
  qty_sold      BIGINT,
  revenue       NUMERIC,
  cogs          NUMERIC,
  profit        NUMERIC,
  margin        NUMERIC,
  product_count BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    COALESCE(b.name, '(Không thương hiệu)'),
    SUM(v.quantity)::BIGINT,
    SUM(v.revenue)::NUMERIC,
    SUM(v.cogs)::NUMERIC,
    SUM(v.revenue - v.cogs)::NUMERIC,
    CASE WHEN SUM(v.revenue) > 0
         THEN ROUND(SUM(v.revenue - v.cogs) / SUM(v.revenue) * 100, 2)
         ELSE 0 END::NUMERIC,
    COUNT(DISTINCT v.product_id)::BIGINT
  FROM public.v_order_line_profit v
  LEFT JOIN public.brands b ON b.id = v.brand_id
  WHERE v.created_at >= p_from AND v.created_at <= p_to
  GROUP BY b.id, b.name
  ORDER BY
    CASE p_sort
      WHEN 'profit' THEN SUM(v.revenue - v.cogs)
      WHEN 'margin' THEN CASE WHEN SUM(v.revenue) > 0
                              THEN SUM(v.revenue - v.cogs) / SUM(v.revenue)
                              ELSE 0 END
      ELSE SUM(v.revenue)
    END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. GRANT (RPC tự enforce fn_is_admin bên trong)
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_profit_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_profit_by_customer(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_profit_by_product(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_profit_by_brand(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_profit_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_by_customer(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_by_product(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_by_brand(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER, INTEGER) TO authenticated;
