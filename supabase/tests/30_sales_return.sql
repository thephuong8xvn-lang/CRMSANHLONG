-- ============================================================
-- Test: fn_create_sales_return + fn_sales_return_apply_effects
--   • Hồi kho GIỮ cờ is_vat của lô gốc (không tụt về non-VAT).
--   • Số lượng hồi đúng, cộng vào ĐÚNG lô VAT cũ.
--   • Idempotent: áp hiệu ứng lần 2 KHÔNG hồi kho gấp đôi.
-- ============================================================

create function tap.test_sales_return_keeps_vat_and_restocks() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare
  v_rid uuid := gen_random_uuid();   -- phiếu nhập
  v_oid uuid := gen_random_uuid();   -- đơn hàng
  v_lot uuid;                        -- lô VAT gốc
  v_lid uuid;                        -- dòng đơn
  v_ret jsonb;                       -- kết quả tạo phiếu trả
begin
  -- Tồn: 1 lô CÓ VAT (rate 5), 20 đơn vị tại kho 1.
  perform tap.mk_verified_receipt(v_rid, 'TAP-SR-R', 'LOTSR', 20, true, 5, tap.wh());
  perform public.fn_complete_goods_receipt(v_rid);
  select id into v_lot from public.stock_lots
    where product_id = tap.prod() and lot_number = 'LOTSR' and warehouse_id = tap.wh() and is_vat;

  -- Bán 8 từ lô VAT → tồn lô còn 12. Đơn ở trạng thái confirmed.
  v_lid := tap.mk_confirmed_order(v_oid, v_lot, 8, 1000);
  return next is(
    (select quantity_on_hand from public.stock_lots where id = v_lot),
    12::numeric, 'Sau bán 8: lô VAT còn 12');

  -- Cho phép trả hàng: đưa đơn về 'delivered'.
  perform set_config('app.order_rpc', 'on', true);
  update public.orders set status = 'delivered' where id = v_oid;
  perform set_config('app.order_rpc', '', true);

  -- Trả 5 (không chỉ định lot_id → resolve theo phân bổ của dòng đơn = lô VAT).
  v_ret := public.fn_create_sales_return(
    v_oid, tap.wh(), 'damage', 'hỏng bao bì', 'cash',
    jsonb_build_array(jsonb_build_object('order_line_id', v_lid, 'quantity', 5)));

  -- Hồi vào ĐÚNG lô VAT cũ → 12 + 5 = 17, cờ VAT giữ nguyên.
  return next is(
    (select quantity_on_hand from public.stock_lots where id = v_lot),
    17::numeric, 'Sau trả 5: hồi vào lô VAT gốc → 17');
  return next is(
    (select is_vat from public.stock_lots where id = v_lot),
    true, 'Lô hồi hàng GIỮ cờ VAT (không tạo lô non-VAT mới)');
  return next ok(
    not exists (select 1 from public.stock_lots
                where product_id = tap.prod() and lot_number = 'LOTSR'
                  and warehouse_id = tap.wh() and is_vat = false),
    'Không phát sinh lô LOTSR non-VAT khi hồi hàng');

  -- Đúng 1 movement hồi hàng cho phiếu trả này.
  return next is(
    (select count(*)::int from public.stock_movements
       where reference_type = 'sales_return'
         and reference_id = (v_ret->>'return_id')::uuid),
    1, 'Có đúng 1 stock_movement hồi hàng');

  -- Idempotent: gọi lại apply_effects KHÔNG hồi kho lần nữa.
  perform public.fn_sales_return_apply_effects((v_ret->>'return_id')::uuid, true);
  return next is(
    (select quantity_on_hand from public.stock_lots where id = v_lot),
    17::numeric, 'Gọi lại apply_effects: tồn vẫn 17 (idempotent, không hồi gấp đôi)');
end $$;
