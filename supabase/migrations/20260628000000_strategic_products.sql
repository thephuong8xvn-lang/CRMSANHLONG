-- ─────────────────────────────────────────────────────────────
-- CRM SANHLONGVETCO – SẢN PHẨM CHIẾN LƯỢC & TỐI ƯU LỢI NHUẬN
-- File: 20260628000000_strategic_products.sql
-- Mô tả: Phân loại SP 2 nhóm (strategic = markup ≥50% trên giá vốn,
--        baseline = hàng nền hòa/lỗ kéo khách) + mục tiêu doanh số
--        tháng theo chi nhánh + 7 RPC báo cáo (admin-only).
--
-- Công thức cốt lõi (tất cả tỉ lệ trả về dạng PHÂN SỐ, FE nhân 100):
--   markup_actual = (Σrevenue − Σcogs) / Σcogs        (NULL nếu cogs=0)
--   margin        = (Σrevenue − Σcogs) / Σrevenue
--   strategic_share = revenue_strategic / revenue_total (mục tiêu ≥ 0.30)
--   cross_subsidy   = profit_strategic + profit_baseline (nhóm 1 bù nhóm 2)
--   days_to_oos     = tồn hiện tại / (sold_30d / 30)   (NULL nếu 30d không bán)
--   gmroi (quy năm, xấp xỉ theo tồn hiện tại)
--                   = profit_90d × (365/90) / giá trị vốn tồn kho
--
-- Nguồn dữ liệu: v_order_line_profit (doanh thu/giá vốn dòng đơn, chỉ đơn
-- confirmed→completed) + v_stock_lot_valuation (tồn + vốn theo lô active).
-- Cả 2 view đã REVOKE anon/authenticated — chỉ RPC SECURITY DEFINER chạm tới.
-- Phân loại áp HỒI TỐ: class hiện tại áp cho toàn bộ lịch sử bán (point-in-time).
-- Múi giờ nghiệp vụ: Asia/Ho_Chi_Minh (ranh giới ngày/tháng).
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- 1. BẢNG product_strategy — phân loại SP (không có dòng = SP thường)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_strategy (
  product_id  UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  class       TEXT NOT NULL CHECK (class IN ('strategic', 'baseline')),
  note        TEXT,
  assigned_by UUID REFERENCES public.profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_strategy IS 'Phân loại SP chiến lược: strategic (markup ≥50% giá vốn, nguồn lãi chính) / baseline (hàng nền hòa/lỗ kéo khách). Không có dòng = SP thường.';

CREATE INDEX IF NOT EXISTS idx_product_strategy_class ON public.product_strategy(class);

ALTER TABLE public.product_strategy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_strategy_select_active ON public.product_strategy;
CREATE POLICY product_strategy_select_active ON public.product_strategy
  FOR SELECT USING (public.fn_is_active());

DROP POLICY IF EXISTS product_strategy_insert_admin ON public.product_strategy;
CREATE POLICY product_strategy_insert_admin ON public.product_strategy
  FOR INSERT WITH CHECK (public.fn_has_role('admin') AND public.fn_is_active());

DROP POLICY IF EXISTS product_strategy_update_admin ON public.product_strategy;
CREATE POLICY product_strategy_update_admin ON public.product_strategy
  FOR UPDATE USING (public.fn_has_role('admin') AND public.fn_is_active())
  WITH CHECK (public.fn_has_role('admin') AND public.fn_is_active());

DROP POLICY IF EXISTS product_strategy_delete_admin ON public.product_strategy;
CREATE POLICY product_strategy_delete_admin ON public.product_strategy
  FOR DELETE USING (public.fn_has_role('admin') AND public.fn_is_active());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_strategy TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. BẢNG branch_month_targets — mục tiêu doanh số tháng theo chi nhánh
--    (số nhạy cảm → cả SELECT lẫn write đều admin-only)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.branch_month_targets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id              UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  year                   INT  NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month                  INT  NOT NULL CHECK (month BETWEEN 1 AND 12),
  revenue_target         NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (revenue_target >= 0),
  strategic_share_target NUMERIC(5,4)  NOT NULL DEFAULT 0.30 CHECK (strategic_share_target BETWEEN 0 AND 1),
  note                   TEXT,
  updated_by             UUID REFERENCES public.profiles(id),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, year, month)
);

COMMENT ON TABLE public.branch_month_targets IS 'Mục tiêu doanh số THÁNG theo chi nhánh: tổng doanh thu + tỉ trọng SP chiến lược (mặc định 30%). Admin-only cả đọc lẫn ghi.';

ALTER TABLE public.branch_month_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branch_targets_select_admin ON public.branch_month_targets;
CREATE POLICY branch_targets_select_admin ON public.branch_month_targets
  FOR SELECT USING (public.fn_has_role('admin') AND public.fn_is_active());

