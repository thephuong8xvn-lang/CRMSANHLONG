-- ─────────────────────────────────────────────────────────────
-- CRM SANHLONGVETCO – BÁO CÁO KHO HÀNG THEO GIÁ VỐN (Inventory Valuation)
-- File: 20260626000000_inventory_valuation_report.sql
-- Mô tả: View định giá tồn kho cấp lô + 3 RPC tổng hợp
--        (tổng quan KPI / theo sản phẩm / theo nhóm: thương hiệu-nhóm hàng-kho).
--        CHỈ role admin (fn_has_role('admin')) được gọi → bảo mật tầng DB.
--
-- Giá vốn trung bình mỗi sản phẩm (bình quân gia quyền theo lô):
--   avg_cost = Σ(quantity_on_hand × cost_price) / Σ(quantity_on_hand)
--   Chỉ tính lô status='active' AND quantity_on_hand > 0.
--
-- Vòng quay tồn kho (xấp xỉ — không có snapshot tồn lịch sử):
--   sold_90d      = Σ(-quantity) từ stock_movements (movement_type='sale', 90 ngày)
--   turnover_90d  = sold_90d / tồn hiện tại
--   days_of_stock = tồn hiện tại / (sold_90d / 90)   (NULL nếu chưa bán)
-- ─────────────────────────────────────────────────────────────

-- 1. VIEW định giá tồn kho cấp lô (mọi status, chỉ lô còn hàng)
DROP VIEW IF EXISTS public.v_stock_lot_valuation;
CREATE VIEW public.v_stock_lot_valuation AS
SELECT
  sl.id                                          AS lot_id,
  sl.product_id                                  AS product_id,
  sl.warehouse_id                                AS warehouse_id,
  w.branch_id                                    AS branch_id,
  w.name                                         AS warehouse_name,
  sl.lot_number                                  AS lot_number,
  sl.status                                      AS status,
  sl.expiry_date                                 AS expiry_date,
  sl.received_at                                 AS received_at,
  sl.quantity_on_hand                            AS quantity_on_hand,
  sl.quantity_reserved                           AS quantity_reserved,
  sl.cost_price                                  AS cost_price,
  (sl.quantity_on_hand * sl.cost_price)::NUMERIC(15,2) AS lot_value,
  p.sku                                          AS sku,
  p.name                                         AS product_name,
  p.unit                                         AS unit,
  p.is_active                                    AS product_is_active,
  p.brand_id                                     AS brand_id,
  b.name                                         AS brand_name,
  p.category_id                                  AS category_id,
  pc.name                                        AS category_name,
  pc.code                                        AS category_code
FROM public.stock_lots sl
JOIN public.products p              ON p.id  = sl.product_id
JOIN public.warehouses w            ON w.id  = sl.warehouse_id
LEFT JOIN public.brands b           ON b.id  = p.brand_id
LEFT JOIN public.product_categories pc ON pc.id = p.category_id
WHERE sl.quantity_on_hand > 0;

COMMENT ON VIEW public.v_stock_lot_valuation IS 'Định giá tồn kho cấp lô (lot_value = qty × cost_price). Chỉ truy cập qua RPC báo cáo kho hàng (admin-only).';

