-- ============================================================
-- Migration: BÁO CÁO LỢI NHUẬN THEO CHI NHÁNH (chi tiết)
-- File: 20260737000000_profit_by_branch.sql
--
-- Bối cảnh:
--   `v_order_line_profit` (20260620 → recreate ở 20260714) ĐÃ có cột
--   `branch_id`, nhưng KHÔNG RPC nào của báo cáo lợi nhuận dùng tới →
--   `/reports/profit` luôn gộp toàn công ty. Thực tế vận hành có 2 chi
--   nhánh lệch nhau rất mạnh (Hoài Ân ~87% đơn / Phù Mỹ ~13%) nên không
--   chẻ được theo CN là mất một lát cắt quan trọng.
--
--   Đồng thời doanh thu cũ = `order_lines.line_total` nên BỎ SÓT 2 khoản
--   làm lợi nhuận bị thổi lên:
--     (a) chiết khấu CẤP HÓA ĐƠN (`orders.discount_total` trừ phần CK dòng)
--         — sau đợt đại tu Khuyến mãi (20260732) khoản này đã phát sinh thật;
--     (b) hàng TRẢ LẠI (`sales_returns` đã completed).
--
-- Quyết định (user chốt 2026-07-27):
--   • KHÔNG đổi công thức của `v_order_line_profit` (BI, SP chiến lược,
--     định giá tồn kho… đều ăn view này — đổi là đổi số cả hệ thống).
--     Thay vào đó BỔ SUNG cột: DT gộp → CK hóa đơn → Trả hàng → DT thuần.
--     Cột `revenue`/`profit` cũ giữ nguyên ý nghĩa để đối chiếu được với
--     báo cáo đang chạy.
--   • CHƯA ghép chi phí vận hành từ Sổ quỹ (Sổ quỹ chưa vận hành thật,
--     còn chạy song song KiotViet) → báo cáo dừng ở LỢI NHUẬN GỘP.
--
-- Nội dung:
--   1. `fn_profit_lines`  — fact cấp dòng đơn đã lọc kỳ/CN + phân bổ CK hóa
--      đơn + trừ hàng trả. Helper nội bộ, KHÔNG grant cho authenticated.
--   2. Nâng cấp 4 RPC cũ: thêm `p_branch_id` + các cột thuần.
--   3. 3 RPC mới cho tab "Theo chi nhánh": summary (có so sánh kỳ),
--      trend (day/week/month, có lấp khoảng trống), breakdown (top theo
--      SP/KH/thương hiệu/nhóm hàng/nhân viên trong 1 CN).
--
-- Bảo mật: giữ nguyên pattern — SECURITY DEFINER + guard fn_has_role('admin')
--   + REVOKE PUBLIC/anon + GRANT authenticated.
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro). KHÔNG db push.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. Index hỗ trợ lọc theo chi nhánh + kỳ
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_branch_created
  ON public.orders (branch_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 1. FACT cấp dòng đơn (helper nội bộ)
--
--    Vì sao là FUNCTION chứ không phải VIEW: phân bổ CK hóa đơn cần tổng
--    doanh thu của TẤT CẢ dòng cùng đơn (window PARTITION BY order_id).
--    Nếu đặt trong view, filter thời gian ở ngoài không đẩy được xuống dưới
--    window → quét toàn bộ order_lines mỗi lần gọi. Đưa filter vào tham số
--    thì lọc trước rồi mới tính window. Lọc theo `created_at` của ĐƠN nên
--    mọi dòng của một đơn hoặc vào hết hoặc ra hết → tỉ trọng phân bổ vẫn
--    chính xác tuyệt đối.
--
--    Ghi chú kế toán: hàng trả được quy về NGÀY CỦA ĐƠN GỐC (không phải
--    ngày lập phiếu trả) để "lợi nhuận của đơn" là con số khép kín. Hệ quả:
--    một phiếu trả hoàn tất hôm nay sẽ làm giảm doanh thu của kỳ đã qua.
-- ─────────────────────────────────────────────────────────────
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
    FROM public.v_order_line_profit v
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
      -- CK cấp hóa đơn = discount_total (tổng) − phần CK đã nằm ở từng dòng
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
      -- giá vốn hàng trả = giá vốn bình quân của chính dòng đó × SL trả
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
  'Fact lợi nhuận cấp dòng đơn đã lọc kỳ/chi nhánh, kèm phân bổ CK cấp hóa đơn và trừ hàng trả (quy về ngày đơn gốc). Helper nội bộ — chỉ các RPC báo cáo admin gọi.';

-- ─────────────────────────────────────────────────────────────
-- 2. RPC CŨ — thêm p_branch_id + cột doanh thu/lợi nhuận thuần
--    (DROP trước vì RETURNS TABLE đổi → CREATE OR REPLACE không nhận)
-- ─────────────────────────────────────────────────────────────

-- 2.1 Tổng quan
DROP FUNCTION IF EXISTS public.fn_profit_summary(timestamptz, timestamptz);

CREATE FUNCTION public.fn_profit_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_revenue          numeric,   -- DT gộp (giữ nguyên nghĩa cũ)
  total_invoice_discount numeric,
  total_returns          numeric,
  total_revenue_net      numeric,
  total_cogs             numeric,   -- giữ nguyên nghĩa cũ
  total_cogs_net         numeric,
  total_profit           numeric,   -- giữ nguyên nghĩa cũ
  profit_margin          numeric,   -- giữ nguyên nghĩa cũ
  total_profit_net       numeric,
  profit_margin_net      numeric,
  order_count            bigint,
  customer_count         bigint,
  product_count          bigint,
  branch_count           bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(l.revenue), 0)::numeric,
    COALESCE(SUM(l.invoice_discount), 0)::numeric,
    COALESCE(SUM(l.return_revenue), 0)::numeric,
    COALESCE(SUM(l.revenue_net), 0)::numeric,
    COALESCE(SUM(l.cogs), 0)::numeric,
    COALESCE(SUM(l.cogs_net), 0)::numeric,
    COALESCE(SUM(l.revenue - l.cogs), 0)::numeric,
    CASE WHEN COALESCE(SUM(l.revenue), 0) > 0
         THEN ROUND(SUM(l.revenue - l.cogs) / SUM(l.revenue) * 100, 2) ELSE 0 END::numeric,
    COALESCE(SUM(l.revenue_net - l.cogs_net), 0)::numeric,
    CASE WHEN COALESCE(SUM(l.revenue_net), 0) > 0
         THEN ROUND(SUM(l.revenue_net - l.cogs_net) / SUM(l.revenue_net) * 100, 2) ELSE 0 END::numeric,
    COUNT(DISTINCT l.order_id)::bigint,
    COUNT(DISTINCT l.customer_id)::bigint,
    COUNT(DISTINCT l.product_id)::bigint,
    COUNT(DISTINCT l.branch_id)::bigint
  FROM public.fn_profit_lines(p_from, p_to, p_branch_id) l;
