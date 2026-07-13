-- ============================================================
-- Migration: smart_product_search
-- File: 20260729000000_smart_product_search.sql
-- Mục đích: Tìm sản phẩm theo TOKEN — bỏ dấu & bỏ ký tự ngăn cách.
--
-- Vấn đề: fn_products_list dùng ILIKE '%<cả câu>%' trên name/sku.
--   Gõ "MKV Doxy" KHÔNG ra "MKV-Doxy 50% kg (10x100g)" vì dấu '-' nằm giữa hai từ.
--
-- Giải pháp: chuẩn hóa (unaccent + hạ chữ + ký tự không phải chữ/số → khoảng trắng)
--   cả câu tìm lẫn dữ liệu, rồi yêu cầu MỌI token đều xuất hiện (AND, không cần đúng thứ tự).
--   → "mkv doxy", "doxy mkv", "doxy 50", "mkvdoxy" đều ra đúng sản phẩm.
--
-- Giữ nguyên schema output của fn_products_list. Khớp logic FE tại src/lib/smartSearch.ts.
-- ============================================================

-- Chuẩn hóa 1 chuỗi để tìm kiếm: bỏ dấu, hạ chữ, ký tự ngăn cách → khoảng trắng.
CREATE OR REPLACE FUNCTION public.fn_search_normalize(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
  SELECT BTRIM(REGEXP_REPLACE(LOWER(unaccent(COALESCE(p_text, ''))), '[^a-z0-9]+', ' ', 'g'));
$fn$;

-- Câu tìm → mảng token đã chuẩn hóa (NULL nếu rỗng → không lọc).
CREATE OR REPLACE FUNCTION public.fn_search_normalize_tokens(p_query TEXT)
RETURNS TEXT[]
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN NULLIF(public.fn_search_normalize(p_query), '') IS NULL THEN NULL
    ELSE STRING_TO_ARRAY(public.fn_search_normalize(p_query), ' ')
  END;
$fn$;

-- MỌI token phải xuất hiện trong chuỗi đã chuẩn hóa (kể cả khi gõ dính: "mkvdoxy").
-- Token đã qua fn_search_normalize nên chỉ còn [a-z0-9] → không cần escape LIKE.
CREATE OR REPLACE FUNCTION public.fn_search_tokens_match(p_haystack TEXT, p_tokens TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
  SELECT p_tokens IS NULL
      OR (
        SELECT bool_and(
          public.fn_search_normalize(p_haystack) LIKE '%' || tok || '%'
          OR REPLACE(public.fn_search_normalize(p_haystack), ' ', '') LIKE '%' || tok || '%'
        )
        FROM unnest(p_tokens) AS tok
      );
$fn$;

-- Không thêm index: bộ lọc token gọi hàm nên planner vẫn seq scan `products` (~1-2k dòng,
-- vài ms) — đúng như ILIKE trước đây. Khi danh mục phình to mới cần cột chuẩn hóa + GIN trgm.

-- ─────────────────────────────────────────────────────────────
-- fn_products_list: thay ILIKE cả câu bằng khớp theo TOKEN
-- (giữ nguyên toàn bộ phần còn lại của hàm ở migration 20260714)
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
  v_tokens TEXT[];
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
  -- Tách câu tìm thành các TOKEN đã chuẩn hóa (bỏ dấu, bỏ ký tự ngăn cách).
  -- "MKV Doxy" → ['mkv','doxy'] → khớp "MKV-Doxy 50% kg" (ILIKE '%mkv doxy%' trước đây trượt vì dấu '-').
  v_tokens := public.fn_search_normalize_tokens(p_search);

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
      AND (v_tokens IS NULL
           OR public.fn_search_tokens_match(p.name || ' ' || p.sku, v_tokens))
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
'Danh sách sản phẩm v4 — SECURITY DEFINER (bypass RLS), inline query, filter pushdown. Tìm kiếm theo token (bỏ dấu, bỏ ký tự ngăn cách).';

GRANT EXECUTE ON FUNCTION public.fn_products_list(INT, INT, TEXT, UUID, UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_normalize(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_normalize_tokens(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_tokens_match(TEXT, TEXT[]) TO authenticated;
