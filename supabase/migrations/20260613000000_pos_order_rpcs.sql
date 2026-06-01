-- ============================================================
-- 20260613000000_pos_order_rpcs.sql
-- Nâng cấp orders/pos: 2 luồng bán (bán nhanh tại quầy / bán giao hàng)
--   - Bán nhanh : draft → confirmed → completed (atomic 1 RPC), trừ kho + thu tiền ngay.
--   - Giao hàng : draft (NV) → confirmed (Admin) → shipping → delivered → completed (NV).
-- Mục tiêu:
--   * Atomic hoá tạo đơn (sửa lỗi mã trùng + trạng thái treo do client orchestration).
--   * Giữ chiết khấu cấp hoá đơn (voucher/KM) — trigger recalc chỉ tính CK dòng.
--   * Thanh toán một phần → ghi nợ phần thiếu (check hạn mức server-side).
--   * Phân quyền chặt: chỉ Admin/CEO xác nhận đơn giao; chủ đơn/Admin giao + thu tiền.
-- Mọi RPC SECURITY DEFINER, tự kiểm tra quyền bên trong (vì bypass RLS).
-- ⚠️ Chạy thủ công qua Supabase SQL Editor / `supabase db push` (cần token).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. CỘT PHÂN LOẠI LUỒNG BÁN
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sale_channel TEXT NOT NULL DEFAULT 'pos_quick';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_sale_channel_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_sale_channel_check
      CHECK (sale_channel IN ('pos_quick', 'delivery'));
  END IF;
END $$;

COMMENT ON COLUMN public.orders.sale_channel IS 'Luồng bán: pos_quick (bán nhanh tại quầy) | delivery (bán giao hàng)';

CREATE INDEX IF NOT EXISTS idx_orders_channel_status
  ON public.orders(sale_channel, status);