END;
$$;

-- 2.2 Theo khách hàng
DROP FUNCTION IF EXISTS public.fn_profit_by_customer(timestamptz, timestamptz, text, text, integer, integer);

CREATE FUNCTION public.fn_profit_by_customer(
  p_from      timestamptz,
  p_to        timestamptz,
  p_search    text    DEFAULT NULL,
  p_sort      text    DEFAULT 'revenue',
  p_limit     integer DEFAULT 100,
  p_offset    integer DEFAULT 0,
  p_branch_id uuid    DEFAULT NULL
)
RETURNS TABLE (
  customer_id      uuid,
  customer_name    text,
  customer_code    text,
  revenue          numeric,
  invoice_discount numeric,
  return_amount    numeric,
  revenue_net      numeric,
  cogs             numeric,
  cogs_net         numeric,
  profit           numeric,
  margin           numeric,
  profit_net       numeric,
  margin_net       numeric,
  order_count      bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.farm_name, c.code,
    SUM(l.revenue)::numeric,
    SUM(l.invoice_discount)::numeric,
    SUM(l.return_revenue)::numeric,
    SUM(l.revenue_net)::numeric,
    SUM(l.cogs)::numeric,
    SUM(l.cogs_net)::numeric,
    SUM(l.revenue - l.cogs)::numeric,
    CASE WHEN SUM(l.revenue) > 0
         THEN ROUND(SUM(l.revenue - l.cogs) / SUM(l.revenue) * 100, 2) ELSE 0 END::numeric,
    SUM(l.revenue_net - l.cogs_net)::numeric,
    CASE WHEN SUM(l.revenue_net) > 0
         THEN ROUND(SUM(l.revenue_net - l.cogs_net) / SUM(l.revenue_net) * 100, 2) ELSE 0 END::numeric,
    COUNT(DISTINCT l.order_id)::bigint
  FROM public.fn_profit_lines(p_from, p_to, p_branch_id) l
  JOIN public.customers c ON c.id = l.customer_id
  WHERE (
      p_search IS NULL OR p_search = ''
      OR unaccent(lower(c.farm_name)) LIKE '%' || unaccent(lower(p_search)) || '%'
      OR c.code ILIKE '%' || p_search || '%'
    )
  GROUP BY c.id, c.farm_name, c.code
  ORDER BY
    CASE p_sort
      WHEN 'profit' THEN SUM(l.revenue_net - l.cogs_net)
      WHEN 'margin' THEN CASE WHEN SUM(l.revenue_net) > 0
                              THEN SUM(l.revenue_net - l.cogs_net) / SUM(l.revenue_net) ELSE 0 END
      ELSE SUM(l.revenue)
    END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 2.3 Theo sản phẩm (dùng chung cho 3 tab Top-100)
DROP FUNCTION IF EXISTS public.fn_profit_by_product(timestamptz, timestamptz, text, text, integer, integer);

CREATE FUNCTION public.fn_profit_by_product(
  p_from      timestamptz,
  p_to        timestamptz,
  p_search    text    DEFAULT NULL,
  p_sort      text    DEFAULT 'revenue',
  p_limit     integer DEFAULT 100,
  p_offset    integer DEFAULT 0,
  p_branch_id uuid    DEFAULT NULL
)
RETURNS TABLE (
  product_id       uuid,
  sku              text,
  product_name     text,
  brand_name       text,
  qty_sold         numeric,   -- đổi BIGINT → NUMERIC: SL bán có thể lẻ (NUMERIC(15,3))
  qty_returned     numeric,
  revenue          numeric,
  invoice_discount numeric,
  return_amount    numeric,
  revenue_net      numeric,
  cogs             numeric,
  cogs_net         numeric,
  profit           numeric,
  margin           numeric,
  profit_net       numeric,
  margin_net       numeric,
  customer_count   bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.sku, p.name, b.name,
    SUM(l.quantity)::numeric,
    SUM(l.return_qty)::numeric,
    SUM(l.revenue)::numeric,
    SUM(l.invoice_discount)::numeric,
    SUM(l.return_revenue)::numeric,
    SUM(l.revenue_net)::numeric,
    SUM(l.cogs)::numeric,
    SUM(l.cogs_net)::numeric,
    SUM(l.revenue - l.cogs)::numeric,
    CASE WHEN SUM(l.revenue) > 0
         THEN ROUND(SUM(l.revenue - l.cogs) / SUM(l.revenue) * 100, 2) ELSE 0 END::numeric,
    SUM(l.revenue_net - l.cogs_net)::numeric,
    CASE WHEN SUM(l.revenue_net) > 0
         THEN ROUND(SUM(l.revenue_net - l.cogs_net) / SUM(l.revenue_net) * 100, 2) ELSE 0 END::numeric,
    COUNT(DISTINCT l.customer_id)::bigint
  FROM public.fn_profit_lines(p_from, p_to, p_branch_id) l
  JOIN public.products p ON p.id = l.product_id
  LEFT JOIN public.brands b ON b.id = p.brand_id
  WHERE (
      p_search IS NULL OR p_search = ''
      OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(p_search)) || '%'
      OR p.sku ILIKE '%' || p_search || '%'
    )
  GROUP BY p.id, p.sku, p.name, b.name
  ORDER BY
    CASE p_sort
      WHEN 'profit'         THEN SUM(l.revenue_net - l.cogs_net)
      WHEN 'profit_ratio'   THEN CASE WHEN SUM(l.revenue_net) > 0
                                      THEN SUM(l.revenue_net - l.cogs_net) / SUM(l.revenue_net) ELSE 0 END
      WHEN 'qty'            THEN SUM(l.quantity)
      WHEN 'customer_count' THEN COUNT(DISTINCT l.customer_id)::numeric
      ELSE SUM(l.revenue)
    END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 2.4 Theo thương hiệu
DROP FUNCTION IF EXISTS public.fn_profit_by_brand(timestamptz, timestamptz, text, integer, integer);

CREATE FUNCTION public.fn_profit_by_brand(
  p_from      timestamptz,
  p_to        timestamptz,
  p_sort      text    DEFAULT 'revenue',
  p_limit     integer DEFAULT 200,
  p_offset    integer DEFAULT 0,
  p_branch_id uuid    DEFAULT NULL
)
RETURNS TABLE (
  brand_id         uuid,
  brand_name       text,
  qty_sold         numeric,
  revenue          numeric,
  invoice_discount numeric,
  return_amount    numeric,
  revenue_net      numeric,
  cogs             numeric,
  cogs_net         numeric,
  profit           numeric,
  margin           numeric,
  profit_net       numeric,
  margin_net       numeric,
  product_count    bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    COALESCE(b.name, '(Không thương hiệu)'),
    SUM(l.quantity)::numeric,
    SUM(l.revenue)::numeric,
    SUM(l.invoice_discount)::numeric,
    SUM(l.return_revenue)::numeric,
    SUM(l.revenue_net)::numeric,
    SUM(l.cogs)::numeric,
    SUM(l.cogs_net)::numeric,
    SUM(l.revenue - l.cogs)::numeric,
    CASE WHEN SUM(l.revenue) > 0
         THEN ROUND(SUM(l.revenue - l.cogs) / SUM(l.revenue) * 100, 2) ELSE 0 END::numeric,
    SUM(l.revenue_net - l.cogs_net)::numeric,
    CASE WHEN SUM(l.revenue_net) > 0
         THEN ROUND(SUM(l.revenue_net - l.cogs_net) / SUM(l.revenue_net) * 100, 2) ELSE 0 END::numeric,
    COUNT(DISTINCT l.product_id)::bigint
  FROM public.fn_profit_lines(p_from, p_to, p_branch_id) l
  LEFT JOIN public.brands b ON b.id = l.brand_id
  GROUP BY b.id, b.name
  ORDER BY
    CASE p_sort
      WHEN 'profit' THEN SUM(l.revenue_net - l.cogs_net)
      WHEN 'margin' THEN CASE WHEN SUM(l.revenue_net) > 0
                              THEN SUM(l.revenue_net - l.cogs_net) / SUM(l.revenue_net) ELSE 0 END
      ELSE SUM(l.revenue)
    END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC MỚI — tab "Theo chi nhánh"
-- ─────────────────────────────────────────────────────────────

-- 3.1 Bảng so sánh các chi nhánh + so kỳ trước
--     p_compare: 'none' | 'prev' (kỳ liền trước cùng độ dài) | 'yoy'
--     p_sort:    'revenue' | 'profit' | 'margin' | 'orders'
--     Dòng chi nhánh NULL hiện là '(Không chi nhánh)' — đơn cũ/nhập liệu
--     thiếu, cố tình để lộ ra thay vì giấu đi.
CREATE OR REPLACE FUNCTION public.fn_profit_branch_summary(
  p_from    timestamptz,
  p_to      timestamptz,
  p_compare text DEFAULT 'none',
  p_sort    text DEFAULT 'revenue'
)
RETURNS TABLE (
  branch_id        uuid,
  branch_code      text,
  branch_name      text,
  revenue          numeric,
  invoice_discount numeric,
  return_amount    numeric,
  revenue_net      numeric,
  cogs             numeric,
  cogs_net         numeric,
  profit           numeric,
  margin           numeric,
  profit_net       numeric,
  margin_net       numeric,
  qty_sold         numeric,
  order_count      bigint,
  customer_count   bigint,
  product_count    bigint,
  line_count       bigint,
  aov              numeric,   -- doanh thu thuần bình quân / đơn
  profit_per_order numeric,
  revenue_share    numeric,   -- % đóng góp DT thuần toàn công ty
  profit_share     numeric,   -- % đóng góp LN thuần toàn công ty
  prev_revenue_net numeric,
  prev_profit_net  numeric,
  prev_order_count bigint,
  revenue_growth   numeric,   -- % so kỳ so sánh (NULL nếu kỳ trước = 0)
  profit_growth    numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pf timestamptz;
  v_pt timestamptz;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận' USING ERRCODE = '42501';
  END IF;
  IF p_compare NOT IN ('none', 'prev', 'yoy') THEN
    RAISE EXCEPTION 'Kiểu so sánh không hợp lệ: %', p_compare;
  END IF;

  IF p_compare = 'yoy' THEN
    v_pf := p_from - interval '1 year';
    v_pt := p_to   - interval '1 year';
  ELSIF p_compare = 'prev' THEN
    v_pf := p_from - (p_to - p_from) - interval '1 second';
    v_pt := p_from - interval '1 second';
  END IF;

  RETURN QUERY
  WITH cur AS (
    SELECT
      l.branch_id AS bid,
      SUM(l.revenue)                     AS revenue,
      SUM(l.invoice_discount)            AS invoice_discount,
      SUM(l.return_revenue)              AS return_amount,
      SUM(l.revenue_net)                 AS revenue_net,
      SUM(l.cogs)                        AS cogs,
      SUM(l.cogs_net)                    AS cogs_net,
      SUM(l.quantity)                    AS qty_sold,
      COUNT(DISTINCT l.order_id)         AS order_count,
      COUNT(DISTINCT l.customer_id)      AS customer_count,
      COUNT(DISTINCT l.product_id)       AS product_count,
      COUNT(*)                           AS line_count
    FROM public.fn_profit_lines(p_from, p_to, NULL) l
    GROUP BY l.branch_id
  ),
  prev AS (
    SELECT
      l.branch_id AS bid,
      SUM(l.revenue_net)         AS revenue_net,
      SUM(l.revenue_net - l.cogs_net) AS profit_net,
      COUNT(DISTINCT l.order_id) AS order_count
    FROM public.fn_profit_lines(v_pf, v_pt, NULL) l
    WHERE v_pf IS NOT NULL
    GROUP BY l.branch_id
  ),
  tot AS (
    SELECT
      NULLIF(SUM(c.revenue_net), 0)            AS revenue_net,
      NULLIF(SUM(c.revenue_net - c.cogs_net), 0) AS profit_net
    FROM cur c
  )
  SELECT
    c.bid,
    br.code,
    COALESCE(br.name, '(Không chi nhánh)'),
    c.revenue::numeric,
    c.invoice_discount::numeric,
    c.return_amount::numeric,
    c.revenue_net::numeric,
    c.cogs::numeric,
    c.cogs_net::numeric,
    (c.revenue - c.cogs)::numeric,
    CASE WHEN c.revenue > 0
         THEN ROUND((c.revenue - c.cogs) / c.revenue * 100, 2) ELSE 0 END::numeric,
    (c.revenue_net - c.cogs_net)::numeric,
    CASE WHEN c.revenue_net > 0
         THEN ROUND((c.revenue_net - c.cogs_net) / c.revenue_net * 100, 2) ELSE 0 END::numeric,
    c.qty_sold::numeric,
    c.order_count::bigint,
    c.customer_count::bigint,
    c.product_count::bigint,
    c.line_count::bigint,
    CASE WHEN c.order_count > 0
         THEN ROUND(c.revenue_net / c.order_count, 0) ELSE 0 END::numeric,
    CASE WHEN c.order_count > 0
         THEN ROUND((c.revenue_net - c.cogs_net) / c.order_count, 0) ELSE 0 END::numeric,
    ROUND(c.revenue_net / (SELECT t.revenue_net FROM tot t) * 100, 2)::numeric,
    ROUND((c.revenue_net - c.cogs_net) / (SELECT t.profit_net FROM tot t) * 100, 2)::numeric,
    COALESCE(pv.revenue_net, 0)::numeric,
    COALESCE(pv.profit_net, 0)::numeric,
    COALESCE(pv.order_count, 0)::bigint,
    CASE WHEN COALESCE(pv.revenue_net, 0) > 0
         THEN ROUND((c.revenue_net - pv.revenue_net) / pv.revenue_net * 100, 1) END::numeric,
    CASE WHEN COALESCE(pv.profit_net, 0) > 0
         THEN ROUND(((c.revenue_net - c.cogs_net) - pv.profit_net) / pv.profit_net * 100, 1) END::numeric
  FROM cur c
  LEFT JOIN prev pv ON pv.bid IS NOT DISTINCT FROM c.bid
  LEFT JOIN public.branches br ON br.id = c.bid
  ORDER BY
    CASE p_sort
      WHEN 'profit' THEN (c.revenue_net - c.cogs_net)
      WHEN 'margin' THEN CASE WHEN c.revenue_net > 0
                              THEN (c.revenue_net - c.cogs_net) / c.revenue_net ELSE 0 END
      WHEN 'orders' THEN c.order_count::numeric
      ELSE c.revenue_net
    END DESC NULLS LAST;
END;
$$;

-- 3.2 Xu hướng theo thời gian trong 1 chi nhánh (lấp khoảng trống → vẽ chart mượt)
--     p_bucket: 'day' | 'week' | 'month'
--     p_branch_id NULL = toàn công ty; p_unassigned = true → chỉ đơn KHÔNG có CN.
CREATE OR REPLACE FUNCTION public.fn_profit_branch_trend(
  p_from       timestamptz,
  p_to         timestamptz,
  p_branch_id  uuid    DEFAULT NULL,
  p_bucket     text    DEFAULT 'day',
  p_unassigned boolean DEFAULT false
)
RETURNS TABLE (
  bucket_start date,
  revenue      numeric,
  revenue_net  numeric,
  cogs_net     numeric,
  profit_net   numeric,
  margin_net   numeric,
  qty_sold     numeric,
  order_count  bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_step interval;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận' USING ERRCODE = '42501';
  END IF;
  IF p_bucket NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Đơn vị thời gian không hợp lệ: %', p_bucket;
  END IF;
  v_step := ('1 ' || p_bucket)::interval;

  -- Ranh giới ngày/tuần/tháng tính theo GIỜ VIỆT NAM (quy ước dự án, xem
  -- 20260628 strategic_products) — nếu để mặc định UTC thì đơn bán buổi
  -- sáng ở VN sẽ rơi nhầm sang ô ngày hôm trước.
  RETURN QUERY
  WITH agg AS (
    SELECT
      date_trunc(p_bucket, l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS b,
      SUM(l.revenue)                      AS revenue,
      SUM(l.revenue_net)                  AS revenue_net,
      SUM(l.cogs_net)                     AS cogs_net,
      SUM(l.quantity)                     AS qty_sold,
      COUNT(DISTINCT l.order_id)          AS order_count
    FROM public.fn_profit_lines(p_from, p_to, p_branch_id) l
    WHERE (NOT p_unassigned OR l.branch_id IS NULL)
    GROUP BY 1
  ),
  series AS (
    SELECT generate_series(
      date_trunc(p_bucket, p_from AT TIME ZONE 'Asia/Ho_Chi_Minh'),
      date_trunc(p_bucket, p_to   AT TIME ZONE 'Asia/Ho_Chi_Minh'),
      v_step
    ) AS b
  )
  SELECT
    s.b::date,
    COALESCE(a.revenue, 0)::numeric,
    COALESCE(a.revenue_net, 0)::numeric,
    COALESCE(a.cogs_net, 0)::numeric,
    COALESCE(a.revenue_net - a.cogs_net, 0)::numeric,
    CASE WHEN COALESCE(a.revenue_net, 0) > 0
         THEN ROUND((a.revenue_net - a.cogs_net) / a.revenue_net * 100, 2) ELSE 0 END::numeric,
    COALESCE(a.qty_sold, 0)::numeric,
    COALESCE(a.order_count, 0)::bigint
  FROM series s
  LEFT JOIN agg a ON a.b = s.b
  ORDER BY s.b;
END;
$$;

-- 3.3 Chi tiết trong 1 chi nhánh — top theo chiều tùy chọn
--     p_dim: 'product' | 'customer' | 'brand' | 'category' | 'salesperson'
CREATE OR REPLACE FUNCTION public.fn_profit_branch_breakdown(
  p_from       timestamptz,
  p_to         timestamptz,
  p_branch_id  uuid    DEFAULT NULL,
  p_dim        text    DEFAULT 'product',
  p_sort       text    DEFAULT 'revenue',
  p_limit      integer DEFAULT 20,
  p_unassigned boolean DEFAULT false
)
RETURNS TABLE (
  dim_key        text,
  dim_label      text,
  dim_sub        text,     -- SKU / mã KH … (nhãn phụ)
  revenue        numeric,
  revenue_net    numeric,
  cogs_net       numeric,
  profit_net     numeric,
  margin_net     numeric,
  qty_sold       numeric,
  order_count    bigint,
  customer_count bigint,
  revenue_share  numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo lợi nhuận' USING ERRCODE = '42501';
  END IF;
  IF p_dim NOT IN ('product', 'customer', 'brand', 'category', 'salesperson') THEN
    RAISE EXCEPTION 'Chiều phân tích không hợp lệ: %', p_dim;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      l.*,
      CASE p_dim
        WHEN 'product'     THEN l.product_id::text
        WHEN 'customer'    THEN l.customer_id::text
        WHEN 'brand'       THEN l.brand_id::text
        WHEN 'category'    THEN l.category_id::text
        WHEN 'salesperson' THEN l.owner_user_id::text
      END AS k,
      CASE p_dim
        WHEN 'product'     THEN p.name
        WHEN 'customer'    THEN COALESCE(c.farm_name, '(Khách lẻ)')
        WHEN 'brand'       THEN COALESCE(b.name, '(Không thương hiệu)')
        WHEN 'category'    THEN COALESCE(cat.name, '(Không nhóm hàng)')
        WHEN 'salesperson' THEN COALESCE(pr.full_name, '(Không nhân viên)')
      END AS lbl,
      CASE p_dim
        WHEN 'product'  THEN p.sku
        WHEN 'customer' THEN c.code
        ELSE NULL
      END AS sub
    FROM public.fn_profit_lines(p_from, p_to, p_branch_id) l
    LEFT JOIN public.products p            ON p.id   = l.product_id
    LEFT JOIN public.customers c           ON c.id   = l.customer_id
    LEFT JOIN public.brands b              ON b.id   = l.brand_id
    LEFT JOIN public.product_categories cat ON cat.id = l.category_id
    LEFT JOIN public.profiles pr           ON pr.id  = l.owner_user_id
    WHERE (NOT p_unassigned OR l.branch_id IS NULL)
  ),
  agg AS (
    SELECT
      base.k, max(base.lbl) AS lbl, max(base.sub) AS sub,
      SUM(base.revenue)                AS revenue,
      SUM(base.revenue_net)            AS revenue_net,
      SUM(base.cogs_net)               AS cogs_net,
      SUM(base.quantity)               AS qty_sold,
      COUNT(DISTINCT base.order_id)    AS order_count,
      COUNT(DISTINCT base.customer_id) AS customer_count
    FROM base
    WHERE base.k IS NOT NULL
    GROUP BY base.k
  ),
  tot AS (SELECT NULLIF(SUM(agg.revenue_net), 0) AS revenue_net FROM agg)
  SELECT
    a.k, a.lbl, a.sub,
    a.revenue::numeric,
    a.revenue_net::numeric,
    a.cogs_net::numeric,
    (a.revenue_net - a.cogs_net)::numeric,
    CASE WHEN a.revenue_net > 0
         THEN ROUND((a.revenue_net - a.cogs_net) / a.revenue_net * 100, 2) ELSE 0 END::numeric,
    a.qty_sold::numeric,
    a.order_count::bigint,
    a.customer_count::bigint,
    ROUND(a.revenue_net / (SELECT t.revenue_net FROM tot t) * 100, 2)::numeric
  FROM agg a
  ORDER BY
    CASE p_sort
      WHEN 'profit' THEN (a.revenue_net - a.cogs_net)
      WHEN 'margin' THEN CASE WHEN a.revenue_net > 0
                              THEN (a.revenue_net - a.cogs_net) / a.revenue_net ELSE 0 END
      WHEN 'qty'    THEN a.qty_sold
      ELSE a.revenue_net
    END DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. GRANT (mỗi RPC tự guard admin bên trong)
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_profit_summary(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_profit_by_customer(timestamptz, timestamptz, text, text, integer, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_profit_by_product(timestamptz, timestamptz, text, text, integer, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_profit_by_brand(timestamptz, timestamptz, text, integer, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_profit_branch_summary(timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_profit_branch_trend(timestamptz, timestamptz, uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_profit_branch_breakdown(timestamptz, timestamptz, uuid, text, text, integer, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_profit_summary(timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_by_customer(timestamptz, timestamptz, text, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_by_product(timestamptz, timestamptz, text, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_by_brand(timestamptz, timestamptz, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_branch_summary(timestamptz, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_branch_trend(timestamptz, timestamptz, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_branch_breakdown(timestamptz, timestamptz, uuid, text, text, integer, boolean) TO authenticated;

COMMENT ON FUNCTION public.fn_profit_branch_summary(timestamptz, timestamptz, text, text) IS
  'Lợi nhuận theo chi nhánh: DT gộp/CK hóa đơn/hàng trả/DT thuần, biên gộp & thuần, AOV, LN/đơn, %đóng góp, so sánh kỳ trước (prev/yoy). Admin-only.';
COMMENT ON FUNCTION public.fn_profit_branch_trend(timestamptz, timestamptz, uuid, text, boolean) IS
  'Xu hướng doanh thu/lợi nhuận thuần theo ngày/tuần/tháng của 1 chi nhánh (đã lấp khoảng trống). Admin-only.';
COMMENT ON FUNCTION public.fn_profit_branch_breakdown(timestamptz, timestamptz, uuid, text, text, integer, boolean) IS
  'Top N trong 1 chi nhánh theo chiều sản phẩm/khách hàng/thương hiệu/nhóm hàng/nhân viên. Admin-only.';

NOTIFY pgrst, 'reload schema';
