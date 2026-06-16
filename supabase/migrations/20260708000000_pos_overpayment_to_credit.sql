-- ============================================================
-- Migration: POS — xử lý tiền khách trả DƯ (overpayment)
-- File: 20260708000000_pos_overpayment_to_credit.sql
-- Mô tả:
--   Trước đây fn_pos_settle_payment KẸP TRẦN số tiền trả = grand_total
--   (LEAST(..., v_grand)) → phần dư mặc định là "tiền thừa trả khách" (đưa lại
--   tiền mặt, sổ quỹ chỉ ghi đúng grand_total). Nay bổ sung LỰA CHỌN thứ 2:
--   "Tính vào công nợ" — ghi nhận TOÀN BỘ tiền khách đưa (kể cả phần dư) vào sổ
--   quỹ, phần dư thành SỐ DƯ CÓ (credit) của khách = dòng customer_debts âm
--   (debt_type 'advance_from_customer'). Lần mua sau phần dư này tự trừ vào nợ.
--
--   Cơ chế: thêm tham số p_overpay_credit (DEFAULT false → giữ nguyên hành vi cũ).
--     • false (mặc định): kẹp trần grand_total → tiền thừa trả khách (như cũ).
--     • true: KHÔNG kẹp trần → v_debt có thể ÂM → ghi dòng công nợ âm (khách dư).
-- ============================================================

-- Bỏ bản 3 tham số cũ → chỉ còn bản 4 tham số bên dưới. Lời gọi 3 tham số trong
-- fn_complete_delivery_payment sẽ tự khớp bản mới với p_overpay_credit = false
-- (giữ nguyên hành vi đơn giao hàng: tiền thừa trả khách).
DROP FUNCTION IF EXISTS public.fn_pos_settle_payment(UUID, NUMERIC, order_payment_method);

CREATE OR REPLACE FUNCTION public.fn_pos_settle_payment(
  p_order_id       UUID,
  p_paid_amount    NUMERIC,
  p_payment_method order_payment_method,
  p_overpay_credit BOOLEAN DEFAULT false
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

  -- Ghi nợ toàn bộ nếu chọn 'credit'; ngược lại lấy số khách trả.
  --   • overpay_credit = false (mặc định): kẹp [0, grand] → phần dư trả khách.
  --   • overpay_credit = true: chỉ chặn dưới 0 → cho phép trả > grand (phần dư ghi có công nợ).
  IF p_payment_method = 'credit' THEN
    v_paid := 0;
  ELSIF p_overpay_credit THEN
    v_paid := GREATEST(COALESCE(p_paid_amount, 0), 0);
  ELSE
    v_paid := LEAST(GREATEST(COALESCE(p_paid_amount, 0), 0), v_grand);
  END IF;
  v_debt := v_grand - v_paid;   -- > 0: khách còn nợ; < 0: khách trả dư (số dư có)

  -- Kiểm tra hạn mức nợ — chỉ khi PHÁT SINH nợ (v_debt > 0). Trả dư (âm) không chặn.
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
  -- v_paid là TOÀN BỘ tiền nhận (kể cả phần dư khi overpay_credit) → sổ quỹ khớp tiền thực.
  IF v_paid > 0 AND p_payment_method IN ('cash', 'bank_transfer', 'card_pos') THEN
    INSERT INTO public.order_payments (order_id, payment_method, amount, reference_no, notes, created_by)
    VALUES (
      p_order_id, p_payment_method, v_paid,
      'POS-' || UPPER(LEFT(p_payment_method::text, 4)) || '-' || COALESCE(v_code, ''),
      'Thu tiền trực tiếp trong đơn (POS).', v_uid
    );
  END IF;

  -- Ghi nợ phần còn thiếu (dương) HOẶC ghi số dư có khi khách trả dư (âm).
  IF v_debt > 0 THEN
    INSERT INTO public.customer_debts (customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by)
    VALUES (
      v_customer, p_order_id, 'order_debt', v_debt,
      (CURRENT_DATE + INTERVAL '30 day')::date, false,
      'Công nợ đơn hàng ' || COALESCE(v_code, ''), v_uid
    );
  ELSIF v_debt < 0 THEN
    INSERT INTO public.customer_debts (customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by)
    VALUES (
      v_customer, p_order_id, 'advance_from_customer', v_debt, NULL, false,
      'Khách trả dư đơn ' || COALESCE(v_code, '') || ' → ghi có công nợ ' || ABS(v_debt)::text || ' ₫', v_uid
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
REVOKE ALL ON FUNCTION public.fn_pos_settle_payment(UUID, NUMERIC, order_payment_method, BOOLEAN) FROM PUBLIC;


-- Bán nhanh: đọc cờ overpay_credit từ payload (mặc định false) và truyền xuống settle.
CREATE OR REPLACE FUNCTION public.fn_pos_quick_sale(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_order_id  UUID;
  v_code      TEXT;
  v_method    order_payment_method := COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash');
  v_paid      NUMERIC := COALESCE((p_payload->>'paid_amount')::NUMERIC, 0);
  v_overpay   BOOLEAN := COALESCE((p_payload->>'overpay_credit')::BOOLEAN, false);
BEGIN
  v_order_id := public.fn_pos_build_draft(p_payload, 'pos_quick');

  -- Xác nhận → trigger trừ kho FEFO (thiếu hàng sẽ RAISE → rollback toàn bộ)
  UPDATE public.orders
  SET status = 'confirmed', confirmed_by = v_uid
  WHERE id = v_order_id;

  UPDATE public.orders SET status = 'completed' WHERE id = v_order_id;

  PERFORM public.fn_pos_settle_payment(v_order_id, v_paid, v_method, v_overpay);

  SELECT order_code INTO v_code FROM public.orders WHERE id = v_order_id;
  RETURN jsonb_build_object('order_id', v_order_id, 'order_code', v_code);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_pos_quick_sale(JSONB) TO authenticated;
