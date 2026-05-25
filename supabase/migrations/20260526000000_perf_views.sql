-- ============================================================
-- CRM SANHLONGVETCO – PERFORMANCE VIEWS & RPC (Sprint P1)
-- File: 20260526000000_perf_views.sql
-- Mô tả: View tổng hợp và RPC để giảm round-trip + bỏ N+1 ở client.
--        Mọi view dùng security_invoker = true để giữ RLS chuẩn.
--        Mọi RPC dùng SECURITY INVOKER (mặc định) để tôn trọng RLS.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. customer_summary_view
--    Mục đích: trang Danh sách khách hàng cần tổng nợ + cờ quá hạn
--    + ngày mua cuối + primary contact. Trước đây phải JOIN 4 bảng
--    với client side aggregation cho mọi customer. View này gộp ở
--    Postgres → 1 query duy nhất paginate qua .range().
-- ─────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.customer_summary_view;
CREATE VIEW public.customer_summary_view
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.code,
  c.customer_type,
  c.farm_name,
  c.value_tier,
  c.lifecycle_stage,
  c.province,
  c.district,
  c.address,
  c.credit_limit,
  c.owner_user_id,
  c.is_active,
  c.created_at,
  c.updated_at,
  -- Tổng nợ chưa thanh toán (dương = khách nợ; âm = công ty nợ khách)
  COALESCE((
    SELECT SUM(d.amount)
    FROM public.customer_debts d
    WHERE d.customer_id = c.id AND d.is_settled = false
  ), 0)::NUMERIC(15,2) AS total_debt,
  -- Cờ quá hạn: có ít nhất 1 debt chưa thanh toán và due_date < hôm nay
  EXISTS (
    SELECT 1
    FROM public.customer_debts d
    WHERE d.customer_id = c.id
      AND d.is_settled = false
      AND d.due_date IS NOT NULL
      AND d.due_date < CURRENT_DATE
  ) AS is_overdue,
  -- Ngày mua hàng gần nhất
  (
    SELECT MAX(o.created_at)
    FROM public.orders o
    WHERE o.customer_id = c.id
  ) AS last_order_at,
  -- Tổng số đơn (tham khảo, không bắt buộc dùng UI)
  (
    SELECT COUNT(*)
    FROM public.orders o
    WHERE o.customer_id = c.id
  )::INTEGER AS orders_count,
  -- Primary contact
  (
    SELECT jsonb_build_object(
      'full_name', cc.full_name,
      'phone', cc.phone,
      'role_at_farm', cc.role_at_farm
    )
    FROM public.customer_contacts cc
    WHERE cc.customer_id = c.id AND cc.is_primary = true
    LIMIT 1
  ) AS primary_contact
FROM public.customers c;

COMMENT ON VIEW public.customer_summary_view IS
'Tổng hợp khách hàng + nợ + ngày mua gần nhất + liên hệ chính. Dùng cho trang Danh sách khách hàng.';

-- ─────────────────────────────────────────────────────────────
-- 2. product_stock_summary_view
--    Mục đích: trang Danh sách sản phẩm cần tồn kho hiện tại
--    + khách đặt + ngày dự kiến hết hàng + giá lẻ + giá vốn.
--    Trước đây phải JOIN price_list_items, stock_lots, order_lines,
--    orders ở client. View này tính ở Postgres.
-- ─────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.product_stock_summary_view;
CREATE VIEW public.product_stock_summary_view
WITH (security_invoker = true) AS
WITH
  retail_price AS (
    SELECT
      pli.product_id,
      pli.selling_price,
      pli.cost_price
    FROM public.price_list_items pli
    JOIN public.price_lists pl ON pl.id = pli.price_list_id
    WHERE pl.code = 'GIA-LE'
  ),
  fallback_price AS (
    SELECT DISTINCT ON (pli.product_id)
      pli.product_id,
      pli.selling_price,
      pli.cost_price
    FROM public.price_list_items pli
    ORDER BY pli.product_id, pli.created_at ASC
  ),
  stock_agg AS (
    SELECT
      product_id,
      COALESCE(SUM(quantity_on_hand), 0)::INTEGER AS stock_on_hand
    FROM public.stock_lots
    WHERE quantity_on_hand > 0
    GROUP BY product_id
  ),
  on_order_agg AS (
    SELECT
      ol.product_id,
      COALESCE(SUM(ol.quantity), 0)::INTEGER AS on_order_qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('confirmed', 'shipping')
    GROUP BY ol.product_id
  ),
  sales_30d AS (
    -- Số lượng đã bán trong 30 ngày gần nhất (orders status hoàn thành/đã giao/đã thanh toán)
    SELECT
      ol.product_id,
      COALESCE(SUM(ol.quantity), 0)::INTEGER AS qty_30d
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('delivered', 'paid', 'completed')
      AND o.created_at >= (now() - INTERVAL '30 days')
    GROUP BY ol.product_id
  )
