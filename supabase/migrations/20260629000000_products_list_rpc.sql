-- ─────────────────────────────────────────────────────────────
-- fn_products_list — Danh sách sản phẩm 1 round-trip
--
-- Thay thế chuỗi 1-5 query ở client (useProductsList):
--   • Trang dữ liệu + count tổng (filtered)
--   • Ghi đè tồn kho / khách đặt theo chi nhánh (p_branch_id)
--   • Tổng tồn + tổng khách đặt của TOÀN BỘ filtered set
--     (trước đây client dùng sai cú pháp PostgREST → tổng chi nhánh = 0)
--   • Sort server-side theo tồn kho ĐÚNG theo chi nhánh — điều
--     không thể làm bằng .order() trên view (view chỉ có tồn toàn cục).
--
-- SECURITY INVOKER: RLS các bảng nền vẫn áp dụng, không mở rộng quyền.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_products_list(
  p_page        INT  DEFAULT 1,
  p_page_size   INT  DEFAULT 10,
  p_search      TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_brand_id    UUID DEFAULT NULL,
  p_status      TEXT DEFAULT 'active',     -- active | inactive | all
  p_branch_id   UUID DEFAULT NULL,         -- NULL = tồn toàn hệ thống
  p_sort_by     TEXT DEFAULT 'created_at', -- created_at | stock
  p_sort_dir    TEXT DEFAULT 'desc'        -- asc | desc
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page   INT := GREATEST(COALESCE(p_page, 1), 1);
  -- Clamp 5000 để phục vụ cả export CSV mà không cho kéo vô hạn
  v_size   INT := LEAST(GREATEST(COALESCE(p_page_size, 10), 1), 5000);
  v_offset INT := 0;
  v_search TEXT;
  v_result JSONB;
BEGIN
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
  -- Escape ký tự wildcard cho ILIKE (escape mặc định là backslash)
  v_search := NULLIF(TRIM(p_search), '');
  IF v_search IS NOT NULL THEN
    v_search := REPLACE(REPLACE(REPLACE(v_search, '\', '\\'), '%', '\%'), '_', '\_');
  END IF;

  WITH
  branch_stock AS (
    SELECT sl.product_id, COALESCE(SUM(sl.quantity_on_hand), 0)::NUMERIC AS qty
    FROM public.stock_lots sl
    JOIN public.warehouses w ON w.id = sl.warehouse_id
    WHERE p_branch_id IS NOT NULL
      AND w.branch_id = p_branch_id
      AND sl.quantity_on_hand > 0
    GROUP BY sl.product_id
  ),
  branch_orders AS (
    SELECT ol.product_id, COALESCE(SUM(ol.quantity), 0)::NUMERIC AS qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE p_branch_id IS NOT NULL
      AND o.branch_id = p_branch_id
      AND o.status IN ('confirmed', 'shipping')
    GROUP BY ol.product_id
  ),
  base0 AS (
    SELECT
      v.*,
      CASE WHEN p_branch_id IS NULL THEN v.stock_on_hand::NUMERIC ELSE COALESCE(bs.qty, 0) END AS eff_stock,
      CASE WHEN p_branch_id IS NULL THEN v.on_order_qty::NUMERIC  ELSE COALESCE(bo.qty, 0) END AS eff_on_order
    FROM public.product_stock_summary_view v
    LEFT JOIN branch_stock  bs ON bs.product_id = v.id
    LEFT JOIN branch_orders bo ON bo.product_id = v.id
    WHERE (p_category_id IS NULL OR v.category_id = p_category_id)
      AND (p_brand_id    IS NULL OR v.brand_id    = p_brand_id)
      AND (p_status = 'all' OR v.is_active = (p_status = 'active'))
      AND (v_search IS NULL
           OR v.name ILIKE '%' || v_search || '%'
           OR v.sku  ILIKE '%' || v_search || '%')
  ),
  base AS (
    SELECT
      b.*,
      -- Tính lại "dự kiến hết hàng" theo tồn hiệu lực (cùng công thức với view)
      CASE
        WHEN p_branch_id IS NULL THEN b.days_to_oos
        WHEN COALESCE(b.sold_30d, 0) > 0 AND b.eff_stock > 0
          THEN ROUND(b.eff_stock / (b.sold_30d::NUMERIC / 30.0))::INT
        WHEN b.eff_stock = 0 THEN 0
        ELSE NULL
      END AS eff_days
    FROM base0 b
  ),
  rows_page AS (
    SELECT
      b.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_sort_by = 'stock'      AND p_sort_dir = 'asc'  THEN b.eff_stock  END ASC  NULLS LAST,
          CASE WHEN p_sort_by = 'stock'      AND p_sort_dir = 'desc' THEN b.eff_stock  END DESC NULLS LAST,
          CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN b.created_at END ASC  NULLS LAST,
          b.created_at DESC
      ) AS rn
    FROM base b
    ORDER BY rn
    LIMIT v_size OFFSET v_offset
  ),
  agg AS (
    SELECT
      COUNT(*)                       AS total,
      COALESCE(SUM(eff_stock), 0)    AS total_stock,
      COALESCE(SUM(eff_on_order), 0) AS total_on_order
    FROM base
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      (SELECT jsonb_agg(
          (to_jsonb(r) - 'eff_stock' - 'eff_on_order' - 'eff_days' - 'rn')
          || jsonb_build_object(
               'stock_on_hand', r.eff_stock,
               'on_order_qty',  r.eff_on_order,
               'days_to_oos',   r.eff_days
             )
          ORDER BY r.rn
        )
       FROM rows_page r),
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
'Danh sách sản phẩm phân trang + filter + sort (created_at|stock) + tồn kho/khách đặt theo chi nhánh + tổng filtered. 1 round-trip cho trang Danh mục Hàng hóa.';

GRANT EXECUTE ON FUNCTION public.fn_products_list(INT, INT, TEXT, UUID, UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
