-- ============================================================
-- Migration: Dự báo nhu cầu — RPC cấp dữ liệu lịch sử cầu theo tuần
-- File: 20260721000000_demand_history.sql
--
-- Mục tiêu (tầng cao nhất backlog "Phân tích nâng cao"): cung cấp chuỗi
-- cầu THEO TUẦN (zero-fill) cho mỗi SKU có bán, để engine dự báo ở
-- frontend (src/lib/forecast.ts) chạy Exponential Smoothing (cầu đều) +
-- Croston/SBA (cầu rời rạc) — đúng phương pháp cho hàng thú y bán dồn.
--
-- VÌ SAO tính ở FE, DB chỉ cấp dữ liệu:
--   - SES/Croston là đệ quy theo thời gian → rắc rối + khó test trong SQL.
--   - Logic thống kê nằm ở module TS THUẦN, có unit test (pattern cartUtils),
--     đổi horizon/alpha tính lại tức thì, minh bạch.
--   - DB chỉ trả ma trận (product × tuần) gọn (≈ SKU-có-bán × p_weeks).
--
-- Bảo mật: admin-only (khớp khu Báo cáo) — guard fn_has_role('admin') +
--   SECURITY DEFINER (bỏ chi phí RLS) + REVOKE public/anon. KHÔNG nhồi tính
--   vào view security_invoker (bài học timeout 20260717→20260718).
--
-- ⚠️ Apply remote + NOTIFY pgrst reload + tracking. KHÔNG db push.
-- ============================================================

-- ── Cấu hình dự báo (FE đọc để khởi tạo, admin chỉnh sau nếu cần) ──
INSERT INTO public.system_settings (key, value)
VALUES (
  'forecast_config',
  jsonb_build_object(
    'alpha', 0.3,                 -- hệ số làm mượt (SES/Croston)
    'default_horizon_weeks', 4,   -- số tuần dự báo mặc định
    'history_weeks', 26,          -- cửa sổ lịch sử lấy về
    'conf_low_weeks', 8,          -- < ngưỡng này → độ tin cậy THẤP
    'conf_high_weeks', 16,        -- >= ngưỡng này (đủ điều kiện) → CAO
    'conf_min_demand_weeks', 3    -- số tuần có cầu tối thiểu để vượt mức THẤP
  )
)
ON CONFLICT (key) DO NOTHING;

-- ── RPC: lịch sử cầu theo tuần (zero-fill) cho SKU có bán ─────
CREATE OR REPLACE FUNCTION public.fn_demand_history(p_weeks integer DEFAULT 26)
RETURNS TABLE (
  product_id    uuid,
  sku           text,
  name          text,
  unit          text,
  stock_on_hand numeric,
  week_start    date,
  qty           numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_n integer := LEAST(GREATEST(COALESCE(p_weeks, 26), 4), 104);
BEGIN
  -- Admin-only (báo cáo phân tích nâng cao) — khớp pattern BI.
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập dự báo nhu cầu' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH weekly AS (
    -- cầu thực theo tuần (chỉ đơn đã chốt), trong cửa sổ v_n tuần gần nhất
    SELECT
      ol.product_id AS pid,
      date_trunc('week', o.created_at)::date AS wk,
      SUM(ol.quantity) AS qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('confirmed','shipping','delivered','paid','completed')
      AND o.created_at >= date_trunc('week', now()) - make_interval(weeks => v_n - 1)
    GROUP BY ol.product_id, date_trunc('week', o.created_at)::date
  ),
  sold_products AS (
    SELECT DISTINCT pid FROM weekly       -- chỉ SKU có cầu trong cửa sổ
  ),
  stock AS (
    SELECT s.product_id AS pid, COALESCE(SUM(s.quantity_on_hand), 0) AS soh
    FROM public.stock_lots s
    WHERE s.status = 'active'
    GROUP BY s.product_id
  ),
  weeks AS (
    SELECT generate_series(
      date_trunc('week', now()) - make_interval(weeks => v_n - 1),
      date_trunc('week', now()),
      interval '1 week'
    )::date AS wk
  )
  SELECT
    p.id,
    p.sku,
    p.name,
    p.unit,
    COALESCE(st.soh, 0)::numeric,
    w.wk,
    COALESCE(wd.qty, 0)::numeric
  FROM sold_products sp
  JOIN public.products p ON p.id = sp.pid AND p.is_active = true
  CROSS JOIN weeks w
  LEFT JOIN weekly wd ON wd.pid = sp.pid AND wd.wk = w.wk
  LEFT JOIN stock  st ON st.pid = sp.pid
  ORDER BY p.name, w.wk;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_demand_history(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demand_history(integer) TO authenticated;

COMMENT ON FUNCTION public.fn_demand_history(integer) IS
  'Chuỗi cầu theo tuần (zero-fill) mỗi SKU có bán, cửa sổ p_weeks tuần (4..104). Engine dự báo (forecast.ts) chạy SES/Croston ở frontend. SECURITY DEFINER + admin-only.';

NOTIFY pgrst, 'reload schema';
