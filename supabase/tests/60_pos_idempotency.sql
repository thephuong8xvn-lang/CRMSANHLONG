-- ============================================================
-- Test: fn_pos_quick_sale — idempotency theo client_request_id.
--   • Gọi 2 lần cùng client_request_id → trả CÙNG order, KHÔNG tạo đơn 2.
--   • Tồn kho chỉ trừ 1 lần (chống tính tiền/trừ kho gấp đôi khi flush offline).
-- ============================================================

create function tap.test_pos_quick_sale_idempotent() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare
  v_rid  uuid := gen_random_uuid();
  v_crid uuid := gen_random_uuid();
  v_payload jsonb;
  v_r1 jsonb; v_r2 jsonb;
begin
  -- Tồn 20 đơn vị tại kho 1 (non-VAT, cash bán nhanh).
  perform tap.mk_verified_receipt(v_rid, 'TAP-POS-R', 'LOTPOS', 20, false, 0, tap.wh());
  perform public.fn_complete_goods_receipt(v_rid);

  v_payload := jsonb_build_object(
    'client_request_id', v_crid,
    'customer_id', tap.cust(),
    'warehouse_id', tap.wh(),
    'payment_method', 'cash',
    'paid_amount', 3000,
    'delivery_address', 'Quầy POS',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', tap.prod(), 'quantity', 3, 'unit_price', 1000))
  );

  v_r1 := public.fn_pos_quick_sale(v_payload);
  v_r2 := public.fn_pos_quick_sale(v_payload);  -- flush lặp cùng key

  return next is(v_r1->>'order_id', v_r2->>'order_id',
    'Gọi lại cùng client_request_id → CÙNG order_id');
  return next is(v_r2->>'idempotent', 'true',
    'Lần 2 đánh dấu idempotent (không tạo mới)');
  return next is(
    (select count(*)::int from public.orders where client_request_id = v_crid),
    1, 'Chỉ tồn tại 1 đơn cho client_request_id này');
  return next is(
    (select sum(quantity_on_hand) from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTPOS' and warehouse_id = tap.wh()),
    17::numeric, 'Tồn chỉ trừ 1 lần: 20 − 3 = 17 (không trừ gấp đôi)');
end $$;