SELECT
  p.id,
  p.sku,
  p.name,
  p.unit,
  p.is_lot_managed,
  p.is_active,
  p.category_id,
  p.brand_id,
  p.package_specs,
  p.image_urls,
  p.created_at,
  p.updated_at,
  pc.name AS category_name,
  pc.code AS category_code,
  b.name  AS brand_name,
  COALESCE(rp.selling_price, fp.selling_price, 0)::NUMERIC(15,2) AS retail_price,
  COALESCE(rp.cost_price,    fp.cost_price,    0)::NUMERIC(15,2) AS retail_cost,
  COALESCE(s.stock_on_hand, 0)            AS stock_on_hand,
  COALESCE(oo.on_order_qty, 0)            AS on_order_qty,
  COALESCE(s30.qty_30d, 0)                AS sold_30d,
  -- Số ngày dự kiến hết hàng (NULL nếu chưa đủ dữ liệu)
  CASE
    WHEN COALESCE(s30.qty_30d, 0) > 0 AND COALESCE(s.stock_on_hand, 0) > 0
      THEN ROUND(COALESCE(s.stock_on_hand, 0)::NUMERIC / (s30.qty_30d::NUMERIC / 30.0))::INTEGER
    WHEN COALESCE(s.stock_on_hand, 0) = 0 THEN 0
    ELSE NULL
  END AS days_to_oos
FROM public.products p
LEFT JOIN public.product_categories pc ON pc.id = p.category_id
LEFT JOIN public.brands b              ON b.id = p.brand_id
LEFT JOIN retail_price   rp ON rp.product_id = p.id
LEFT JOIN fallback_price fp ON fp.product_id = p.id
LEFT JOIN stock_agg      s  ON s.product_id  = p.id
LEFT JOIN on_order_agg   oo ON oo.product_id = p.id
LEFT JOIN sales_30d      s30 ON s30.product_id = p.id;

