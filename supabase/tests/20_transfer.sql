-- ============================================================
-- Test: fn_receive_transfer — chuyển kho GIỮ cờ is_vat của lô nguồn.
-- ============================================================

create function tap.test_transfer_keeps_vat() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare v_rid uuid := gen_random_uuid(); v_lot uuid; v_tid uuid := gen_random_uuid();
begin
  -- Tồn nguồn ở kho 1: lô CÓ VAT, 20 đơn vị.
  perform tap.mk_verified_receipt(v_rid, 'TAP-TR-R', 'LOTT', 20, true, 5, tap.wh());
  perform public.fn_complete_goods_receipt(v_rid);
  select id into v_lot from public.stock_lots
    where product_id = tap.prod() and lot_number = 'LOTT' and warehouse_id = tap.wh() and is_vat;

  -- Phiếu chuyển kho 1 -> kho 2, trạng thái đang chuyển.
  insert into public.stock_transfers(id, transfer_code, from_warehouse, to_warehouse, created_by, status)
    values (v_tid, 'TAP-TR-1', tap.wh(), tap.wh2(), tap.uid(), 'in_transit');
  insert into public.stock_transfer_lines(transfer_id, lot_id, product_id, quantity, unit_price)
    values (v_tid, v_lot, tap.prod(), 8, 1000);

  perform public.fn_receive_transfer(v_tid, tap.uid());

  return next is(
    (select is_vat from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTT' and warehouse_id = tap.wh2()),
    true, 'Lô đích sau chuyển kho GIỮ cờ VAT (không tụt về non-VAT)');
  return next is(
    (select quantity_on_hand from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTT' and warehouse_id = tap.wh2()),
    8::numeric, 'Số lượng nhận đúng 8 ở kho đích');
end $$;
