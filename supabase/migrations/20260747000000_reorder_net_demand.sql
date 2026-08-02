-- ============================================================
-- Migration: Gợi ý đặt hàng dùng CẦU RÒNG — khớp số với Báo cáo giá vốn
-- File: 20260747000000_reorder_net_demand.sql
--
-- BỐI CẢNH: sau 20260746, Báo cáo Kho hàng theo Giá vốn tính cầu từ
--   stock_movements và TRỪ hàng khách trả. fn_reorder_planning vẫn tính từ
--   order_lines + orders.status và KHÔNG trừ hàng trả → cùng 1 sản phẩm, hai
--   màn hình cho hai tốc độ bán khác nhau, nhân viên không giải thích được.
--
-- ĐO TRƯỚC KHI SỬA (dữ liệu thật 2026-08-02, 475 SP):
--   • 178 SP lệch giữa 2 định nghĩa; 108 SP lệch ≥10%; 53 SP lệch ≥25%
--   • Tổng cầu 90 ngày: 41.369 → 39.160 (−5,34%)
--   • Chỉ 3 SP đảo trạng thái "đủ bán còn ≤14 ngày" → quyết định đặt hàng
--     gần như không đổi, chủ yếu là chỉnh cho hai màn hình nhất quán.
--   • Phần lệch KHÔNG phải do hết hàng xuất thiếu (0 dòng xuất thiếu) mà do
--     29 đơn đầu vận hành (29/05–07/06) không hề sinh stock_movement.
--     30 ngày gần nhất: 0 đơn lỗi → sổ movement nay đã đủ tin cậy.
--     Các đơn lỗi đó tự rời cửa sổ 90 ngày vào đầu 09/2026.
--
-- SỬA:
--   (1) Cầu = Σ(-quantity) trên movement_type IN ('sale','return_from_customer')
--       → giống hệt định nghĩa của 20260746.
--   (2) orders_90d = số đơn RIÊNG BIỆT thực sự có xuất kho
--       (reference_type='order') thay vì đếm theo orders.status.
--   (3) VÁ σ: chuỗi tuần trước đây cố định 12 tuần và nhồi 0 cho tuần không có
--       dữ liệu. Hệ thống mới chạy từ 2026-05-28 (~9 tuần) nên 2-3 tuần đầu là
--       số 0 BỊA. Nay cắt chuỗi từ tuần có dữ liệu đầu tiên.
--       Tác động đo được: σ tổng 5.617 → 5.937 (+5,7%), tồn an toàn ở mức phục
--       vụ 95% tăng 9.269 → 9.797 đơn vị. σ TĂNG chứ không giảm — đúng về thống
--       kê (ít tuần quan sát thì bất định lớn hơn), đổi lại không còn bịa dữ liệu.
--
-- KHÔNG đụng product_reorder_view: view đó security_invoker và nuôi widget
--   Dashboard + trang Hạn sử dụng. RLS stock_movements cho vai trò `sales` chỉ
--   thấy movement thuộc đơn của chính họ → chuyển nguồn sẽ làm Dashboard của
--   sales hiển thị cầu thiếu trầm trọng. Giữ nguyên.
--
-- Chữ ký + toàn bộ cột trả về GIỮ NGUYÊN → frontend không phải đổi gì.
--
-- ⚠️ Apply remote qua Management API + NOTIFY pgrst reload. KHÔNG db push.
-- ============================================================

-- DROP theo TÊN (mọi overload) để file chạy lại được nhiều lần.
DO $drop$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_reorder_planning'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END
$drop$;

