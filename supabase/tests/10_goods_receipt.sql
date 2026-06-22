-- ============================================================
-- Test: fn_complete_goods_receipt — VAT theo lô + guard trạng thái.
-- Bảo vệ 2 bug đã từng vấp: (1) gộp lô sai cờ VAT; (2) guard chặn hoàn thành.
-- ============================================================

-- 1) Hoàn thành phiếu → lô sinh ra giữ đúng is_vat/vat_rate.
create function tap.test_complete_keeps_vat_flag() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare v_rid uuid := gen_random_uuid();
begin
  perform tap.mk_verified_receipt(v_rid, 'TAP-GR-A', 'LOTX', 10, true, 5, null);
  perform public.fn_complete_goods_receipt(v_rid);

  return next is(
    (select quantity_on_hand from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTX' and is_vat),
    10::numeric, 'Lô VAT tạo đúng số lượng 10');
  return next is(
    (select vat_rate from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTX' and is_vat),
    5::numeric, 'Lô VAT giữ đúng vat_rate=5');
  return next is(
    (select status from public.goods_receipts where id = v_rid)::text,
    'completed', 'Phiếu chuyển sang completed (guard cho qua)');
end $$;

-- 2) Cùng SP + lô + HSD nhưng khác VAT → 2 LÔ RIÊNG, KHÔNG gộp/ghi đè (bug 20260715).
create function tap.test_complete_vat_split_no_merge() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare v_r1 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid();
begin
  perform tap.mk_verified_receipt(v_r1, 'TAP-GR-V', 'LOTY', 10, true,  5, null);  -- có VAT
  perform public.fn_complete_goods_receipt(v_r1);
  perform tap.mk_verified_receipt(v_r2, 'TAP-GR-N', 'LOTY', 5,  false, 0, null);  -- không VAT, CÙNG lô
  perform public.fn_complete_goods_receipt(v_r2);

  return next is(
    (select count(*)::int from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTY' and warehouse_id = tap.wh()),
    2, 'Cùng lô khác VAT → tách thành 2 dòng lô');
  return next is(
    (select quantity_on_hand from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTY' and is_vat),
    10::numeric, 'Lô VAT giữ 10 (không bị gộp)');
  return next is(
    (select quantity_on_hand from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTY' and not is_vat),
    5::numeric, 'Lô không-VAT giữ 5 (không bị gộp)');
end $$;

-- 3) Cùng SP + lô + CÙNG VAT nhập 2 lần → GỘP số lượng (đúng hành vi mong muốn).
create function tap.test_complete_same_vat_merges() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare v_r1 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid();
begin
  perform tap.mk_verified_receipt(v_r1, 'TAP-GR-M1', 'LOTZ', 10, true, 5, null);
  perform public.fn_complete_goods_receipt(v_r1);
  perform tap.mk_verified_receipt(v_r2, 'TAP-GR-M2', 'LOTZ', 7,  true, 5, null);
  perform public.fn_complete_goods_receipt(v_r2);

  return next is(
    (select count(*)::int from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTZ' and warehouse_id = tap.wh()),
    1, 'Cùng lô cùng VAT → 1 dòng');
  return next is(
    (select quantity_on_hand from public.stock_lots
       where product_id = tap.prod() and lot_number = 'LOTZ'),
    17::numeric, 'Số lượng cộng dồn 10+7=17');
end $$;

-- 4) Guard: đổi status trực tiếp (không qua RPC) phải bị chặn.
create function tap.test_guard_blocks_direct_status() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare v_rid uuid := gen_random_uuid();
begin
  perform tap.mk_verified_receipt(v_rid, 'TAP-GR-G', 'LOTG', 3, false, 0, null);
  return next throws_ok(
    format('update public.goods_receipts set status = ''completed'' where id = %L', v_rid),
    'P0001',
    'Không được đổi trạng thái phiếu nhập trực tiếp. Hãy dùng chức năng Duyệt/Hoàn thành/Huỷ.',
    'Guard chặn đổi status trực tiếp');
end $$;
