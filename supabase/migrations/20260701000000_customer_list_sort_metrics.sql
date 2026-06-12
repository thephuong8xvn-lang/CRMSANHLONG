-- ============================================================
-- CRM SANHLONGVETCO – CUSTOMER LIST SORT METRICS
-- File: 20260629000000_customer_list_sort_metrics.sql
-- Mô tả: Bổ sung 2 cột tính toán cho customer_summary_view phục vụ
--        trang Danh sách khách hàng (sort server-side qua .order()):
--          • debt_age_days     – tuổi nợ: số ngày từ khoản nợ CHƯA
--                                thanh toán cũ nhất đến hôm nay.
--          • orders_per_month  – tần suất mua: số đơn 90 ngày gần
--                                nhất / 3 (không tính đơn hủy).
--        Kèm partial index customer_debts(customer_id) WHERE
--        is_settled = false (bảng này chưa có index theo customer_id).
--        View giữ security_invoker = true → tôn trọng RLS như cũ.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Index còn thiếu cho subquery tính nợ theo khách hàng
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customer_debts_customer_unsettled
  ON public.customer_debts(customer_id)
  WHERE is_settled = false;

-- ─────────────────────────────────────────────────────────────
-- 2. Recreate customer_summary_view (giữ nguyên cột cũ + 2 cột mới)
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
  -- Tuổi nợ: số ngày từ khoản nợ CHƯA thanh toán cũ nhất (amount > 0,
  -- không tính khách trả trước). NULL nếu không có nợ.
  (
    SELECT (CURRENT_DATE - MIN(d.created_at)::date)
    FROM public.customer_debts d
    WHERE d.customer_id = c.id
      AND d.is_settled = false
      AND d.amount > 0
  )::INTEGER AS debt_age_days,
  -- Tần suất mua: số đơn trong 90 ngày gần nhất / 3 (loại đơn hủy)
  ROUND((
    SELECT COUNT(*)
    FROM public.orders o
    WHERE o.customer_id = c.id
      AND o.status <> 'cancelled'
      AND o.created_at >= now() - INTERVAL '90 days'
  )::NUMERIC / 3.0, 1) AS orders_per_month,
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
'Tổng hợp khách hàng + nợ + tuổi nợ + tần suất mua (90d/3) + ngày mua gần nhất + liên hệ chính. Dùng cho trang Danh sách khách hàng.';

-- ─────────────────────────────────────────────────────────────
-- 3. Grant lại (DROP VIEW làm mất grant cũ)
-- ─────────────────────────────────────────────────────────────
GRANT SELECT ON public.customer_summary_view TO authenticated;
