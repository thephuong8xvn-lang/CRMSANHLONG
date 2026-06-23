-- ============================================================
-- Migration: BI tương tác — Pivot đa chiều + ABC/XYZ + Cohort
-- File: 20260720000000_bi_analytics.sql
--
-- Mục tiêu (#1 backlog "Phân tích nâng cao/BI"): bổ sung tầng BI tương tác
-- trên fact v_order_line_profit (đã chuẩn COGS, REVOKED). 3 RPC admin-only
-- SECURITY DEFINER (khớp pattern báo cáo: fn_profit_*, fn_strategic_*):
--   1. fn_bi_pivot       — gộp theo 1 chiều (thời gian/SP/brand/nhóm/KH/CN/NV)
--                          × đo lường + so sánh kỳ (MoM/YoY) + lọc drill-down.
--   2. fn_bi_abc_xyz     — ABC (DT tích lũy 80/95) + XYZ (CV cầu theo tháng).
--   3. fn_bi_cohort      — retention theo cohort tháng mua đầu tiên.
--
-- Bảo mật: guard fn_has_role('admin') + REVOKE public/anon + GRANT
-- authenticated. KHÔNG nhồi tính vào view security_invoker (bài học #2:
-- timeout) — tính trong RPC DEFINER (bỏ chi phí RLS).
--
-- ⚠️ Apply remote + NOTIFY pgrst reload + tracking. KHÔNG db push.
-- ============================================================

-- ── 1. PIVOT đa chiều + so sánh kỳ + drill-down ─────────────
CREATE OR REPLACE FUNCTION public.fn_bi_pivot(
  p_from        timestamptz,
  p_to          timestamptz,
  p_dim         text,
  p_compare     text   DEFAULT 'none',   -- none | mom | yoy
  p_branch_id   uuid   DEFAULT NULL,
  p_customer_id uuid   DEFAULT NULL,
  p_product_id  uuid   DEFAULT NULL,
  p_brand_id    uuid   DEFAULT NULL,
  p_category_id uuid   DEFAULT NULL,
  p_owner_id    uuid   DEFAULT NULL
)
RETURNS TABLE (
  dim_key        text,
  dim_label      text,
  revenue        numeric,
  cogs           numeric,
  profit         numeric,
  margin         numeric,
  qty            numeric,
  order_count    bigint,
  customer_count bigint,
  prev_revenue   numeric,
  prev_profit    numeric,
  prev_qty       numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_pf timestamptz;
  v_pt timestamptz;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo BI' USING ERRCODE = '42501';
  END IF;
  IF p_dim NOT IN ('month','quarter','year','product','brand','category','customer','branch','salesperson') THEN
    RAISE EXCEPTION 'Chiều phân tích không hợp lệ: %', p_dim;
  END IF;

  IF p_compare = 'yoy' THEN
    v_pf := p_from - interval '1 year'; v_pt := p_to - interval '1 year';
  ELSIF p_compare = 'mom' THEN
    v_pf := p_from - (p_to - p_from); v_pt := p_from;
  ELSE
    v_pf := NULL; v_pt := NULL;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      v.created_at, v.revenue, v.cogs, v.quantity, v.order_id,
      v.customer_id, v.branch_id, v.product_id, v.brand_id,
      p.category_id, o.owner_user_id,
      p.name AS product_name, b.name AS brand_name, cat.name AS category_name,
      c.farm_name, br.name AS branch_name, pr.full_name AS owner_name,
      CASE WHEN v.created_at >= p_from AND v.created_at <= p_to THEN 1 ELSE 0 END AS in_cur,
      CASE WHEN v_pf IS NOT NULL AND v.created_at >= v_pf AND v.created_at <= v_pt THEN 1 ELSE 0 END AS in_prev
    FROM public.v_order_line_profit v
    JOIN public.orders o   ON o.id = v.order_id
    JOIN public.products p ON p.id = v.product_id
    LEFT JOIN public.brands b             ON b.id   = v.brand_id
    LEFT JOIN public.customers c          ON c.id   = v.customer_id
    LEFT JOIN public.branches br          ON br.id  = v.branch_id
    LEFT JOIN public.product_categories cat ON cat.id = p.category_id
    LEFT JOIN public.profiles pr          ON pr.id  = o.owner_user_id
    WHERE v.created_at >= COALESCE(v_pf, p_from) AND v.created_at <= p_to
      AND (p_branch_id   IS NULL OR v.branch_id   = p_branch_id)
      AND (p_customer_id IS NULL OR v.customer_id = p_customer_id)
      AND (p_product_id  IS NULL OR v.product_id  = p_product_id)
      AND (p_brand_id    IS NULL OR v.brand_id    = p_brand_id)
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (p_owner_id    IS NULL OR o.owner_user_id = p_owner_id)
  ),
  keyed AS (
    SELECT
      CASE p_dim
        WHEN 'month'       THEN to_char(created_at,'YYYY-MM')
        WHEN 'quarter'     THEN EXTRACT(year FROM created_at)::int::text || '-Q' || EXTRACT(quarter FROM created_at)::int::text
        WHEN 'year'        THEN EXTRACT(year FROM created_at)::int::text
        WHEN 'product'     THEN product_id::text
        WHEN 'brand'       THEN brand_id::text
        WHEN 'category'    THEN category_id::text
        WHEN 'customer'    THEN customer_id::text
        WHEN 'branch'      THEN branch_id::text
        WHEN 'salesperson' THEN owner_user_id::text
      END AS dim_key,
      CASE p_dim
        WHEN 'month'       THEN to_char(created_at,'MM/YYYY')
        WHEN 'quarter'     THEN 'Q' || EXTRACT(quarter FROM created_at)::int::text || '/' || EXTRACT(year FROM created_at)::int::text
        WHEN 'year'        THEN EXTRACT(year FROM created_at)::int::text
        WHEN 'product'     THEN product_name
        WHEN 'brand'       THEN COALESCE(brand_name,'(Không thương hiệu)')
        WHEN 'category'    THEN COALESCE(category_name,'(Không nhóm)')
        WHEN 'customer'    THEN COALESCE(farm_name,'(Khách lẻ)')
        WHEN 'branch'      THEN COALESCE(branch_name,'(Không chi nhánh)')
        WHEN 'salesperson' THEN COALESCE(owner_name,'(Không NV)')
      END AS dim_label,
      revenue, cogs, quantity, order_id, customer_id, in_cur, in_prev
    FROM base
  ),
  cur_agg AS (
    SELECT dim_key, max(dim_label) AS dim_label,
      SUM(revenue) AS revenue, SUM(cogs) AS cogs, SUM(revenue-cogs) AS profit,
      SUM(quantity) AS qty,
      COUNT(DISTINCT order_id) AS order_count,
      COUNT(DISTINCT customer_id) AS customer_count
    FROM keyed WHERE in_cur = 1 AND dim_key IS NOT NULL
    GROUP BY dim_key
  ),
  prev_agg AS (
    SELECT dim_key,
      SUM(revenue) AS prev_revenue, SUM(revenue-cogs) AS prev_profit, SUM(quantity) AS prev_qty
    FROM keyed WHERE in_prev = 1 AND dim_key IS NOT NULL
    GROUP BY dim_key
  )
  SELECT
    ca.dim_key, ca.dim_label,
    ca.revenue::numeric, ca.cogs::numeric, ca.profit::numeric,
    CASE WHEN ca.revenue > 0 THEN ROUND(ca.profit/ca.revenue*100,2) ELSE 0 END::numeric,
    ca.qty::numeric, ca.order_count, ca.customer_count,
    COALESCE(pa.prev_revenue,0)::numeric, COALESCE(pa.prev_profit,0)::numeric, COALESCE(pa.prev_qty,0)::numeric
  FROM cur_agg ca
  LEFT JOIN prev_agg pa USING (dim_key)
  ORDER BY ca.revenue DESC NULLS LAST
  LIMIT 1000;
END;
$$;

-- ── 2. ABC / XYZ ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_abc_xyz(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  product_id  uuid,
  sku         text,
  name        text,
  revenue     numeric,
  qty         numeric,
  rev_share   numeric,
  cum_share   numeric,
  abc_class   text,
  cv          numeric,
  xyz_class   text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo BI' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH win AS (
    SELECT v.product_id, v.revenue, v.quantity, date_trunc('month', v.created_at) AS m
    FROM public.v_order_line_profit v
    WHERE v.created_at >= p_from AND v.created_at <= p_to
  ),
  tot AS (SELECT NULLIF(SUM(revenue),0) AS total FROM win),
  prod AS (
    SELECT product_id, SUM(revenue) AS rev, SUM(quantity) AS qty
    FROM win GROUP BY product_id
  ),
  monthly AS (
    SELECT product_id, m, SUM(revenue) AS rev FROM win GROUP BY product_id, m
  ),
  months AS (
    SELECT generate_series(date_trunc('month',p_from), date_trunc('month',p_to), interval '1 month') AS m
  ),
  cvtab AS (
    SELECT z.product_id,
      CASE WHEN avg(z.rev) > 0 THEN stddev_samp(z.rev)/avg(z.rev) ELSE NULL END AS cv
    FROM (
      SELECT pr.product_id, mo.m, COALESCE(mm.rev,0) AS rev
      FROM (SELECT DISTINCT product_id FROM monthly) pr
      CROSS JOIN months mo
      LEFT JOIN monthly mm ON mm.product_id = pr.product_id AND mm.m = mo.m
    ) z
    GROUP BY z.product_id
  ),
  ranked AS (
    SELECT p.product_id, p.rev, p.qty,
      p.rev / (SELECT total FROM tot) AS rev_share,
      SUM(p.rev) OVER (ORDER BY p.rev DESC, p.product_id) / (SELECT total FROM tot) AS cum_share
    FROM prod p
  )
  SELECT
    r.product_id, pr.sku, pr.name,
    r.rev::numeric, r.qty::numeric,
    ROUND(COALESCE(r.rev_share,0)*100,2)::numeric,
    ROUND(COALESCE(r.cum_share,0)*100,2)::numeric,
    CASE WHEN r.cum_share <= 0.8 THEN 'A' WHEN r.cum_share <= 0.95 THEN 'B' ELSE 'C' END,
    ROUND(cv.cv,2)::numeric,
    CASE WHEN cv.cv IS NULL THEN 'Z' WHEN cv.cv <= 0.5 THEN 'X' WHEN cv.cv <= 1.0 THEN 'Y' ELSE 'Z' END
  FROM ranked r
  JOIN public.products pr ON pr.id = r.product_id
  LEFT JOIN cvtab cv ON cv.product_id = r.product_id
  ORDER BY r.rev DESC NULLS LAST
  LIMIT 1000;
END;
$$;

-- ── 3. COHORT retention (theo tháng mua đầu tiên) ───────────
CREATE OR REPLACE FUNCTION public.fn_bi_cohort(
  p_months integer DEFAULT 12
)
RETURNS TABLE (
  cohort_month  date,
  cohort_size   bigint,
  month_offset  integer,
  active        bigint,
  retention_pct numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer := LEAST(GREATEST(p_months, 1), 24);
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo BI' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH first_ord AS (
    SELECT v.customer_id, date_trunc('month', min(v.created_at)) AS cohort_m
    FROM public.v_order_line_profit v
    WHERE v.customer_id IS NOT NULL
    GROUP BY v.customer_id
  ),
  cohorts AS (
    SELECT customer_id, cohort_m
    FROM first_ord
    WHERE cohort_m >= date_trunc('month', now()) - make_interval(months => v_n - 1)
  ),
  activity AS (
    SELECT DISTINCT v.customer_id, date_trunc('month', v.created_at) AS active_m
    FROM public.v_order_line_profit v
    WHERE v.customer_id IS NOT NULL
  ),
  joined AS (
    SELECT co.cohort_m, co.customer_id,
      ((EXTRACT(year FROM age(a.active_m, co.cohort_m)) * 12)
        + EXTRACT(month FROM age(a.active_m, co.cohort_m)))::int AS offset_m
    FROM cohorts co
    JOIN activity a ON a.customer_id = co.customer_id AND a.active_m >= co.cohort_m
  ),
  sizes AS (SELECT cohort_m, COUNT(DISTINCT customer_id) AS sz FROM cohorts GROUP BY cohort_m)
  SELECT
    j.cohort_m::date,
    s.sz,
    j.offset_m,
    COUNT(DISTINCT j.customer_id)::bigint,
    ROUND(COUNT(DISTINCT j.customer_id)::numeric / NULLIF(s.sz,0) * 100, 1)
  FROM joined j
  JOIN sizes s ON s.cohort_m = j.cohort_m
  WHERE j.offset_m >= 0 AND j.offset_m < v_n
  GROUP BY j.cohort_m, s.sz, j.offset_m
  ORDER BY j.cohort_m, j.offset_m;
END;
$$;

-- ── Grants (RPC tự guard admin) ─────────────────────────────
REVOKE ALL ON FUNCTION public.fn_bi_pivot(timestamptz,timestamptz,text,text,uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_abc_xyz(timestamptz,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_cohort(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_pivot(timestamptz,timestamptz,text,text,uuid,uuid,uuid,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_abc_xyz(timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_cohort(integer) TO authenticated;
