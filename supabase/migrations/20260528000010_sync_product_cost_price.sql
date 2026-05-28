-- ─────────────────────────────────────────────────────────────
-- CRM SANHLONGVETCO – PRICE SYNCHRONIZATION MIGRATION (Sprint P4)
-- File: 20260528000010_sync_product_cost_price.sql
-- Mô tả: Đồng bộ giá vốn của sản phẩm từ phiếu nhập kho
--        và cập nhật view tổng hợp sản phẩm để tự động fallback
-- ─────────────────────────────────────────────────────────────

-- 1. Cập nhật trigger function fn_create_stock_lot_on_receipt
CREATE OR REPLACE FUNCTION public.fn_create_stock_lot_on_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt RECORD;
BEGIN
  -- Lấy thông tin phiếu nhập
  SELECT supplier_id, warehouse_id, received_by
  INTO v_receipt
  FROM public.goods_receipts
  WHERE id = NEW.receipt_id;

  -- Tạo hoặc cập nhật lô hàng
  INSERT INTO public.stock_lots (
    product_id, warehouse_id, supplier_id, receipt_id,
    lot_number, manufacture_date, expiry_date,
    cost_price, quantity_on_hand
  )
  VALUES (
    NEW.product_id,
    v_receipt.warehouse_id,
    v_receipt.supplier_id,
    NEW.receipt_id,
    COALESCE(NEW.lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MISS')),
    NEW.manufacture_date,
    NEW.expiry_date,
    NEW.unit_price,
    NEW.quantity
  )
  ON CONFLICT (product_id, lot_number, warehouse_id) DO UPDATE
    SET quantity_on_hand = stock_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
        updated_at       = now();

  -- Ghi phiếu nhập kho
  INSERT INTO public.stock_movements (
    lot_id, product_id, warehouse_id,
    movement_type, quantity,
    reference_id, reference_type,
    unit_cost, performed_by
  )
  SELECT
    sl.id, NEW.product_id, v_receipt.warehouse_id,
    'receipt', NEW.quantity,
    NEW.receipt_id, 'goods_receipt',
    NEW.unit_price, v_receipt.received_by
  FROM public.stock_lots sl
  WHERE sl.product_id   = NEW.product_id
    AND sl.lot_number   = COALESCE(NEW.lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MISS'))
    AND sl.warehouse_id = v_receipt.warehouse_id;

  -- Cập nhật giá vốn trong price_list_items
  UPDATE public.price_list_items
  SET cost_price = NEW.unit_price
  WHERE product_id = NEW.product_id;

  RETURN NEW;
END;
$$;

-- 2. Cập nhật view product_stock_summary_view với cơ chế fallback giá vốn
DROP VIEW IF EXISTS public.product_stock_summary_view;
CREATE VIEW public.product_stock_summary_view
WITH (security_invoker = true) AS
WITH
  retail_price AS (
    SELECT
      pli.product_id,
      pli.selling_price,
      pli.cost_price
    FROM public.price_list_items pli
    JOIN public.price_lists pl ON pl.id = pli.price_list_id
    WHERE pl.code = 'GIA-LE'
  ),
  fallback_price AS (
    SELECT DISTINCT ON (pli.product_id)
      pli.product_id,
      pli.selling_price,
      pli.cost_price
    FROM public.price_list_items pli
    ORDER BY pli.product_id, pli.created_at ASC
  ),
  stock_agg AS (
    SELECT
      product_id,
      COALESCE(SUM(quantity_on_hand), 0)::INTEGER AS stock_on_hand
    FROM public.stock_lots
    WHERE quantity_on_hand > 0
    GROUP BY product_id
  ),
  on_order_agg AS (
    SELECT
      ol.product_id,
      COALESCE(SUM(ol.quantity), 0)::INTEGER AS on_order_qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('confirmed', 'shipping')
    GROUP BY ol.product_id
  ),
  sales_30d AS (
    SELECT
      ol.product_id,
      COALESCE(SUM(ol.quantity), 0)::INTEGER AS qty_30d
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('delivered', 'paid', 'completed')
      AND o.created_at >= (now() - INTERVAL '30 days')
    GROUP BY ol.product_id
  )
SELECT
  p.id,
  p.sku,
  p.name,
  p.unit,
  p.is_lot_managed,
  p.is_active,
  p.category_id,
  p.brand_id,
  p.package_specs,
  p.image_urls,
  p.created_at,
  p.updated_at,
  pc.name AS category_name,
  pc.code AS category_code,
  b.name  AS brand_name,
  COALESCE(rp.selling_price, fp.selling_price, 0)::NUMERIC(15,2) AS retail_price,
  COALESCE(
    NULLIF(rp.cost_price, 0),
    NULLIF(fp.cost_price, 0),
    (
      SELECT cost_price
      FROM public.stock_lots
      WHERE product_id = p.id AND cost_price > 0
      ORDER BY created_at DESC
      LIMIT 1
    ),
    0
  )::NUMERIC(15,2) AS retail_cost,
  COALESCE(s.stock_on_hand, 0)            AS stock_on_hand,
  COALESCE(oo.on_order_qty, 0)            AS on_order_qty,
  COALESCE(s30.qty_30d, 0)                AS sold_30d,
  CASE
    WHEN COALESCE(s30.qty_30d, 0) > 0 AND COALESCE(s.stock_on_hand, 0) > 0
      THEN ROUND(COALESCE(s.stock_on_hand, 0)::NUMERIC / (s30.qty_30d::NUMERIC / 30.0))::INTEGER
    WHEN COALESCE(s.stock_on_hand, 0) = 0 THEN 0
    ELSE NULL
  END AS days_to_oos
FROM public.products p
LEFT JOIN public.product_categories pc ON pc.id = p.category_id
LEFT JOIN public.brands b              ON b.id = p.brand_id
LEFT JOIN retail_price   rp ON rp.product_id = p.id
LEFT JOIN fallback_price fp ON fp.product_id = p.id
LEFT JOIN stock_agg      s  ON s.product_id  = p.id
LEFT JOIN on_order_agg   oo ON oo.product_id = p.id
LEFT JOIN sales_30d      s30 ON s30.product_id = p.id;

GRANT SELECT ON public.product_stock_summary_view TO authenticated;
