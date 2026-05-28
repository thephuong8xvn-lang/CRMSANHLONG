-- ============================================================
-- Migration: Atomic stock transfer functions
-- File: 20260528000002_atomic_stock_transfer_functions.sql
-- Fix: Race condition trong handleStartTransfer/ReceiveTransfer/CancelTransfer
--   Mỗi operation được wrap trong 1 PG function dùng FOR UPDATE locks
--   để đảm bảo atomicity khi nhiều user thao tác đồng thời.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. fn_start_transfer: draft → in_transit
--    Trừ quantity_on_hand tại kho nguồn, ghi stock_movements
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_start_transfer(
  p_transfer_id UUID,
  p_user_id     UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer  RECORD;
  v_line      RECORD;
  v_available INTEGER;
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

-- ─────────────────────────────────────────────────────────────
-- 2. fn_receive_transfer: in_transit → received
--    Cộng quantity vào kho đích, ghi stock_movements
-- ─────────────────────────────────────────────────────────────
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
      UPDATE public.stock_lots
      SET quantity_on_hand = quantity_on_hand + v_line.quantity,
          updated_at = now()
      WHERE id = v_target_lot_id;
    ELSE
      INSERT INTO public.stock_lots (
        product_id, warehouse_id, lot_number,
        manufacture_date, expiry_date, cost_price,
        quantity_on_hand, status
      ) VALUES (
        v_line.product_id, v_transfer.to_warehouse, v_source_lot.lot_number,
        v_source_lot.manufacture_date, v_source_lot.expiry_date, v_source_lot.cost_price,
        v_line.quantity, v_source_lot.status
      ) RETURNING id INTO v_target_lot_id;
    END IF;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, performed_by
    ) VALUES (
      v_target_lot_id, v_line.product_id, v_transfer.to_warehouse,
      'transfer_in', v_line.quantity, p_transfer_id, 'transfer', p_user_id
    );
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'received', received_by = p_user_id, updated_at = now()
  WHERE id = p_transfer_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. fn_cancel_transfer: draft/in_transit → cancelled
--    Nếu đang in_transit thì hoàn kho về nguồn
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancel_transfer(
  p_transfer_id UUID,
  p_user_id     UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer RECORD;
  v_line     RECORD;
BEGIN
  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;

  IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
    RAISE EXCEPTION 'Chỉ có thể hủy phiếu ở trạng thái Nháp hoặc Đang chuyển.';
  END IF;

  IF v_transfer.status = 'in_transit' THEN
    FOR v_line IN
      SELECT * FROM public.stock_transfer_lines
      WHERE transfer_id = p_transfer_id
    LOOP
      UPDATE public.stock_lots
      SET quantity_on_hand = quantity_on_hand + v_line.quantity,
          updated_at = now()
      WHERE id = v_line.lot_id;

      INSERT INTO public.stock_movements (
        lot_id, product_id, warehouse_id, movement_type,
        quantity, reference_id, reference_type, performed_by, notes
      ) VALUES (
        v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
        'transfer_in', v_line.quantity, p_transfer_id, 'transfer', p_user_id,
        'Hoàn kho do hủy chuyển'
      );
    END LOOP;
  END IF;

  UPDATE public.stock_transfers
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_transfer_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. GRANTS — authenticated users có thể gọi các functions
-- ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.fn_start_transfer(UUID, UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_transfer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancel_transfer(UUID, UUID)  TO authenticated;
