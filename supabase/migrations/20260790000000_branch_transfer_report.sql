-- ============================================================
-- Migration: BÁO CÁO CHUYỂN KHO NỘI BỘ (doanh số / lợi nhuận chi nhánh)
-- File: 20260790000000_branch_transfer_report.sql
--
-- Bối cảnh nghiệp vụ (user chốt 2026-08-08):
--   Mỗi chi nhánh kinh doanh ĐỘC LẬP kiểu nhượng quyền. Hoài Ân là chi
--   nhánh CHÍNH: hàng nhập về kho Hoài Ân rồi luân chuyển sang các kho
--   chi nhánh khác. Vì vậy MỘT PHIẾU CHUYỂN KHO = MỘT LẦN BÁN HÀNG của
--   chi nhánh nguồn cho chi nhánh đích ([[model-multi-branch-business]]).
--
--   Trước migration này, toàn bộ dòng doanh số đó VÔ HÌNH trong báo cáo:
--   `/reports/profit` chỉ đọc `v_order_line_profit` (bán cho khách ngoài),
--   còn `stock_transfers` chưa từng có báo cáo nào.
--
-- ⚠️ PHẠM VI — user chốt rõ 2026-08-08:
--   "chỉ báo cáo giá chuyển, không liên quan đến báo cáo lợi nhuận cho
--    khách hàng, đây là báo cáo chuyển kho".
--   ⇒ Báo cáo này ĐỨNG RIÊNG, KHÔNG cộng gộp với doanh thu bán khách.
--     Không đụng một dòng nào của `fn_profit_*`. Ai muốn xem tổng hợp
--     nhất thì tự cộng ở ngoài — hệ thống KHÔNG tự cộng hộ.
--
-- Ba quyết định tính toán (user chốt, đừng "sửa lại" ở phiên sau):
--   1. MỐC GHI NHẬN = `approved_at` (lúc Admin duyệt), chỉ tính phiếu
--      `status = 'completed'`. Đó đúng là thời điểm hàng vào sổ kho đích
--      và giá vốn được chốt ⇒ báo cáo khớp tuyệt đối với tồn kho. Hàng
--      đang đi đường / chờ duyệt CỐ Ý nằm ngoài (có KPI riêng để thấy).
--   2. CHI NHÁNH NHẬN KHÔNG bị trừ gì cả. Hàng nhận về là TỒN KHO, chỉ
--      thành giá vốn khi bán ra cho khách (đã có ở /reports/profit qua
--      `stock_lots.cost_price`). Cột "Nhận về" ở đây thuần THAM KHẢO.
--   3. LÃI NỘI BỘ của chi nhánh nguồn = Σ SL×(đơn giá chuyển − giá vốn
--      nguồn), với giá vốn nguồn lấy snapshot `source_cost_price` chụp
--      lúc XUẤT KHO — không phải giá vốn lô hiện tại.
--
-- Quy ước lấy số (bám đúng `fn_complete_transfer` + `fn_transfer_cost_preview`
-- của 20260738 để báo cáo không lệch với cái đã ghi sổ):
--   đơn giá chuyển = COALESCE(NULLIF(unit_price,0), source_cost_price, lô.cost_price, 0)
--   giá vốn nguồn  = COALESCE(source_cost_price, lô.cost_price, 0)
--   ⇒ phiếu chuyển ngang giá vốn (unit_price = 0) cho lãi nội bộ = 0,
--     KHÔNG phải lãi 100%.
--
-- Chuyển kho NỘI BỘ CÙNG MỘT CHI NHÁNH (kho A → kho B của cùng CN) KHÔNG
-- phải là bán hàng ⇒ loại khỏi mọi con số doanh số/lợi nhuận, nhưng vẫn
-- đếm riêng ở KPI để không ai tưởng số bị nuốt.
--
-- Nội dung:
--   1. `fn_branch_transfer_lines`   — fact cấp dòng phiếu (helper, KHÔNG grant)
--   2. `fn_branch_transfer_summary` — KPI tổng
--   3. `fn_branch_transfer_by_branch` — bảng chính: mỗi CN xuất/nhận bao nhiêu
--   4. `fn_branch_transfer_matrix`  — ma trận luồng hàng Từ CN → Đến CN
--   5. `fn_branch_transfer_trend`   — xu hướng ngày/tuần/tháng (đã lấp trống)
--   6. `fn_branch_transfer_breakdown` — top theo SP/thương hiệu/nhóm/CN/người lập
--   7. `fn_branch_transfer_docs`    — danh sách chứng từ để soi tận phiếu
--
-- Bảo mật: giữ nguyên pattern của cụm báo cáo — SECURITY DEFINER + guard
--   `fn_has_role('admin')` + REVOKE PUBLIC/anon + GRANT authenticated.
--   (Báo cáo phơi GIÁ VỐN của mọi chi nhánh nên không mở cho branch_manager.)
--
-- Ranh giới ngày theo GIỜ VIỆT NAM (quy ước dự án từ 20260628/20260737).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro). KHÔNG db push.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. Index hỗ trợ: báo cáo luôn lọc completed + khoảng approved_at
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_transfers_completed_approved
  ON public.stock_transfers (approved_at DESC)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer
  ON public.stock_transfer_lines (transfer_id);

