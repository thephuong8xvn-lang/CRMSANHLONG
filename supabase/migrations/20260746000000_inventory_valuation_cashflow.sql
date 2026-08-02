-- ============================================================
-- Migration: Báo cáo Kho hàng theo Giá vốn — TỐI ƯU DÒNG VỐN
-- File: 20260746000000_inventory_valuation_cashflow.sql
--
-- BỐI CẢNH (đánh giá 2026-08-02):
--   Báo cáo 20260626 trả lời "đang chôn bao nhiêu tiền trong kho" nhưng KHÔNG
--   trả lời "bao nhiêu trong đó là THỪA" và "khi nào hết hàng". Ngoài ra:
--     • sold_90d chỉ lọc movement_type='sale' → KHÔNG trừ hàng khách trả
--       (enum có 'return_from_customer') → tốc độ bán bị thổi lên → days_of_stock
--       ngắn giả → đặt hàng DƯ = chôn thêm vốn.
--     • fn_inventory_valuation_summary chỉ nhận p_warehouse_id → lọc theo
--       thương hiệu/nhóm hàng thì bảng đổi nhưng KPI vẫn là số toàn công ty;
--       và không có tổng nào để làm dòng "Tổng cộng" trên đầu bảng (tab Sản phẩm
--       phân trang server-side 50 dòng → cộng ở client sẽ ra tổng của TRANG, sai).
--
-- THAY ĐỔI:
--   (1) v_stock_lot_valuation: thêm branch_name (view đã có branch_id nhưng
--       thiếu tên) → mở chiều gom nhóm 'branch'.
--   (2) CẦU RÒNG là nền của mọi con số mới:
--         sold_net = Σ(-quantity) trên movement_type IN ('sale','return_from_customer')
--       quantity: dương = nhập, âm = xuất → -quantity cho ra +bán / -trả.
--   (3) Tham số p_window_days (mặc định 20) — N ngày vừa đo tốc độ bán vừa là
--       mức tồn mục tiêu. Nhờ target = (sold_window/N) × N nên rút gọn thành:
--         excess_qty = max(0, tồn − bán ròng N ngày)      ← VỐN THỪA
--         days_to_stockout = tồn × N / bán ròng N ngày    ← NGÀY HẾT HÀNG
--   (4) fn_inventory_valuation_summary nhận ĐỦ bộ lọc + trả tổng từng cột
--       (kèm unit_uniform để FE biết cột số lượng có cộng được không —
--        135 kg + 107 chai + 67 lọ là con số vô nghĩa).
--   (5) fn_inventory_valuation_by_product: + cột dòng vốn, + sort 'excess' /
--       'stockout'. fn_inventory_valuation_by_group: + 'branch' + cột dòng vốn.
--
-- TƯƠNG THÍCH NGƯỢC: mọi tham số mới đều có DEFAULT và PostgREST gọi theo TÊN
--   → FE bản cũ (chỉ truyền p_warehouse_id) vẫn chạy đúng trong lúc chờ deploy.
--
-- ⚠️ Apply remote qua Management API + NOTIFY pgrst reload. KHÔNG db push.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. VIEW cấp lô — thêm branch_name
--    DROP an toàn: mọi hàm tham chiếu đều là plpgsql (resolve lúc chạy),
--    không có view/matview nào phụ thuộc.
-- ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_stock_lot_valuation;
CREATE VIEW public.v_stock_lot_valuation AS
SELECT
  sl.id                                          AS lot_id,
  sl.product_id                                  AS product_id,
  sl.warehouse_id                                AS warehouse_id,
  w.branch_id                                    AS branch_id,
  br.name                                        AS branch_name,
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
LEFT JOIN public.branches br        ON br.id = w.branch_id
LEFT JOIN public.brands b           ON b.id  = p.brand_id
LEFT JOIN public.product_categories pc ON pc.id = p.category_id
WHERE sl.quantity_on_hand > 0;

COMMENT ON VIEW public.v_stock_lot_valuation IS 'Định giá tồn kho cấp lô (lot_value = qty × cost_price). Chỉ truy cập qua RPC báo cáo kho hàng (admin-only).';

