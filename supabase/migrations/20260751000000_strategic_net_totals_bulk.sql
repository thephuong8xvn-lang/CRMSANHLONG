-- ─────────────────────────────────────────────────────────────
-- CRM SANHLONGVETCO – SP CHIẾN LƯỢC: DOANH THU THUẦN + DÒNG TỔNG + GÁN HÀNG LOẠT
-- File: 20260751000000_strategic_net_totals_bulk.sql
--
-- 1. VÁ GỐC: đơn đã trả hàng bị loại khỏi mọi báo cáo.
--    Trigger trả hàng (20260702) đổi orders.status → 'returned_partial' /
--    'returned_full', nhưng v_order_line_profit chỉ nhận 5 trạng thái cũ
--    → cả đơn biến mất. Hệ quả đo trên prod 2026-08-03:
--      · 13 đơn returned_full  (61,26tr bán = 61,26tr trả) → loại đi vẫn đúng tổng
--      · 11 đơn returned_partial (17,12tr bán, chỉ 3,28tr trả)
--        → 13,84tr doanh thu khách GIỮ LẠI bị mất khỏi báo cáo (T6 4,08tr · T7 9,76tr)
--    Đồng thời cơ chế trừ hàng trả của fn_profit_lines (20260737) CHƯA TỪNG
--    chạy: nó LEFT JOIN theo order_line_id của đơn đã bị loại → luôn ra 0.
--    Cách vá (phạm vi hẹp, không đụng consumer khác):
--      · view mới v_order_line_profit_ext = đủ 7 trạng thái
--      · v_order_line_profit giữ NGUYÊN nghĩa cũ (5 trạng thái) → fn_bi_*,
--        các báo cáo khác KHÔNG đổi hành vi
--      · chỉ fn_profit_lines đọc _ext → nó tự trừ hàng trả nên ra số ĐÚNG
--
-- 2. 7 RPC fn_strategic_* chuyển sang fn_profit_lines → doanh thu/giá vốn
--    THUẦN, khớp tuyệt đối với /reports/profit. 'Bán 30 ngày' thành bán RÒNG
--    (trừ hàng trả) — đồng bộ Báo cáo kho hàng.
--
-- 3. DÒNG TỔNG: fn_strategic_products / _suggestions trả thêm cột tổng tính
--    bằng window function → tổng của TOÀN BỘ tập lọc (không phải 50 dòng của
--    trang đang xem), và không thể lệch với danh sách vì cùng một truy vấn.
--    Markup tổng = Σlợi nhuận ÷ Σgiá vốn (FE tự tính từ sum_profit/sum_cogs),
--    KHÔNG phải trung bình cộng markup.
--
-- 4. fn_assign_strategy_bulk — gán/gỡ nhóm hàng loạt (nút thắt lớn nhất:
--    2,3% SP được phân loại sau 2 tháng vì phải gán từng cái một).
--
-- Bổ sung: chi nhánh có mục tiêu nhưng doanh thu = 0 vẫn hiện (trước đây biến
-- mất khỏi bảng + mất luôn cảnh báo chậm tiến độ).
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- 1. NỀN DỮ LIỆU: view đủ trạng thái + fn_profit_lines đọc nó
-- ─────────────────────────────────────────────────────────────

-- 1.1 View mở rộng: thêm returned_partial / returned_full.
--     Thân view giữ NGUYÊN công thức COGS của 20260714 (allocation theo lô +
--     fallback giá vốn hiện hành cho phần chưa phân bổ). Trả hàng KHÔNG xoá
--     order_line_allocations (20260702 chỉ hồi kho) → COGS dòng vẫn đúng.
CREATE OR REPLACE VIEW public.v_order_line_profit_ext AS
WITH alloc AS (
  SELECT ola.order_line_id,
         SUM(ola.quantity) AS alloc_qty,
         SUM(ola.quantity * sl.cost_price) AS alloc_cogs
  FROM public.order_line_allocations ola
  JOIN public.stock_lots sl ON sl.id = ola.lot_id
  GROUP BY ola.order_line_id
)
SELECT
  ol.id AS order_line_id, o.id AS order_id,
  o.created_at, o.status, o.customer_id, o.branch_id,
  ol.product_id, p.brand_id, ol.quantity, ol.line_total AS revenue,
  (COALESCE(a.alloc_cogs, 0)
   + GREATEST(ol.quantity - COALESCE(a.alloc_qty, 0), 0) * COALESCE(pss.retail_cost, 0)
  )::NUMERIC(15,2) AS cogs
FROM public.order_lines ol
JOIN public.orders o ON o.id = ol.order_id
JOIN public.products p ON p.id = ol.product_id
LEFT JOIN alloc a ON a.order_line_id = ol.id
LEFT JOIN public.product_stock_summary_view pss ON pss.id = ol.product_id
WHERE o.status IN ('confirmed', 'shipping', 'delivered', 'paid', 'completed',
                   'returned_partial', 'returned_full');

