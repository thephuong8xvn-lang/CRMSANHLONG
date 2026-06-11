-- ─────────────────────────────────────────────────────────────
-- fn_product_movements — Thẻ kho sản phẩm KÈM đối tượng giao dịch
--
-- Trước đây client query stock_movements thô: không có tên KH/NCC,
-- không có mã chứng từ, giá bán (unit_cost NULL với dòng sale),
-- không có nhóm giá. RPC này enrich qua reference_id/reference_type:
--   • order / order_reverse → order_code + tên KH + đơn giá thực bán + nhóm giá
--   • goods_receipt         → receipt_code + tên NCC (giá nhập = unit_cost)
--   • sales_return          → return_code + tên KH (qua đơn gốc)
--   • transfer              → transfer_code (không đối tượng)
--   • manual_lot / khác     → không đối tượng
-- (Ghi chú: bảng purchase_returns KHÔNG tồn tại trên remote — file
--  migration 20260524000002 chưa từng được apply; không join.)
--
-- Giá bán dòng 'order': MAX(unit_price) các dòng cùng SP trong đơn
-- (bỏ qua dòng quà tặng 0đ của khuyến mãi).
-- SECURITY INVOKER: RLS bảng nền vẫn áp dụng — user không đọc được
-- đơn/phiếu nào thì cột đối tượng trả NULL (hiển thị "—").
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_product_movements(
  p_product_id UUID,
  p_branch_id  UUID DEFAULT NULL,
  p_limit      INT  DEFAULT 50
)
RETURNS TABLE (
  id              UUID,
  created_at      TIMESTAMPTZ,
  movement_type   TEXT,
  quantity        NUMERIC,
  unit_cost       NUMERIC,
  notes           TEXT,
  lot_number      TEXT,
  warehouse_code  TEXT,
  warehouse_name  TEXT,
  performer_name  TEXT,
  ref_type        TEXT,
  ref_id          UUID,
  ref_code        TEXT,
  partner_name    TEXT,
  txn_price       NUMERIC,
  price_list_name TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    sm.id,
    sm.created_at,
    sm.movement_type::TEXT,
    sm.quantity::NUMERIC,
    sm.unit_cost,
    sm.notes,
    sl.lot_number,
    w.code,
    w.name,
    pf.full_name,
    sm.reference_type,
    sm.reference_id,
    CASE
      WHEN sm.reference_type IN ('order', 'order_reverse') THEN o.order_code
      WHEN sm.reference_type = 'goods_receipt'             THEN gr.receipt_code
      WHEN sm.reference_type = 'sales_return'              THEN sr.return_code
      WHEN sm.reference_type = 'transfer'                  THEN st.transfer_code
      ELSE NULL
    END,
    CASE
      WHEN sm.reference_type IN ('order', 'order_reverse') THEN c_o.farm_name
      WHEN sm.reference_type = 'goods_receipt'             THEN sup_gr.name
      WHEN sm.reference_type = 'sales_return'              THEN c_sr.farm_name
      ELSE NULL
    END,
    CASE
      WHEN sm.reference_type IN ('order', 'order_reverse') THEN ol_price.sale_price
      ELSE sm.unit_cost
    END,
    pl.name
  FROM public.stock_movements sm
  JOIN public.stock_lots sl ON sl.id = sm.lot_id
  JOIN public.warehouses w  ON w.id  = sm.warehouse_id
  LEFT JOIN public.profiles pf ON pf.id = sm.performed_by
  -- Bán hàng / hoàn tác đơn: đơn + KH + nhóm giá + đơn giá thực bán
  LEFT JOIN public.orders o        ON sm.reference_type IN ('order', 'order_reverse') AND o.id = sm.reference_id
  LEFT JOIN public.customers c_o   ON c_o.id = o.customer_id
  LEFT JOIN public.price_lists pl  ON pl.id = o.price_list_id
  LEFT JOIN LATERAL (
    SELECT MAX(ol.unit_price) AS sale_price
    FROM public.order_lines ol
    WHERE ol.order_id = o.id AND ol.product_id = sm.product_id
  ) ol_price ON o.id IS NOT NULL
  -- Nhập NCC
  LEFT JOIN public.goods_receipts gr ON sm.reference_type = 'goods_receipt' AND gr.id = sm.reference_id
  LEFT JOIN public.suppliers sup_gr  ON sup_gr.id = gr.supplier_id
  -- Khách trả hàng (qua đơn gốc)
  LEFT JOIN public.sales_returns sr ON sm.reference_type = 'sales_return' AND sr.id = sm.reference_id
  LEFT JOIN public.orders o_sr      ON o_sr.id = sr.order_id
  LEFT JOIN public.customers c_sr   ON c_sr.id = o_sr.customer_id
  -- Chuyển kho
  LEFT JOIN public.stock_transfers st ON sm.reference_type = 'transfer' AND st.id = sm.reference_id
  WHERE sm.product_id = p_product_id
    AND (p_branch_id IS NULL OR w.branch_id = p_branch_id)
  ORDER BY sm.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
$$;

COMMENT ON FUNCTION public.fn_product_movements IS
'Thẻ kho 1 sản phẩm (lọc chi nhánh tùy chọn) kèm đối tượng giao dịch: mã chứng từ + tên KH/NCC + đơn giá thực bán + nhóm giá. Dùng cho quick view & trang chi tiết sản phẩm.';

GRANT EXECUTE ON FUNCTION public.fn_product_movements(UUID, UUID, INT) TO authenticated;
