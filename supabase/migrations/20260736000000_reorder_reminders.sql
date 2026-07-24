-- ============================================================
-- Migration: Nhắc mua lại C1 — dự đoán chu kỳ mua theo (Khách × Sản phẩm)
-- File: 20260736000000_reorder_reminders.sql
--
-- Bối cảnh: đã có nhịp mua theo TỪNG KHÁCH (fn_churn_worklist). Thiếu mảnh
--   "KH nào tới kỳ mua lại SP nào" — biến lịch sử mua thành worklist chào đơn
--   chủ động. Nguồn: order_lines + orders (confirmed+). 323 cặp (KH,SP) mua ≥3
--   lần (đo 2026-07-24).
--
-- Công thức mỗi (KH,SP): avg_interval = (last-first)/(n-1) ngày (n≥3);
--   days_since = today - last; due khi days_since ≥ 0.9×avg_interval;
--   predicted_next = last + avg_interval. Xếp theo mức trễ giảm dần.
--
-- Kiến trúc theo fn_churn_worklist (20260719000000:166): SECURITY DEFINER,
--   scope theo vai trò, guard trong hàm, REVOKE public.
--
-- ⚠️ Apply remote qua Management API. REVOKE tường minh.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_reorder_reminders(p_owner_id uuid DEFAULT NULL)
RETURNS TABLE (
  customer_id       uuid,
  code              text,
  farm_name         text,
  owner_user_id     uuid,
  owner_name        text,
  branch_id         uuid,
  phone             text,
  product_id        uuid,
  product_name      text,
  unit              text,
  n_buys            integer,
  avg_interval_days numeric,
  last_bought_at    timestamptz,
  last_qty          numeric,
  days_since        numeric,
  predicted_next    date,
  overdue_ratio     numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid      uuid    := auth.uid();
  v_is_admin boolean := public.fn_is_admin() OR public.fn_has_role('ceo');
  v_is_bm    boolean := public.fn_has_role('branch_manager');
  v_is_tl    boolean := public.fn_has_role('team_lead');
BEGIN
  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Không có quyền xem danh sách nhắc mua lại' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH pair AS (
    SELECT
      o.customer_id,
      ol.product_id,
      count(DISTINCT o.id)::int AS n_buys,
      min(o.created_at)         AS first_at,
      max(o.created_at)         AS last_at
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('confirmed','shipping','delivered','paid','completed')
      AND o.customer_id IS NOT NULL
    GROUP BY o.customer_id, ol.product_id
    HAVING count(DISTINCT o.id) >= 3
  ),
  last_line AS (
    SELECT DISTINCT ON (o.customer_id, ol.product_id)
      o.customer_id, ol.product_id, ol.quantity AS last_qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('confirmed','shipping','delivered','paid','completed')
      AND o.customer_id IS NOT NULL
    ORDER BY o.customer_id, ol.product_id, o.created_at DESC
  ),
  calc AS (
    SELECT
      p.customer_id, p.product_id, p.n_buys, p.last_at,
      EXTRACT(epoch FROM (p.last_at - p.first_at)) / 86400.0               AS span_days,
      EXTRACT(epoch FROM (p.last_at - p.first_at)) / 86400.0 / (p.n_buys - 1) AS avg_interval,
      EXTRACT(epoch FROM (now() - p.last_at)) / 86400.0                    AS days_since
    FROM pair p
  )
  SELECT
    c.id, c.code, c.farm_name,
    c.owner_user_id, pr.full_name, c.branch_id,
    (SELECT cc.phone FROM public.customer_contacts cc
     WHERE cc.customer_id = c.id AND cc.is_primary = true LIMIT 1),
    pd.id, pd.name, pd.unit,
    ca.n_buys,
    ROUND(ca.avg_interval, 1),
    ca.last_at,
    ll.last_qty,
    ROUND(ca.days_since, 0),
    (ca.last_at + (ca.avg_interval || ' days')::interval)::date,
    ROUND(ca.days_since / ca.avg_interval, 2)
  FROM calc ca
  JOIN public.customers c  ON c.id  = ca.customer_id
  JOIN public.products  pd ON pd.id = ca.product_id
  LEFT JOIN last_line ll ON ll.customer_id = ca.customer_id AND ll.product_id = ca.product_id
  LEFT JOIN public.profiles pr ON pr.id = c.owner_user_id
  WHERE c.is_active = true
    AND pd.is_active = true
    AND ca.span_days >= 21                        -- lịch sử đủ trải để nhịp có nghĩa
    AND ca.avg_interval BETWEEN 7 AND 120         -- loại mua dồn cùng lượt (<7n) & chu kỳ quá dài
    AND ca.days_since >= ca.avg_interval * 0.9   -- tới kỳ hoặc trễ
    AND (
      v_is_admin
      OR (v_is_bm AND c.branch_id = public.fn_my_branch_id())
      OR (v_is_tl AND c.team_id   = public.fn_my_team_id())
      OR (NOT v_is_admin AND NOT v_is_bm AND NOT v_is_tl AND c.owner_user_id = v_uid)
    )
    AND (p_owner_id IS NULL OR c.owner_user_id = p_owner_id)
  ORDER BY ca.days_since / ca.avg_interval DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reorder_reminders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reorder_reminders(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_reorder_reminders(uuid) IS
  'Danh sách (KH,SP) tới kỳ mua lại theo nhịp mua riêng (n≥3). Scope theo vai trò như fn_churn_worklist. Live.';

NOTIFY pgrst, 'reload schema';