DROP POLICY IF EXISTS branch_targets_write_admin ON public.branch_month_targets;
CREATE POLICY branch_targets_write_admin ON public.branch_month_targets
  FOR ALL USING (public.fn_has_role('admin') AND public.fn_is_active())
  WITH CHECK (public.fn_has_role('admin') AND public.fn_is_active());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_month_targets TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. SEED cấu hình ngưỡng (đổi qua UI, RPC đọc COALESCE → không cần deploy)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES ('strategic_config', jsonb_build_object(
  'markup_min',              0.5,      -- markup tối thiểu nhóm 1 (50% trên giá vốn)
  'baseline_loss_floor',     -0.05,    -- margin sàn nhóm 2 (lỗ quá 5% doanh thu = lỗ sâu)
  'suggest_min_revenue_90d', 5000000,  -- DT 90 ngày tối thiểu để gợi ý vào nhóm 1
  'suggest_min_qty_90d',     30,       -- SL bán 90 ngày tối thiểu để gợi ý nhóm 2
  'oos_warn_days',           7         -- cảnh báo sắp hết hàng khi tồn còn ≤ N ngày bán
))
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: Tổng quan tháng theo chi nhánh (1 dòng/chi nhánh)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_summary(
  p_year      INT,
  p_month     INT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  branch_id                 UUID,
  branch_name               TEXT,
  revenue_total             NUMERIC,
  revenue_strategic         NUMERIC,
  revenue_baseline          NUMERIC,
  revenue_other             NUMERIC,
  strategic_share           NUMERIC,  -- phân số (0.30 = 30%)
  profit_strategic          NUMERIC,
  profit_baseline           NUMERIC,
  profit_other              NUMERIC,
  cross_subsidy             NUMERIC,  -- profit nhóm 1 + nhóm 2
  strategic_violation_count BIGINT,   -- SP nhóm 1 markup tháng < markup_min
  baseline_deep_loss_count  BIGINT,   -- SP nhóm 2 margin < loss_floor
  revenue_target            NUMERIC,  -- NULL nếu chưa đặt
  strategic_share_target    NUMERIC,
  month_elapsed_ratio       NUMERIC,  -- 0..1, FE tính pace
  gmroi_strategic           NUMERIC,  -- quy năm, theo tồn hiện tại
  gmroi_baseline            NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg        JSONB;
  v_markup_min NUMERIC;
  v_loss_floor NUMERIC;
  v_from       TIMESTAMPTZ;
  v_to         TIMESTAMPTZ;
  v_elapsed    NUMERIC;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Kỳ báo cáo không hợp lệ: %/%', p_month, p_year;
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'strategic_config';
  v_markup_min := COALESCE((v_cfg->>'markup_min')::NUMERIC, 0.5);
  v_loss_floor := COALESCE((v_cfg->>'baseline_loss_floor')::NUMERIC, -0.05);

  v_from := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh');
  v_to   := v_from + INTERVAL '1 month';
  v_elapsed := CASE
    WHEN now() <= v_from THEN 0
    WHEN now() >= v_to   THEN 1
    ELSE ROUND(EXTRACT(EPOCH FROM now() - v_from) / EXTRACT(EPOCH FROM v_to - v_from), 4)
  END;

  RETURN QUERY
  WITH lines AS (
    SELECT v.branch_id AS bid, COALESCE(ps.class, 'other') AS cls,
           v.product_id AS pid, v.revenue AS rev, v.cogs AS cg
    FROM public.v_order_line_profit v
    LEFT JOIN public.product_strategy ps ON ps.product_id = v.product_id
    WHERE v.created_at >= v_from AND v.created_at < v_to
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
  ),
  by_branch AS (
    SELECT l.bid,
      SUM(l.rev)                                            AS rev_total,
      COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'strategic'), 0) AS rev_s,
      COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'baseline'),  0) AS rev_b,
      COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'other'),     0) AS rev_o,
      COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'strategic'), 0) AS prof_s,
      COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'baseline'),  0) AS prof_b,
      COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'other'),     0) AS prof_o
    FROM lines l
    GROUP BY l.bid
  ),
  prod_month AS (
    SELECT l.bid, l.cls, l.pid, SUM(l.rev) AS rev, SUM(l.cg) AS cg
    FROM lines l
    GROUP BY l.bid, l.cls, l.pid
  ),
  viol AS (
    SELECT pm.bid,
      COUNT(*) FILTER (WHERE pm.cls = 'strategic' AND pm.cg > 0
                         AND (pm.rev - pm.cg) / pm.cg < v_markup_min)   AS strat_viol,
      COUNT(*) FILTER (WHERE pm.cls = 'baseline' AND pm.rev > 0
                         AND (pm.rev - pm.cg) / pm.rev < v_loss_floor)  AS base_loss
    FROM prod_month pm
    GROUP BY pm.bid
  ),
  p90 AS (
    SELECT v.branch_id AS bid, COALESCE(ps.class, 'other') AS cls,
           SUM(v.revenue - v.cogs) AS profit90
    FROM public.v_order_line_profit v
    LEFT JOIN public.product_strategy ps ON ps.product_id = v.product_id
    WHERE v.created_at >= now() - INTERVAL '90 days'
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
    GROUP BY 1, 2
  ),
  stockv AS (
    SELECT sv.branch_id AS bid, ps.class AS cls, SUM(sv.lot_value) AS val
    FROM public.v_stock_lot_valuation sv
    JOIN public.product_strategy ps ON ps.product_id = sv.product_id
    WHERE sv.status = 'active'
      AND (p_branch_id IS NULL OR sv.branch_id = p_branch_id)
    GROUP BY 1, 2
  ),
  gm AS (
    SELECT COALESCE(p.bid, s.bid) AS bid,
      MAX(CASE WHEN COALESCE(p.cls, s.cls) = 'strategic'
               THEN ROUND(COALESCE(p.profit90, 0) * (365.0 / 90.0) / NULLIF(s.val, 0), 2) END) AS gmroi_s,
      MAX(CASE WHEN COALESCE(p.cls, s.cls) = 'baseline'
               THEN ROUND(COALESCE(p.profit90, 0) * (365.0 / 90.0) / NULLIF(s.val, 0), 2) END) AS gmroi_b
    FROM p90 p
    FULL JOIN stockv s ON s.bid IS NOT DISTINCT FROM p.bid AND s.cls = p.cls
    GROUP BY 1
  )
  SELECT
    bb.bid,
    COALESCE(br.name, '(Chưa gán CN)'),
    bb.rev_total::NUMERIC,
    bb.rev_s::NUMERIC,
    bb.rev_b::NUMERIC,
    bb.rev_o::NUMERIC,
    ROUND(bb.rev_s / NULLIF(bb.rev_total, 0), 4)::NUMERIC,
    bb.prof_s::NUMERIC,
    bb.prof_b::NUMERIC,
    bb.prof_o::NUMERIC,
    (bb.prof_s + bb.prof_b)::NUMERIC,
    COALESCE(vl.strat_viol, 0)::BIGINT,
    COALESCE(vl.base_loss, 0)::BIGINT,
    t.revenue_target::NUMERIC,
    COALESCE(t.strategic_share_target, 0.30)::NUMERIC,
    v_elapsed,
    g.gmroi_s::NUMERIC,
    g.gmroi_b::NUMERIC
  FROM by_branch bb
  LEFT JOIN public.branches br ON br.id = bb.bid
  LEFT JOIN viol vl ON vl.bid IS NOT DISTINCT FROM bb.bid
  LEFT JOIN gm g   ON g.bid  IS NOT DISTINCT FROM bb.bid
  LEFT JOIN public.branch_month_targets t
    ON t.branch_id = bb.bid AND t.year = p_year AND t.month = p_month
  ORDER BY bb.rev_total DESC NULLS LAST;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. RPC: Danh sách SP theo nhóm (manualPagination)
