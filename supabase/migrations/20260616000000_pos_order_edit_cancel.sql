-- ============================================================
-- 20260616000000_pos_order_edit_cancel.sql
-- Sửa / Hủy đơn POS theo 2 luồng bán (pos_quick / delivery) với toàn vẹn dữ liệu.
--
-- Quy tắc nghiệp vụ (đã chốt):
--   • Bán nhanh tại quầy (pos_quick): sau khi xuất đơn (status='completed'),
--     nhân viên CÙNG CHI NHÁNH được SỬA hầu hết thông tin trong 60 PHÚT.
--     Admin/CEO được SỬA + HỦY mọi lúc.
--   • Bán giao hàng (delivery): ở trạng thái 'draft' nhân viên cùng chi nhánh
--     sửa SL/giá/khách; Admin/CEO sửa/hủy kể cả sau khi hoàn tất.
--   • Hủy / sửa đơn ĐÃ trừ kho → mô hình HOÀN TÁC + ÁP LẠI nguyên tử:
--       hoàn kho về lô gốc, đảo phiếu thu (số dư quỹ), xóa công nợ → dựng lại.
--
-- Mọi RPC SECURITY DEFINER, tự kiểm tra quyền bên trong (bypass RLS).
-- Áp thủ công qua Supabase Management API rồi NOTIFY pgrst,'reload schema'.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A0. CỘT LƯU LÝ DO HỦY
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

COMMENT ON COLUMN public.orders.cancel_reason IS 'Lý do hủy đơn (ghi khi fn_cancel_order chạy).';

