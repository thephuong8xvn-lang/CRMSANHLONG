-- ============================================================
-- Workstream C — POS offline: khóa idempotency cho bán nhanh
-- Chống TÍNH TIỀN 2 LẦN khi hàng đợi offline đẩy lại (retry/flush trùng).
-- CHỈ THÊM cột + sửa fn_pos_quick_sale (giữ nguyên hành vi cũ khi không có key).
-- Bản fn lấy từ pg_get_functiondef LIVE (2026-06-23), chỉ thêm nhánh idempotent.
-- ============================================================

alter table public.orders add column if not exists client_request_id uuid;

-- Unique 1 phần: mỗi client_request_id chỉ ứng 1 order (bỏ qua NULL của đơn thường).
create unique index if not exists uq_orders_client_request_id
  on public.orders (client_request_id) where client_request_id is not null;

create or replace function public.fn_pos_quick_sale(p_payload jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_order_id  UUID;
  v_code      TEXT;
  v_crid      UUID := NULLIF(p_payload->>'client_request_id','')::uuid;
  v_method    order_payment_method := COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash');
  v_paid      NUMERIC := COALESCE((p_payload->>'paid_amount')::NUMERIC, 0);
  v_overpay   BOOLEAN := COALESCE((p_payload->>'overpay_credit')::BOOLEAN, false);
BEGIN
  -- ── Idempotent: nếu key này đã tạo đơn rồi → trả lại đơn cũ, KHÔNG tạo mới ──
  IF v_crid IS NOT NULL THEN
    SELECT id, order_code INTO v_order_id, v_code
    FROM public.orders WHERE client_request_id = v_crid;
    IF FOUND THEN
      RETURN jsonb_build_object('order_id', v_order_id, 'order_code', v_code, 'idempotent', true);
    END IF;
  END IF;

  PERFORM set_config('app.order_rpc', 'on', true);
  v_order_id := public.fn_pos_build_draft(p_payload, 'pos_quick');
  IF v_crid IS NOT NULL THEN
    UPDATE public.orders SET client_request_id = v_crid WHERE id = v_order_id;
  END IF;
  UPDATE public.orders SET status = 'confirmed', confirmed_by = v_uid WHERE id = v_order_id;
  UPDATE public.orders SET status = 'completed' WHERE id = v_order_id;
  PERFORM public.fn_pos_settle_payment(v_order_id, v_paid, v_method, v_overpay);
  SELECT order_code INTO v_code FROM public.orders WHERE id = v_order_id;
  RETURN jsonb_build_object('order_id', v_order_id, 'order_code', v_code);
END;
$function$;