-- ─────────────────────────────────────────────────────────────
-- HELPER A: dựng đơn nháp + dòng + ghi TỔNG CÓ THẨM QUYỀN
-- (giữ chiết khấu cấp hoá đơn p_invoice_discount mà trigger recalc bỏ qua)
-- Nội bộ — không cấp EXECUTE cho authenticated.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_build_draft(
  p_payload      JSONB,
  p_sale_channel TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_branch      UUID;
  v_order_id    UUID;
  v_subtotal    NUMERIC(15,2);
  v_line_disc   NUMERIC(15,2);
  v_inv_disc    NUMERIC(15,2) := COALESCE((p_payload->>'invoice_discount')::NUMERIC, 0);
  v_grand       NUMERIC(15,2);
  v_line        JSONB;
  v_n_lines     INT := 0;
BEGIN
  IF NOT public.fn_is_active() OR NOT public.fn_has_permission('orders.create') THEN
    RAISE EXCEPTION 'Không có quyền tạo đơn hàng (orders.create).';
  END IF;

  IF (p_payload->>'customer_id') IS NULL THEN
    RAISE EXCEPTION 'Thiếu khách hàng.';
  END IF;

  SELECT branch_id INTO v_branch FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.orders (
    customer_id, status, sale_channel, payment_status, payment_method,
    owner_user_id, confirmed_by, branch_id, warehouse_id, price_list_id,
    delivery_address, notes, disease_id, treatment_purpose
  ) VALUES (
    (p_payload->>'customer_id')::UUID,
    'draft', p_sale_channel, 'unpaid',
    COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash'),
    v_uid, NULL, v_branch,
    NULLIF(p_payload->>'warehouse_id','')::UUID,
    NULLIF(p_payload->>'price_list_id','')::UUID,
    NULLIF(p_payload->>'delivery_address',''),
    NULLIF(p_payload->>'notes',''),
    NULLIF(p_payload->>'disease_id','')::UUID,
    NULLIF(p_payload->>'treatment_purpose','')
  )
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb))
  LOOP
    INSERT INTO public.order_lines (order_id, product_id, quantity, unit_price, discount)
    VALUES (
      v_order_id,
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

  -- Trigger trg_order_lines_recalc đã set subtotal/discount_total/grand_total theo CK dòng.
  -- Ghi đè TỔNG có thẩm quyền: cộng thêm chiết khấu cấp hoá đơn (voucher/KM).
  SELECT COALESCE(SUM(unit_price * quantity), 0),
         COALESCE(SUM(discount   * quantity), 0)
    INTO v_subtotal, v_line_disc
  FROM public.order_lines WHERE order_id = v_order_id;

  v_grand := v_subtotal - v_line_disc - v_inv_disc;
  IF v_grand < 0 THEN
    RAISE EXCEPTION 'Chiết khấu vượt quá giá trị đơn hàng.';
  END IF;

  UPDATE public.orders
  SET subtotal       = v_subtotal,
      discount_total = v_line_disc + v_inv_disc,
      grand_total    = v_grand,
      updated_at     = now()
  WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_pos_build_draft(JSONB, TEXT) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────
-- HELPER B: thanh toán + ghi nợ phần thiếu (check hạn mức)
-- Dùng chung cho bán nhanh & hoàn tất đơn giao. Nội bộ.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_settle_payment(
  p_order_id       UUID,
  p_paid_amount    NUMERIC,
  p_payment_method order_payment_method
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_grand       NUMERIC(15,2);
  v_customer    UUID;
  v_code        TEXT;
  v_credit      NUMERIC(15,2);
  v_outstanding NUMERIC(15,2);
  v_paid        NUMERIC(15,2);
  v_debt        NUMERIC(15,2);
  v_pay_status  order_payment_status;
BEGIN
  SELECT grand_total, customer_id, order_code
    INTO v_grand, v_customer, v_code
  FROM public.orders WHERE id = p_order_id;

  -- Ghi nợ toàn bộ nếu chọn 'credit'; ngược lại lấy số khách trả (kẹp [0, grand]).
  IF p_payment_method = 'credit' THEN
    v_paid := 0;
  ELSE
    v_paid := LEAST(GREATEST(COALESCE(p_paid_amount, 0), 0), v_grand);
  END IF;
  v_debt := v_grand - v_paid;

  -- Kiểm tra hạn mức nợ (khớp UI: nợ hiện tại + phần ghi nợ > hạn mức → chặn)
  IF v_debt > 0 THEN
    SELECT COALESCE(credit_limit, 0) INTO v_credit FROM public.customers WHERE id = v_customer;
    SELECT COALESCE(SUM(amount), 0) INTO v_outstanding
      FROM public.customer_debts WHERE customer_id = v_customer AND NOT is_settled;
    IF v_outstanding + v_debt > v_credit THEN
      RAISE EXCEPTION 'Vượt hạn mức công nợ. Hạn mức: % ₫, nợ hiện tại: % ₫, phát sinh: % ₫.',
        v_credit, v_outstanding, v_debt;
    END IF;
  END IF;

  -- Ghi nhận tiền thật (cash/bank/card) → trigger tự sinh phiếu thu sổ quỹ + gắn ca.
  IF v_paid > 0 AND p_payment_method IN ('cash', 'bank_transfer', 'card_pos') THEN
    INSERT INTO public.order_payments (order_id, payment_method, amount, reference_no, notes, created_by)
    VALUES (
      p_order_id, p_payment_method, v_paid,
      'POS-' || UPPER(LEFT(p_payment_method::text, 4)) || '-' || COALESCE(v_code, ''),
      'Thu tiền trực tiếp trong đơn (POS).', v_uid
    );
  END IF;

  -- Ghi nợ phần còn thiếu
  IF v_debt > 0 THEN
    INSERT INTO public.customer_debts (customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by)
    VALUES (
      v_customer, p_order_id, 'order_debt', v_debt,
      (CURRENT_DATE + INTERVAL '30 day')::date, false,
      'Công nợ đơn hàng ' || COALESCE(v_code, ''), v_uid
    );
  END IF;

  v_pay_status := CASE
    WHEN v_paid >= v_grand THEN 'paid'
    WHEN v_paid > 0        THEN 'partially_paid'
    ELSE 'unpaid'
  END;

  UPDATE public.orders
  SET paid_amount    = v_paid,
      payment_status = v_pay_status,
      payment_method = p_payment_method,
      updated_at     = now()
  WHERE id = p_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_pos_settle_payment(UUID, NUMERIC, order_payment_method) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────
-- RPC 1: BÁN NHANH TẠI QUẦY — atomic draft→confirmed→completed + thu tiền
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_quick_sale(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_order_id  UUID;
  v_code      TEXT;
  v_method    order_payment_method := COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash');
  v_paid      NUMERIC := COALESCE((p_payload->>'paid_amount')::NUMERIC, 0);
BEGIN
  v_order_id := public.fn_pos_build_draft(p_payload, 'pos_quick');

  -- Xác nhận → trigger trừ kho FEFO (thiếu hàng sẽ RAISE → rollback toàn bộ)
  UPDATE public.orders
  SET status = 'confirmed', confirmed_by = v_uid
  WHERE id = v_order_id;

  UPDATE public.orders SET status = 'completed' WHERE id = v_order_id;

  PERFORM public.fn_pos_settle_payment(v_order_id, v_paid, v_method);

  SELECT order_code INTO v_code FROM public.orders WHERE id = v_order_id;
  RETURN jsonb_build_object('order_id', v_order_id, 'order_code', v_code);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_pos_quick_sale(JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- RPC 2: TẠO ĐƠN NHÁP GIAO HÀNG — chỉ tạo nháp, chờ Admin xác nhận
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_create_delivery_draft(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id UUID;
  v_code     TEXT;
BEGIN
  v_order_id := public.fn_pos_build_draft(p_payload, 'delivery');
  SELECT order_code INTO v_code FROM public.orders WHERE id = v_order_id;
  RETURN jsonb_build_object('order_id', v_order_id, 'order_code', v_code);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_create_delivery_draft(JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- RPC 3: XÁC NHẬN ĐƠN GIAO — CHỈ Admin/CEO (trừ kho)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_confirm_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status order_status;
  v_channel TEXT;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ Admin/CEO được xác nhận đơn giao hàng.';
  END IF;

  SELECT status, sale_channel INTO v_status, v_channel
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_channel <> 'delivery' THEN
    RAISE EXCEPTION 'Chỉ áp dụng cho đơn giao hàng.';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Đơn không ở trạng thái nháp (hiện: %).', v_status;
  END IF;

  UPDATE public.orders
  SET status = 'confirmed', confirmed_by = auth.uid()
  WHERE id = p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_confirm_order(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- RPC 4: TIẾN TRÌNH GIAO HÀNG — chủ đơn HOẶC Admin
--   confirmed → shipping (Đang giao) ; shipping → delivered (Đã giao)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_advance_delivery(p_order_id UUID, p_to_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status order_status;
  v_channel TEXT;
  v_owner   UUID;
BEGIN
  SELECT status, sale_channel, owner_user_id INTO v_status, v_channel, v_owner
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT (public.fn_is_admin() OR v_owner = auth.uid()) THEN
    RAISE EXCEPTION 'Chỉ chủ đơn hoặc Admin được cập nhật tiến trình giao hàng.';
  END IF;
  IF v_channel <> 'delivery' THEN
    RAISE EXCEPTION 'Chỉ áp dụng cho đơn giao hàng.';
  END IF;

  IF p_to_status = 'shipping' AND v_status = 'confirmed' THEN
    UPDATE public.orders SET status = 'shipping' WHERE id = p_order_id;
  ELSIF p_to_status = 'delivered' AND v_status = 'shipping' THEN
    UPDATE public.orders SET status = 'delivered' WHERE id = p_order_id;
  ELSE
    RAISE EXCEPTION 'Chuyển trạng thái không hợp lệ: % → %.', v_status, p_to_status;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_advance_delivery(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- RPC 5: HOÀN TẤT GIAO + THU TIỀN — chủ đơn HOẶC Admin
--   delivered → completed + thu tiền/ghi nợ
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_complete_delivery_payment(
  p_order_id       UUID,
  p_paid_amount    NUMERIC,
  p_payment_method order_payment_method
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status  order_status;
  v_channel TEXT;
  v_owner   UUID;
BEGIN
  SELECT status, sale_channel, owner_user_id INTO v_status, v_channel, v_owner
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT (public.fn_is_admin() OR v_owner = auth.uid()) THEN
    RAISE EXCEPTION 'Chỉ chủ đơn hoặc Admin được thu tiền đơn giao hàng.';
  END IF;
  IF v_channel <> 'delivery' THEN
    RAISE EXCEPTION 'Chỉ áp dụng cho đơn giao hàng.';
  END IF;
  IF v_status <> 'delivered' THEN
    RAISE EXCEPTION 'Đơn chưa ở trạng thái "Đã giao" (hiện: %).', v_status;
  END IF;

  UPDATE public.orders SET status = 'completed' WHERE id = p_order_id;
  PERFORM public.fn_pos_settle_payment(p_order_id, p_paid_amount, p_payment_method);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_complete_delivery_payment(UUID, NUMERIC, order_payment_method) TO authenticated;