--    p_class: 'strategic' | 'baseline' | 'other'
--    p_sort:  'revenue' | 'profit' | 'markup' | 'qty' | 'sold_30d'
--             | 'days_to_oos' (ASC — sắp hết lên đầu) | 'gmroi'
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_products(
  p_year      INT,
  p_month     INT,
  p_branch_id UUID    DEFAULT NULL,
  p_class     TEXT    DEFAULT 'strategic',
  p_search    TEXT    DEFAULT NULL,
  p_sort      TEXT    DEFAULT 'revenue',
  p_limit     INTEGER DEFAULT 50,
  p_offset    INTEGER DEFAULT 0
)
RETURNS TABLE (
  product_id    UUID,
  sku           TEXT,
  product_name  TEXT,
  unit          TEXT,
  brand_name    TEXT,
  class         TEXT,
  note          TEXT,
  qty           NUMERIC,
  revenue       NUMERIC,
  cogs          NUMERIC,
  profit        NUMERIC,
  markup_actual NUMERIC,  -- phân số; NULL nếu cogs=0
  margin        NUMERIC,  -- phân số; NULL nếu revenue=0
  order_count   BIGINT,
  sold_30d      NUMERIC,
  stock_on_hand NUMERIC,
  stock_value   NUMERIC,
  days_to_oos   NUMERIC,  -- NULL nếu 30 ngày không bán
  gmroi         NUMERIC,  -- quy năm; NULL nếu không có tồn
  is_violation  BOOLEAN,
  missing_cost  BOOLEAN,
  total_count   BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg        JSONB;
  v_markup_min NUMERIC;
  v_loss_floor NUMERIC;
  v_from       TIMESTAMPTZ;
  v_to         TIMESTAMPTZ;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược';
  END IF;
  IF p_class NOT IN ('strategic', 'baseline', 'other') THEN
    RAISE EXCEPTION 'Nhóm sản phẩm không hợp lệ: %', p_class;
  END IF;
  IF p_sort NOT IN ('revenue', 'profit', 'markup', 'qty', 'sold_30d', 'days_to_oos', 'gmroi') THEN
    RAISE EXCEPTION 'Tham số sắp xếp không hợp lệ: %', p_sort;
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Kỳ báo cáo không hợp lệ: %/%', p_month, p_year;
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'strategic_config';
  v_markup_min := COALESCE((v_cfg->>'markup_min')::NUMERIC, 0.5);
  v_loss_floor := COALESCE((v_cfg->>'baseline_loss_floor')::NUMERIC, -0.05);

  v_from := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh');
  v_to   := v_from + INTERVAL '1 month';

  RETURN QUERY
  WITH base AS (
    -- nhóm strategic/baseline: TẤT CẢ SP đã gán (kể cả chưa bán tháng này)
    SELECT ps.product_id AS pid, ps.class AS cls, ps.note AS pnote
    FROM public.product_strategy ps
    WHERE p_class IN ('strategic', 'baseline') AND ps.class = p_class
    UNION ALL
    -- nhóm other: SP CHƯA gán có bán trong tháng
    SELECT DISTINCT v.product_id, 'other'::TEXT, NULL::TEXT
    FROM public.v_order_line_profit v
    WHERE p_class = 'other'
      AND v.created_at >= v_from AND v.created_at < v_to
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
      AND NOT EXISTS (SELECT 1 FROM public.product_strategy ps WHERE ps.product_id = v.product_id)
  ),
  sal AS (
    SELECT v.product_id AS pid, SUM(v.quantity) AS qty, SUM(v.revenue) AS rev,
           SUM(v.cogs) AS cg, COUNT(DISTINCT v.order_id) AS ocnt
    FROM public.v_order_line_profit v
    WHERE v.created_at >= v_from AND v.created_at < v_to
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
    GROUP BY 1
  ),
  s30 AS (
    SELECT v.product_id AS pid, SUM(v.quantity) AS q30
    FROM public.v_order_line_profit v
    WHERE v.created_at >= now() - INTERVAL '30 days'
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
    GROUP BY 1
  ),
  p90 AS (
    SELECT v.product_id AS pid, SUM(v.revenue - v.cogs) AS profit90
    FROM public.v_order_line_profit v
    WHERE v.created_at >= now() - INTERVAL '90 days'
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
    GROUP BY 1
  ),
  stk AS (
    SELECT sv.product_id AS pid, SUM(sv.quantity_on_hand) AS stockq, SUM(sv.lot_value) AS stockval
    FROM public.v_stock_lot_valuation sv
    WHERE sv.status = 'active'
      AND (p_branch_id IS NULL OR sv.branch_id = p_branch_id)
    GROUP BY 1
  )
  SELECT
    p.id,
    p.sku,
    p.name,
    p.unit,
    COALESCE(b.name, '(Không thương hiệu)'),
    bs.cls,
    bs.pnote,
    COALESCE(s.qty, 0)::NUMERIC,
    COALESCE(s.rev, 0)::NUMERIC,
    COALESCE(s.cg, 0)::NUMERIC,
    COALESCE(s.rev - s.cg, 0)::NUMERIC,
    ROUND((s.rev - s.cg) / NULLIF(s.cg, 0), 4)::NUMERIC,
    ROUND((s.rev - s.cg) / NULLIF(s.rev, 0), 4)::NUMERIC,
    COALESCE(s.ocnt, 0)::BIGINT,
    COALESCE(m.q30, 0)::NUMERIC,
    COALESCE(st.stockq, 0)::NUMERIC,
    COALESCE(st.stockval, 0)::NUMERIC,
    CASE WHEN COALESCE(m.q30, 0) > 0
         THEN ROUND(COALESCE(st.stockq, 0) / (m.q30 / 30.0), 1)
         ELSE NULL END::NUMERIC,
    CASE WHEN COALESCE(st.stockval, 0) > 0
         THEN ROUND(COALESCE(g.profit90, 0) * (365.0 / 90.0) / st.stockval, 2)
         ELSE NULL END::NUMERIC,
    CASE
      WHEN bs.cls = 'strategic' THEN
        COALESCE(s.cg, 0) > 0 AND (s.rev - s.cg) / s.cg < v_markup_min
      WHEN bs.cls = 'baseline' THEN
        COALESCE(s.rev, 0) > 0 AND (s.rev - s.cg) / s.rev < v_loss_floor
      ELSE FALSE
    END,
    (COALESCE(s.rev, 0) > 0 AND COALESCE(s.cg, 0) = 0),
    COUNT(*) OVER ()::BIGINT
  FROM base bs
  JOIN public.products p ON p.id = bs.pid
  LEFT JOIN public.brands b ON b.id = p.brand_id
  LEFT JOIN sal s  ON s.pid  = bs.pid
  LEFT JOIN s30 m  ON m.pid  = bs.pid
  LEFT JOIN p90 g  ON g.pid  = bs.pid
  LEFT JOIN stk st ON st.pid = bs.pid
  WHERE (
    p_search IS NULL OR p_search = ''
    OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(p_search)) || '%'
    OR p.sku ILIKE '%' || p_search || '%'
  )
  ORDER BY
    CASE WHEN p_sort = 'days_to_oos'
         THEN CASE WHEN COALESCE(m.q30, 0) > 0
                   THEN COALESCE(st.stockq, 0) / (m.q30 / 30.0) END
    END ASC NULLS LAST,
    CASE p_sort
      WHEN 'profit'   THEN COALESCE(s.rev - s.cg, 0)
      WHEN 'markup'   THEN (s.rev - s.cg) / NULLIF(s.cg, 0)
      WHEN 'qty'      THEN COALESCE(s.qty, 0)
      WHEN 'sold_30d' THEN COALESCE(m.q30, 0)
      WHEN 'gmroi'    THEN CASE WHEN COALESCE(st.stockval, 0) > 0
                                THEN COALESCE(g.profit90, 0) * (365.0 / 90.0) / st.stockval END
      WHEN 'days_to_oos' THEN NULL
      ELSE COALESCE(s.rev, 0)
    END DESC NULLS LAST,
    p.name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. RPC: Gợi ý phân loại (cửa sổ 90 ngày, chỉ SP CHƯA gán + đang bán)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_suggestions(
  p_branch_id UUID    DEFAULT NULL,
  p_limit     INTEGER DEFAULT 50,
  p_offset    INTEGER DEFAULT 0
)
RETURNS TABLE (
  product_id      UUID,
  sku             TEXT,
  product_name    TEXT,
  unit            TEXT,
  suggested_class TEXT,
  revenue_90d     NUMERIC,
  qty_90d         NUMERIC,
  profit_90d      NUMERIC,
  markup_90d      NUMERIC,  -- phân số; NULL nếu cogs=0
  order_count_90d BIGINT,
  total_count     BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg        JSONB;
  v_markup_min NUMERIC;
  v_min_rev    NUMERIC;
  v_min_qty    NUMERIC;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược';
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'strategic_config';
  v_markup_min := COALESCE((v_cfg->>'markup_min')::NUMERIC, 0.5);
  v_min_rev    := COALESCE((v_cfg->>'suggest_min_revenue_90d')::NUMERIC, 5000000);
  v_min_qty    := COALESCE((v_cfg->>'suggest_min_qty_90d')::NUMERIC, 30);

  RETURN QUERY
  WITH agg AS (
    SELECT
      v.product_id AS pid,
      SUM(v.revenue)           AS rev90,
      SUM(v.quantity)          AS qty90,
      SUM(v.revenue - v.cogs)  AS profit90,
      SUM(v.cogs)              AS cogs90,
      COUNT(DISTINCT v.order_id) AS ocnt90
    FROM public.v_order_line_profit v
    WHERE v.created_at >= now() - INTERVAL '90 days'
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
      AND NOT EXISTS (SELECT 1 FROM public.product_strategy ps WHERE ps.product_id = v.product_id)
    GROUP BY v.product_id
  ),
  scored AS (
    SELECT a.*,
      (a.profit90 / NULLIF(a.cogs90, 0)) AS mk90,
      CASE
        WHEN a.cogs90 > 0 AND a.profit90 / a.cogs90 >= v_markup_min AND a.rev90 >= v_min_rev
          THEN 'strategic'
        WHEN a.qty90 >= v_min_qty AND (a.cogs90 = 0 OR a.profit90 / a.cogs90 < v_markup_min)
          THEN 'baseline'
        ELSE NULL
      END AS sug
    FROM agg a
  )
  SELECT
    p.id,
    p.sku,
    p.name,
    p.unit,
    sc.sug,
    sc.rev90::NUMERIC,
    sc.qty90::NUMERIC,
    sc.profit90::NUMERIC,
    ROUND(sc.mk90, 4)::NUMERIC,
    sc.ocnt90::BIGINT,
    COUNT(*) OVER ()::BIGINT
  FROM scored sc
  JOIN public.products p ON p.id = sc.pid AND p.is_active
  WHERE sc.sug IS NOT NULL
  ORDER BY sc.rev90 DESC NULLS LAST, p.name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. RPC: Cảnh báo tổng hợp cấp chi nhánh (7 loại)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_alerts(
  p_year      INT,
  p_month     INT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  alert_type  TEXT,     -- share_below_target | strategic_below_markup | baseline_deep_loss
                        -- | cross_subsidy_negative | pace_behind
                        -- | strategic_oos_risk | baseline_oos_risk
  severity    TEXT,     -- warning | critical
  branch_id   UUID,
  branch_name TEXT,
  metric      NUMERIC,
  threshold   NUMERIC,
  item_count  BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg        JSONB;
  v_markup_min NUMERIC;
  v_loss_floor NUMERIC;
  v_oos_days   NUMERIC;
  v_from       TIMESTAMPTZ;
  v_to         TIMESTAMPTZ;
  v_elapsed    NUMERIC;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Kỳ báo cáo không hợp lệ: %/%', p_month, p_year;
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'strategic_config';
  v_markup_min := COALESCE((v_cfg->>'markup_min')::NUMERIC, 0.5);
  v_loss_floor := COALESCE((v_cfg->>'baseline_loss_floor')::NUMERIC, -0.05);
  v_oos_days   := COALESCE((v_cfg->>'oos_warn_days')::NUMERIC, 7);

  v_from := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh');
  v_to   := v_from + INTERVAL '1 month';
  v_elapsed := CASE
    WHEN now() <= v_from THEN 0
    WHEN now() >= v_to   THEN 1
    ELSE EXTRACT(EPOCH FROM now() - v_from) / EXTRACT(EPOCH FROM v_to - v_from)
  END;

  RETURN QUERY
  WITH lines AS (
    SELECT v.branch_id AS bid, COALESCE(ps.class, 'other') AS cls,
           v.product_id AS pid, v.revenue AS rev, v.cogs AS cg
    FROM public.v_order_line_profit v
    LEFT JOIN public.product_strategy ps ON ps.product_id = v.product_id
    WHERE v.created_at >= v_from AND v.created_at < v_to
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
  ),
  by_branch AS (
    SELECT l.bid,
      SUM(l.rev) AS rev_total,
      COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'strategic'), 0) AS rev_s,
      COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'strategic'), 0) AS prof_s,
      COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'baseline'),  0) AS prof_b
    FROM lines l
    GROUP BY l.bid
  ),
  prod_month AS (
    SELECT l.bid, l.cls, l.pid, SUM(l.rev) AS rev, SUM(l.cg) AS cg
    FROM lines l
    GROUP BY l.bid, l.cls, l.pid
  ),
  viol AS (
    SELECT pm.bid,
      COUNT(*) FILTER (WHERE pm.cls = 'strategic' AND pm.cg > 0
                         AND (pm.rev - pm.cg) / pm.cg < v_markup_min)  AS strat_viol,
      COUNT(*) FILTER (WHERE pm.cls = 'strategic' AND pm.rev > 0)      AS strat_sold,
      COUNT(*) FILTER (WHERE pm.cls = 'baseline' AND pm.rev > 0
                         AND (pm.rev - pm.cg) / pm.rev < v_loss_floor) AS base_loss
    FROM prod_month pm
    GROUP BY pm.bid
  ),
  tgt AS (
    SELECT t.branch_id AS bid, t.revenue_target AS rt, t.strategic_share_target AS st
    FROM public.branch_month_targets t
    WHERE t.year = p_year AND t.month = p_month
      AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  ),
  -- Sắp hết hàng: SP đã gán nhóm, CÓ bán 30 ngày qua, tồn ≤ N ngày bán
  s30b AS (
    SELECT v.branch_id AS bid, v.product_id AS pid, SUM(v.quantity) AS q30
    FROM public.v_order_line_profit v
    JOIN public.product_strategy ps ON ps.product_id = v.product_id
    WHERE v.created_at >= now() - INTERVAL '30 days'
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
    GROUP BY 1, 2
    HAVING SUM(v.quantity) > 0
  ),
  stkb AS (
    SELECT sv.branch_id AS bid, sv.product_id AS pid, SUM(sv.quantity_on_hand) AS stockq
    FROM public.v_stock_lot_valuation sv
    WHERE sv.status = 'active'
      AND (p_branch_id IS NULL OR sv.branch_id = p_branch_id)
    GROUP BY 1, 2
  ),
  oos AS (
    SELECT s.bid, ps.class AS cls,
           COUNT(*) FILTER (
             WHERE COALESCE(st.stockq, 0) / (s.q30 / 30.0) <= v_oos_days
           ) AS oos_count
    FROM s30b s
    JOIN public.product_strategy ps ON ps.product_id = s.pid
    LEFT JOIN stkb st ON st.bid IS NOT DISTINCT FROM s.bid AND st.pid = s.pid
    GROUP BY 1, 2
  )
  -- 1) Tỉ trọng nhóm 1 dưới mục tiêu
  SELECT 'share_below_target'::TEXT, 'warning'::TEXT, bb.bid,
         COALESCE(br.name, '(Chưa gán CN)'),
         ROUND(bb.rev_s / NULLIF(bb.rev_total, 0), 4)::NUMERIC,
         COALESCE(tg.st, 0.30)::NUMERIC, NULL::BIGINT
  FROM by_branch bb
  LEFT JOIN public.branches br ON br.id = bb.bid
  LEFT JOIN tgt tg ON tg.bid = bb.bid
  WHERE bb.bid IS NOT NULL AND bb.rev_total > 0
    AND bb.rev_s / bb.rev_total < COALESCE(tg.st, 0.30)
  UNION ALL
  -- 2) SP nhóm 1 bán dưới markup chuẩn
  SELECT 'strategic_below_markup',
         CASE WHEN vl.strat_sold > 0 AND vl.strat_viol >= vl.strat_sold * 0.3
              THEN 'critical' ELSE 'warning' END,
         vl.bid, COALESCE(br.name, '(Chưa gán CN)'),
         vl.strat_viol::NUMERIC, v_markup_min, vl.strat_viol::BIGINT
  FROM viol vl
  LEFT JOIN public.branches br ON br.id = vl.bid
  WHERE vl.strat_viol > 0
  UNION ALL
  -- 3) Hàng nền lỗ sâu hơn sàn
  SELECT 'baseline_deep_loss', 'warning', vl.bid, COALESCE(br.name, '(Chưa gán CN)'),
         vl.base_loss::NUMERIC, v_loss_floor, vl.base_loss::BIGINT
  FROM viol vl
  LEFT JOIN public.branches br ON br.id = vl.bid
  WHERE vl.base_loss > 0
  UNION ALL
  -- 4) Nhóm 1 không gánh nổi lỗ nhóm 2
  SELECT 'cross_subsidy_negative', 'critical', bb.bid, COALESCE(br.name, '(Chưa gán CN)'),
         (bb.prof_s + bb.prof_b)::NUMERIC, 0::NUMERIC, NULL::BIGINT
  FROM by_branch bb
  LEFT JOIN public.branches br ON br.id = bb.bid
  WHERE bb.prof_s + bb.prof_b < 0
  UNION ALL
  -- 5) Tiến độ doanh thu chậm hơn 90% pace
  SELECT 'pace_behind', 'warning', bb.bid, br.name,
         bb.rev_total::NUMERIC, ROUND(tg.rt * v_elapsed, 0)::NUMERIC, NULL::BIGINT
  FROM by_branch bb
  JOIN tgt tg ON tg.bid = bb.bid
  LEFT JOIN public.branches br ON br.id = bb.bid
  WHERE tg.rt > 0 AND v_elapsed > 0.1
    AND bb.rev_total < tg.rt * v_elapsed * 0.9
  UNION ALL
  -- 6) SP nhóm 1 sắp hết hàng (mất nguồn lãi cao)
  SELECT 'strategic_oos_risk', 'warning', o.bid, COALESCE(br.name, '(Chưa gán CN)'),
         o.oos_count::NUMERIC, v_oos_days, o.oos_count::BIGINT
  FROM oos o
  LEFT JOIN public.branches br ON br.id = o.bid
  WHERE o.cls = 'strategic' AND o.oos_count > 0
  UNION ALL
  -- 7) HÀNG NỀN sắp hết (CRITICAL — hàng bắt buộc có mặt)
  SELECT 'baseline_oos_risk', 'critical', o.bid, COALESCE(br.name, '(Chưa gán CN)'),
         o.oos_count::NUMERIC, v_oos_days, o.oos_count::BIGINT
  FROM oos o
  LEFT JOIN public.branches br ON br.id = o.bid
  WHERE o.cls = 'baseline' AND o.oos_count > 0;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 8. RPC: Xu hướng theo tháng (chart)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_trend(
  p_branch_id UUID    DEFAULT NULL,
  p_months    INTEGER DEFAULT 12
)
RETURNS TABLE (
  ym                TEXT,     -- 'YYYY-MM' (giờ VN)
  revenue_total     NUMERIC,
  revenue_strategic NUMERIC,
  revenue_baseline  NUMERIC,
  strategic_share   NUMERIC,
  profit_strategic  NUMERIC,
  profit_baseline   NUMERIC,
  cross_subsidy     NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_months INTEGER;
  v_start  TIMESTAMP;  -- mốc local VN
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược';
  END IF;

  v_months := LEAST(GREATEST(COALESCE(p_months, 12), 1), 24);
  v_start  := date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
              - make_interval(months => v_months - 1);

  RETURN QUERY
  WITH lines AS (
    SELECT
      to_char(v.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') AS lym,
      COALESCE(ps.class, 'other') AS cls,
      v.revenue AS rev, v.cogs AS cg
    FROM public.v_order_line_profit v
    LEFT JOIN public.product_strategy ps ON ps.product_id = v.product_id
    WHERE (v.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') >= v_start
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
  )
  SELECT
    l.lym,
    SUM(l.rev)::NUMERIC,
    COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'strategic'), 0)::NUMERIC,
    COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'baseline'),  0)::NUMERIC,
    ROUND(COALESCE(SUM(l.rev) FILTER (WHERE l.cls = 'strategic'), 0)
          / NULLIF(SUM(l.rev), 0), 4)::NUMERIC,
    COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'strategic'), 0)::NUMERIC,
    COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'baseline'),  0)::NUMERIC,
    (COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'strategic'), 0)
     + COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'baseline'), 0))::NUMERIC
  FROM lines l
  GROUP BY l.lym
  ORDER BY l.lym ASC;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 9. RPC: KPI live HÔM NAY (từ 0h giờ VN) — tab realtime
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_today(
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  branch_id         UUID,
  branch_name       TEXT,
  revenue_total     NUMERIC,
  revenue_strategic NUMERIC,
  revenue_baseline  NUMERIC,
  revenue_other     NUMERIC,
  strategic_share   NUMERIC,
  profit_strategic  NUMERIC,
  profit_baseline   NUMERIC,
  order_count       BIGINT,
  last_order_at     TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day_start TIMESTAMP;  -- 0h hôm nay theo giờ VN (local)
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược';
  END IF;

  v_day_start := date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh');

  RETURN QUERY
  WITH lines AS (
    SELECT v.branch_id AS bid, COALESCE(ps.class, 'other') AS cls,
           v.order_id AS oid, v.created_at AS cat, v.revenue AS rev, v.cogs AS cg
    FROM public.v_order_line_profit v
    LEFT JOIN public.product_strategy ps ON ps.product_id = v.product_id
    WHERE (v.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') >= v_day_start
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
  )
  SELECT
    l.bid,
    COALESCE(br.name, '(Chưa gán CN)'),
    SUM(l.rev)::NUMERIC,
    COALESCE(SUM(l.rev) FILTER (WHERE l.cls = 'strategic'), 0)::NUMERIC,
    COALESCE(SUM(l.rev) FILTER (WHERE l.cls = 'baseline'),  0)::NUMERIC,
    COALESCE(SUM(l.rev) FILTER (WHERE l.cls = 'other'),     0)::NUMERIC,
    ROUND(COALESCE(SUM(l.rev) FILTER (WHERE l.cls = 'strategic'), 0)
          / NULLIF(SUM(l.rev), 0), 4)::NUMERIC,
    COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'strategic'), 0)::NUMERIC,
    COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'baseline'),  0)::NUMERIC,
    COUNT(DISTINCT l.oid)::BIGINT,
    MAX(l.cat)
  FROM lines l
  LEFT JOIN public.branches br ON br.id = l.bid
  GROUP BY l.bid, br.name
  ORDER BY 3 DESC NULLS LAST;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 10. RPC: Đơn hàng mới nhất hôm nay kèm cơ cấu nhóm — tab realtime
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_today_orders(
  p_branch_id UUID    DEFAULT NULL,
  p_limit     INTEGER DEFAULT 20
)
RETURNS TABLE (
  order_id          UUID,
  order_code        TEXT,
  created_at        TIMESTAMPTZ,
  branch_name       TEXT,
  customer_name     TEXT,
  grand_total       NUMERIC,
  revenue_strategic NUMERIC,
  revenue_baseline  NUMERIC,
  status            TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day_start TIMESTAMP;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược';
  END IF;

  v_day_start := date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh');

  RETURN QUERY
  SELECT
    o.id,
    o.order_code,
    o.created_at,
    COALESCE(br.name, '(Chưa gán CN)'),
    COALESCE(c.farm_name, 'Khách lẻ'),
    o.grand_total::NUMERIC,
    COALESCE(SUM(v.revenue) FILTER (
      WHERE ps.class = 'strategic'), 0)::NUMERIC,
    COALESCE(SUM(v.revenue) FILTER (
      WHERE ps.class = 'baseline'), 0)::NUMERIC,
    o.status::TEXT
  FROM public.v_order_line_profit v
  JOIN public.orders o ON o.id = v.order_id
  LEFT JOIN public.product_strategy ps ON ps.product_id = v.product_id
  LEFT JOIN public.branches br ON br.id = o.branch_id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE (v.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') >= v_day_start
    AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
  GROUP BY o.id, o.order_code, o.created_at, br.name, c.farm_name, o.grand_total, o.status
  ORDER BY o.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 11. INDEX hỗ trợ (lọc đơn theo chi nhánh + thời gian)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_branch_created
  ON public.orders(branch_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 12. REALTIME: đảm bảo bảng orders nằm trong publication
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 13. GRANT/REVOKE (RPC tự enforce fn_has_role('admin') bên trong;
--     KHÔNG tạo view mới → không phát sinh lỗ hổng auto-GRANT)
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_strategic_summary(INT, INT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_products(INT, INT, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_suggestions(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_alerts(INT, INT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_trend(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_today(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_today_orders(UUID, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_strategic_summary(INT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_products(INT, INT, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_suggestions(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_alerts(INT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_trend(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_today(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_today_orders(UUID, INTEGER) TO authenticated;