CREATE FUNCTION public.fn_reorder_planning(p_min_orders integer DEFAULT 3)
RETURNS TABLE (
  product_id            uuid,
  sku                   text,
  name                  text,
  unit                  text,
  min_stock_level       numeric,
  stock_on_hand         numeric,
  sold_30d              numeric,   -- RÒNG (đã trừ hàng khách trả)
  sold_90d              numeric,   -- RÒNG
  orders_90d            integer,   -- số đơn thực sự có xuất kho
  avg_weekly            numeric,
  days_cover            numeric,
  weekly_stddev         numeric,
  weeks_observed        integer,
  brand_id              uuid,
  brand_name            text,
  category_id           uuid,
  category_name         text,
  supplier_id           uuid,
  supplier_name         text,
  last_purchase_at      timestamptz,
  supplier_receipts_12m integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- Chỉ user active có quyền xem kho mới gọi được (khớp gate trang).
  IF NOT (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('inventory.view'))) THEN
    RAISE EXCEPTION 'Không có quyền xem gợi ý đặt hàng' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH sold AS (
    -- CẦU RÒNG: xuất bán − hàng khách trả. quantity dương = nhập, âm = xuất
    -- → -quantity cho ra +bán / −trả trong cùng một tổng.
    SELECT
      sm.product_id,
      GREATEST(0, COALESCE(SUM(-sm.quantity) FILTER (
        WHERE sm.created_at >= now() - interval '30 days'), 0)) AS sold_30d,
      GREATEST(0, COALESCE(SUM(-sm.quantity), 0))               AS sold_90d,
      COUNT(DISTINCT sm.reference_id) FILTER (
        WHERE sm.movement_type = 'sale'
          AND sm.reference_type = 'order')                      AS orders_90d
    FROM public.stock_movements sm
    WHERE sm.movement_type IN ('sale', 'return_from_customer')
      AND sm.created_at >= now() - interval '90 days'
    GROUP BY sm.product_id
  ),
  stock AS (
    SELECT s2.product_id, COALESCE(SUM(s2.quantity_on_hand), 0) AS soh
    FROM public.stock_lots s2
    WHERE s2.status = 'active'
    GROUP BY s2.product_id
  ),
  weekly AS (
    SELECT
      sm.product_id,
      date_trunc('week', sm.created_at) AS wk,
      GREATEST(0, SUM(-sm.quantity))    AS qty
    FROM public.stock_movements sm
    WHERE sm.movement_type IN ('sale', 'return_from_customer')
      AND sm.created_at >= date_trunc('week', now()) - interval '11 weeks'
    GROUP BY sm.product_id, date_trunc('week', sm.created_at)
  ),
  weeks AS (
    -- Cắt từ tuần CÓ dữ liệu đầu tiên: hệ thống chạy từ 2026-05-28 nên chuỗi
    -- 12 tuần cứng sẽ nhồi số 0 BỊA cho các tuần chưa từng tồn tại.
    SELECT generate_series(
      GREATEST(
        date_trunc('week', now()) - interval '11 weeks',
        COALESCE((SELECT date_trunc('week', MIN(sm.created_at))
                  FROM public.stock_movements sm
                  WHERE sm.movement_type = 'sale'),
                 date_trunc('week', now()) - interval '11 weeks')
      ),
      date_trunc('week', now()),
      interval '1 week'
    ) AS wk
  ),
  sigma AS (
    SELECT
      z.product_id,
      stddev_samp(z.qty)                AS weekly_stddev,
      COUNT(*) FILTER (WHERE z.qty > 0) AS weeks_observed
    FROM (
      SELECT pw.product_id, w.wk, COALESCE(wd.qty, 0) AS qty
      FROM (SELECT DISTINCT product_id FROM weekly) pw
      CROSS JOIN weeks w
      LEFT JOIN weekly wd ON wd.product_id = pw.product_id AND wd.wk = w.wk
    ) z
    GROUP BY z.product_id
  ),
  -- ── NCC suy ra từ lịch sử nhập (giữ nguyên logic 20260743) ──
  supplier_src AS (
    SELECT grl.product_id, gr.supplier_id, gr.receipt_date::timestamptz AS src_at
    FROM public.goods_receipt_lines grl
    JOIN public.goods_receipts gr ON gr.id = grl.receipt_id
    WHERE gr.status = 'completed'
      AND gr.supplier_id IS NOT NULL
    UNION ALL
    SELECT sl.product_id, sl.supplier_id, sl.received_at
    FROM public.stock_lots sl
    WHERE sl.supplier_id IS NOT NULL
      AND sl.receipt_id IS NULL
  ),
  supplier_agg AS (
    SELECT
      ss.product_id,
      ss.supplier_id,
      MAX(ss.src_at) AS last_at,
      COUNT(*) FILTER (WHERE ss.src_at >= now() - interval '12 months') AS times_12m
    FROM supplier_src ss
    GROUP BY ss.product_id, ss.supplier_id
  ),
  supplier_pick AS (
    SELECT DISTINCT ON (sa.product_id)
      sa.product_id, sa.supplier_id, sa.last_at, sa.times_12m
    FROM supplier_agg sa
    ORDER BY sa.product_id, sa.last_at DESC, sa.times_12m DESC
  )
  SELECT
    p.id,
    p.sku,
    p.name,
    p.unit,
    p.min_stock_level::numeric,
    COALESCE(st.soh, 0)::numeric,
    COALESCE(s.sold_30d, 0)::numeric,
    COALESCE(s.sold_90d, 0)::numeric,
    COALESCE(s.orders_90d, 0)::integer,
    ROUND(COALESCE(s.sold_90d, 0)::numeric / (90.0 / 7.0), 2),
    ROUND(COALESCE(st.soh, 0)::numeric / (COALESCE(s.sold_90d, 0)::numeric / 90.0), 1),
    ROUND(COALESCE(sg.weekly_stddev, 0)::numeric, 2),
    COALESCE(sg.weeks_observed, 0)::integer,
    p.brand_id,
    b.name,
    p.category_id,
    c.name,
    sp.supplier_id,
    sup.name,
    sp.last_at,
    COALESCE(sp.times_12m, 0)::integer
  FROM public.products p
  JOIN sold  s  ON s.product_id  = p.id        -- chỉ SP có bán
  LEFT JOIN stock st ON st.product_id = p.id
  LEFT JOIN sigma sg ON sg.product_id = p.id
  LEFT JOIN public.brands b             ON b.id   = p.brand_id
  LEFT JOIN public.product_categories c ON c.id   = p.category_id
  LEFT JOIN supplier_pick sp            ON sp.product_id = p.id
  LEFT JOIN public.suppliers sup        ON sup.id = sp.supplier_id
  WHERE p.is_active = true
    AND COALESCE(s.sold_90d, 0) > 0
    AND COALESCE(s.orders_90d, 0) >= p_min_orders
  ORDER BY (COALESCE(st.soh, 0)::numeric / NULLIF(COALESCE(s.sold_90d, 0)::numeric / 90.0, 0)) ASC NULLS LAST
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reorder_planning(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reorder_planning(integer) TO authenticated;

COMMENT ON FUNCTION public.fn_reorder_planning(integer) IS
  'Gợi ý đặt hàng: CẦU RÒNG từ stock_movements (bán − hàng khách trả, khớp định nghĩa của báo cáo giá vốn 20260746) + σ cầu tuần cắt từ tuần có dữ liệu đầu tiên (không nhồi tuần 0 bịa) + chiều phân loại (thương hiệu, nhóm SP, NCC suy từ lần nhập gần nhất). SECURITY DEFINER (cầu toàn công ty, bỏ chi phí RLS) + guard active & inventory.view. ROP/SS và bộ lọc tính ở frontend.';

NOTIFY pgrst, 'reload schema';
