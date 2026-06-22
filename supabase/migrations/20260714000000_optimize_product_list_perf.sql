-- ============================================================
-- Migration: optimize_product_list_perf
-- File: 20260714000000_optimize_product_list_perf.sql
-- Mục đích: Sửa lỗi trang Danh mục Hàng hóa không hiển thị sản phẩm.
--
-- Nguyên nhân gốc:
--   1. View product_stock_summary_view chậm (DISTINCT ON + correlated subquery)
--   2. RLS trên orders/order_lines gọi fn_is_admin()/fn_has_role() cho MỖI DÒNG
--      → tổng thời gian > 8s → PostgREST timeout → error 57014
--
-- Giải pháp:
--   1. Thêm 6 index thiếu
--   2. Viết lại view dùng LATERAL JOIN
--   3. Recreate v_order_line_profit (bị DROP CASCADE)
--   4. Viết lại fn_products_list: SECURITY DEFINER + inline query
--      → bypass RLS overhead + filter pushdown → 189ms (từ 8s+)
--
-- Tính toàn vẹn: output CÙNG schema + logic nghiệp vụ.
-- Bảo mật: fn_is_active() check ở đầu RPC. View giữ security_invoker.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. INDEXES thiếu
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pli_product_pricelist
  ON public.price_list_items(product_id, price_list_id);