-- ─────────────────────────────────────────────────────────────
-- A1. QUYỀN SỬA/HỦY ĐƠN — cho UI gating + tái dùng trong RPC sửa
--   Trả JSONB: { can_edit, can_cancel, can_edit_qty, window_expires_at, reason }
--   Cửa sổ sửa của nhân viên bán nhanh: 60 phút kể từ created_at.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_order_edit_perms(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status   order_status;
  v_channel  TEXT;
  v_branch   UUID;
  v_created  TIMESTAMPTZ;
  v_expires  TIMESTAMPTZ;
  v_same_br  BOOLEAN;
BEGIN
  SELECT status, sale_channel, branch_id, created_at
    INTO v_status, v_channel, v_branch, v_created
  FROM public.orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_edit', false, 'can_cancel', false,
      'can_edit_qty', false, 'window_expires_at', NULL, 'reason', 'Không tìm thấy đơn hàng.');
  END IF;

  -- Admin/CEO: toàn quyền, mọi lúc.
  IF public.fn_is_admin() THEN
    RETURN jsonb_build_object('can_edit', v_status <> 'cancelled', 'can_cancel', v_status <> 'cancelled',
      'can_edit_qty', v_status <> 'cancelled', 'window_expires_at', NULL,
      'reason', CASE WHEN v_status = 'cancelled' THEN 'Đơn đã hủy.' ELSE 'Admin: toàn quyền.' END);
  END IF;

  -- Nhân viên: phải active + cùng chi nhánh với đơn.
  v_same_br := public.fn_is_active() AND v_branch IS NOT NULL AND v_branch = public.fn_my_branch_id();
  IF NOT v_same_br THEN
    RETURN jsonb_build_object('can_edit', false, 'can_cancel', false,
      'can_edit_qty', false, 'window_expires_at', NULL,
      'reason', 'Chỉ nhân viên cùng chi nhánh hoặc Admin được sửa đơn.');
  END IF;

  -- Bán nhanh đã hoàn tất: cho sửa trong 60 phút; KHÔNG cho hủy (chỉ Admin hủy).
  IF v_channel = 'pos_quick' AND v_status = 'completed' THEN
    v_expires := v_created + INTERVAL '60 minutes';
    IF now() <= v_expires THEN
      RETURN jsonb_build_object('can_edit', true, 'can_cancel', false,
        'can_edit_qty', true, 'window_expires_at', v_expires,
        'reason', 'Bán nhanh: được sửa trong 60 phút kể từ lúc xuất đơn.');
    END IF;
    RETURN jsonb_build_object('can_edit', false, 'can_cancel', false,
      'can_edit_qty', false, 'window_expires_at', v_expires,
      'reason', 'Đã quá 60 phút — liên hệ Admin để chỉnh sửa.');
  END IF;

  -- Giao hàng còn nháp: cho sửa + hủy (chưa trừ kho, hủy không hậu quả).
  IF v_channel = 'delivery' AND v_status = 'draft' THEN
    RETURN jsonb_build_object('can_edit', true, 'can_cancel', true,
      'can_edit_qty', true, 'window_expires_at', NULL,
      'reason', 'Đơn giao nháp: được sửa trước khi Admin xác nhận.');
  END IF;

  RETURN jsonb_build_object('can_edit', false, 'can_cancel', false,
    'can_edit_qty', false, 'window_expires_at', NULL,
    'reason', 'Trạng thái đơn không cho phép nhân viên chỉnh sửa.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_order_edit_perms(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- A2. HOÀN TÁC HIỆU ỨNG ĐƠN — nội bộ (hoàn kho + đảo thu + xóa nợ)
--   Đảo TRƯỚC khi xóa dòng (cần allocations + quantity).
--   Guard: chặn nếu đã phát sinh trả hàng hoặc công nợ đã tất toán (đã thu).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reverse_order_effects(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_alloc RECORD;
BEGIN
  -- Guard 1: đã có phiếu trả hàng (chưa hủy) → không tự hoàn tác.
  IF EXISTS (
    SELECT 1 FROM public.sales_returns
    WHERE order_id = p_order_id AND status <> 'rejected'
  ) THEN
    RAISE EXCEPTION 'Đơn đã phát sinh trả hàng — không thể tự sửa/hủy. Hãy xử lý phiếu trả hàng trước.';
  END IF;

  -- Guard 2: công nợ của đơn đã được tất toán (đã thu nợ) → không tự hoàn tác.
  IF EXISTS (
    SELECT 1 FROM public.customer_debts
    WHERE order_id = p_order_id AND is_settled = true
  ) THEN
    RAISE EXCEPTION 'Đơn đã phát sinh thu công nợ — không thể tự sửa/hủy. Hãy điều chỉnh công nợ thủ công.';
  END IF;

  -- 1. HOÀN KHO: trả lại số đã phân bổ vào đúng lô gốc + ghi phiếu nhập hoàn.
  FOR v_alloc IN
    SELECT ola.id AS alloc_id, ola.lot_id, ola.quantity,
           ol.product_id, sl.warehouse_id
    FROM public.order_line_allocations ola
    JOIN public.order_lines ol ON ol.id = ola.order_line_id
    JOIN public.stock_lots  sl ON sl.id = ola.lot_id
    WHERE ol.order_id = p_order_id
  LOOP
    UPDATE public.stock_lots
    SET quantity_on_hand = quantity_on_hand + v_alloc.quantity,
        updated_at = now()
    WHERE id = v_alloc.lot_id;

    INSERT INTO public.stock_movements
      (lot_id, product_id, warehouse_id, movement_type, quantity,
       reference_id, reference_type, performed_by, notes)
    VALUES
      (v_alloc.lot_id, v_alloc.product_id, v_alloc.warehouse_id,
       'adjustment_increase', v_alloc.quantity,
       p_order_id, 'order_reverse', v_uid,
       'Hoàn kho do sửa/hủy đơn hàng.');

    DELETE FROM public.order_line_allocations WHERE id = v_alloc.alloc_id;
  END LOOP;

  -- 2. ĐẢO SỔ QUỸ: hủy các phiếu thu tự sinh từ đơn (trigger tự hoàn số dư quỹ).
  UPDATE public.cashbook_transactions
  SET status = 'cancelled', updated_at = now()
  WHERE order_id = p_order_id
    AND source_table = 'order_payments'
    AND status = 'approved';

  -- 3. XÓA THANH TOÁN của đơn (để áp lại; source_id mới sẽ khác → không đụng unique).
  DELETE FROM public.order_payments WHERE order_id = p_order_id;

  -- 4. XÓA CÔNG NỢ chưa tất toán của đơn.
  DELETE FROM public.customer_debts WHERE order_id = p_order_id AND is_settled = false;

  -- 5. Reset trạng thái thanh toán.
  UPDATE public.orders
  SET paid_amount = 0, payment_status = 'unpaid', updated_at = now()
  WHERE id = p_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_reverse_order_effects(UUID) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────
-- A3. DỰNG LẠI DÒNG + TỔNG — nội bộ (dùng cho sửa đơn)
--   Xóa dòng cũ, insert dòng mới từ payload, ghi đè tổng có CK cấp HĐ
--   (recalc trigger bỏ qua invoice_discount nên phải set thủ công).
--   Cập nhật header có thể sửa.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_apply_lines(
  p_order_id UUID,
  p_payload  JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line      JSONB;
  v_n_lines   INT := 0;
  v_subtotal  NUMERIC(15,2);
  v_line_disc NUMERIC(15,2);
  v_inv_disc  NUMERIC(15,2) := COALESCE((p_payload->>'invoice_discount')::NUMERIC, 0);
  v_grand     NUMERIC(15,2);
BEGIN
  IF (p_payload->>'customer_id') IS NULL THEN
    RAISE EXCEPTION 'Thiếu khách hàng.';
  END IF;

  -- Cập nhật header (chỉ field cho phép sửa).
  UPDATE public.orders SET
    customer_id       = (p_payload->>'customer_id')::UUID,
    payment_method    = COALESCE((p_payload->>'payment_method')::order_payment_method, payment_method),
    warehouse_id      = COALESCE(NULLIF(p_payload->>'warehouse_id','')::UUID, warehouse_id),
    price_list_id     = NULLIF(p_payload->>'price_list_id','')::UUID,
    delivery_address  = NULLIF(p_payload->>'delivery_address',''),
    notes             = NULLIF(p_payload->>'notes',''),
    disease_id        = NULLIF(p_payload->>'disease_id','')::UUID,
    treatment_purpose = NULLIF(p_payload->>'treatment_purpose',''),
    updated_at        = now()
  WHERE id = p_order_id;

  -- Xóa dòng cũ (cascade xóa allocation còn sót — đã hoàn kho ở reverse).
  DELETE FROM public.order_lines WHERE order_id = p_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb))
  LOOP
    INSERT INTO public.order_lines (order_id, product_id, quantity, unit_price, discount)
    VALUES (
      p_order_id,
      (v_line->>'product_id')::UUID,
      (v_line->>'quantity')::NUMERIC,
      (v_line->>'unit_price')::NUMERIC,
      COALESCE((v_line->>'discount')::NUMERIC, 0)
    );
    v_n_lines := v_n_lines + 1;
  END LOOP;

  IF v_n_lines = 0 THEN
    RAISE EXCEPTION 'Đơn hàng phải có ít nhất 1 dòng sản phẩm.';
  END IF;

  -- Ghi đè tổng có thẩm quyền (cộng chiết khấu cấp hoá đơn).
  SELECT COALESCE(SUM(unit_price * quantity), 0),
         COALESCE(SUM(discount   * quantity), 0)
    INTO v_subtotal, v_line_disc
  FROM public.order_lines WHERE order_id = p_order_id;

  v_grand := v_subtotal - v_line_disc - v_inv_disc;
  IF v_grand < 0 THEN
    RAISE EXCEPTION 'Chiết khấu vượt quá giá trị đơn hàng.';
  END IF;

  UPDATE public.orders
  SET subtotal       = v_subtotal,
      discount_total = v_line_disc + v_inv_disc,
      grand_total    = v_grand,
      updated_at     = now()
  WHERE id = p_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_pos_apply_lines(UUID, JSONB) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────
-- A4. HỦY ĐƠN — Admin mọi lúc; NV cùng chi nhánh chỉ với đơn giao nháp.
--   (hoàn kho + đảo thu chi + xóa nợ; quyền theo fn_order_edit_perms)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancel_order(
  p_order_id UUID,
  p_reason   TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status order_status;
  v_perms  JSONB;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn hàng.';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Đơn hàng đã ở trạng thái hủy.';
  END IF;

  v_perms := public.fn_order_edit_perms(p_order_id);
  IF NOT (v_perms->>'can_cancel')::boolean THEN
    RAISE EXCEPTION '%', COALESCE(v_perms->>'reason', 'Không có quyền hủy đơn hàng.');
  END IF;

  PERFORM public.fn_reverse_order_effects(p_order_id);

  UPDATE public.orders
  SET status = 'cancelled',
      cancel_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      updated_at = now()
  WHERE id = p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_cancel_order(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- A5. SỬA ĐƠN — nhân viên cùng chi nhánh (trong cửa sổ) HOẶC Admin
--   draft (delivery): chỉ dựng lại dòng/header — không đụng kho/tiền.
--   đã trừ kho      : hoàn tác → dựng lại → trừ kho lại → thu tiền lại.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_edit_order(
  p_order_id UUID,
  p_payload  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_perms   JSONB;
  v_status  order_status;
  v_channel TEXT;
  v_code    TEXT;
  v_method  order_payment_method := COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash');
  v_paid    NUMERIC := COALESCE((p_payload->>'paid_amount')::NUMERIC, 0);
BEGIN
  -- Khóa đơn chống sửa đồng thời + đọc trạng thái.
  SELECT status, sale_channel INTO v_status, v_channel
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn hàng.';
  END IF;

  -- Kiểm tra quyền (tái dùng fn_order_edit_perms).
  v_perms := public.fn_order_edit_perms(p_order_id);
  IF NOT (v_perms->>'can_edit')::boolean THEN
    RAISE EXCEPTION '%', COALESCE(v_perms->>'reason', 'Không có quyền sửa đơn hàng.');
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Đơn đã hủy — không thể sửa.';
  END IF;

  IF v_status = 'draft' THEN
    -- Đơn giao còn nháp: chưa trừ kho/thu tiền → chỉ dựng lại dòng + header.
    PERFORM public.fn_pos_apply_lines(p_order_id, p_payload);
  ELSE
    -- Đơn đã trừ kho (confirmed/shipping/delivered/completed): hoàn tác rồi áp lại.
    PERFORM public.fn_reverse_order_effects(p_order_id);
    PERFORM public.fn_pos_apply_lines(p_order_id, p_payload);

    -- Áp lại trừ kho FEFO: đưa về draft trước để trigger nhận diện đổi trạng thái.
    UPDATE public.orders SET status = 'draft' WHERE id = p_order_id;
    UPDATE public.orders SET status = 'confirmed', confirmed_by = v_uid WHERE id = p_order_id;
    UPDATE public.orders SET status = 'completed' WHERE id = p_order_id;

    PERFORM public.fn_pos_settle_payment(
      p_order_id,
      CASE WHEN v_method = 'credit' THEN 0 ELSE v_paid END,
      v_method
    );
  END IF;

  SELECT order_code INTO v_code FROM public.orders WHERE id = p_order_id;
  RETURN jsonb_build_object('order_id', p_order_id, 'order_code', v_code);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_pos_edit_order(UUID, JSONB) TO authenticated;

-- Nạp lại schema cho PostgREST.
NOTIFY pgrst, 'reload schema';
