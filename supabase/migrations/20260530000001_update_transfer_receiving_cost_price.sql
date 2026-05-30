-- 20260530000001_update_transfer_receiving_cost_price.sql
-- Mô tả: Cập nhật hàm fn_receive_transfer để gán giá vốn cho chi nhánh nhận
--        bằng đơn giá chuyển kho (unit_price) thay vì giá vốn gốc của chi nhánh chuyển.
--        Tính trung bình gia quyền nếu lô đã tồn tại ở kho đích.

CREATE OR REPLACE FUNCTION public.fn_receive_transfer(
  p_transfer_id UUID,
  p_user_id     UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer      RECORD;
  v_line          RECORD;
  v_source_lot    RECORD;
  v_target_lot_id UUID;
BEGIN
  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;

  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Phiếu chuyển kho phải ở trạng thái Đang chuyển để xác nhận nhận hàng.';
  END IF;

  FOR v_line IN
    SELECT * FROM public.stock_transfer_lines
    WHERE transfer_id = p_transfer_id
  LOOP
    SELECT lot_number, manufacture_date, expiry_date, cost_price, status
    INTO v_source_lot
    FROM public.stock_lots
    WHERE id = v_line.lot_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng nguồn (id: %).', v_line.lot_id;
    END IF;

    SELECT id INTO v_target_lot_id
    FROM public.stock_lots
    WHERE product_id  = v_line.product_id
      AND lot_number  = v_source_lot.lot_number
      AND warehouse_id = v_transfer.to_warehouse
    FOR UPDATE;

    IF v_target_lot_id IS NOT NULL THEN
      -- Cập nhật tồn kho và tính lại giá vốn trung bình gia quyền dựa trên giá chuyển kho
      UPDATE public.stock_lots
      SET cost_price = CASE 
            WHEN (quantity_on_hand + v_line.quantity) > 0 THEN 
              ROUND(((quantity_on_hand * cost_price) + (v_line.quantity * COALESCE(v_line.unit_price, 0))) / (quantity_on_hand + v_line.quantity), 2)
            ELSE COALESCE(v_line.unit_price, 0)
          END,
          quantity_on_hand = quantity_on_hand + v_line.quantity,
          updated_at = now()
      WHERE id = v_target_lot_id;
    ELSE
      -- Tạo lô mới với giá vốn bằng giá chuyển kho
      INSERT INTO public.stock_lots (
        product_id, warehouse_id, lot_number,
        manufacture_date, expiry_date, cost_price,
        quantity_on_hand, status
      ) VALUES (
        v_line.product_id, v_transfer.to_warehouse, v_source_lot.lot_number,
        v_source_lot.manufacture_date, v_source_lot.expiry_date, COALESCE(v_line.unit_price, 0),
        v_line.quantity, v_source_lot.status
      ) RETURNING id INTO v_target_lot_id;
    END IF;

    -- Ghi nhận lịch sử di chuyển với giá vốn mới
    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_target_lot_id, v_line.product_id, v_transfer.to_warehouse,
      'transfer_in', v_line.quantity, p_transfer_id, 'transfer', COALESCE(v_line.unit_price, 0), p_user_id
    );
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'received', received_by = p_user_id, updated_at = now()
  WHERE id = p_transfer_id;
END;
$$;