-- View mới → Supabase ALTER DEFAULT PRIVILEGES tự GRANT cho anon/authenticated.
-- Phải REVOKE lại tường minh, nếu không view lộ qua PostgREST.
REVOKE ALL ON public.v_stock_lot_valuation FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. INDEX hỗ trợ cầu ròng có lọc kho
--    (idx_stockmov_product_type_created đã có từ 20260626 cho nhánh không lọc kho)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stockmov_wh_type_created
  ON public.stock_movements(warehouse_id, movement_type, created_at DESC);

-- Đổi chữ ký + kiểu trả về → bắt buộc DROP trước.
-- DROP theo TÊN (mọi overload) thay vì liệt kê chữ ký cũ: file này phải chạy
-- lại được nhiều lần. Liệt kê chữ ký cũ sẽ hỏng ngay lần apply thứ hai —
-- lúc đó hàm đã mang chữ ký MỚI nên DROP không khớp và CREATE báo
-- "function already exists with same argument types".
DO $drop$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'fn_inventory_valuation_summary',
        'fn_inventory_valuation_by_product',
        'fn_inventory_valuation_by_group')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END
$drop$;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: Tổng quan KPI + TỔNG TỪNG CỘT theo đúng bộ lọc đang xem
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_inventory_valuation_summary(
  p_search       TEXT    DEFAULT NULL,
  p_warehouse_id UUID    DEFAULT NULL,
  p_brand_id     UUID    DEFAULT NULL,
  p_category_id  UUID    DEFAULT NULL,
  p_window_days  INTEGER DEFAULT 20
)
RETURNS TABLE (
  -- ── Bộ cũ (giữ nguyên tên để FE cũ không vỡ) ──
  total_qty              NUMERIC,  -- Σ tồn (lô active) — CHỈ có nghĩa khi unit_uniform
  total_value            NUMERIC,  -- Σ qty × cost (lô active)
  product_count          BIGINT,
  lot_count              BIGINT,
  warehouse_count        BIGINT,
  missing_cost_products  BIGINT,
  expiring_90d_value     NUMERIC,
  expired_active_lots    BIGINT,
  non_active_value       NUMERIC,
  -- ── Bộ mới: phục vụ dòng "Tổng cộng" trên đầu bảng ──
  unit_uniform           BOOLEAN,  -- tập đang lọc chỉ gồm 1 ĐVT?
  unit_label             TEXT,     -- ĐVT đó (NULL nếu hỗn hợp) → FE hiện "—"
  avg_cost_weighted      NUMERIC,  -- total_value / total_qty
  nearest_expiry         DATE,     -- HSD sớm nhất trong tập lọc
  -- ── Bộ mới: dòng vốn ──
  sold_window            NUMERIC,  -- Σ bán ròng N ngày
  excess_qty             NUMERIC,
  excess_value           NUMERIC,  -- VỐN THỪA = Σ(excess_qty × giá vốn TB)
  dead_value             NUMERIC,  -- giá trị SP không bán ròng nào trong 90 ngày
  dead_products          BIGINT,
  stockout_soon_products BIGINT,   -- số SP dự kiến hết hàng trong ≤ N ngày
  stockout_soon_value    NUMERIC,
  window_days            INTEGER,  -- N thực dùng (đã kẹp 1..365)
  -- Số ngày lịch sử xuất bán THỰC CÓ. Hệ thống chạy từ 2026-05-28 nên chọn N
  -- lớn hơn con số này sẽ cho "vốn thừa" sai (mẫu số N ngày nhưng tử số chỉ có
  -- chừng này ngày dữ liệu) → FE phải cảnh báo thay vì im lặng.
  history_days           INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_win INTEGER := GREATEST(1, LEAST(365, COALESCE(p_window_days, 20)));
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo kho hàng';
  END IF;

  RETURN QUERY
  WITH f AS (   -- lô trong phạm vi lọc, MỌI trạng thái (cần cho non_active_value)
    SELECT v.*
    FROM public.v_stock_lot_valuation v
    WHERE (p_warehouse_id IS NULL OR v.warehouse_id = p_warehouse_id)
      AND (p_brand_id     IS NULL OR v.brand_id     = p_brand_id)
      AND (p_category_id  IS NULL OR v.category_id  = p_category_id)
      AND (
        p_search IS NULL OR p_search = ''
        OR unaccent(lower(v.product_name)) LIKE '%' || unaccent(lower(p_search)) || '%'
        OR v.sku ILIKE '%' || p_search || '%'
      )
  ),
  lot_agg AS (
    SELECT
      COALESCE(SUM(f.quantity_on_hand) FILTER (WHERE f.status = 'active'), 0)        AS total_qty,
      COALESCE(SUM(f.lot_value)        FILTER (WHERE f.status = 'active'), 0)        AS total_value,
      COUNT(DISTINCT f.product_id)     FILTER (WHERE f.status = 'active')            AS product_count,
      COUNT(*)                         FILTER (WHERE f.status = 'active')            AS lot_count,
      COUNT(DISTINCT f.warehouse_id)   FILTER (WHERE f.status = 'active')            AS warehouse_count,
      COUNT(DISTINCT f.product_id)     FILTER (WHERE f.status = 'active'
                                          AND f.cost_price = 0)                      AS missing_cost_products,
      COALESCE(SUM(f.lot_value)        FILTER (WHERE f.status = 'active'
                                          AND f.expiry_date IS NOT NULL
                                          AND f.expiry_date <= CURRENT_DATE + 90), 0) AS expiring_90d_value,
      COUNT(*)                         FILTER (WHERE f.status = 'active'
                                          AND f.expiry_date IS NOT NULL
                                          AND f.expiry_date < CURRENT_DATE)          AS expired_active_lots,
      COALESCE(SUM(f.lot_value)        FILTER (WHERE f.status <> 'active'), 0)       AS non_active_value,
      MIN(f.expiry_date)               FILTER (WHERE f.status = 'active')            AS nearest_expiry,
      COUNT(DISTINCT f.unit)           FILTER (WHERE f.status = 'active')            AS unit_kinds,
      MIN(f.unit)                      FILTER (WHERE f.status = 'active')            AS unit_label
    FROM f
  ),
  prod AS (   -- gộp về cấp sản phẩm (lô active còn hàng)
    SELECT
      f.product_id AS pid,
      SUM(f.quantity_on_hand)                                                   AS qty,
      SUM(f.lot_value)                                                          AS value,
      -- ROUND(...,2) GIỐNG HỆT fn_..._by_product để dòng "Tổng cộng" cross-foot
      -- khớp đúng tổng các dòng đang hiển thị (kế toán sẽ đối chiếu).
      ROUND(SUM(f.quantity_on_hand * f.cost_price)
            / NULLIF(SUM(f.quantity_on_hand), 0), 2)                            AS avg_cost
    FROM f
    WHERE f.status = 'active'
    GROUP BY f.product_id
  ),
  mv AS (     -- CẦU RÒNG: bán − hàng khách trả
    SELECT
      sm.product_id AS pid,
      GREATEST(0, COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - make_interval(days => v_win)), 0))  AS sold_window,
      GREATEST(0, COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - interval '90 days'), 0))            AS sold_90d
    FROM public.stock_movements sm
    WHERE sm.movement_type IN ('sale', 'return_from_customer')
      AND sm.created_at >= now() - make_interval(days => GREATEST(90, v_win))
      AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY sm.product_id
  ),
  calc AS (
    SELECT
      pr.qty                                              AS qty,
      pr.value                                            AS value,
      COALESCE(pr.avg_cost, 0)                            AS avg_cost,
      COALESCE(m.sold_window, 0)                          AS sold_window,
      COALESCE(m.sold_90d, 0)                             AS sold_90d,
      -- target = (sold_window / N) × N = sold_window
      GREATEST(0, pr.qty - COALESCE(m.sold_window, 0))    AS excess_qty,
      CASE WHEN COALESCE(m.sold_window, 0) > 0
           THEN pr.qty * v_win::NUMERIC / m.sold_window
           END                                            AS dts
    FROM prod pr
    LEFT JOIN mv m ON m.pid = pr.pid
  )
  SELECT
    la.total_qty::NUMERIC,
    la.total_value::NUMERIC,
    la.product_count::BIGINT,
    la.lot_count::BIGINT,
    la.warehouse_count::BIGINT,
    la.missing_cost_products::BIGINT,
    la.expiring_90d_value::NUMERIC,
    la.expired_active_lots::BIGINT,
    la.non_active_value::NUMERIC,
    (la.unit_kinds = 1),
    CASE WHEN la.unit_kinds = 1 THEN la.unit_label END,
    ROUND(la.total_value / NULLIF(la.total_qty, 0), 2)::NUMERIC,
    la.nearest_expiry,
    c.sold_window_total::NUMERIC,
    c.excess_qty_total::NUMERIC,
    c.excess_value_total::NUMERIC,
    c.dead_value::NUMERIC,
    c.dead_products::BIGINT,
    c.stockout_soon_products::BIGINT,
    c.stockout_soon_value::NUMERIC,
    v_win,
    COALESCE((
      SELECT FLOOR(EXTRACT(EPOCH FROM now() - MIN(sm.created_at)) / 86400)::INTEGER
      FROM public.stock_movements sm
      WHERE sm.movement_type = 'sale'
    ), 0)
  FROM lot_agg la
  CROSS JOIN (
    SELECT
      COALESCE(SUM(k.sold_window), 0)                                        AS sold_window_total,
      COALESCE(SUM(k.excess_qty), 0)                                         AS excess_qty_total,
      COALESCE(SUM(ROUND(k.excess_qty * k.avg_cost, 2)), 0)                  AS excess_value_total,
      COALESCE(SUM(k.value) FILTER (WHERE k.sold_90d = 0), 0)                AS dead_value,
      COUNT(*)              FILTER (WHERE k.sold_90d = 0)                    AS dead_products,
      COUNT(*)              FILTER (WHERE k.dts IS NOT NULL AND k.dts <= v_win) AS stockout_soon_products,
      COALESCE(SUM(k.value) FILTER (WHERE k.dts IS NOT NULL AND k.dts <= v_win), 0) AS stockout_soon_value
    FROM calc k
  ) c;
