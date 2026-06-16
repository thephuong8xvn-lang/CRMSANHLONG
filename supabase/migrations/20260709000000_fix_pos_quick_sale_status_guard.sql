-- ============================================================
-- Migration: FIX — khôi phục cờ phiên app.order_rpc trong fn_pos_quick_sale
-- File: 20260709000000_fix_pos_quick_sale_status_guard.sql
-- Mô tả (HOTFIX):
--   Migration 20260708 viết lại fn_pos_quick_sale (thêm overpay_credit) nhưng
--   VÔ TÌNH bỏ mất dòng:
--       PERFORM set_config('app.order_rpc', 'on', true);
--   vốn được thêm ở guard 20260624000001. Hệ quả: khi bán nhanh, RPC UPDATE
--   status draft → confirmed → completed mà KHÔNG bật cờ phiên, nên trigger
--   trg_guard_order_status (fn_guard_order_status) từ chối với lỗi:
--       "Không được đổi trạng thái đơn hàng trực tiếp..."
--   → KHÔNG THỂ BÁN HÀNG (dù đã nhập kho / thiết lập công nợ).
--
--   Bản này tạo lại fn_pos_quick_sale GIỮ NGUYÊN logic 20260708, chỉ thêm lại
--   dòng set_config ngay đầu BEGIN (phạm vi TRANSACTION → đủ cho mọi UPDATE
--   status lồng nhau trong cùng giao dịch RPC).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

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
  -- Bật cờ phiên để guard trg_guard_order_status cho phép đổi status trong RPC này.
  PERFORM set_config('app.order_rpc', 'on', true);

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

NOTIFY pgrst, 'reload schema';