-- ─────────────────────────────────────────────────────────────
-- 1. FACT cấp dòng phiếu (helper nội bộ — KHÔNG grant cho authenticated)
--
--    Vì sao là FUNCTION chứ không phải VIEW: mọi RPC bên dưới đều lọc
--    kỳ + cặp chi nhánh trước rồi mới tổng hợp; đưa filter vào tham số
--    thì planner cắt bằng index partial ở trên thay vì quét cả bảng.
--
--    `recognized_at` = approved_at, có 2 nấc dự phòng cho dữ liệu cũ:
--    157 phiếu 'received' thời mô hình cũ được 20260738 backfill
--    `approved_at = updated_at` (≈ lúc nhận hàng); nếu vẫn NULL thì rơi
--    về `transfer_date` quy về 00:00 giờ VN.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_branch_transfer_lines(
  p_from        timestamptz,
  p_to          timestamptz,
  p_from_branch uuid DEFAULT NULL,
  p_to_branch   uuid DEFAULT NULL
)
RETURNS TABLE (
  line_id         uuid,
  transfer_id     uuid,
  transfer_code   text,
  recognized_at   timestamptz,
  transfer_date   date,
  from_branch_id  uuid,
  to_branch_id    uuid,
  from_warehouse  uuid,
  to_warehouse    uuid,
  cross_branch    boolean,
  created_by      uuid,
  approved_by     uuid,
  product_id      uuid,
  brand_id        uuid,
  category_id     uuid,
  quantity        numeric,
  unit_price      numeric,   -- đơn giá chuyển (đã áp quy ước COALESCE)
  source_cost     numeric,   -- giá vốn bên bán, snapshot lúc xuất kho
  list_unit_price numeric,   -- giá gốc từ bảng giá nội bộ
  amount          numeric,   -- SL × đơn giá chuyển  = doanh số nội bộ
  cost            numeric,   -- SL × giá vốn nguồn
  margin_amount   numeric,   -- amount − cost        = lãi nội bộ
  price_edited    boolean,   -- đơn giá bị sửa tay lệch bảng giá nội bộ
  priced_at_cost  boolean    -- phiếu để trống đơn giá → chuyển ngang giá vốn
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH l AS (
    SELECT
      stl.id            AS line_id,
      t.id              AS transfer_id,
      t.transfer_code,
      COALESCE(
        t.approved_at,
        t.received_at,
        (t.transfer_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      )                 AS recognized_at,
      t.transfer_date,
      fw.branch_id      AS from_branch_id,
      tw.branch_id      AS to_branch_id,
      t.from_warehouse,
      t.to_warehouse,
      (fw.branch_id IS DISTINCT FROM tw.branch_id) AS cross_branch,
      t.created_by,
      t.approved_by,
      stl.product_id,
      p.brand_id,
      p.category_id,
      stl.quantity,
      COALESCE(NULLIF(stl.unit_price, 0), stl.source_cost_price, src.cost_price, 0) AS unit_price,
      COALESCE(stl.source_cost_price, src.cost_price, 0)                            AS source_cost,
      stl.list_unit_price,
      -- Hai cờ chất lượng dữ liệu phải so trên GIÁ THÔ của chứng từ, không so
      -- trên giá đã COALESCE — nếu không, phiếu để trống đơn giá (rơi về giá
      -- vốn nguồn) sẽ bị hiểu nhầm thành "có người sửa giá tay".
      (stl.list_unit_price IS NOT NULL
        AND stl.unit_price IS NOT NULL
        AND stl.list_unit_price <> stl.unit_price)      AS price_edited,
      (COALESCE(stl.unit_price, 0) = 0)                 AS priced_at_cost
    FROM public.stock_transfer_lines stl
    JOIN public.stock_transfers t  ON t.id  = stl.transfer_id
    JOIN public.warehouses      fw ON fw.id = t.from_warehouse
    JOIN public.warehouses      tw ON tw.id = t.to_warehouse
    JOIN public.products        p  ON p.id  = stl.product_id
    LEFT JOIN public.stock_lots src ON src.id = stl.lot_id
    WHERE t.status = 'completed'
      AND COALESCE(
            t.approved_at, t.received_at,
            (t.transfer_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          ) >= p_from
      AND COALESCE(
            t.approved_at, t.received_at,
            (t.transfer_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          ) <= p_to
      AND (p_from_branch IS NULL OR fw.branch_id = p_from_branch)
      AND (p_to_branch   IS NULL OR tw.branch_id = p_to_branch)
  )
  SELECT
    l.line_id, l.transfer_id, l.transfer_code, l.recognized_at, l.transfer_date,
    l.from_branch_id, l.to_branch_id, l.from_warehouse, l.to_warehouse,
    l.cross_branch, l.created_by, l.approved_by,
    l.product_id, l.brand_id, l.category_id,
    l.quantity::numeric,
    l.unit_price::numeric,
    l.source_cost::numeric,
    l.list_unit_price::numeric,
    (l.quantity * l.unit_price)::numeric,
    (l.quantity * l.source_cost)::numeric,
    (l.quantity * (l.unit_price - l.source_cost))::numeric,
    l.price_edited,
    l.priced_at_cost
  FROM l;
$$;

REVOKE ALL ON FUNCTION public.fn_branch_transfer_lines(timestamptz, timestamptz, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_branch_transfer_lines(timestamptz, timestamptz, uuid, uuid) IS
  'Helper NỘI BỘ: fact cấp dòng phiếu chuyển kho đã duyệt (status=completed), mốc theo approved_at. Không grant — chỉ các RPC báo cáo gọi.';

-- ─────────────────────────────────────────────────────────────
-- 2. KPI TỔNG
--    Kèm luôn 2 nhóm số CỐ Ý nằm ngoài doanh số để không ai tưởng bị nuốt:
--      • intra_*   : chuyển giữa 2 kho CÙNG một chi nhánh (không phải bán)
--      • pending_* : đang đi đường / chờ duyệt (chưa vào sổ kho đích)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_branch_transfer_summary(
  p_from        timestamptz,
  p_to          timestamptz,
  p_from_branch uuid DEFAULT NULL,
  p_to_branch   uuid DEFAULT NULL
)
RETURNS TABLE (
  total_amount        numeric,   -- doanh số nội bộ (giá chuyển)
  total_cost          numeric,   -- giá vốn bên bán
  total_margin        numeric,   -- lãi nội bộ
  margin_pct          numeric,
  total_qty           numeric,
  transfer_count      bigint,
  line_count          bigint,
  product_count       bigint,
  from_branch_count   bigint,
  to_branch_count     bigint,
  pair_count          bigint,    -- số cặp CN có luân chuyển
  avg_per_transfer    numeric,
  edited_line_count   bigint,    -- số dòng bị sửa giá tay so với bảng giá
  zero_price_lines    bigint,    -- dòng chuyển ngang giá vốn (unit_price = 0)
  -- Dòng có giá vốn nguồn = 0. KHÔNG mặc định là lỗi: nhập kho giá 0đ là
  -- nghiệp vụ thật (hàng NCC tặng — user chốt 2026-08-07). Nhưng chuyển
  -- những dòng đó đi có giá thì lãi nội bộ = 100% giá chuyển, nên phải tách
  -- ra đếm để người đọc biết biên đến từ đâu.
  no_cost_lines       bigint,
  intra_amount        numeric,   -- chuyển trong cùng 1 CN (ngoài doanh số)
  intra_transfers     bigint,
  pending_count       bigint,    -- phiếu chưa vào sổ kho đích
  pending_cost        numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo chuyển kho' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH l AS (
    SELECT * FROM public.fn_branch_transfer_lines(p_from, p_to, p_from_branch, p_to_branch)
  ),
  x AS (SELECT * FROM l WHERE l.cross_branch),
  -- Ảnh chụp HIỆN TẠI, cố ý KHÔNG lọc theo kỳ: hàng chưa vào sổ kho đích là
  -- hiện trạng đang treo, không phải con số của một khoảng thời gian.
  pend AS (
    SELECT
      COUNT(*)                                AS cnt,
      COALESCE(SUM(t.total_cost), 0)::numeric AS cost
    FROM public.stock_transfers t
    JOIN public.warehouses fw ON fw.id = t.from_warehouse
    JOIN public.warehouses tw ON tw.id = t.to_warehouse
    WHERE t.status IN ('in_transit', 'received')
      AND (p_from_branch IS NULL OR fw.branch_id = p_from_branch)
      AND (p_to_branch   IS NULL OR tw.branch_id = p_to_branch)
  )
  SELECT
    COALESCE(SUM(x.amount), 0)::numeric,
    COALESCE(SUM(x.cost), 0)::numeric,
    COALESCE(SUM(x.margin_amount), 0)::numeric,
    CASE WHEN COALESCE(SUM(x.amount), 0) > 0
         THEN ROUND(SUM(x.margin_amount) / SUM(x.amount) * 100, 2) ELSE 0 END::numeric,
    COALESCE(SUM(x.quantity), 0)::numeric,
    COUNT(DISTINCT x.transfer_id)::bigint,
    COUNT(x.line_id)::bigint,
    COUNT(DISTINCT x.product_id)::bigint,
    COUNT(DISTINCT x.from_branch_id)::bigint,
    COUNT(DISTINCT x.to_branch_id)::bigint,
    COUNT(DISTINCT (x.from_branch_id::text || '>' || x.to_branch_id::text))::bigint,
    CASE WHEN COUNT(DISTINCT x.transfer_id) > 0
         THEN ROUND(SUM(x.amount) / COUNT(DISTINCT x.transfer_id), 0) ELSE 0 END::numeric,
    COUNT(*) FILTER (WHERE x.price_edited)::bigint,
    COUNT(*) FILTER (WHERE x.priced_at_cost)::bigint,
    COUNT(*) FILTER (WHERE x.source_cost = 0)::bigint,
    (SELECT COALESCE(SUM(i.amount), 0) FROM l i WHERE NOT i.cross_branch)::numeric,
    (SELECT COUNT(DISTINCT i.transfer_id) FROM l i WHERE NOT i.cross_branch)::bigint,
    (SELECT p.cnt  FROM pend p)::bigint,
    (SELECT p.cost FROM pend p)::numeric
  FROM x;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. BẢNG CHÍNH — mỗi chi nhánh XUẤT bao nhiêu / NHẬN bao nhiêu
--
--    Chiều XUẤT (out_*) mới là doanh số & lợi nhuận của chi nhánh đó.
--    Chiều NHẬN (in_*) là THAM KHẢO: giá trị hàng nhận về, và chênh lệch
--    so với giá vốn gốc bên bán (`in_markup`) — tức phần biên mà chi
--    nhánh nguồn ăn trên lưng chi nhánh nhận. Admin nhìn số này để chốt
--    giá bán hợp lý cho chi nhánh nhận (đúng mục đích bước duyệt giá).
--
--    p_compare: 'none' | 'prev' (kỳ liền trước cùng độ dài) | 'yoy'
--    p_sort:    'out' | 'profit' | 'margin' | 'in' | 'transfers'
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_branch_transfer_by_branch(
  p_from    timestamptz,
  p_to      timestamptz,
  p_compare text DEFAULT 'none',
  p_sort    text DEFAULT 'out'
)
RETURNS TABLE (
  branch_id          uuid,
  branch_code        text,
  branch_name        text,
  out_amount         numeric,
  out_cost           numeric,
  out_margin         numeric,
  out_margin_pct     numeric,
  out_qty            numeric,
  out_transfers      bigint,
  out_lines          bigint,
  out_products       bigint,
  out_partners       bigint,   -- số CN nhận hàng từ CN này
  in_amount          numeric,
  in_source_cost     numeric,
  in_markup          numeric,  -- in_amount − in_source_cost
  in_markup_pct      numeric,
  in_qty             numeric,
  in_transfers       bigint,
  in_products        bigint,
  in_partners        bigint,
  net_amount         numeric,  -- out_amount − in_amount (luồng hàng ròng)
  out_share          numeric,  -- % doanh số nội bộ toàn công ty
  margin_share       numeric,
  prev_out_amount    numeric,
  prev_out_margin    numeric,
  prev_out_transfers bigint,
  out_growth         numeric,
  margin_growth      numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pf timestamptz;
  v_pt timestamptz;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo chuyển kho' USING ERRCODE = '42501';
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
    SELECT * FROM public.fn_branch_transfer_lines(p_from, p_to, NULL, NULL) WHERE cross_branch
  ),
  outb AS (
    SELECT
      c.from_branch_id                    AS bid,
      SUM(c.amount)                       AS amount,
      SUM(c.cost)                         AS cost,
      SUM(c.margin_amount)                AS margin,
      SUM(c.quantity)                     AS qty,
      COUNT(DISTINCT c.transfer_id)       AS transfers,
      COUNT(*)                            AS lines,
      COUNT(DISTINCT c.product_id)        AS products,
      COUNT(DISTINCT c.to_branch_id)      AS partners
    FROM cur c GROUP BY c.from_branch_id
  ),
  inb AS (
    SELECT
      c.to_branch_id                      AS bid,
      SUM(c.amount)                       AS amount,
      SUM(c.cost)                         AS src_cost,
      SUM(c.quantity)                     AS qty,
      COUNT(DISTINCT c.transfer_id)       AS transfers,
      COUNT(DISTINCT c.product_id)        AS products,
      COUNT(DISTINCT c.from_branch_id)    AS partners
    FROM cur c GROUP BY c.to_branch_id
  ),
  prev AS (
    SELECT
      pl.from_branch_id             AS bid,
      SUM(pl.amount)                AS amount,
      SUM(pl.margin_amount)         AS margin,
      COUNT(DISTINCT pl.transfer_id) AS transfers
    FROM public.fn_branch_transfer_lines(v_pf, v_pt, NULL, NULL) pl
    WHERE v_pf IS NOT NULL AND pl.cross_branch
    GROUP BY pl.from_branch_id
  ),
  ids AS (
    SELECT o.bid FROM outb o
    UNION
    SELECT i.bid FROM inb i
  ),
  tot AS (
    SELECT
      NULLIF(SUM(o.amount), 0) AS amount,
      NULLIF(SUM(o.margin), 0) AS margin
    FROM outb o
  )
  SELECT
    k.bid,
    br.code,
    COALESCE(br.name, '(Không xác định)'),
    COALESCE(o.amount, 0)::numeric,
    COALESCE(o.cost, 0)::numeric,
    COALESCE(o.margin, 0)::numeric,
    CASE WHEN COALESCE(o.amount, 0) > 0
         THEN ROUND(o.margin / o.amount * 100, 2) ELSE 0 END::numeric,
    COALESCE(o.qty, 0)::numeric,
    COALESCE(o.transfers, 0)::bigint,
    COALESCE(o.lines, 0)::bigint,
    COALESCE(o.products, 0)::bigint,
    COALESCE(o.partners, 0)::bigint,
    COALESCE(i.amount, 0)::numeric,
    COALESCE(i.src_cost, 0)::numeric,
    COALESCE(i.amount - i.src_cost, 0)::numeric,
    CASE WHEN COALESCE(i.src_cost, 0) > 0
         THEN ROUND((i.amount - i.src_cost) / i.src_cost * 100, 2) ELSE 0 END::numeric,
    COALESCE(i.qty, 0)::numeric,
    COALESCE(i.transfers, 0)::bigint,
    COALESCE(i.products, 0)::bigint,
    COALESCE(i.partners, 0)::bigint,
    (COALESCE(o.amount, 0) - COALESCE(i.amount, 0))::numeric,
    ROUND(COALESCE(o.amount, 0) / (SELECT t.amount FROM tot t) * 100, 2)::numeric,
    ROUND(COALESCE(o.margin, 0) / (SELECT t.margin FROM tot t) * 100, 2)::numeric,
    COALESCE(pv.amount, 0)::numeric,
    COALESCE(pv.margin, 0)::numeric,
    COALESCE(pv.transfers, 0)::bigint,
    CASE WHEN COALESCE(pv.amount, 0) > 0
         THEN ROUND((COALESCE(o.amount, 0) - pv.amount) / pv.amount * 100, 1) END::numeric,
    CASE WHEN COALESCE(pv.margin, 0) > 0
         THEN ROUND((COALESCE(o.margin, 0) - pv.margin) / pv.margin * 100, 1) END::numeric
  FROM ids k
  LEFT JOIN outb o  ON o.bid  = k.bid
  LEFT JOIN inb  i  ON i.bid  = k.bid
  LEFT JOIN prev pv ON pv.bid = k.bid
  LEFT JOIN public.branches br ON br.id = k.bid
  ORDER BY
    CASE p_sort
      WHEN 'profit'    THEN COALESCE(o.margin, 0)
      WHEN 'margin'    THEN CASE WHEN COALESCE(o.amount, 0) > 0
                                 THEN o.margin / o.amount ELSE 0 END
      WHEN 'in'        THEN COALESCE(i.amount, 0)
      WHEN 'transfers' THEN COALESCE(o.transfers, 0)::numeric
      ELSE COALESCE(o.amount, 0)
    END DESC NULLS LAST;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. MA TRẬN LUỒNG HÀNG — Từ chi nhánh → Đến chi nhánh
--    Đây là lát cắt cho thấy mô hình "Hoài Ân là kho tổng": một dòng
--    nguồn duy nhất tỏa ra nhiều đích.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_branch_transfer_matrix(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  from_branch_id   uuid,
  from_branch_code text,
  from_branch_name text,
  to_branch_id     uuid,
  to_branch_code   text,
  to_branch_name   text,
  amount           numeric,
  cost             numeric,
  margin           numeric,
  margin_pct       numeric,
  qty              numeric,
  transfers        bigint,
  lines            bigint,
  products         bigint,
  amount_share     numeric,
  last_at          timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo chuyển kho' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT
      l.from_branch_id AS fb,
      l.to_branch_id   AS tb,
      SUM(l.amount)                 AS amount,
      SUM(l.cost)                   AS cost,
      SUM(l.margin_amount)          AS margin,
      SUM(l.quantity)               AS qty,
      COUNT(DISTINCT l.transfer_id) AS transfers,
      COUNT(*)                      AS lines,
      COUNT(DISTINCT l.product_id)  AS products,
      MAX(l.recognized_at)          AS last_at
    FROM public.fn_branch_transfer_lines(p_from, p_to, NULL, NULL) l
    WHERE l.cross_branch
    GROUP BY l.from_branch_id, l.to_branch_id
  ),
  tot AS (SELECT NULLIF(SUM(a.amount), 0) AS amount FROM agg a)
  SELECT
    a.fb, bf.code, COALESCE(bf.name, '(Không xác định)'),
    a.tb, bt.code, COALESCE(bt.name, '(Không xác định)'),
    a.amount::numeric,
    a.cost::numeric,
    a.margin::numeric,
    CASE WHEN a.amount > 0 THEN ROUND(a.margin / a.amount * 100, 2) ELSE 0 END::numeric,
    a.qty::numeric,
    a.transfers::bigint,
    a.lines::bigint,
    a.products::bigint,
    ROUND(a.amount / (SELECT t.amount FROM tot t) * 100, 2)::numeric,
    a.last_at
  FROM agg a
  LEFT JOIN public.branches bf ON bf.id = a.fb
  LEFT JOIN public.branches bt ON bt.id = a.tb
  ORDER BY a.amount DESC NULLS LAST;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. XU HƯỚNG theo ngày/tuần/tháng (đã lấp khoảng trống → chart mượt)
--    p_from_branch / p_to_branch = NULL → toàn công ty.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_branch_transfer_trend(
  p_from        timestamptz,
  p_to          timestamptz,
  p_from_branch uuid DEFAULT NULL,
  p_to_branch   uuid DEFAULT NULL,
  p_bucket      text DEFAULT 'day'
)
RETURNS TABLE (
  bucket_start date,
  amount       numeric,
  cost         numeric,
  margin       numeric,
  margin_pct   numeric,
  qty          numeric,
  transfers    bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_step interval;
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo chuyển kho' USING ERRCODE = '42501';
  END IF;
  IF p_bucket NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Đơn vị thời gian không hợp lệ: %', p_bucket;
  END IF;
  v_step := ('1 ' || p_bucket)::interval;

  RETURN QUERY
  WITH agg AS (
    SELECT
      date_trunc(p_bucket, l.recognized_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS b,
      SUM(l.amount)                 AS amount,
      SUM(l.cost)                   AS cost,
      SUM(l.margin_amount)          AS margin,
      SUM(l.quantity)               AS qty,
      COUNT(DISTINCT l.transfer_id) AS transfers
    FROM public.fn_branch_transfer_lines(p_from, p_to, p_from_branch, p_to_branch) l
    WHERE l.cross_branch
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
    COALESCE(a.amount, 0)::numeric,
    COALESCE(a.cost, 0)::numeric,
    COALESCE(a.margin, 0)::numeric,
    CASE WHEN COALESCE(a.amount, 0) > 0
         THEN ROUND(a.margin / a.amount * 100, 2) ELSE 0 END::numeric,
    COALESCE(a.qty, 0)::numeric,
    COALESCE(a.transfers, 0)::bigint
  FROM series s
  LEFT JOIN agg a ON a.b = s.b
  ORDER BY s.b;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. TOP N theo chiều tùy chọn
--    p_dim: 'product' | 'brand' | 'category' | 'to_branch' | 'from_branch' | 'creator'
--    p_sort: 'amount' | 'margin' | 'margin_pct' | 'qty'
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_branch_transfer_breakdown(
  p_from        timestamptz,
  p_to          timestamptz,
  p_from_branch uuid    DEFAULT NULL,
  p_to_branch   uuid    DEFAULT NULL,
  p_dim         text    DEFAULT 'product',
  p_sort        text    DEFAULT 'amount',
  p_limit       integer DEFAULT 20
)
RETURNS TABLE (
  dim_key      text,
  dim_label    text,
  dim_sub      text,
  amount       numeric,
  cost         numeric,
  margin       numeric,
  margin_pct   numeric,
  qty          numeric,
  transfers    bigint,
  amount_share numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo chuyển kho' USING ERRCODE = '42501';
  END IF;
  IF p_dim NOT IN ('product', 'brand', 'category', 'to_branch', 'from_branch', 'creator') THEN
    RAISE EXCEPTION 'Chiều phân tích không hợp lệ: %', p_dim;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      l.*,
      CASE p_dim
        WHEN 'product'     THEN l.product_id::text
        WHEN 'brand'       THEN l.brand_id::text
        WHEN 'category'    THEN l.category_id::text
        WHEN 'to_branch'   THEN l.to_branch_id::text
        WHEN 'from_branch' THEN l.from_branch_id::text
        WHEN 'creator'     THEN l.created_by::text
      END AS k,
      CASE p_dim
        WHEN 'product'     THEN p.name
        WHEN 'brand'       THEN COALESCE(b.name, '(Không thương hiệu)')
        WHEN 'category'    THEN COALESCE(cat.name, '(Không nhóm hàng)')
        WHEN 'to_branch'   THEN COALESCE(tb.name, '(Không xác định)')
        WHEN 'from_branch' THEN COALESCE(fb.name, '(Không xác định)')
        WHEN 'creator'     THEN COALESCE(pr.full_name, '(Không rõ người lập)')
      END AS lbl,
      CASE p_dim
        WHEN 'product'     THEN p.sku
        WHEN 'to_branch'   THEN tb.code
        WHEN 'from_branch' THEN fb.code
        ELSE NULL
      END AS sub
    FROM public.fn_branch_transfer_lines(p_from, p_to, p_from_branch, p_to_branch) l
    LEFT JOIN public.products           p   ON p.id   = l.product_id
    LEFT JOIN public.brands             b   ON b.id   = l.brand_id
    LEFT JOIN public.product_categories cat ON cat.id = l.category_id
    LEFT JOIN public.branches           tb  ON tb.id  = l.to_branch_id
    LEFT JOIN public.branches           fb  ON fb.id  = l.from_branch_id
    LEFT JOIN public.profiles           pr  ON pr.id  = l.created_by
    WHERE l.cross_branch
  ),
  agg AS (
    SELECT
      base.k,
      max(base.lbl) AS lbl,
      max(base.sub) AS sub,
      SUM(base.amount)                 AS amount,
      SUM(base.cost)                   AS cost,
      SUM(base.margin_amount)          AS margin,
      SUM(base.quantity)               AS qty,
      COUNT(DISTINCT base.transfer_id) AS transfers
    FROM base
    WHERE base.k IS NOT NULL
    GROUP BY base.k
  ),
  tot AS (SELECT NULLIF(SUM(agg.amount), 0) AS amount FROM agg)
  SELECT
    a.k, a.lbl, a.sub,
    a.amount::numeric,
    a.cost::numeric,
    a.margin::numeric,
    CASE WHEN a.amount > 0 THEN ROUND(a.margin / a.amount * 100, 2) ELSE 0 END::numeric,
    a.qty::numeric,
    a.transfers::bigint,
    ROUND(a.amount / (SELECT t.amount FROM tot t) * 100, 2)::numeric
  FROM agg a
  ORDER BY
    CASE p_sort
      WHEN 'margin'     THEN a.margin
      WHEN 'margin_pct' THEN CASE WHEN a.amount > 0 THEN a.margin / a.amount ELSE 0 END
      WHEN 'qty'        THEN a.qty
      ELSE a.amount
    END DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. DANH SÁCH CHỨNG TỪ — soi tận từng phiếu
--    `total_count` trả kèm mỗi dòng (window) để FE phân trang mà không
--    phải gọi thêm một RPC đếm.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_branch_transfer_docs(
  p_from        timestamptz,
  p_to          timestamptz,
  p_from_branch uuid    DEFAULT NULL,
  p_to_branch   uuid    DEFAULT NULL,
  p_search      text    DEFAULT NULL,
  p_sort        text    DEFAULT 'recent',
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE (
  transfer_id    uuid,
  transfer_code  text,
  recognized_at  timestamptz,
  transfer_date  date,
  from_branch    text,
  to_branch      text,
  from_warehouse text,
  to_warehouse   text,
  created_by     text,
  approved_by    text,
  lines          bigint,
  qty            numeric,
  amount         numeric,
  cost           numeric,
  margin         numeric,
  margin_pct     numeric,
  edited_lines   bigint,
  -- Tổng của TOÀN BỘ tập lọc (kể cả trang khác) — dòng tổng của bảng phải là
  -- tổng cả tập chứ không phải tổng trang đang xem.
  total_count    bigint,
  all_qty        numeric,
  all_amount     numeric,
  all_cost       numeric,
  all_margin     numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_has_role('admin') THEN
    RAISE EXCEPTION 'Không có quyền truy cập báo cáo chuyển kho' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  -- GROUP BY cả cụm cột "của phiếu" (đều phụ thuộc hàm vào transfer_id) thay
  -- vì bọc max() — Postgres không có aggregate max(uuid).
  WITH agg AS (
    SELECT
      l.transfer_id,
      l.transfer_code,
      l.recognized_at,
      l.transfer_date,
      l.from_branch_id AS fb,
      l.to_branch_id   AS tb,
      l.from_warehouse AS fw,
      l.to_warehouse   AS tw,
      l.created_by     AS cb,
      l.approved_by    AS ab,
      COUNT(*)             AS lines,
      SUM(l.quantity)      AS qty,
      SUM(l.amount)        AS amount,
      SUM(l.cost)          AS cost,
      SUM(l.margin_amount) AS margin,
      COUNT(*) FILTER (WHERE l.price_edited) AS edited_lines
    FROM public.fn_branch_transfer_lines(p_from, p_to, p_from_branch, p_to_branch) l
    WHERE l.cross_branch
      AND (
        p_search IS NULL OR p_search = ''
        OR l.transfer_code ILIKE '%' || p_search || '%'
      )
    GROUP BY
      l.transfer_id, l.transfer_code, l.recognized_at, l.transfer_date,
      l.from_branch_id, l.to_branch_id, l.from_warehouse, l.to_warehouse,
      l.created_by, l.approved_by
  )
  SELECT
    a.transfer_id,
    a.transfer_code,
    a.recognized_at,
    a.transfer_date,
    COALESCE(fbr.name, '(Không xác định)'),
    COALESCE(tbr.name, '(Không xác định)'),
    COALESCE(fwh.name, '—'),
    COALESCE(twh.name, '—'),
    COALESCE(cp.full_name, '—'),
    COALESCE(ap.full_name, '—'),
    a.lines::bigint,
    a.qty::numeric,
    a.amount::numeric,
    a.cost::numeric,
    a.margin::numeric,
    CASE WHEN a.amount > 0 THEN ROUND(a.margin / a.amount * 100, 2) ELSE 0 END::numeric,
    a.edited_lines::bigint,
    COUNT(*) OVER ()::bigint,
    SUM(a.qty)    OVER ()::numeric,
    SUM(a.amount) OVER ()::numeric,
    SUM(a.cost)   OVER ()::numeric,
    SUM(a.margin) OVER ()::numeric
  FROM agg a
  LEFT JOIN public.branches   fbr ON fbr.id = a.fb
  LEFT JOIN public.branches   tbr ON tbr.id = a.tb
  LEFT JOIN public.warehouses fwh ON fwh.id = a.fw
  LEFT JOIN public.warehouses twh ON twh.id = a.tw
  LEFT JOIN public.profiles   cp  ON cp.id  = a.cb
  LEFT JOIN public.profiles   ap  ON ap.id  = a.ab
  -- p_sort='recent' (mặc định) → khóa đầu toàn NULL, mọi dòng hòa nhau và
  -- rơi xuống khóa phụ recognized_at. Không cần nhánh riêng.
  ORDER BY
    CASE WHEN p_sort = 'amount' THEN a.amount
         WHEN p_sort = 'margin' THEN a.margin
    END DESC NULLS LAST,
    a.recognized_at DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 8. GRANT (mỗi RPC tự guard admin bên trong)
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_branch_transfer_summary(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_branch_transfer_by_branch(timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_branch_transfer_matrix(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_branch_transfer_trend(timestamptz, timestamptz, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_branch_transfer_breakdown(timestamptz, timestamptz, uuid, uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_branch_transfer_docs(timestamptz, timestamptz, uuid, uuid, text, text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_branch_transfer_summary(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_branch_transfer_by_branch(timestamptz, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_branch_transfer_matrix(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_branch_transfer_trend(timestamptz, timestamptz, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_branch_transfer_breakdown(timestamptz, timestamptz, uuid, uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_branch_transfer_docs(timestamptz, timestamptz, uuid, uuid, text, text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.fn_branch_transfer_summary(timestamptz, timestamptz, uuid, uuid) IS
  'KPI báo cáo chuyển kho nội bộ: doanh số giá chuyển, giá vốn nguồn, lãi nội bộ, biên; kèm số chuyển nội bộ cùng CN và hàng chưa vào sổ. Admin-only.';
COMMENT ON FUNCTION public.fn_branch_transfer_by_branch(timestamptz, timestamptz, text, text) IS
  'Doanh số/lợi nhuận chuyển kho theo chi nhánh: chiều XUẤT (bán nội bộ) + chiều NHẬN (tham khảo) + so kỳ trước. Admin-only.';
COMMENT ON FUNCTION public.fn_branch_transfer_matrix(timestamptz, timestamptz) IS
  'Ma trận luồng hàng Từ chi nhánh → Đến chi nhánh trong kỳ. Admin-only.';
COMMENT ON FUNCTION public.fn_branch_transfer_trend(timestamptz, timestamptz, uuid, uuid, text) IS
  'Xu hướng doanh số/lãi chuyển kho theo ngày/tuần/tháng (đã lấp khoảng trống). Admin-only.';
COMMENT ON FUNCTION public.fn_branch_transfer_breakdown(timestamptz, timestamptz, uuid, uuid, text, text, integer) IS
  'Top N chuyển kho theo sản phẩm/thương hiệu/nhóm hàng/chi nhánh nhận/chi nhánh xuất/người lập phiếu. Admin-only.';
COMMENT ON FUNCTION public.fn_branch_transfer_docs(timestamptz, timestamptz, uuid, uuid, text, text, integer, integer) IS
  'Danh sách chứng từ chuyển kho đã duyệt kèm giá trị/lãi từng phiếu, có phân trang (total_count qua window). Admin-only.';

NOTIFY pgrst, 'reload schema';