END;
$$;

COMMENT ON FUNCTION public.fn_inventory_valuation_summary(TEXT, UUID, UUID, UUID, INTEGER) IS
  'KPI + TỔNG TỪNG CỘT của báo cáo giá vốn theo đúng bộ lọc đang xem (dùng cho dòng "Tổng cộng" trên đầu bảng — không cộng ở client vì tab Sản phẩm phân trang server-side). Cầu ròng = bán − hàng trả. Vốn thừa = tồn − bán ròng N ngày. admin-only.';

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: Định giá theo sản phẩm (+ dòng vốn)
--    p_sort: 'value' | 'qty' | 'avg_cost' | 'turnover' | 'days_of_stock'
--            | 'idle' | 'excess' (vốn thừa ↓) | 'stockout' (sắp hết hàng ↑)
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_inventory_valuation_by_product(
  p_search       TEXT    DEFAULT NULL,
  p_warehouse_id UUID    DEFAULT NULL,
  p_brand_id     UUID    DEFAULT NULL,
  p_category_id  UUID    DEFAULT NULL,
  p_sort         TEXT    DEFAULT 'value',
  p_limit        INTEGER DEFAULT 100,
  p_offset       INTEGER DEFAULT 0,
  p_window_days  INTEGER DEFAULT 20
)
RETURNS TABLE (
  product_id       UUID,
  sku              TEXT,
  product_name     TEXT,
  unit             TEXT,
  brand_name       TEXT,
  category_name    TEXT,
  total_qty        NUMERIC,
  avg_cost         NUMERIC,
  total_value      NUMERIC,
  lot_count        BIGINT,
  warehouse_count  BIGINT,
  nearest_expiry   DATE,
  missing_cost     BOOLEAN,
  sold_30d         NUMERIC,      -- RÒNG (đã trừ hàng trả)
  sold_90d         NUMERIC,      -- RÒNG
  turnover_90d     NUMERIC,
  days_of_stock    NUMERIC,      -- theo tốc độ 90 ngày
  last_sale_at     TIMESTAMPTZ,
  total_count      BIGINT,
  -- ── Dòng vốn theo cửa sổ N ngày ──
  sold_window      NUMERIC,      -- bán ròng N ngày
  daily_demand     NUMERIC,      -- sold_window / N
  days_to_stockout NUMERIC,      -- tồn / daily_demand
  stockout_date    DATE,         -- NULL nếu > 10 năm hoặc không có cầu
  excess_qty       NUMERIC,      -- max(0, tồn − sold_window)
  excess_value     NUMERIC,      -- excess_qty × giá vốn TB
  window_days      INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_win INTEGER := GREATEST(1, LEAST(365, COALESCE(p_window_days, 20)));
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo kho hàng';
  END IF;

  IF p_sort NOT IN ('value', 'qty', 'avg_cost', 'turnover', 'days_of_stock', 'idle', 'excess', 'stockout') THEN
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
  mv AS (   -- CẦU RÒNG: bán − hàng khách trả
    SELECT
      sm.product_id AS pid,
      GREATEST(0, COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - make_interval(days => v_win)), 0)) AS sold_window,
      GREATEST(0, COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - interval '30 days'), 0))           AS sold_30d,
      GREATEST(0, COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - interval '90 days'), 0))           AS sold_90d
    FROM public.stock_movements sm
    WHERE sm.movement_type IN ('sale', 'return_from_customer')
      AND sm.created_at >= now() - make_interval(days => GREATEST(90, v_win))
      AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY sm.product_id
  ),
  last_sale AS (
    SELECT
      sm.product_id      AS pid,
      MAX(sm.created_at) AS last_sale_at
    FROM public.stock_movements sm
    WHERE sm.movement_type = 'sale'
      AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY sm.product_id
  ),
  calc AS (
    SELECT
      p.id                                        AS product_id,
      p.sku                                       AS sku,
      p.name                                      AS product_name,
      p.unit                                      AS unit,
      COALESCE(b.name, '(Không thương hiệu)')     AS brand_name,
      COALESCE(pc.name, '(Chưa phân nhóm)')       AS category_name,
      s.qty                                       AS qty,
      COALESCE(s.avg_cost, 0)                     AS avg_cost,
      s.value                                     AS value,
      s.lot_count                                 AS lot_count,
      s.wh_count                                  AS wh_count,
      s.nearest_expiry                            AS nearest_expiry,
      s.missing_cost                              AS missing_cost,
      COALESCE(m.sold_30d, 0)                     AS sold_30d,
      COALESCE(m.sold_90d, 0)                     AS sold_90d,
      COALESCE(m.sold_window, 0)                  AS sold_window,
      ls.last_sale_at                             AS last_sale_at,
      CASE WHEN s.qty > 0
           THEN ROUND(COALESCE(m.sold_90d, 0) / s.qty, 2)
           ELSE 0 END                             AS turnover_90d,
      CASE WHEN COALESCE(m.sold_90d, 0) > 0
           THEN ROUND(s.qty / (m.sold_90d / 90.0), 0)
           END                                    AS days_of_stock,
      ROUND(COALESCE(m.sold_window, 0) / v_win::NUMERIC, 3) AS daily_demand,
      CASE WHEN COALESCE(m.sold_window, 0) > 0
           THEN ROUND(s.qty * v_win::NUMERIC / m.sold_window, 1)
           END                                    AS days_to_stockout,
      GREATEST(0, s.qty - COALESCE(m.sold_window, 0)) AS excess_qty,
      ROUND(GREATEST(0, s.qty - COALESCE(m.sold_window, 0))
            * COALESCE(s.avg_cost, 0), 2)         AS excess_value
    FROM stock s
    JOIN public.products p ON p.id = s.pid
    LEFT JOIN public.brands b              ON b.id  = p.brand_id
    LEFT JOIN public.product_categories pc ON pc.id = p.category_id
    LEFT JOIN mv m         ON m.pid  = s.pid
    LEFT JOIN last_sale ls ON ls.pid = s.pid
  )
  SELECT
    c.product_id,
    c.sku,
    c.product_name,
    c.unit,
    c.brand_name,
    c.category_name,
    c.qty::NUMERIC,
    c.avg_cost::NUMERIC,
    c.value::NUMERIC,
    c.lot_count::BIGINT,
    c.wh_count::BIGINT,
    c.nearest_expiry,
    c.missing_cost,
    c.sold_30d::NUMERIC,
    c.sold_90d::NUMERIC,
    c.turnover_90d::NUMERIC,
    c.days_of_stock::NUMERIC,
    c.last_sale_at,
    COUNT(*) OVER ()::BIGINT,
    c.sold_window::NUMERIC,
    c.daily_demand::NUMERIC,
    c.days_to_stockout::NUMERIC,
    -- Chặn tràn kiểu DATE với hàng bán cực chậm (tồn/cầu có thể ra hàng vạn ngày)
    CASE WHEN c.days_to_stockout IS NOT NULL AND c.days_to_stockout <= 3650
         THEN CURRENT_DATE + FLOOR(c.days_to_stockout)::INTEGER
         END,
    c.excess_qty::NUMERIC,
    c.excess_value::NUMERIC,
    v_win
  FROM calc c
  ORDER BY
    -- 'idle': lâu chưa bán lên đầu (NULL = chưa từng bán → đầu tiên)
    CASE WHEN p_sort = 'idle'     THEN c.last_sale_at     END ASC NULLS FIRST,
    -- 'stockout': sắp hết hàng lên đầu (NULL = không có cầu → cuối)
    CASE WHEN p_sort = 'stockout' THEN c.days_to_stockout END ASC NULLS LAST,
    CASE p_sort
      WHEN 'qty'           THEN c.qty
      WHEN 'avg_cost'      THEN c.avg_cost
      WHEN 'turnover'      THEN c.turnover_90d
      WHEN 'days_of_stock' THEN c.days_of_stock
      WHEN 'excess'        THEN c.excess_value
      WHEN 'idle'          THEN NULL
      WHEN 'stockout'      THEN NULL
      ELSE c.value
    END DESC NULLS LAST,
    c.product_name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.fn_inventory_valuation_by_product(TEXT, UUID, UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER) IS
  'Định giá tồn kho theo sản phẩm + dòng vốn: bán ròng N ngày (đã trừ hàng khách trả), ngày dự kiến hết hàng, vốn thừa. admin-only.';

