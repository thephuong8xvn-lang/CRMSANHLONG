-- ============================================================
-- Migration: fn_add_manual_lot
-- File: 20260607000000_fn_add_manual_lot.sql
-- Mục đích: Nhập kho thủ công (thêm lô hàng từ trang chi tiết sản phẩm)
--   phải ghi ĐỒNG THỜI stock_lots + stock_movements trong 1 transaction.
--   Trước đây client chỉ insert stock_lots → tồn kho tăng nhưng Thẻ kho
--   (stock_movements) trống → lệch sổ, không truy vết được.
--
-- SECURITY INVOKER: giữ nguyên RLS — cả 2 INSERT vẫn bị kiểm tra theo
--   policy "stock_lots_manage_warehouse" / "stock_mov_insert_warehouse"
--   (chỉ admin hoặc warehouse_keeper được ghi thủ công). Atomic vì toàn
--   bộ thân hàm chạy trong một transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_add_manual_lot(
  p_product_id      UUID,
  p_warehouse_id    UUID,
  p_lot_number      TEXT,
  p_manufacture_date DATE,
  p_expiry_date     DATE,
  p_quantity        NUMERIC,
  p_cost_price      NUMERIC
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lot_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Số lượng nhập phải lớn hơn 0.';
  END IF;

  -- 1) Tạo lô hàng (nguồn tồn kho)
  INSERT INTO public.stock_lots (
    product_id, warehouse_id, lot_number,
    manufacture_date, expiry_date,
    quantity_on_hand, quantity_reserved, cost_price, status
  ) VALUES (
    p_product_id, p_warehouse_id, p_lot_number,
    p_manufacture_date, p_expiry_date,
    p_quantity, 0, COALESCE(p_cost_price, 0), 'active'
  )
  RETURNING id INTO v_lot_id;

  -- 2) Ghi sổ Thẻ kho (audit) — điều chỉnh tăng do nhập thủ công
  INSERT INTO public.stock_movements (
    lot_id, product_id, warehouse_id,
    movement_type, quantity,
    reference_type, unit_cost, performed_by, notes
  ) VALUES (
    v_lot_id, p_product_id, p_warehouse_id,
    'adjustment_increase', p_quantity,
    'manual_lot', COALESCE(p_cost_price, 0), auth.uid(),
    'Nhập kho thủ công (thêm lô hàng từ trang sản phẩm)'
  );

  RETURN v_lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_add_manual_lot(UUID, UUID, TEXT, DATE, DATE, NUMERIC, NUMERIC) TO authenticated;
