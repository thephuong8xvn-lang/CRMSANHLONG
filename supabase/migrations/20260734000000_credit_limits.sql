-- ============================================================
-- Migration: Công nợ B1 — Gợi ý & phủ hạn mức tín dụng hàng loạt
-- File: 20260734000000_credit_limits.sql
--
-- Bối cảnh (đo prod 2026-07-24): 1.933 KH active nhưng chỉ 133 (7%) có
--   credit_limit > 0. fn_pos_settle_payment CHẶN nợ khi outstanding+debt >
--   credit_limit → 93% KH (limit=0) bị chặn mọi giao dịch nợ. Cần công cụ
--   đề xuất hạn mức theo lịch sử mua + áp hàng loạt (admin duyệt).
--
-- Kiến trúc (theo [[customer_churn]] / [[strategic_products]]):
--   - fn_suggest_credit_limits(): SECURITY DEFINER, admin/ceo, REVOKE public.
--       suggested = round_up( doanh_số_90d/3 × factor, round_to ), clamp min/max.
--   - fn_bulk_set_credit_limits(jsonb): admin/ceo, cập nhật hàng loạt + audit.
--   - system_settings.credit_config: tham số công thức.
--
-- ⚠️ Apply remote qua Management API (KHÔNG db push). REVOKE tường minh.
-- ============================================================

-- ── 1. Cấu hình công thức ────────────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES (
  'credit_config',
  '{"months_factor":1.5,"round_to":500000,"min_limit":0,"max_limit":500000000}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Đề xuất hạn mức cho các KH có hoạt động ───────────────
-- Trả về KH có: doanh số 90d > 0 HOẶC đang nợ HOẶC đã có hạn mức
-- (bộ actionable — tránh trả hết 1.933 dòng). Frontend lọc/sửa tiếp.
CREATE OR REPLACE FUNCTION public.fn_suggest_credit_limits()
RETURNS TABLE (
  customer_id     uuid,
  code            text,
  farm_name       text,
  owner_user_id   uuid,
  owner_name      text,
  branch_id       uuid,
  current_limit   numeric,
  revenue_90d     numeric,
  avg_monthly     numeric,
  outstanding     numeric,
  n_orders_90d    integer,
  suggested_limit numeric,
  is_zero_limit   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factor   numeric;
  v_round    numeric;
  v_min      numeric;
  v_max      numeric;
BEGIN
  IF NOT (public.fn_is_admin() OR public.fn_has_role('ceo')) THEN
    RAISE EXCEPTION 'Chỉ quản trị viên được xem đề xuất hạn mức tín dụng' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE((value->>'months_factor')::numeric, 1.5),
    COALESCE(NULLIF((value->>'round_to')::numeric, 0), 500000),
    COALESCE((value->>'min_limit')::numeric, 0),
    COALESCE((value->>'max_limit')::numeric, 500000000)
  INTO v_factor, v_round, v_min, v_max
  FROM public.system_settings WHERE key = 'credit_config';

  v_factor := COALESCE(v_factor, 1.5);
  v_round  := COALESCE(v_round, 500000);
  v_min    := COALESCE(v_min, 0);
  v_max    := COALESCE(v_max, 500000000);

  RETURN QUERY
  WITH rev AS (
    SELECT o.customer_id,
           SUM(o.grand_total)          AS revenue_90d,
           COUNT(*)::int               AS n_orders_90d
    FROM public.orders o
    WHERE o.status IN ('confirmed','shipping','delivered','paid','completed')
      AND o.customer_id IS NOT NULL
      AND o.created_at > now() - interval '90 days'
    GROUP BY o.customer_id
  ),
  debt AS (
    SELECT d.customer_id, SUM(d.amount) AS outstanding
    FROM public.customer_debts d
    WHERE d.is_settled = false
    GROUP BY d.customer_id
  )
  SELECT
    c.id,
    c.code,
    c.farm_name,
    c.owner_user_id,
    pr.full_name,
    c.branch_id,
    COALESCE(c.credit_limit, 0)::numeric,
    COALESCE(r.revenue_90d, 0)::numeric,
    ROUND(COALESCE(r.revenue_90d, 0) / 3.0, 0)::numeric,
    COALESCE(dt.outstanding, 0)::numeric,
    COALESCE(r.n_orders_90d, 0),
    -- suggested = clamp( ceil( avg_monthly × factor / round_to ) × round_to )
    LEAST(v_max, GREATEST(v_min,
      CEIL( (COALESCE(r.revenue_90d, 0) / 3.0 * v_factor) / v_round ) * v_round
    ))::numeric,
    (COALESCE(c.credit_limit, 0) = 0) AS is_zero_limit
  FROM public.customers c
  LEFT JOIN rev  r  ON r.customer_id  = c.id
  LEFT JOIN debt dt ON dt.customer_id = c.id
  LEFT JOIN public.profiles pr ON pr.id = c.owner_user_id
  WHERE c.is_active = true
    AND (COALESCE(r.revenue_90d, 0) > 0
         OR COALESCE(dt.outstanding, 0) <> 0
         OR COALESCE(c.credit_limit, 0) > 0)
  ORDER BY COALESCE(r.revenue_90d, 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_suggest_credit_limits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_suggest_credit_limits() TO authenticated;

COMMENT ON FUNCTION public.fn_suggest_credit_limits() IS
  'Đề xuất hạn mức tín dụng theo doanh số 90d × factor (system_settings.credit_config). Admin/ceo, bỏ RLS.';

-- ── 3. Áp hạn mức hàng loạt (admin/ceo) + audit từng dòng ─────
-- p_pairs: jsonb array [{"customer_id":"...","credit_limit":N}, ...]
CREATE OR REPLACE FUNCTION public.fn_bulk_set_credit_limits(p_pairs jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   jsonb;
  v_cid   uuid;
  v_lim   numeric;
  v_old   numeric;
  v_count integer := 0;
BEGIN
  IF NOT (public.fn_is_admin() OR public.fn_has_role('ceo')) THEN
    RAISE EXCEPTION 'Chỉ quản trị viên được áp hạn mức tín dụng' USING ERRCODE = '42501';
  END IF;

  IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN
    RAISE EXCEPTION 'Dữ liệu không hợp lệ (cần mảng {customer_id, credit_limit}).' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_pairs)
  LOOP
    v_cid := (v_row->>'customer_id')::uuid;
    v_lim := (v_row->>'credit_limit')::numeric;

    IF v_cid IS NULL OR v_lim IS NULL OR v_lim < 0 THEN
      CONTINUE;  -- bỏ qua dòng lỗi, không làm hỏng cả lô
    END IF;

    SELECT credit_limit INTO v_old FROM public.customers WHERE id = v_cid FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF COALESCE(v_old, -1) = v_lim THEN CONTINUE; END IF;  -- không đổi → bỏ qua

    UPDATE public.customers
    SET credit_limit = v_lim, updated_at = now()
    WHERE id = v_cid;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      v_uid, 'UPDATE', 'customers', v_cid,
      jsonb_build_object('credit_limit', v_old),
      jsonb_build_object('credit_limit', v_lim, 'source', 'bulk_set_credit_limits')
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bulk_set_credit_limits(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bulk_set_credit_limits(jsonb) TO authenticated;

COMMENT ON FUNCTION public.fn_bulk_set_credit_limits(jsonb) IS
  'Áp hạn mức tín dụng hàng loạt [{customer_id,credit_limit}]. Admin/ceo, ghi audit từng dòng, trả số dòng đã đổi.';

NOTIFY pgrst, 'reload schema';
