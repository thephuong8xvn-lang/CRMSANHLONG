-- Migration: Alter quantity columns to support decimals (NUMERIC(15, 3))
-- File: 20260529000012_alter_quantity_to_decimal.sql

-- 0. Drop dependent views and triggers that reference quantity columns
DROP VIEW IF EXISTS public.product_stock_summary_view CASCADE;
DROP TRIGGER IF EXISTS trg_stock_lots_check_alert ON public.stock_lots;

-- 1. Alter table column types
-- A. purchase_order_lines (drop generated 'total' first)
ALTER TABLE public.purchase_order_lines DROP COLUMN IF EXISTS total;
ALTER TABLE public.purchase_order_lines ALTER COLUMN quantity TYPE NUMERIC(15, 3);
ALTER TABLE public.purchase_order_lines ALTER COLUMN received_qty TYPE NUMERIC(15, 3);
ALTER TABLE public.purchase_order_lines ADD COLUMN total NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * quantity) STORED;

-- B. goods_receipt_lines (drop generated 'line_total' first)
ALTER TABLE public.goods_receipt_lines DROP COLUMN IF EXISTS line_total;
ALTER TABLE public.goods_receipt_lines ALTER COLUMN quantity TYPE NUMERIC(15, 3);
ALTER TABLE public.goods_receipt_lines ADD COLUMN line_total NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * quantity) STORED;

-- C. stock_lots (no generated columns)
ALTER TABLE public.stock_lots ALTER COLUMN quantity_on_hand TYPE NUMERIC(15, 3);
ALTER TABLE public.stock_lots ALTER COLUMN quantity_reserved TYPE NUMERIC(15, 3);

-- D. stock_movements (no generated columns)
ALTER TABLE public.stock_movements ALTER COLUMN quantity TYPE NUMERIC(15, 3);

-- E. stock_transfer_lines (no generated columns)
ALTER TABLE public.stock_transfer_lines ALTER COLUMN quantity TYPE NUMERIC(15, 3);

-- F. order_lines (drop generated 'line_total' first)
ALTER TABLE public.order_lines DROP COLUMN IF EXISTS line_total;
ALTER TABLE public.order_lines ALTER COLUMN quantity TYPE NUMERIC(15, 3);
ALTER TABLE public.order_lines ADD COLUMN line_total NUMERIC(15,2) GENERATED ALWAYS AS ((unit_price - discount) * quantity) STORED;

-- G. order_line_allocations (no generated columns)
ALTER TABLE public.order_line_allocations ALTER COLUMN quantity TYPE NUMERIC(15, 3);

-- H. sales_return_lines (drop generated 'line_total' first)
ALTER TABLE public.sales_return_lines DROP COLUMN IF EXISTS line_total;
ALTER TABLE public.sales_return_lines ALTER COLUMN quantity TYPE NUMERIC(15, 3);
ALTER TABLE public.sales_return_lines ADD COLUMN line_total NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * quantity) STORED;