COMMENT ON VIEW public.product_stock_summary_view IS
'Tổng hợp sản phẩm + giá lẻ + tồn kho live + khách đặt + ngày dự kiến hết hàng. Dùng cho trang Danh sách sản phẩm.';

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: get_dashboard_stats()
--    Mục đích: trang Dashboard cần 6 nhóm số liệu cùng lúc.
--    Gộp thành 1 RPC trả về JSON → 1 round-trip (thay vì 5–7).
-- ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_dashboard_stats();
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_start    DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_last_start     DATE := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::DATE;
  v_today          DATE := CURRENT_DATE;
  v_expiry_limit   DATE := CURRENT_DATE + INTERVAL '30 days';
  v_six_months_ago DATE := (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')::DATE;
  v_monthly        NUMERIC(15,2);
  v_last_month     NUMERIC(15,2);
  v_overdue        NUMERIC(15,2);
  v_overdue_cnt    INTEGER;
  v_expiring_cnt   INTEGER;
  v_cashflow       JSONB;
BEGIN
  -- 1. Doanh thu tháng này
  SELECT COALESCE(SUM(grand_total), 0) INTO v_monthly
  FROM public.orders
  WHERE status <> 'cancelled' AND created_at >= v_month_start;

  -- 2. Doanh thu tháng trước
  SELECT COALESCE(SUM(grand_total), 0) INTO v_last_month
  FROM public.orders
  WHERE status <> 'cancelled'
    AND created_at >= v_last_start
    AND created_at <  v_month_start;

  -- 3. Tổng nợ quá hạn + số khoản
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
    INTO v_overdue, v_overdue_cnt
  FROM public.customer_debts
  WHERE is_settled = false
    AND due_date IS NOT NULL
    AND due_date < v_today;

  -- 4. Số lô sắp hết hạn (0–30 ngày)
  SELECT COUNT(*) INTO v_expiring_cnt
  FROM public.stock_lots
  WHERE quantity_on_hand > 0
    AND expiry_date IS NOT NULL
    AND expiry_date >= v_today
    AND expiry_date <= v_expiry_limit;

  -- 5. Dòng tiền 6 tháng gần nhất (gồm tháng hiện tại)
  WITH months AS (
    SELECT generate_series(
      v_six_months_ago,
      date_trunc('month', CURRENT_DATE)::DATE,
      INTERVAL '1 month'
    )::DATE AS month_start
  ),
  flows AS (
    SELECT
      date_trunc('month', t.transaction_date)::DATE AS month_start,
      t.flow_type,
      SUM(t.amount) AS total
    FROM public.cashbook_transactions t
    WHERE t.status = 'approved'
      AND t.transaction_date >= v_six_months_ago
    GROUP BY 1, 2
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', to_char(m.month_start, 'YYYY-MM-DD'),
      'name',  'Tháng ' || EXTRACT(MONTH FROM m.month_start)::INT,
      'inflow',  COALESCE((SELECT total FROM flows f WHERE f.month_start = m.month_start AND f.flow_type = 'inflow'),  0),
      'outflow', COALESCE((SELECT total FROM flows f WHERE f.month_start = m.month_start AND f.flow_type = 'outflow'), 0)
    )
    ORDER BY m.month_start
  ), '[]'::jsonb)
  INTO v_cashflow
  FROM months m;

  RETURN jsonb_build_object(
    'monthly_revenue',       v_monthly,
    'last_month_revenue',    v_last_month,
    'monthly_revenue_delta', CASE
                               WHEN v_last_month > 0
                                 THEN ROUND(((v_monthly - v_last_month) / v_last_month) * 100, 1)
                               WHEN v_monthly > 0 THEN 100
                               ELSE 0
                             END,
    'overdue_debt',          v_overdue,
    'overdue_debt_count',    v_overdue_cnt,
    'expiring_lots_count',   v_expiring_cnt,
    'cashflow_6m',           v_cashflow
  );
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_stats() IS
'Trả về số liệu Dashboard gộp: doanh thu tháng + delta MoM, nợ quá hạn, lô sắp hết hạn, dòng tiền 6 tháng. Tôn trọng RLS qua SECURITY INVOKER.';

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: get_user_role_and_permissions(p_user_id)
--    Mục đích: AuthContext load 1 lần khi login thay vì Layout
--    fetch lại mỗi page navigation. RLS sẵn cho user_roles theo
--    auth.uid() nên không cần param thực tế, nhưng tham số giúp
--    test dễ hơn.
-- ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_user_role_and_permissions(UUID);
CREATE OR REPLACE FUNCTION public.get_user_role_and_permissions(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   JSONB;
  v_perms  JSONB;
BEGIN
  -- Lấy role đầu tiên (1 user thường có 1 role chính)
  SELECT to_jsonb(r) INTO v_role
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = p_user_id
  LIMIT 1;

  -- Lấy danh sách permission codes (distinct, vì 1 user có thể có nhiều role)
  SELECT COALESCE(jsonb_agg(DISTINCT pm.code ORDER BY pm.code), '[]'::jsonb) INTO v_perms
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions pm     ON pm.id = rp.permission_id
  WHERE ur.user_id = p_user_id;

  RETURN jsonb_build_object(
    'role',         COALESCE(v_role, jsonb_build_object('code', 'guest', 'name', 'Khách')),
    'permissions',  COALESCE(v_perms, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_user_role_and_permissions(UUID) IS
'Trả về role + danh sách permission codes của user. Dùng cho AuthContext load 1 lần khi login.';

-- ─────────────────────────────────────────────────────────────
-- 5. Quyền truy cập (grants)
-- ─────────────────────────────────────────────────────────────
GRANT SELECT ON public.customer_summary_view      TO authenticated;
GRANT SELECT ON public.product_stock_summary_view TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats()                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role_and_permissions(UUID)                TO authenticated;
