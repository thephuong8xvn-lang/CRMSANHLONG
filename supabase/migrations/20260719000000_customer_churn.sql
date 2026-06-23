-- ============================================================
-- Migration: Churn-to-action — phân loại vòng đời KH theo nhịp mua + worklist
-- File: 20260719000000_customer_churn.sql
--
-- Mục tiêu (#4 backlog "Dự báo & hành động"):
--   Tính lifecycle_stage + churn_risk_score theo NHỊP MUA RIÊNG mỗi KH
--   (trễ gấp N lần khoảng cách mua trung bình → at_risk/churned) → biến
--   `churn_risk_score` (spec docs, CHƯA có trong DB) thành cột thật + danh
--   sách "Khách cần chăm sóc" cho NV.
--
-- Công thức: avg_interval = (last-first)/(n-1) ngày (n≥2); ratio =
--   days_since_last / avg_interval (n=1 dùng fallback config). lifecycle:
--   ratio≤1→active, ≤2→at_risk, >2→churned, n=0→new. score=clamp(ratio×50).
--
-- Kiến trúc (theo bài học #2 [[infra-verify-remote-schema]]): KHÔNG nhồi
--   tính nặng vào view security_invoker (timeout dưới RLS). Tách:
--     - fn_customer_churn_metrics() : helper NỘI BỘ (REVOKE all), tính live.
--     - fn_recompute_customer_lifecycle(): persist vào customers (admin/cron).
--     - fn_churn_worklist(): worklist scope theo vai trò (live, luôn tươi).
--   Tất cả SECURITY DEFINER (bỏ chi phí RLS) + guard quyền trong hàm.
--
-- ⚠️ Apply remote + NOTIFY pgrst reload + tracking. KHÔNG db push.
-- ============================================================

-- ── 1. Cột mới + config + index ─────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS churn_risk_score      SMALLINT,
  ADD COLUMN IF NOT EXISTS lifecycle_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.customers.churn_risk_score IS
  'Điểm rủi ro rời bỏ 0-100 (clamp(ratio×50)). Tính bởi fn_recompute_customer_lifecycle (nightly/admin).';

INSERT INTO public.system_settings (key, value)
VALUES (
  'churn_config',
  '{"at_risk_ratio":1.0,"churned_ratio":2.0,"fallback_interval_days":45}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Hỗ trợ gộp đơn theo KH cho tính nhịp mua.
CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON public.orders(customer_id, created_at);

-- ── 2. Helper NỘI BỘ: tính chỉ số churn live cho MỌI KH active ──
CREATE OR REPLACE FUNCTION public.fn_customer_churn_metrics()
RETURNS TABLE (
  customer_id       uuid,
  n_orders          integer,
  last_order_at     timestamptz,
  avg_interval_days numeric,
  days_since        numeric,
  ratio             numeric,
  lifecycle         customer_lifecycle_stage,
  churn_score       smallint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT
      COALESCE(MAX((value->>'at_risk_ratio')::numeric), 1.0)         AS at_risk_ratio,
      COALESCE(MAX((value->>'churned_ratio')::numeric), 2.0)         AS churned_ratio,
      COALESCE(MAX((value->>'fallback_interval_days')::numeric), 45) AS fallback_days
    FROM public.system_settings WHERE key = 'churn_config'
  ),
  ord AS (
    SELECT
      o.customer_id,
      count(*)::int      AS n_orders,
      max(o.created_at)  AS last_order_at,
      min(o.created_at)  AS first_order_at
    FROM public.orders o
    WHERE o.status IN ('confirmed','shipping','delivered','paid','completed')
      AND o.customer_id IS NOT NULL
    GROUP BY o.customer_id
  ),
  base AS (
    SELECT
      c.id AS customer_id,
      COALESCE(o.n_orders, 0) AS n_orders,
      o.last_order_at,
      CASE WHEN o.n_orders >= 2
        THEN GREATEST(1, EXTRACT(epoch FROM (o.last_order_at - o.first_order_at)) / 86400.0 / (o.n_orders - 1))
        ELSE NULL END AS avg_interval_days,
      CASE WHEN o.last_order_at IS NOT NULL
        THEN EXTRACT(epoch FROM (now() - o.last_order_at)) / 86400.0
        ELSE NULL END AS days_since
    FROM public.customers c
    LEFT JOIN ord o ON o.customer_id = c.id
    WHERE c.is_active = true
  ),
  rated AS (
    SELECT b.*, cfg.at_risk_ratio, cfg.churned_ratio, cfg.fallback_days,
      CASE
        WHEN b.n_orders = 0 THEN NULL
        WHEN b.n_orders >= 2 THEN b.days_since / b.avg_interval_days
        ELSE b.days_since / cfg.fallback_days
      END AS ratio
    FROM base b CROSS JOIN cfg
  )
  SELECT
    r.customer_id,
    r.n_orders,
    r.last_order_at,
    ROUND(r.avg_interval_days, 1),
    ROUND(r.days_since, 0),
    ROUND(r.ratio, 2),
    (CASE
      WHEN r.n_orders = 0      THEN 'new'
      WHEN r.ratio <= r.at_risk_ratio THEN 'active'
      WHEN r.ratio <= r.churned_ratio THEN 'at_risk'
      ELSE 'churned'
    END)::customer_lifecycle_stage,
    (CASE WHEN r.ratio IS NULL THEN 0
          ELSE LEAST(100, GREATEST(0, round(r.ratio * 50)))::int END)::smallint
  FROM rated r;
$$;

-- Helper chỉ dùng nội bộ bởi 2 RPC dưới → KHÔNG cho gọi trực tiếp.
REVOKE ALL ON FUNCTION public.fn_customer_churn_metrics() FROM PUBLIC, anon, authenticated;

-- ── 3. RPC persist (admin hoặc cron) ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recompute_customer_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  -- Admin qua app (auth.uid() != null) HOẶC cron/postgres (auth.uid() null).
  -- anon đã bị REVOKE EXECUTE → không vào được nhánh null.
  IF NOT (public.fn_is_admin() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Chỉ quản trị viên được tính lại phân loại khách hàng' USING ERRCODE = '42501';
  END IF;

  UPDATE public.customers c
  SET lifecycle_stage       = m.lifecycle,
      churn_risk_score      = m.churn_score,
      lifecycle_computed_at = now()
  FROM public.fn_customer_churn_metrics() m
  WHERE m.customer_id = c.id
    AND (c.lifecycle_stage IS DISTINCT FROM m.lifecycle
         OR c.churn_risk_score IS DISTINCT FROM m.churn_score
         OR c.lifecycle_computed_at IS NULL);

  SELECT jsonb_build_object(
    'computed_at', now(),
    'active',  count(*) FILTER (WHERE lifecycle_stage = 'active'),
    'at_risk', count(*) FILTER (WHERE lifecycle_stage = 'at_risk'),
    'churned', count(*) FILTER (WHERE lifecycle_stage = 'churned'),
    'new',     count(*) FILTER (WHERE lifecycle_stage = 'new')
  ) INTO v_result
  FROM public.customers WHERE is_active = true;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recompute_customer_lifecycle() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_recompute_customer_lifecycle() TO authenticated;

-- ── 4. RPC worklist "Khách cần chăm sóc" (scope theo vai trò) ──
CREATE OR REPLACE FUNCTION public.fn_churn_worklist(p_owner_id uuid DEFAULT NULL)
RETURNS TABLE (
  customer_id       uuid,
  code              text,
  farm_name         text,
  owner_user_id     uuid,
  owner_name        text,
  branch_id         uuid,
  lifecycle         customer_lifecycle_stage,
  churn_score       smallint,
  last_order_at     timestamptz,
  days_since        numeric,
  avg_interval_days numeric,
  n_orders          integer,
  total_debt        numeric,
  phone             text
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
    RAISE EXCEPTION 'Không có quyền xem danh sách chăm sóc' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.code, c.farm_name,
    c.owner_user_id, pr.full_name, c.branch_id,
    m.lifecycle, m.churn_score,
    m.last_order_at, m.days_since, m.avg_interval_days, m.n_orders,
    COALESCE((SELECT SUM(d.amount) FROM public.customer_debts d
              WHERE d.customer_id = c.id AND d.is_settled = false), 0)::numeric,
    (SELECT cc.phone FROM public.customer_contacts cc
     WHERE cc.customer_id = c.id AND cc.is_primary = true LIMIT 1)
  FROM public.fn_customer_churn_metrics() m
  JOIN public.customers c     ON c.id = m.customer_id
  LEFT JOIN public.profiles pr ON pr.id = c.owner_user_id
  WHERE c.is_active = true
    AND m.lifecycle IN ('at_risk','churned')
    AND (
      v_is_admin
      OR (v_is_bm AND c.branch_id = public.fn_my_branch_id())
      OR (v_is_tl AND c.team_id   = public.fn_my_team_id())
      OR (NOT v_is_admin AND NOT v_is_bm AND NOT v_is_tl AND c.owner_user_id = v_uid)
    )
    AND (p_owner_id IS NULL OR c.owner_user_id = p_owner_id)
  ORDER BY m.churn_score DESC, m.days_since DESC NULLS LAST
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_churn_worklist(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_churn_worklist(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_churn_worklist(uuid) IS
  'Danh sách KH at_risk/churned theo nhịp mua, scope theo vai trò (sales→của mình, team_lead→team, branch_manager→chi nhánh, admin→tất cả). Live, không phụ thuộc job nightly.';

-- ── 5. Lịch nightly (pg_cron) — 18:00 UTC = 01:00 VN ────────
DO $cron$
BEGIN
  PERFORM cron.unschedule('recompute_customer_lifecycle');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;

SELECT cron.schedule(
  'recompute_customer_lifecycle',
  '0 18 * * *',
  'SELECT public.fn_recompute_customer_lifecycle();'
);