-- 2. Drop old functions with old signatures (so we can recreate them with NUMERIC)
DROP FUNCTION IF EXISTS public.fn_allocate_lots_fefo(UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.fn_allocate_lots_fefo(UUID, UUID, NUMERIC);

-- 3. Redefine fn_allocate_lots_fefo with NUMERIC(15, 3)
CREATE OR REPLACE FUNCTION public.fn_allocate_lots_fefo(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_quantity     NUMERIC(15, 3)
)
RETURNS TABLE (lot_id UUID, allocated_qty NUMERIC(15, 3))
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lot         RECORD;
  v_remaining   NUMERIC(15, 3) := p_quantity;
  v_available   NUMERIC(15, 3);
  v_alloc       NUMERIC(15, 3);
BEGIN
  -- Duyệt qua các lô còn hàng, sắp xếp theo FEFO
  FOR v_lot IN
    SELECT id, quantity_on_hand, quantity_reserved
    FROM public.stock_lots
    WHERE product_id   = p_product_id
      AND warehouse_id = p_warehouse_id
      AND status       = 'active'
      AND quantity_on_hand > quantity_reserved
    ORDER BY
      expiry_date   ASC NULLS LAST,   -- Lô hết hạn trước → xuất trước
      received_at   ASC               -- Tiebreak: nhập trước → xuất trước
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_available := v_lot.quantity_on_hand - v_lot.quantity_reserved;
    v_alloc     := LEAST(v_remaining, v_available);

    -- Cập nhật số lượng đã đặt trước
    UPDATE public.stock_lots
    SET quantity_reserved = quantity_reserved + v_alloc,
        updated_at        = now()
    WHERE id = v_lot.id;

    v_remaining := v_remaining - v_alloc;

    lot_id       := v_lot.id;
    allocated_qty := v_alloc;
    RETURN NEXT;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'Không đủ hàng trong kho. Còn thiếu % đơn vị cho sản phẩm %',
      v_remaining, p_product_id;
  END IF;
END;
$$;

-- 4. Redefine fn_check_stock_alerts with NUMERIC(15, 3)
CREATE OR REPLACE FUNCTION public.fn_check_stock_alerts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_setting    RECORD;
  v_total_qty  NUMERIC(15,3);
BEGIN
  -- Tính tổng tồn kho theo product_id + warehouse_id
  SELECT
    COALESCE(SUM(quantity_on_hand - quantity_reserved), 0) AS available
  INTO v_total_qty
  FROM public.stock_lots
  WHERE product_id   = NEW.product_id
    AND warehouse_id = NEW.warehouse_id
    AND status       = 'active';

  -- Lấy cài đặt tồn kho
  SELECT * INTO v_setting
  FROM public.inventory_settings
  WHERE product_id   = NEW.product_id
    AND warehouse_id = NEW.warehouse_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Cảnh báo tồn kho dưới mức tối thiểu
  IF v_total_qty <= v_setting.min_stock_level THEN
    INSERT INTO public.inventory_alerts (
      product_id, warehouse_id, alert_type, severity, status, message,
      threshold_value, actual_value
    )
    VALUES (
      NEW.product_id, NEW.warehouse_id,
      'low_stock',
      CASE WHEN v_total_qty = 0 THEN 'critical' ELSE 'warning' END,
      'active',
      'Tồn kho thấp dưới mức tối thiểu. Hiện có: ' || v_total_qty || ' | Tối thiểu: ' || v_setting.min_stock_level,
      v_setting.min_stock_level,
      v_total_qty
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Redefine fn_start_transfer with NUMERIC(15, 3) variables
CREATE OR REPLACE FUNCTION public.fn_start_transfer(
  p_transfer_id UUID,
  p_user_id     UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer  RECORD;
  v_line      RECORD;
  v_available NUMERIC(15, 3);
BEGIN
  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;

  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'Phiếu chuyển kho phải ở trạng thái Nháp để bắt đầu chuyển.';
  END IF;

  FOR v_line IN
    SELECT * FROM public.stock_transfer_lines
    WHERE transfer_id = p_transfer_id
  LOOP
    SELECT (quantity_on_hand - quantity_reserved)
    INTO v_available
    FROM public.stock_lots
    WHERE id = v_line.lot_id
    FOR UPDATE;

    IF v_available IS NULL THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng (id: %).', v_line.lot_id;
    END IF;

    IF v_available < v_line.quantity THEN
      RAISE EXCEPTION 'Lô hàng không đủ tồn khả dụng. Yêu cầu: %, Khả dụng: %.', v_line.quantity, v_available;
    END IF;

    UPDATE public.stock_lots
    SET quantity_on_hand = quantity_on_hand - v_line.quantity,
        updated_at = now()
    WHERE id = v_line.lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, performed_by
    ) VALUES (
      v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
      'transfer_out', -v_line.quantity, p_transfer_id, 'transfer', p_user_id
    );
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'in_transit', updated_at = now()
  WHERE id = p_transfer_id;
END;
$$;

-- 6. Re-create view product_stock_summary_view with decimal support
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
      COALESCE(SUM(quantity_on_hand), 0)::NUMERIC(15, 3) AS stock_on_hand
    FROM public.stock_lots
    WHERE quantity_on_hand > 0
    GROUP BY product_id
  ),
  on_order_agg AS (
    SELECT
      ol.product_id,
      COALESCE(SUM(ol.quantity), 0)::NUMERIC(15, 3) AS on_order_qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.status IN ('confirmed', 'shipping')
    GROUP BY ol.product_id
  ),
  sales_30d AS (
    SELECT
      ol.product_id,
      COALESCE(SUM(ol.quantity), 0)::NUMERIC(15, 3) AS qty_30d
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

-- 7. Re-create trigger trg_stock_lots_check_alert
CREATE TRIGGER trg_stock_lots_check_alert
  AFTER UPDATE ON public.stock_lots
  FOR EACH ROW
  WHEN (OLD.quantity_on_hand IS DISTINCT FROM NEW.quantity_on_hand)
  EXECUTE FUNCTION public.fn_check_stock_alerts();