-- ─────────────────────────────────────────────────────────────
-- 2. RPC: Tổng quan KPI định giá tồn kho
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_inventory_valuation_summary(
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_qty             NUMERIC,  -- Σ tồn (lô active)
  total_value           NUMERIC,  -- Σ qty × cost (lô active)
  product_count         BIGINT,   -- số SP có tồn active
  lot_count             BIGINT,   -- số lô active còn hàng
  warehouse_count       BIGINT,   -- số kho có tồn active
  missing_cost_products BIGINT,   -- số SP có ≥1 lô active thiếu giá vốn (cost=0)
  expiring_90d_value    NUMERIC,  -- giá trị lô active hết hạn trong ≤90 ngày
  expired_active_lots   BIGINT,   -- lô active nhưng đã quá hạn (lỗi dữ liệu)
  non_active_value      NUMERIC   -- giá trị tồn ở lô quarantine/expired/damaged/disposed
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo kho hàng';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(v.quantity_on_hand) FILTER (WHERE v.status = 'active'), 0)::NUMERIC,
    COALESCE(SUM(v.lot_value)        FILTER (WHERE v.status = 'active'), 0)::NUMERIC,
    COUNT(DISTINCT v.product_id)     FILTER (WHERE v.status = 'active')::BIGINT,
    COUNT(*)                         FILTER (WHERE v.status = 'active')::BIGINT,
    COUNT(DISTINCT v.warehouse_id)   FILTER (WHERE v.status = 'active')::BIGINT,
    COUNT(DISTINCT v.product_id)     FILTER (WHERE v.status = 'active' AND v.cost_price = 0)::BIGINT,
    COALESCE(SUM(v.lot_value)        FILTER (WHERE v.status = 'active'
                                       AND v.expiry_date IS NOT NULL
                                       AND v.expiry_date <= CURRENT_DATE + 90), 0)::NUMERIC,
    COUNT(*)                         FILTER (WHERE v.status = 'active'
                                       AND v.expiry_date IS NOT NULL
                                       AND v.expiry_date < CURRENT_DATE)::BIGINT,
    COALESCE(SUM(v.lot_value)        FILTER (WHERE v.status <> 'active'), 0)::NUMERIC
  FROM public.v_stock_lot_valuation v
  WHERE (p_warehouse_id IS NULL OR v.warehouse_id = p_warehouse_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: Định giá tồn kho theo sản phẩm (dùng chung cho các tab
--    Sản phẩm / Top tồn / Vòng quay / Tồn lâu)
--    p_sort: 'value' (mặc định) | 'qty' | 'avg_cost' | 'turnover'
--            | 'days_of_stock' | 'idle' (lâu chưa bán lên đầu)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_inventory_valuation_by_product(
  p_search       TEXT    DEFAULT NULL,
  p_warehouse_id UUID    DEFAULT NULL,
  p_brand_id     UUID    DEFAULT NULL,
  p_category_id  UUID    DEFAULT NULL,
  p_sort         TEXT    DEFAULT 'value',
  p_limit        INTEGER DEFAULT 100,
  p_offset       INTEGER DEFAULT 0
)
RETURNS TABLE (
  product_id      UUID,
  sku             TEXT,
  product_name    TEXT,
  unit            TEXT,
  brand_name      TEXT,
  category_name   TEXT,
  total_qty       NUMERIC,      -- Σ tồn (qty là NUMERIC(15,3))
  avg_cost        NUMERIC,      -- giá vốn bình quân gia quyền theo lô
  total_value     NUMERIC,
  lot_count       BIGINT,
  warehouse_count BIGINT,
  nearest_expiry  DATE,
  missing_cost    BOOLEAN,      -- có lô active thiếu giá vốn
  sold_30d        NUMERIC,
  sold_90d        NUMERIC,
  turnover_90d    NUMERIC,      -- sold_90d / tồn hiện tại
  days_of_stock   NUMERIC,      -- tồn / (sold_90d/90); NULL nếu chưa bán 90d
  last_sale_at    TIMESTAMPTZ,  -- lần xuất bán gần nhất (mọi thời điểm)
  total_count     BIGINT        -- tổng số dòng (phân trang server-side)
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo kho hàng';
  END IF;

  IF p_sort NOT IN ('value', 'qty', 'avg_cost', 'turnover', 'days_of_stock', 'idle') THEN
    RAISE EXCEPTION 'Tham số sắp xếp không hợp lệ: %', p_sort;
  END IF;

  RETURN QUERY
  WITH stock AS (
    SELECT
      v.product_id                                       AS pid,
      SUM(v.quantity_on_hand)                            AS qty,
      SUM(v.lot_value)                                   AS value,
      ROUND(SUM(v.quantity_on_hand * v.cost_price)
            / NULLIF(SUM(v.quantity_on_hand), 0), 2)     AS avg_cost,
      COUNT(*)                                           AS lot_count,
      COUNT(DISTINCT v.warehouse_id)                     AS wh_count,
      MIN(v.expiry_date)                                 AS nearest_expiry,
      BOOL_OR(v.cost_price = 0)                          AS missing_cost
    FROM public.v_stock_lot_valuation v
    WHERE v.status = 'active'
      AND (p_warehouse_id IS NULL OR v.warehouse_id = p_warehouse_id)
      AND (p_brand_id    IS NULL OR v.brand_id    = p_brand_id)
      AND (p_category_id IS NULL OR v.category_id = p_category_id)
      AND (
        p_search IS NULL OR p_search = ''
        OR unaccent(lower(v.product_name)) LIKE '%' || unaccent(lower(p_search)) || '%'
        OR v.sku ILIKE '%' || p_search || '%'
      )
    GROUP BY v.product_id
  ),
  mv AS (
    SELECT
      sm.product_id AS pid,
      COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - INTERVAL '30 days'), 0) AS sold_30d,
      COALESCE(SUM(-sm.quantity), 0)                           AS sold_90d
    FROM public.stock_movements sm
    WHERE sm.movement_type = 'sale'
      AND sm.created_at >= now() - INTERVAL '90 days'
      AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY sm.product_id
  ),
  last_sale AS (
    SELECT
      sm.product_id        AS pid,
      MAX(sm.created_at)   AS last_sale_at
    FROM public.stock_movements sm
    WHERE sm.movement_type = 'sale'
      AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY sm.product_id
  )
  SELECT
    p.id,
    p.sku,
    p.name,
    p.unit,
    COALESCE(b.name, '(Không thương hiệu)'),
    COALESCE(pc.name, '(Chưa phân nhóm)'),
    s.qty::NUMERIC,
    COALESCE(s.avg_cost, 0)::NUMERIC,
    s.value::NUMERIC,
    s.lot_count::BIGINT,
    s.wh_count::BIGINT,
    s.nearest_expiry,
    s.missing_cost,
    COALESCE(m.sold_30d, 0)::NUMERIC,
    COALESCE(m.sold_90d, 0)::NUMERIC,
    CASE WHEN s.qty > 0
         THEN ROUND(COALESCE(m.sold_90d, 0) / s.qty, 2)
         ELSE 0 END::NUMERIC,
    CASE WHEN COALESCE(m.sold_90d, 0) > 0
         THEN ROUND(s.qty / (m.sold_90d / 90.0), 0)
         ELSE NULL END::NUMERIC,
    ls.last_sale_at,
    COUNT(*) OVER ()::BIGINT
  FROM stock s
  JOIN public.products p ON p.id = s.pid
  LEFT JOIN public.brands b              ON b.id  = p.brand_id
  LEFT JOIN public.product_categories pc ON pc.id = p.category_id
  LEFT JOIN mv m         ON m.pid  = s.pid
  LEFT JOIN last_sale ls ON ls.pid = s.pid
  ORDER BY
    CASE WHEN p_sort = 'idle' THEN 0 ELSE 1 END,
    CASE WHEN p_sort = 'idle' THEN ls.last_sale_at END ASC NULLS FIRST,
    CASE p_sort
      WHEN 'qty'           THEN s.qty
      WHEN 'avg_cost'      THEN s.avg_cost
      WHEN 'turnover'      THEN CASE WHEN s.qty > 0
                                     THEN COALESCE(m.sold_90d, 0) / s.qty
                                     ELSE 0 END
      WHEN 'days_of_stock' THEN CASE WHEN COALESCE(m.sold_90d, 0) > 0
                                     THEN s.qty / (m.sold_90d / 90.0)
                                     ELSE NULL END
      WHEN 'idle'          THEN NULL
      ELSE s.value
    END DESC NULLS LAST,
    p.name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: Định giá tồn kho theo nhóm
--    p_group_by: 'brand' | 'category' | 'warehouse'
--    p_sort:     'value' (mặc định) | 'qty' | 'product_count'
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_inventory_valuation_by_group(
  p_group_by     TEXT,
  p_warehouse_id UUID    DEFAULT NULL,
  p_sort         TEXT    DEFAULT 'value',
  p_limit        INTEGER DEFAULT 200,
  p_offset       INTEGER DEFAULT 0
)
RETURNS TABLE (
  group_id              UUID,
  group_name            TEXT,
  product_count         BIGINT,
  lot_count             BIGINT,
  total_qty             NUMERIC,
  total_value           NUMERIC,
  value_share           NUMERIC,  -- % trên tổng giá trị vốn
  missing_cost_products BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo kho hàng';
  END IF;

  IF p_group_by NOT IN ('brand', 'category', 'warehouse') THEN
    RAISE EXCEPTION 'Tham số nhóm không hợp lệ: %', p_group_by;
  END IF;

  IF p_sort NOT IN ('value', 'qty', 'product_count') THEN
    RAISE EXCEPTION 'Tham số sắp xếp không hợp lệ: %', p_sort;
  END IF;

  RETURN QUERY
  WITH grouped AS (
    SELECT
      CASE p_group_by
        WHEN 'brand'     THEN v.brand_id
        WHEN 'category'  THEN v.category_id
        ELSE                  v.warehouse_id
      END                                               AS gid,
      CASE p_group_by
        WHEN 'brand'     THEN COALESCE(v.brand_name, '(Không thương hiệu)')
        WHEN 'category'  THEN COALESCE(v.category_name, '(Chưa phân nhóm)')
        ELSE                  v.warehouse_name
      END                                               AS gname,
      COUNT(DISTINCT v.product_id)                      AS product_count,
      COUNT(*)                                          AS lot_count,
      SUM(v.quantity_on_hand)                           AS qty,
      SUM(v.lot_value)                                  AS value,
      COUNT(DISTINCT v.product_id) FILTER (WHERE v.cost_price = 0) AS missing_cost
    FROM public.v_stock_lot_valuation v
    WHERE v.status = 'active'
      AND (p_warehouse_id IS NULL OR v.warehouse_id = p_warehouse_id)
    GROUP BY 1, 2
  )
  SELECT
    g.gid,
    g.gname,
    g.product_count::BIGINT,
    g.lot_count::BIGINT,
    g.qty::NUMERIC,
    g.value::NUMERIC,
    ROUND(g.value / NULLIF(SUM(g.value) OVER (), 0) * 100, 1)::NUMERIC,
    g.missing_cost::BIGINT
  FROM grouped g
  ORDER BY
    CASE p_sort
      WHEN 'qty'           THEN g.qty
      WHEN 'product_count' THEN g.product_count::NUMERIC
      ELSE g.value
    END DESC NULLS LAST,
    g.gname ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. INDEX hỗ trợ tính vòng quay (scan movement 'sale' theo SP + thời gian)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stockmov_product_type_created
  ON public.stock_movements(product_id, movement_type, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 6. GRANT (RPC tự enforce fn_has_role('admin') bên trong;
--    view nền KHÔNG cho truy cập trực tiếp)
-- ─────────────────────────────────────────────────────────────
-- Supabase ALTER DEFAULT PRIVILEGES tự GRANT cho anon/authenticated trên
-- object mới → phải REVOKE tường minh, nếu không view lộ qua PostgREST.
REVOKE ALL ON public.v_stock_lot_valuation FROM PUBLIC, anon, authenticated;
-- Vá luôn view báo cáo lợi nhuận cũ (cùng lỗ hổng, file 20260620000000):
REVOKE ALL ON public.v_order_line_profit FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.fn_inventory_valuation_summary(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventory_valuation_by_product(TEXT, UUID, UUID, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventory_valuation_by_group(TEXT, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_inventory_valuation_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_valuation_by_product(TEXT, UUID, UUID, UUID, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_valuation_by_group(TEXT, UUID, TEXT, INTEGER, INTEGER) TO authenticated;