REVOKE ALL ON public.v_order_line_profit_ext FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW public.v_order_line_profit_ext IS
  'Như v_order_line_profit nhưng GIỮ LẠI đơn đã trả hàng (returned_partial/full). Chỉ fn_profit_lines dùng — hàm đó tự trừ hàng trả nên ra doanh thu thuần đúng. Consumer nào KHÔNG trừ hàng trả thì phải dùng v_order_line_profit (5 trạng thái) để không đếm khống.';

-- 1.2 fn_profit_lines đọc view mở rộng.
--     Từ đây cột return_qty/return_revenue/return_cogs mới thực sự có số.
CREATE OR REPLACE FUNCTION public.fn_profit_lines(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  order_line_id    uuid,
  order_id         uuid,
  created_at       timestamptz,
  customer_id      uuid,
  branch_id        uuid,
  owner_user_id    uuid,
  product_id       uuid,
  brand_id         uuid,
  category_id      uuid,
  quantity         numeric,
  revenue          numeric,
  cogs             numeric,
  invoice_discount numeric,
  return_qty       numeric,
  return_revenue   numeric,
  return_cogs      numeric,
  revenue_net      numeric,
  cogs_net         numeric
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH base AS (
    SELECT
      v.order_line_id, v.order_id, v.created_at, v.customer_id, v.branch_id,
      o.owner_user_id, v.product_id, v.brand_id, p.category_id,
      v.quantity, v.revenue, v.cogs,
      o.discount_total, ol.discount AS line_discount
    FROM public.v_order_line_profit_ext v
    JOIN public.orders      o  ON o.id  = v.order_id
    JOIN public.order_lines ol ON ol.id = v.order_line_id
    JOIN public.products    p  ON p.id  = v.product_id
    WHERE v.created_at >= p_from
      AND v.created_at <= p_to
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
  ),
  spread AS (
    SELECT
      b.*,
      SUM(b.revenue) OVER (PARTITION BY b.order_id) AS ord_line_revenue,
      GREATEST(
        b.discount_total - SUM(b.line_discount * b.quantity) OVER (PARTITION BY b.order_id),
        0
      ) AS ord_invoice_discount
    FROM base b
  ),
  ret AS (
    SELECT
      srl.order_line_id,
      SUM(srl.quantity)   AS ret_qty,
      SUM(srl.line_total) AS ret_revenue
    FROM public.sales_return_lines srl
    JOIN public.sales_returns sr ON sr.id = srl.return_id
    WHERE sr.status = 'completed'
    GROUP BY srl.order_line_id
  ),
  calc AS (
    SELECT
      s.*,
      ROUND(
        s.ord_invoice_discount
        * CASE WHEN s.ord_line_revenue > 0 THEN s.revenue / s.ord_line_revenue ELSE 0 END,
      2) AS inv_disc_alloc,
      COALESCE(r.ret_qty, 0)     AS r_qty,
      COALESCE(r.ret_revenue, 0) AS r_revenue,
      ROUND(
        CASE WHEN s.quantity > 0 THEN s.cogs / s.quantity * COALESCE(r.ret_qty, 0) ELSE 0 END,
      2) AS r_cogs
    FROM spread s
    LEFT JOIN ret r ON r.order_line_id = s.order_line_id
  )
  SELECT
    c.order_line_id, c.order_id, c.created_at, c.customer_id, c.branch_id,
    c.owner_user_id, c.product_id, c.brand_id, c.category_id,
    c.quantity::numeric, c.revenue::numeric, c.cogs::numeric,
    c.inv_disc_alloc::numeric,
    c.r_qty::numeric, c.r_revenue::numeric, c.r_cogs::numeric,
    (c.revenue - c.inv_disc_alloc - c.r_revenue)::numeric,
    (c.cogs - c.r_cogs)::numeric
  FROM calc c;
$$;

REVOKE ALL ON FUNCTION public.fn_profit_lines(timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_profit_lines(timestamptz, timestamptz, uuid) IS
  'Fact lợi nhuận cấp dòng đơn đã lọc kỳ/chi nhánh, kèm phân bổ CK cấp hóa đơn và trừ hàng trả (quy về ngày đơn gốc). Đọc v_order_line_profit_ext nên GIỮ đơn đã trả rồi mới trừ phần trả — trước 20260751 đơn đã trả bị loại từ view nên phần trừ không bao giờ chạy. Helper nội bộ — chỉ RPC báo cáo admin gọi.';

-- ─────────────────────────────────────────────────────────────
-- 2. DROP các hàm đổi RETURNS TABLE (drop theo TÊN, không liệt kê chữ ký cũ)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('fn_strategic_products',
                        'fn_strategic_suggestions',
                        'fn_strategic_today_orders')
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: Tổng quan tháng theo chi nhánh (THUẦN + giữ CN có mục tiêu)
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
  strategic_share           NUMERIC,
  profit_strategic          NUMERIC,
  profit_baseline           NUMERIC,
  profit_other              NUMERIC,
  cross_subsidy             NUMERIC,
  strategic_violation_count BIGINT,
  baseline_deep_loss_count  BIGINT,
  revenue_target            NUMERIC,
  strategic_share_target    NUMERIC,
  month_elapsed_ratio       NUMERIC,
  gmroi_strategic           NUMERIC,
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
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược' USING ERRCODE = '42501';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Kỳ báo cáo không hợp lệ: %/%', p_month, p_year;
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'strategic_config';
  v_markup_min := COALESCE((v_cfg->>'markup_min')::NUMERIC, 0.5);
  v_loss_floor := COALESCE((v_cfg->>'baseline_loss_floor')::NUMERIC, -0.05);

  v_from := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh');
  -- ⚠️ KHÔNG dùng `v_from + INTERVAL '1 month'`: v_from là timestamptz, phép
  -- cộng chạy theo múi giờ PHIÊN (UTC). 1/7 00:00 VN = 30/6 17:00 UTC, +1 tháng
  -- → 30/7 17:00 UTC = 31/7 00:00 VN → MẤT TRỌN NGÀY 31/7 (đo trên prod:
  -- 78 dòng / 22.891.570 ₫). Lỗi có từ 20260628, mọi tháng đứng sau tháng 30
  -- ngày đều bị cụt ngày cuối. Cộng tháng ở dạng giờ ĐỊA PHƯƠNG rồi mới đổi lại.
  v_to   := ((v_from AT TIME ZONE 'Asia/Ho_Chi_Minh') + INTERVAL '1 month')
            AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_elapsed := CASE
    WHEN now() <= v_from THEN 0
    WHEN now() >= v_to   THEN 1
    ELSE ROUND(EXTRACT(EPOCH FROM now() - v_from) / EXTRACT(EPOCH FROM v_to - v_from), 4)
  END;

  RETURN QUERY
  WITH lines AS (
    -- p_to lùi 1 micro giây: fn_profit_lines lấy khoảng ĐÓNG, nếu truyền v_to
    -- thì đơn tạo đúng 0h ngày 1 tháng sau bị đếm vào cả hai tháng.
    SELECT l.branch_id AS bid, COALESCE(ps.class, 'other') AS cls,
           l.product_id AS pid, l.revenue_net AS rev, l.cogs_net AS cg
    FROM public.fn_profit_lines(v_from, v_to - INTERVAL '1 microsecond', p_branch_id) l
    LEFT JOIN public.product_strategy ps ON ps.product_id = l.product_id
  ),
  by_branch AS (
    SELECT l.bid,
      SUM(l.rev)                                                        AS rev_total,
      COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'strategic'), 0) AS rev_s,
      COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'baseline'),  0) AS rev_b,
      COALESCE(SUM(l.rev)        FILTER (WHERE l.cls = 'other'),     0) AS rev_o,
      COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'strategic'), 0) AS prof_s,
      COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'baseline'),  0) AS prof_b,
      COALESCE(SUM(l.rev - l.cg) FILTER (WHERE l.cls = 'other'),     0) AS prof_o
    FROM lines l
    GROUP BY l.bid
  ),
  tgt AS (
    SELECT t.branch_id AS bid, t.revenue_target AS rt, t.strategic_share_target AS st
    FROM public.branch_month_targets t
    WHERE t.year = p_year AND t.month = p_month
      AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  ),
  -- Chi nhánh CÓ mục tiêu nhưng doanh thu = 0 vẫn phải hiện (trước đây biến
  -- mất khỏi bảng, kéo theo mất cảnh báo chậm tiến độ — đúng lúc cần nhất).
  universe AS (
    SELECT bb.bid FROM by_branch bb
    UNION
    SELECT tg.bid FROM tgt tg
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
    SELECT l.branch_id AS bid, COALESCE(ps.class, 'other') AS cls,
           SUM(l.revenue_net - l.cogs_net) AS profit90
    FROM public.fn_profit_lines(now() - INTERVAL '90 days', now(), p_branch_id) l
    LEFT JOIN public.product_strategy ps ON ps.product_id = l.product_id
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
    u.bid,
    COALESCE(br.name, '(Chưa gán CN)'),
    COALESCE(bb.rev_total, 0)::NUMERIC,
    COALESCE(bb.rev_s, 0)::NUMERIC,
    COALESCE(bb.rev_b, 0)::NUMERIC,
    COALESCE(bb.rev_o, 0)::NUMERIC,
    ROUND(bb.rev_s / NULLIF(bb.rev_total, 0), 4)::NUMERIC,
    COALESCE(bb.prof_s, 0)::NUMERIC,
    COALESCE(bb.prof_b, 0)::NUMERIC,
    COALESCE(bb.prof_o, 0)::NUMERIC,
    COALESCE(bb.prof_s + bb.prof_b, 0)::NUMERIC,
    COALESCE(vl.strat_viol, 0)::BIGINT,
    COALESCE(vl.base_loss, 0)::BIGINT,
    tg.rt::NUMERIC,
    COALESCE(tg.st, 0.30)::NUMERIC,
    v_elapsed,
    g.gmroi_s::NUMERIC,
    g.gmroi_b::NUMERIC
  FROM universe u
  LEFT JOIN by_branch bb ON bb.bid IS NOT DISTINCT FROM u.bid
  LEFT JOIN public.branches br ON br.id = u.bid
  LEFT JOIN viol vl ON vl.bid IS NOT DISTINCT FROM u.bid
  LEFT JOIN gm g   ON g.bid  IS NOT DISTINCT FROM u.bid
  LEFT JOIN tgt tg ON tg.bid = u.bid
  ORDER BY COALESCE(bb.rev_total, 0) DESC NULLS LAST;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: Danh sách SP theo nhóm — THUẦN + 11 cột TỔNG toàn bộ tập lọc
--    Tổng tính bằng window function trên chính tập đã lọc (trước LIMIT)
--    → không thể lệch với danh sách, không tốn thêm round-trip.
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_strategic_products(
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
  product_id         UUID,
  sku                TEXT,
  product_name       TEXT,
  unit               TEXT,
  brand_name         TEXT,
  class              TEXT,
  note               TEXT,
  qty                NUMERIC,
  revenue            NUMERIC,
  cogs               NUMERIC,
  profit             NUMERIC,
  markup_actual      NUMERIC,
  margin             NUMERIC,
  order_count        BIGINT,
  sold_30d           NUMERIC,
  stock_on_hand      NUMERIC,
  stock_value        NUMERIC,
  days_to_oos        NUMERIC,
  gmroi              NUMERIC,
  is_violation       BOOLEAN,
  missing_cost       BOOLEAN,
  total_count        BIGINT,
  -- ── tổng của TOÀN BỘ tập lọc (lặp lại trên mọi dòng) ──
  sum_qty            NUMERIC,
  sum_revenue        NUMERIC,
  sum_cogs           NUMERIC,
  sum_profit         NUMERIC,
  sum_sold_30d       NUMERIC,
  sum_stock_qty      NUMERIC,
  sum_stock_value    NUMERIC,
  sum_profit_90d     NUMERIC,
  violation_count    BIGINT,
  missing_cost_count BIGINT,
  unit_uniform       BOOLEAN
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
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược' USING ERRCODE = '42501';
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
  -- ⚠️ KHÔNG dùng `v_from + INTERVAL '1 month'`: v_from là timestamptz, phép
  -- cộng chạy theo múi giờ PHIÊN (UTC). 1/7 00:00 VN = 30/6 17:00 UTC, +1 tháng
  -- → 30/7 17:00 UTC = 31/7 00:00 VN → MẤT TRỌN NGÀY 31/7 (đo trên prod:
  -- 78 dòng / 22.891.570 ₫). Lỗi có từ 20260628, mọi tháng đứng sau tháng 30
  -- ngày đều bị cụt ngày cuối. Cộng tháng ở dạng giờ ĐỊA PHƯƠNG rồi mới đổi lại.
  v_to   := ((v_from AT TIME ZONE 'Asia/Ho_Chi_Minh') + INTERVAL '1 month')
            AT TIME ZONE 'Asia/Ho_Chi_Minh';

  RETURN QUERY
  WITH base AS (
    SELECT ps.product_id AS pid, ps.class AS cls, ps.note AS pnote
    FROM public.product_strategy ps
    WHERE p_class IN ('strategic', 'baseline') AND ps.class = p_class
    UNION ALL
    SELECT DISTINCT l.product_id, 'other'::TEXT, NULL::TEXT
    FROM public.fn_profit_lines(v_from, v_to - INTERVAL '1 microsecond', p_branch_id) l
    WHERE p_class = 'other'
      AND NOT EXISTS (SELECT 1 FROM public.product_strategy ps WHERE ps.product_id = l.product_id)
  ),
  sal AS (
    SELECT l.product_id AS pid,
           SUM(l.quantity - l.return_qty)   AS qty,   -- SL bán RÒNG
           SUM(l.revenue_net)               AS rev,
           SUM(l.cogs_net)                  AS cg,
           COUNT(DISTINCT l.order_id)       AS ocnt
    FROM public.fn_profit_lines(v_from, v_to - INTERVAL '1 microsecond', p_branch_id) l
    GROUP BY 1
  ),
  s30 AS (
    SELECT l.product_id AS pid, SUM(l.quantity - l.return_qty) AS q30
    FROM public.fn_profit_lines(now() - INTERVAL '30 days', now(), p_branch_id) l
    GROUP BY 1
  ),
  p90 AS (
    SELECT l.product_id AS pid, SUM(l.revenue_net - l.cogs_net) AS profit90
    FROM public.fn_profit_lines(now() - INTERVAL '90 days', now(), p_branch_id) l
    GROUP BY 1
  ),
  stk AS (
    SELECT sv.product_id AS pid, SUM(sv.quantity_on_hand) AS stockq, SUM(sv.lot_value) AS stockval
    FROM public.v_stock_lot_valuation sv
    WHERE sv.status = 'active'
      AND (p_branch_id IS NULL OR sv.branch_id = p_branch_id)
    GROUP BY 1
  ),
  rws AS (
    SELECT
      p.id                                          AS r_pid,
      p.sku                                         AS r_sku,
      p.name                                        AS r_name,
      COALESCE(p.unit, '')                          AS r_unit,
      COALESCE(b.name, '(Không thương hiệu)')       AS r_brand,
      bs.cls                                        AS r_cls,
      bs.pnote                                      AS r_note,
      COALESCE(s.qty, 0)::NUMERIC                   AS r_qty,
      COALESCE(s.rev, 0)::NUMERIC                   AS r_rev,
      COALESCE(s.cg, 0)::NUMERIC                    AS r_cogs,
      COALESCE(s.rev - s.cg, 0)::NUMERIC            AS r_profit,
      ROUND((s.rev - s.cg) / NULLIF(s.cg, 0), 4)::NUMERIC  AS r_markup,
      ROUND((s.rev - s.cg) / NULLIF(s.rev, 0), 4)::NUMERIC AS r_margin,
      COALESCE(s.ocnt, 0)::BIGINT                   AS r_ocnt,
      COALESCE(m.q30, 0)::NUMERIC                   AS r_s30,
      COALESCE(st.stockq, 0)::NUMERIC               AS r_stockq,
      COALESCE(st.stockval, 0)::NUMERIC             AS r_stockval,
      CASE WHEN COALESCE(m.q30, 0) > 0
           THEN ROUND(COALESCE(st.stockq, 0) / (m.q30 / 30.0), 1) END::NUMERIC AS r_oos,
      CASE WHEN COALESCE(st.stockval, 0) > 0
           THEN ROUND(COALESCE(g.profit90, 0) * (365.0 / 90.0) / st.stockval, 2) END::NUMERIC AS r_gmroi,
      COALESCE(g.profit90, 0)::NUMERIC              AS r_p90,
      CASE
        WHEN bs.cls = 'strategic' THEN
          COALESCE(s.cg, 0) > 0 AND (s.rev - s.cg) / s.cg < v_markup_min
        WHEN bs.cls = 'baseline' THEN
          COALESCE(s.rev, 0) > 0 AND (s.rev - s.cg) / s.rev < v_loss_floor
        ELSE FALSE
      END                                           AS r_viol,
      (COALESCE(s.rev, 0) > 0 AND COALESCE(s.cg, 0) = 0) AS r_missing
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
  )
  SELECT
    r.r_pid, r.r_sku, r.r_name, r.r_unit, r.r_brand, r.r_cls, r.r_note,
    r.r_qty, r.r_rev, r.r_cogs, r.r_profit, r.r_markup, r.r_margin, r.r_ocnt,
    r.r_s30, r.r_stockq, r.r_stockval, r.r_oos, r.r_gmroi,
    r.r_viol, r.r_missing,
    COUNT(*)                  OVER ()::BIGINT,
    SUM(r.r_qty)              OVER ()::NUMERIC,
    SUM(r.r_rev)              OVER ()::NUMERIC,
    SUM(r.r_cogs)             OVER ()::NUMERIC,
    SUM(r.r_profit)           OVER ()::NUMERIC,
    SUM(r.r_s30)              OVER ()::NUMERIC,
    SUM(r.r_stockq)           OVER ()::NUMERIC,
    SUM(r.r_stockval)         OVER ()::NUMERIC,
    SUM(r.r_p90)              OVER ()::NUMERIC,
    COUNT(*) FILTER (WHERE r.r_viol)    OVER ()::BIGINT,
    COUNT(*) FILTER (WHERE r.r_missing) OVER ()::BIGINT,
    -- COUNT(DISTINCT) không dùng được trong window → so MIN với MAX.
    -- ĐVT lẫn nhau thì FE hiện "nhiều ĐVT" thay vì cộng bừa chai + thùng + kg.
    (MIN(r.r_unit) OVER () = MAX(r.r_unit) OVER ())
  FROM rws r
  ORDER BY
    CASE WHEN p_sort = 'days_to_oos' THEN r.r_oos END ASC NULLS LAST,
    CASE p_sort
      WHEN 'profit'      THEN r.r_profit
      WHEN 'markup'      THEN r.r_markup
      WHEN 'qty'         THEN r.r_qty
      WHEN 'sold_30d'    THEN r.r_s30
      WHEN 'gmroi'       THEN r.r_gmroi
      WHEN 'days_to_oos' THEN NULL
      ELSE r.r_rev
    END DESC NULLS LAST,
    r.r_name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. RPC: Gợi ý phân loại — THUẦN + 3 cột tổng
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_strategic_suggestions(
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
  markup_90d      NUMERIC,
  order_count_90d BIGINT,
  total_count     BIGINT,
  sum_revenue_90d NUMERIC,
  sum_qty_90d     NUMERIC,
  sum_profit_90d  NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg        JSONB;
  v_markup_min NUMERIC;
  v_min_rev    NUMERIC;
  v_min_qty    NUMERIC;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược' USING ERRCODE = '42501';
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'strategic_config';
  v_markup_min := COALESCE((v_cfg->>'markup_min')::NUMERIC, 0.5);
  v_min_rev    := COALESCE((v_cfg->>'suggest_min_revenue_90d')::NUMERIC, 5000000);
  v_min_qty    := COALESCE((v_cfg->>'suggest_min_qty_90d')::NUMERIC, 30);

  RETURN QUERY
  WITH agg AS (
    SELECT
      l.product_id AS pid,
      SUM(l.revenue_net)                 AS rev90,
      SUM(l.quantity - l.return_qty)     AS qty90,
      SUM(l.revenue_net - l.cogs_net)    AS profit90,
      SUM(l.cogs_net)                    AS cogs90,
      COUNT(DISTINCT l.order_id)         AS ocnt90
    FROM public.fn_profit_lines(now() - INTERVAL '90 days', now(), p_branch_id) l
    WHERE NOT EXISTS (SELECT 1 FROM public.product_strategy ps WHERE ps.product_id = l.product_id)
    GROUP BY l.product_id
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
  ),
  rws AS (
    SELECT p.id AS r_pid, p.sku AS r_sku, p.name AS r_name, COALESCE(p.unit, '') AS r_unit,
           sc.sug AS r_sug, sc.rev90 AS r_rev, sc.qty90 AS r_qty, sc.profit90 AS r_profit,
           ROUND(sc.mk90, 4) AS r_mk, sc.ocnt90 AS r_ocnt
    FROM scored sc
    JOIN public.products p ON p.id = sc.pid AND p.is_active
    WHERE sc.sug IS NOT NULL
  )
  SELECT
    r.r_pid, r.r_sku, r.r_name, r.r_unit, r.r_sug,
    r.r_rev::NUMERIC, r.r_qty::NUMERIC, r.r_profit::NUMERIC,
    r.r_mk::NUMERIC, r.r_ocnt::BIGINT,
    COUNT(*)          OVER ()::BIGINT,
    SUM(r.r_rev)      OVER ()::NUMERIC,
    SUM(r.r_qty)      OVER ()::NUMERIC,
    SUM(r.r_profit)   OVER ()::NUMERIC
  FROM rws r
  ORDER BY r.r_rev DESC NULLS LAST, r.r_name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. RPC: Cảnh báo cấp chi nhánh — THUẦN
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_alerts(
  p_year      INT,
  p_month     INT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  alert_type  TEXT,
  severity    TEXT,
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
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược' USING ERRCODE = '42501';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Kỳ báo cáo không hợp lệ: %/%', p_month, p_year;
  END IF;

  SELECT value INTO v_cfg FROM public.system_settings WHERE key = 'strategic_config';
  v_markup_min := COALESCE((v_cfg->>'markup_min')::NUMERIC, 0.5);
  v_loss_floor := COALESCE((v_cfg->>'baseline_loss_floor')::NUMERIC, -0.05);
  v_oos_days   := COALESCE((v_cfg->>'oos_warn_days')::NUMERIC, 7);

  v_from := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh');
  -- ⚠️ KHÔNG dùng `v_from + INTERVAL '1 month'`: v_from là timestamptz, phép
  -- cộng chạy theo múi giờ PHIÊN (UTC). 1/7 00:00 VN = 30/6 17:00 UTC, +1 tháng
  -- → 30/7 17:00 UTC = 31/7 00:00 VN → MẤT TRỌN NGÀY 31/7 (đo trên prod:
  -- 78 dòng / 22.891.570 ₫). Lỗi có từ 20260628, mọi tháng đứng sau tháng 30
  -- ngày đều bị cụt ngày cuối. Cộng tháng ở dạng giờ ĐỊA PHƯƠNG rồi mới đổi lại.
  v_to   := ((v_from AT TIME ZONE 'Asia/Ho_Chi_Minh') + INTERVAL '1 month')
            AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_elapsed := CASE
    WHEN now() <= v_from THEN 0
    WHEN now() >= v_to   THEN 1
    ELSE EXTRACT(EPOCH FROM now() - v_from) / EXTRACT(EPOCH FROM v_to - v_from)
  END;

  RETURN QUERY
  WITH lines AS (
    SELECT l.branch_id AS bid, COALESCE(ps.class, 'other') AS cls,
           l.product_id AS pid, l.revenue_net AS rev, l.cogs_net AS cg
    FROM public.fn_profit_lines(v_from, v_to - INTERVAL '1 microsecond', p_branch_id) l
    LEFT JOIN public.product_strategy ps ON ps.product_id = l.product_id
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
  s30b AS (
    SELECT l.branch_id AS bid, l.product_id AS pid, SUM(l.quantity - l.return_qty) AS q30
    FROM public.fn_profit_lines(now() - INTERVAL '30 days', now(), p_branch_id) l
    JOIN public.product_strategy ps ON ps.product_id = l.product_id
    GROUP BY 1, 2
    HAVING SUM(l.quantity - l.return_qty) > 0
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
  SELECT 'strategic_below_markup',
         CASE WHEN vl.strat_sold > 0 AND vl.strat_viol >= vl.strat_sold * 0.3
              THEN 'critical' ELSE 'warning' END,
         vl.bid, COALESCE(br.name, '(Chưa gán CN)'),
         vl.strat_viol::NUMERIC, v_markup_min, vl.strat_viol::BIGINT
  FROM viol vl
  LEFT JOIN public.branches br ON br.id = vl.bid
  WHERE vl.strat_viol > 0
  UNION ALL
  SELECT 'baseline_deep_loss', 'warning', vl.bid, COALESCE(br.name, '(Chưa gán CN)'),
         vl.base_loss::NUMERIC, v_loss_floor, vl.base_loss::BIGINT
  FROM viol vl
  LEFT JOIN public.branches br ON br.id = vl.bid
  WHERE vl.base_loss > 0
  UNION ALL
  SELECT 'cross_subsidy_negative', 'critical', bb.bid, COALESCE(br.name, '(Chưa gán CN)'),
         (bb.prof_s + bb.prof_b)::NUMERIC, 0::NUMERIC, NULL::BIGINT
  FROM by_branch bb
  LEFT JOIN public.branches br ON br.id = bb.bid
  WHERE bb.prof_s + bb.prof_b < 0
  UNION ALL
  -- Chi nhánh có mục tiêu mà doanh thu = 0 nay cũng vào được (LEFT JOIN từ tgt)
  SELECT 'pace_behind', 'warning', tg.bid, COALESCE(br.name, '(Chưa gán CN)'),
         COALESCE(bb.rev_total, 0)::NUMERIC, ROUND(tg.rt * v_elapsed, 0)::NUMERIC, NULL::BIGINT
  FROM tgt tg
  LEFT JOIN by_branch bb ON bb.bid = tg.bid
  LEFT JOIN public.branches br ON br.id = tg.bid
  WHERE tg.rt > 0 AND v_elapsed > 0.1
    AND COALESCE(bb.rev_total, 0) < tg.rt * v_elapsed * 0.9
  UNION ALL
  SELECT 'strategic_oos_risk', 'warning', o.bid, COALESCE(br.name, '(Chưa gán CN)'),
         o.oos_count::NUMERIC, v_oos_days, o.oos_count::BIGINT
  FROM oos o
  LEFT JOIN public.branches br ON br.id = o.bid
  WHERE o.cls = 'strategic' AND o.oos_count > 0
  UNION ALL
  SELECT 'baseline_oos_risk', 'critical', o.bid, COALESCE(br.name, '(Chưa gán CN)'),
         o.oos_count::NUMERIC, v_oos_days, o.oos_count::BIGINT
  FROM oos o
  LEFT JOIN public.branches br ON br.id = o.bid
  WHERE o.cls = 'baseline' AND o.oos_count > 0;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. RPC: Xu hướng theo tháng — THUẦN (1 lần gọi cho cả dải)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_strategic_trend(
  p_branch_id UUID    DEFAULT NULL,
  p_months    INTEGER DEFAULT 12
)
RETURNS TABLE (
  ym                TEXT,
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
  v_months   INTEGER;
  v_start_tz TIMESTAMPTZ;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược' USING ERRCODE = '42501';
  END IF;

  v_months   := LEAST(GREATEST(COALESCE(p_months, 12), 1), 24);
  v_start_tz := (date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                 - make_interval(months => v_months - 1)) AT TIME ZONE 'Asia/Ho_Chi_Minh';

  RETURN QUERY
  WITH lines AS (
    SELECT
      to_char(l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') AS lym,
      COALESCE(ps.class, 'other') AS cls,
      l.revenue_net AS rev, l.cogs_net AS cg
    FROM public.fn_profit_lines(v_start_tz, now(), p_branch_id) l
    LEFT JOIN public.product_strategy ps ON ps.product_id = l.product_id
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
-- 8. RPC: KPI live hôm nay — THUẦN
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
  v_day_start TIMESTAMPTZ;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược' USING ERRCODE = '42501';
  END IF;

  v_day_start := date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                 AT TIME ZONE 'Asia/Ho_Chi_Minh';

  RETURN QUERY
  WITH lines AS (
    SELECT l.branch_id AS bid, COALESCE(ps.class, 'other') AS cls,
           l.order_id AS oid, l.created_at AS cat,
           l.revenue_net AS rev, l.cogs_net AS cg
    FROM public.fn_profit_lines(v_day_start, now(), p_branch_id) l
    LEFT JOIN public.product_strategy ps ON ps.product_id = l.product_id
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
-- 9. RPC: Đơn hôm nay — THUẦN + cơ cấu cộng lại KHỚP tổng
--    Trước đây cột "Tổng" lấy orders.grand_total (cấp đơn) còn cơ cấu N1/N2
--    lấy cấp dòng → người xem cộng nhẩm không ra. Nay trả thêm revenue_other
--    và revenue_net_total để N1 + N2 + Thường = tổng thuần.
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_strategic_today_orders(
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
  revenue_other     NUMERIC,
  revenue_net_total NUMERIC,
  status            TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day_start TIMESTAMPTZ;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo sản phẩm chiến lược' USING ERRCODE = '42501';
  END IF;

  v_day_start := date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                 AT TIME ZONE 'Asia/Ho_Chi_Minh';

  RETURN QUERY
  SELECT
    o.id,
    o.order_code,
    o.created_at,
    COALESCE(br.name, '(Chưa gán CN)'),
    COALESCE(c.farm_name, 'Khách lẻ'),
    o.grand_total::NUMERIC,
    COALESCE(SUM(l.revenue_net) FILTER (WHERE ps.class = 'strategic'), 0)::NUMERIC,
    COALESCE(SUM(l.revenue_net) FILTER (WHERE ps.class = 'baseline'),  0)::NUMERIC,
    COALESCE(SUM(l.revenue_net) FILTER (WHERE ps.class IS NULL),       0)::NUMERIC,
    COALESCE(SUM(l.revenue_net), 0)::NUMERIC,
    o.status::TEXT
  FROM public.fn_profit_lines(v_day_start, now(), p_branch_id) l
  JOIN public.orders o ON o.id = l.order_id
  LEFT JOIN public.product_strategy ps ON ps.product_id = l.product_id
  LEFT JOIN public.branches br ON br.id = o.branch_id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  GROUP BY o.id, o.order_code, o.created_at, br.name, c.farm_name, o.grand_total, o.status
  ORDER BY o.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 10. RPC: Gán / gỡ nhóm HÀNG LOẠT
--     Nút thắt lớn nhất của module: 2,3% SP được phân loại sau 2 tháng vì
--     modal chỉ gán được từng SP. Cũng vá luôn assigned_by đang bỏ trống
--     (FE upsert thẳng vào bảng, không ghi ai gán).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_assign_strategy_bulk(
  p_product_ids UUID[],
  p_class       TEXT DEFAULT NULL,   -- NULL = gỡ khỏi nhóm
  p_note        TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n   INTEGER := 0;
  v_uid UUID;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền phân loại sản phẩm chiến lược' USING ERRCODE = '42501';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  IF array_length(p_product_ids, 1) > 2000 THEN
    RAISE EXCEPTION 'Tối đa 2.000 sản phẩm mỗi lần (đang gửi %)', array_length(p_product_ids, 1);
  END IF;

  -- assigned_by tham chiếu profiles(id); lấy an toàn để không vỡ FK nếu
  -- người đang thao tác chưa có hồ sơ.
  SELECT pr.id INTO v_uid FROM public.profiles pr WHERE pr.id = auth.uid();

  IF p_class IS NULL THEN
    DELETE FROM public.product_strategy ps WHERE ps.product_id = ANY(p_product_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    IF p_class NOT IN ('strategic', 'baseline') THEN
      RAISE EXCEPTION 'Nhóm sản phẩm không hợp lệ: %', p_class;
    END IF;
    INSERT INTO public.product_strategy (product_id, class, note, assigned_by, assigned_at)
    SELECT u.pid, p_class, NULLIF(p_note, ''), v_uid, now()
    FROM unnest(p_product_ids) AS u(pid)
    WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = u.pid)
    ON CONFLICT (product_id) DO UPDATE
      SET class       = EXCLUDED.class,
          note        = COALESCE(EXCLUDED.note, public.product_strategy.note),
          assigned_by = EXCLUDED.assigned_by,
          assigned_at = now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.fn_assign_strategy_bulk(UUID[], TEXT, TEXT) IS
  'Gán/gỡ nhóm SP chiến lược hàng loạt (p_class NULL = gỡ). Trả số dòng ảnh hưởng. Admin-only, tối đa 2.000 SP/lần.';

-- ─────────────────────────────────────────────────────────────
-- 11. GRANT / REVOKE
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_strategic_summary(INT, INT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_products(INT, INT, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_suggestions(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_alerts(INT, INT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_trend(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_today(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_strategic_today_orders(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_assign_strategy_bulk(UUID[], TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_strategic_summary(INT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_products(INT, INT, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_suggestions(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_alerts(INT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_trend(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_today(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_strategic_today_orders(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_assign_strategy_bulk(UUID[], TEXT, TEXT) TO authenticated;
