-- ============================================================
-- 20260617000000_admin_edit_lot.sql
-- Admin (admin@sanhlongvetco.vn / CEO) sửa & xóa LÔ HÀNG (stock_lots)
-- với toàn vẹn thẻ kho. Nhân viên giữ quyền như cũ (không gọi được 2 RPC này).
--
-- Quy tắc (đã chốt):
--   • Sửa SỐ LƯỢNG tồn → ghi BÚT TOÁN điều chỉnh (adjustment_increase/decrease)
--     để thẻ kho (stock_movements) luôn khớp.
--   • "Xóa" lô = HỦY/HOÀN TÁC có dấu vết (soft): đảo trả tồn về 0 + ghi movement
--     nghịch, đánh dấu status='disposed', GIỮ lịch sử + FK (không hard-delete).
--   • Chặn giảm/xóa dưới phần đang giữ chỗ (quantity_reserved).
--
-- Cả 2 RPC SECURITY DEFINER, tự kiểm tra fn_is_admin().
-- Áp thủ công qua Management API rồi NOTIFY pgrst,'reload schema'.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A1. SỬA LÔ HÀNG — admin
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_edit_lot(
  p_lot_id  UUID,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_cur_qty   NUMERIC(15,3);
  v_reserved  NUMERIC(15,3);
  v_warehouse UUID;
  v_product   UUID;
  v_new_qty   NUMERIC(15,3);
  v_delta     NUMERIC(15,3);
  v_cost      NUMERIC(15,2);
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ Admin/CEO được sửa lô hàng.';
  END IF;

  SELECT quantity_on_hand, quantity_reserved, warehouse_id, product_id
    INTO v_cur_qty, v_reserved, v_warehouse, v_product
  FROM public.stock_lots WHERE id = p_lot_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy lô hàng.';
  END IF;

  v_cost    := COALESCE((p_payload->>'cost_price')::NUMERIC, NULL);
  v_new_qty := COALESCE((p_payload->>'quantity_on_hand')::NUMERIC, v_cur_qty);
  v_delta   := v_new_qty - v_cur_qty;

  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Số lượng tồn không được âm.';
  END IF;
  IF v_new_qty < v_reserved THEN
    RAISE EXCEPTION 'Số lượng tồn mới (%) nhỏ hơn phần đang giữ chỗ cho đơn hàng (%).', v_new_qty, v_reserved;
  END IF;

  -- Ghi bút toán điều chỉnh nếu thay đổi số lượng → thẻ kho khớp.
  IF v_delta <> 0 THEN
    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type, quantity,
      reference_id, reference_type, unit_cost, performed_by, notes
    ) VALUES (
      p_lot_id, v_product, v_warehouse,
      (CASE WHEN v_delta > 0 THEN 'adjustment_increase' ELSE 'adjustment_decrease' END)::stock_movement_type,
      v_delta, p_lot_id, 'lot_adjustment', COALESCE(v_cost, NULL), v_uid,
      'Điều chỉnh tồn kho thủ công (admin).'
    );
  END IF;

  UPDATE public.stock_lots SET
    lot_number       = COALESCE(NULLIF(p_payload->>'lot_number',''), lot_number),
    manufacture_date = NULLIF(p_payload->>'manufacture_date','')::date,
    expiry_date      = NULLIF(p_payload->>'expiry_date','')::date,
    cost_price       = COALESCE(v_cost, cost_price),
    status           = COALESCE((NULLIF(p_payload->>'status',''))::stock_lot_status, status),
    quantity_on_hand = v_new_qty,
    updated_at       = now()
  WHERE id = p_lot_id;

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Số lô đã tồn tại cho sản phẩm này trong kho.';
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_admin_edit_lot(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- A2. XÓA LÔ HÀNG (soft + hoàn tác) — admin
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_delete_lot(
  p_lot_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_cur_qty   NUMERIC(15,3);
  v_reserved  NUMERIC(15,3);
  v_warehouse UUID;
  v_product   UUID;
  v_cost      NUMERIC(15,2);
  v_status    stock_lot_status;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ Admin/CEO được xóa lô hàng.';
  END IF;

  SELECT quantity_on_hand, quantity_reserved, warehouse_id, product_id, cost_price, status
    INTO v_cur_qty, v_reserved, v_warehouse, v_product, v_cost, v_status
  FROM public.stock_lots WHERE id = p_lot_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy lô hàng.';
  END IF;
  IF v_status = 'disposed' THEN
    RAISE EXCEPTION 'Lô hàng đã ở trạng thái hủy.';
  END IF;
  IF v_reserved > 0 THEN
    RAISE EXCEPTION 'Lô đang được giữ chỗ cho đơn hàng (% đơn vị) — không thể xóa.', v_reserved;
  END IF;

  -- Đảo trả tồn về 0 + ghi phiếu xuất hủy (thẻ kho khớp).
  IF v_cur_qty > 0 THEN
    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type, quantity,
      reference_id, reference_type, unit_cost, performed_by, notes
    ) VALUES (
      p_lot_id, v_product, v_warehouse, 'adjustment_decrease', -v_cur_qty,
      p_lot_id, 'lot_delete', v_cost, v_uid,
      COALESCE(NULLIF(TRIM(p_reason), '') || ' — ', '') || 'Hủy lô hàng (admin).'
    );
  END IF;

  UPDATE public.stock_lots SET
    quantity_on_hand = 0,
    status           = 'disposed',
    notes            = COALESCE(NULLIF(TRIM(p_reason), ''), notes),
    updated_at       = now()
  WHERE id = p_lot_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_admin_delete_lot(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