-- ─────────────────────────────────────────────────────────────
-- 5. RPC: Định giá theo nhóm — thêm chiều 'branch' + cột dòng vốn
--    p_group_by: 'brand' | 'category' | 'warehouse' | 'branch'
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_inventory_valuation_by_group(
  p_group_by     TEXT,
  p_warehouse_id UUID    DEFAULT NULL,
  p_sort         TEXT    DEFAULT 'value',
  p_limit        INTEGER DEFAULT 200,
  p_offset       INTEGER DEFAULT 0,
  p_window_days  INTEGER DEFAULT 20
)
RETURNS TABLE (
  group_id              UUID,
  group_name            TEXT,
  product_count         BIGINT,
  lot_count             BIGINT,
  total_qty             NUMERIC,
  total_value           NUMERIC,
  value_share           NUMERIC,
  missing_cost_products BIGINT,
  -- ── Dòng vốn ──
  sold_window           NUMERIC,
  excess_value          NUMERIC,  -- VỐN THỪA của nhóm
  dead_value            NUMERIC,  -- giá trị SP không bán ròng nào trong 90 ngày
  unit_uniform          BOOLEAN,  -- nhóm chỉ gồm 1 ĐVT?
  window_days           INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_win INTEGER := GREATEST(1, LEAST(365, COALESCE(p_window_days, 20)));
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo kho hàng';
  END IF;

  IF p_group_by NOT IN ('brand', 'category', 'warehouse', 'branch') THEN
    RAISE EXCEPTION 'Tham số nhóm không hợp lệ: %', p_group_by;
  END IF;

  IF p_sort NOT IN ('value', 'qty', 'product_count', 'excess') THEN
    RAISE EXCEPTION 'Tham số sắp xếp không hợp lệ: %', p_sort;
  END IF;

  RETURN QUERY
  -- Bất biến cần giữ: "dòng của kho X" phải khớp đúng tab Sản phẩm khi lọc kho X.
  -- → Chiều gom nhóm quyết định phạm vi tính CẦU:
  --     • 'warehouse' / 'branch' : cầu tính theo (sản phẩm × kho)
  --     • 'brand' / 'category'   : cầu tính theo sản phẩm (trong phạm vi lọc kho)
  --   Nếu dùng cầu toàn công ty cho nhóm theo kho thì tồn của 1 kho bị đem so với
  --   lượng bán của TẤT CẢ các kho → vốn thừa bị triệt tiêu sai.
  WITH mv AS (
    SELECT
      sm.product_id AS pid,
      CASE WHEN p_group_by IN ('warehouse', 'branch') THEN sm.warehouse_id END AS wid,
      GREATEST(0, COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - make_interval(days => v_win)), 0)) AS sold_window,
      GREATEST(0, COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - interval '90 days'), 0))           AS sold_90d
    FROM public.stock_movements sm
    WHERE sm.movement_type IN ('sale', 'return_from_customer')
      AND sm.created_at >= now() - make_interval(days => GREATEST(90, v_win))
      AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY 1, 2
  ),
  -- Vốn thừa phải tính ở CẤP SẢN PHẨM rồi mới cộng lên nhóm; cộng tồn của cả
  -- nhóm rồi trừ cầu của cả nhóm sẽ triệt tiêu sai (SP dư bù cho SP thiếu).
  prod AS (
    SELECT
      v.product_id AS pid,
      CASE WHEN p_group_by IN ('warehouse', 'branch') THEN v.warehouse_id END AS wid,
      CASE p_group_by
        WHEN 'brand'    THEN v.brand_id
        WHEN 'category' THEN v.category_id
        WHEN 'branch'   THEN v.branch_id
        ELSE                 v.warehouse_id
      END AS gid,
      CASE p_group_by
        WHEN 'brand'    THEN COALESCE(v.brand_name, '(Không thương hiệu)')
        WHEN 'category' THEN COALESCE(v.category_name, '(Chưa phân nhóm)')
        WHEN 'branch'   THEN COALESCE(v.branch_name, '(Chưa gán chi nhánh)')
        ELSE                 v.warehouse_name
      END AS gname,
      MIN(v.unit)                     AS unit,
      SUM(v.quantity_on_hand)         AS qty,
      SUM(v.lot_value)                AS value,
      COUNT(*)                        AS lot_count,
      BOOL_OR(v.cost_price = 0)       AS missing_cost,
      ROUND(SUM(v.quantity_on_hand * v.cost_price)
            / NULLIF(SUM(v.quantity_on_hand), 0), 2) AS avg_cost
    FROM public.v_stock_lot_valuation v
    WHERE v.status = 'active'
      AND (p_warehouse_id IS NULL OR v.warehouse_id = p_warehouse_id)
    GROUP BY 1, 2, 3, 4
  ),
  grouped AS (
    SELECT
      pr.gid                                                        AS gid,
      pr.gname                                                      AS gname,
      COUNT(DISTINCT pr.pid)                                        AS product_count,
      SUM(pr.lot_count)                                             AS lot_count,
      SUM(pr.qty)                                                   AS qty,
      SUM(pr.value)                                                 AS value,
      COUNT(DISTINCT pr.pid) FILTER (WHERE pr.missing_cost)         AS missing_cost,
      COALESCE(SUM(m.sold_window), 0)                               AS sold_window,
      COALESCE(SUM(ROUND(GREATEST(0, pr.qty - COALESCE(m.sold_window, 0))
                         * COALESCE(pr.avg_cost, 0), 2)), 0)        AS excess_value,
      COALESCE(SUM(pr.value) FILTER (WHERE COALESCE(m.sold_90d, 0) = 0), 0) AS dead_value,
      COUNT(DISTINCT pr.unit)                                       AS unit_kinds
    FROM prod pr
    LEFT JOIN mv m
      ON  m.pid = pr.pid
      AND m.wid IS NOT DISTINCT FROM pr.wid
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
    g.missing_cost::BIGINT,
    g.sold_window::NUMERIC,
    ROUND(g.excess_value, 2)::NUMERIC,
    g.dead_value::NUMERIC,
    (g.unit_kinds = 1),
    v_win
  FROM grouped g
  ORDER BY
    CASE p_sort
      WHEN 'qty'           THEN g.qty
      WHEN 'product_count' THEN g.product_count::NUMERIC
      WHEN 'excess'        THEN g.excess_value
      ELSE g.value
    END DESC NULLS LAST,
    g.gname ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.fn_inventory_valuation_by_group(TEXT, UUID, TEXT, INTEGER, INTEGER, INTEGER) IS
  'Định giá tồn kho theo thương hiệu / nhóm hàng / kho / CHI NHÁNH + vốn thừa & vốn đọng. Vốn thừa tính ở cấp SP rồi mới cộng lên nhóm. admin-only.';

-- ─────────────────────────────────────────────────────────────
-- 6. GRANT (RPC tự enforce fn_has_role('admin') bên trong)
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_inventory_valuation_summary(TEXT, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_inventory_valuation_by_product(TEXT, UUID, UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_inventory_valuation_by_group(TEXT, UUID, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_inventory_valuation_summary(TEXT, UUID, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_valuation_by_product(TEXT, UUID, UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_valuation_by_group(TEXT, UUID, TEXT, INTEGER, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