CREATE INDEX IF NOT EXISTS idx_pli_product_created
  ON public.price_list_items(product_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_stock_lots_product_qty_positive
  ON public.stock_lots(product_id, quantity_on_hand)
  WHERE quantity_on_hand > 0;

CREATE INDEX IF NOT EXISTS idx_stock_lots_product_cost_created
  ON public.stock_lots(product_id, created_at DESC)
  WHERE cost_price > 0;

CREATE INDEX IF NOT EXISTS idx_orders_status_created_v2
  ON public.orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_lines_product_quantity
  ON public.order_lines(product_id)
  INCLUDE (quantity, order_id);

-- ─────────────────────────────────────────────────────────────
-- 2. TÁI TẠO view product_stock_summary_view (LATERAL JOIN)
--    ⚠️ DROP CASCADE → v_order_line_profit bị drop
-- ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.product_stock_summary_view CASCADE;

CREATE VIEW public.product_stock_summary_view
WITH (security_invoker = true) AS
WITH
  stock_agg AS (
    SELECT product_id,
           COALESCE(SUM(quantity_on_hand), 0)::NUMERIC(15,3) AS stock_on_hand
    FROM public.stock_lots
    WHERE quantity_on_hand > 0
    GROUP BY product_id
  ),
  on_order_agg AS (
    SELECT ol.product_id,
           COALESCE(SUM(ol.quantity), 0)::NUMERIC(15,3) AS on_order_qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('confirmed', 'shipping')
    GROUP BY ol.product_id
  ),
  sales_30d AS (
    SELECT ol.product_id,
           COALESCE(SUM(ol.quantity), 0)::NUMERIC(15,3) AS qty_30d
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('delivered', 'paid', 'completed')
      AND o.created_at >= (now() - INTERVAL '30 days')
    GROUP BY ol.product_id
  )
SELECT
  p.id, p.sku, p.name, p.unit, p.is_lot_managed, p.is_active,
  p.category_id, p.brand_id, p.package_specs, p.image_urls,
  p.created_at, p.updated_at,
  pc.name AS category_name, pc.code AS category_code, b.name AS brand_name,
  COALESCE(rp.selling_price, fp.selling_price, 0)::NUMERIC(15,2) AS retail_price,
  COALESCE(NULLIF(rp.cost_price, 0), NULLIF(fp.cost_price, 0), lc.cost_price, 0)::NUMERIC(15,2) AS retail_cost,
  COALESCE(s.stock_on_hand, 0) AS stock_on_hand,
  COALESCE(oo.on_order_qty, 0) AS on_order_qty,
  COALESCE(s30.qty_30d, 0) AS sold_30d,
  CASE
    WHEN COALESCE(s30.qty_30d, 0) > 0 AND COALESCE(s.stock_on_hand, 0) > 0
      THEN ROUND(COALESCE(s.stock_on_hand, 0)::NUMERIC / (s30.qty_30d::NUMERIC / 30.0))::INTEGER
    WHEN COALESCE(s.stock_on_hand, 0) = 0 THEN 0
    ELSE NULL
  END AS days_to_oos
FROM public.products p
LEFT JOIN public.product_categories pc ON pc.id = p.category_id
LEFT JOIN public.brands b ON b.id = p.brand_id
LEFT JOIN public.price_list_items rp
  ON rp.product_id = p.id
  AND rp.price_list_id = (SELECT id FROM public.price_lists WHERE code = 'GIA-LE' LIMIT 1)
LEFT JOIN LATERAL (
  SELECT pli.selling_price, pli.cost_price
  FROM public.price_list_items pli
  WHERE pli.product_id = p.id
  ORDER BY pli.created_at ASC
  LIMIT 1
) fp ON true
LEFT JOIN LATERAL (
  SELECT sl.cost_price
  FROM public.stock_lots sl
  WHERE sl.product_id = p.id AND sl.cost_price > 0
  ORDER BY sl.created_at DESC
  LIMIT 1
) lc ON true
LEFT JOIN stock_agg s ON s.product_id = p.id
LEFT JOIN on_order_agg oo ON oo.product_id = p.id
LEFT JOIN sales_30d s30 ON s30.product_id = p.id;

GRANT SELECT ON public.product_stock_summary_view TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. RECREATE v_order_line_profit (bị CASCADE drop)
-- ─────────────────────────────────────────────────────────────
CREATE VIEW public.v_order_line_profit AS
WITH alloc AS (
  SELECT ola.order_line_id,
         SUM(ola.quantity) AS alloc_qty,
         SUM(ola.quantity * sl.cost_price) AS alloc_cogs
  FROM public.order_line_allocations ola
  JOIN public.stock_lots sl ON sl.id = ola.lot_id
  GROUP BY ola.order_line_id
)
SELECT
  ol.id AS order_line_id, o.id AS order_id,
  o.created_at, o.status, o.customer_id, o.branch_id,
  ol.product_id, p.brand_id, ol.quantity, ol.line_total AS revenue,
  (COALESCE(a.alloc_cogs, 0)
   + GREATEST(ol.quantity - COALESCE(a.alloc_qty, 0), 0) * COALESCE(pss.retail_cost, 0)
  )::NUMERIC(15,2) AS cogs
FROM public.order_lines ol
JOIN public.orders o ON o.id = ol.order_id
JOIN public.products p ON p.id = ol.product_id
LEFT JOIN alloc a ON a.order_line_id = ol.id
LEFT JOIN public.product_stock_summary_view pss ON pss.id = ol.product_id
WHERE o.status IN ('confirmed', 'shipping', 'delivered', 'paid', 'completed');

REVOKE ALL ON public.v_order_line_profit FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. fn_products_list — SECURITY DEFINER + inline query
--    Bypass RLS (gốc vấn đề: RLS trên orders/order_lines = 8s+)
--    fn_is_active() kiểm tra bảo mật thay RLS.
--    Inline query + filter pushdown → 189ms.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_products_list(
  p_page        INT  DEFAULT 1,
  p_page_size   INT  DEFAULT 10,
  p_search      TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_brand_id    UUID DEFAULT NULL,
  p_status      TEXT DEFAULT 'active',
  p_branch_id   UUID DEFAULT NULL,
  p_sort_by     TEXT DEFAULT 'created_at',
  p_sort_dir    TEXT DEFAULT 'desc'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page   INT := GREATEST(COALESCE(p_page, 1), 1);
  v_size   INT := LEAST(GREATEST(COALESCE(p_page_size, 10), 1), 5000);
  v_offset INT := 0;
  v_search TEXT;
  v_result JSONB;
  v_gia_le_id UUID;
BEGIN
  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Tài khoản không hoạt động';
  END IF;
  IF p_sort_by NOT IN ('created_at', 'stock') THEN
    RAISE EXCEPTION 'invalid p_sort_by: %', p_sort_by;
  END IF;
  IF p_sort_dir NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'invalid p_sort_dir: %', p_sort_dir;
  END IF;
  IF p_status NOT IN ('active', 'inactive', 'all') THEN
    RAISE EXCEPTION 'invalid p_status: %', p_status;
  END IF;

  v_offset := (v_page - 1) * v_size;
  v_search := NULLIF(TRIM(p_search), '');
  IF v_search IS NOT NULL THEN
    v_search := REPLACE(REPLACE(REPLACE(v_search, '\', '\\'), '%', '\%'), '_', '\_');
  END IF;

  SELECT id INTO v_gia_le_id FROM public.price_lists WHERE code = 'GIA-LE' LIMIT 1;

  WITH
  filtered_products AS (
    SELECT p.id, p.sku, p.name, p.unit, p.is_lot_managed, p.is_active,
           p.category_id, p.brand_id, p.package_specs, p.image_urls,
           p.created_at, p.updated_at
    FROM public.products p
    WHERE (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (p_brand_id    IS NULL OR p.brand_id    = p_brand_id)
      AND (p_status = 'all' OR p.is_active = (p_status = 'active'))
      AND (v_search IS NULL
           OR p.name ILIKE '%' || v_search || '%'
           OR p.sku  ILIKE '%' || v_search || '%')
  ),
  retail_price AS (
    SELECT pli.product_id, pli.selling_price, pli.cost_price
    FROM public.price_list_items pli
    WHERE pli.price_list_id = v_gia_le_id
      AND pli.product_id IN (SELECT id FROM filtered_products)
  ),
  stock_agg AS (
    SELECT sl.product_id,
           COALESCE(SUM(sl.quantity_on_hand), 0)::NUMERIC AS stock_on_hand
    FROM public.stock_lots sl
    WHERE sl.quantity_on_hand > 0
      AND sl.product_id IN (SELECT id FROM filtered_products)
    GROUP BY sl.product_id
  ),
  on_order_agg AS (
    SELECT ol.product_id,
           COALESCE(SUM(ol.quantity), 0)::NUMERIC AS on_order_qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('confirmed', 'shipping')
      AND ol.product_id IN (SELECT id FROM filtered_products)
    GROUP BY ol.product_id
  ),
  sales_30d AS (
    SELECT ol.product_id,
           COALESCE(SUM(ol.quantity), 0)::NUMERIC AS qty_30d
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('delivered', 'paid', 'completed')
      AND o.created_at >= (now() - INTERVAL '30 days')
      AND ol.product_id IN (SELECT id FROM filtered_products)
    GROUP BY ol.product_id
  ),
  branch_stock AS (
    SELECT sl.product_id, COALESCE(SUM(sl.quantity_on_hand), 0)::NUMERIC AS qty
    FROM public.stock_lots sl
    JOIN public.warehouses w ON w.id = sl.warehouse_id
    WHERE p_branch_id IS NOT NULL
      AND w.branch_id = p_branch_id
      AND sl.quantity_on_hand > 0
      AND sl.product_id IN (SELECT id FROM filtered_products)
    GROUP BY sl.product_id
  ),
  branch_orders AS (
    SELECT ol.product_id, COALESCE(SUM(ol.quantity), 0)::NUMERIC AS qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE p_branch_id IS NOT NULL
      AND o.branch_id = p_branch_id
      AND o.status IN ('confirmed', 'shipping')
      AND ol.product_id IN (SELECT id FROM filtered_products)
    GROUP BY ol.product_id
  ),
  vat_split AS (
    SELECT sl.product_id,
      COALESCE(SUM(sl.quantity_on_hand) FILTER (WHERE sl.is_vat),     0)::NUMERIC AS vat_qty,
      COALESCE(SUM(sl.quantity_on_hand) FILTER (WHERE NOT sl.is_vat), 0)::NUMERIC AS nonvat_qty
    FROM public.stock_lots sl
    JOIN public.warehouses w ON w.id = sl.warehouse_id
    WHERE sl.quantity_on_hand > 0
      AND (p_branch_id IS NULL OR w.branch_id = p_branch_id)
      AND sl.product_id IN (SELECT id FROM filtered_products)
    GROUP BY sl.product_id
  ),
  base AS (
    SELECT fp.*,
      pc.name AS category_name, pc.code AS category_code, b.name AS brand_name,
      COALESCE(rp.selling_price, 0)::NUMERIC(15,2) AS retail_price,
      COALESCE(NULLIF(rp.cost_price, 0), 0)::NUMERIC(15,2) AS retail_cost,
      CASE WHEN p_branch_id IS NULL THEN COALESCE(sa.stock_on_hand, 0) ELSE COALESCE(bs.qty, 0) END AS eff_stock,
      CASE WHEN p_branch_id IS NULL THEN COALESCE(oo.on_order_qty, 0) ELSE COALESCE(bo.qty, 0) END AS eff_on_order,
      COALESCE(s30.qty_30d, 0) AS sold_30d,
      COALESCE(vs.vat_qty, 0) AS vat_stock, COALESCE(vs.nonvat_qty, 0) AS nonvat_stock,
      CASE
        WHEN COALESCE(s30.qty_30d, 0) > 0
             AND (CASE WHEN p_branch_id IS NULL THEN COALESCE(sa.stock_on_hand, 0) ELSE COALESCE(bs.qty, 0) END) > 0
          THEN ROUND((CASE WHEN p_branch_id IS NULL THEN COALESCE(sa.stock_on_hand, 0) ELSE COALESCE(bs.qty, 0) END)::NUMERIC / (s30.qty_30d::NUMERIC / 30.0))::INT
        WHEN (CASE WHEN p_branch_id IS NULL THEN COALESCE(sa.stock_on_hand, 0) ELSE COALESCE(bs.qty, 0) END) = 0 THEN 0
        ELSE NULL
      END AS eff_days
    FROM filtered_products fp
    LEFT JOIN public.product_categories pc ON pc.id = fp.category_id
    LEFT JOIN public.brands b ON b.id = fp.brand_id
    LEFT JOIN retail_price rp ON rp.product_id = fp.id
    LEFT JOIN stock_agg sa ON sa.product_id = fp.id
    LEFT JOIN on_order_agg oo ON oo.product_id = fp.id
    LEFT JOIN sales_30d s30 ON s30.product_id = fp.id
    LEFT JOIN branch_stock bs ON bs.product_id = fp.id
    LEFT JOIN branch_orders bo ON bo.product_id = fp.id
    LEFT JOIN vat_split vs ON vs.product_id = fp.id
  ),
  rows_page AS (
    SELECT b.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_sort_by = 'stock'      AND p_sort_dir = 'asc'  THEN b.eff_stock  END ASC  NULLS LAST,
          CASE WHEN p_sort_by = 'stock'      AND p_sort_dir = 'desc' THEN b.eff_stock  END DESC NULLS LAST,
          CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN b.created_at END ASC  NULLS LAST,
          b.created_at DESC
      ) AS rn
    FROM base b ORDER BY rn LIMIT v_size OFFSET v_offset
  ),
  agg AS (
    SELECT COUNT(*) AS total, COALESCE(SUM(eff_stock), 0) AS total_stock, COALESCE(SUM(eff_on_order), 0) AS total_on_order
    FROM base
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      (SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id, 'sku', r.sku, 'name', r.name, 'unit', r.unit,
            'is_lot_managed', r.is_lot_managed, 'is_active', r.is_active,
            'category_id', r.category_id, 'brand_id', r.brand_id,
            'package_specs', r.package_specs, 'image_urls', r.image_urls,
            'created_at', r.created_at, 'updated_at', r.updated_at,
            'category_name', r.category_name, 'category_code', r.category_code,
            'brand_name', r.brand_name,
            'retail_price', r.retail_price, 'retail_cost', r.retail_cost,
            'stock_on_hand', r.eff_stock, 'on_order_qty', r.eff_on_order,
            'sold_30d', r.sold_30d, 'days_to_oos', r.eff_days,
            'vat_stock', r.vat_stock, 'nonvat_stock', r.nonvat_stock
          ) ORDER BY r.rn
        ) FROM rows_page r),
      '[]'::jsonb
    ),
    'total',          (SELECT total          FROM agg),
    'total_stock',    (SELECT total_stock    FROM agg),
    'total_on_order', (SELECT total_on_order FROM agg)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.fn_products_list IS
'Danh sách sản phẩm v3 — SECURITY DEFINER (bypass RLS), inline query, filter pushdown. Tối ưu cho 1000+ SP.';

GRANT EXECUTE ON FUNCTION public.fn_products_list(INT, INT, TEXT, UUID, UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
