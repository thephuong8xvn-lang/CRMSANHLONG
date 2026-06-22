-- ============================================================
-- Test: trg_orders_vat_sync (fn_vat_sync_on_order) + fn_vat_issue
--   • Xác nhận đơn bán từ lô CÓ VAT → sinh 1 dòng vat_pending_sales đúng số.
--   • fn_vat_issue → tạo vat_issuance (subtotal/vat/total đúng), pending → issued.
--   • Idempotent: xuất lại đúng dòng đã xuất → BÁO LỖI (không xuất trùng).
-- ============================================================

create function tap.test_vat_issue_from_confirmed_order() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare
  v_rid uuid := gen_random_uuid();
  v_oid uuid := gen_random_uuid();
  v_lot uuid;
  v_lid uuid;
  v_sale uuid;        -- dòng vat_pending_sales
  v_issuance uuid;
  v_sql text;
begin
  -- Lô CÓ VAT (rate 10), 30 đơn vị.
  perform tap.mk_verified_receipt(v_rid, 'TAP-VI-R', 'LOTVI', 30, true, 10, tap.wh());
  perform public.fn_complete_goods_receipt(v_rid);
  select id into v_lot from public.stock_lots
    where product_id = tap.prod() and lot_number = 'LOTVI' and warehouse_id = tap.wh() and is_vat;

  -- Bán 6 @ 1000 từ lô VAT → 1 dòng pending: line_amount = 6000, vat_rate = 10.
  v_lid := tap.mk_confirmed_order(v_oid, v_lot, 6, 1000);

  select id into v_sale from public.vat_pending_sales where order_line_id = v_lid;
  return next ok(v_sale is not null, 'Xác nhận đơn lô VAT → sinh dòng vat_pending_sales');
  return next is(
    (select status from public.vat_pending_sales where id = v_sale),
    'pending', 'Dòng VAT mới ở trạng thái pending');
  return next is(
    (select line_amount from public.vat_pending_sales where id = v_sale),
    6000::numeric, 'line_amount = 6 × 1000 = 6000');
  return next is(
    (select vat_rate from public.vat_pending_sales where id = v_sale),
    10::numeric, 'vat_rate lấy từ lô = 10');

  -- Xuất hóa đơn cho dòng này.
  v_issuance := public.fn_vat_issue(array[v_sale]::uuid[], 'INV-TAP-1', current_date,
                                    'Khách TAP', '0312345678', 'TP.HCM', null);

  return next is(
    (select subtotal from public.vat_issuances where id = v_issuance),
    6000::numeric, 'Hóa đơn: subtotal = 6000');
  return next is(
    (select vat_amount from public.vat_issuances where id = v_issuance),
    600::numeric, 'Hóa đơn: vat_amount = round(6000×10%) = 600');
  return next is(
    (select total from public.vat_issuances where id = v_issuance),
    6600::numeric, 'Hóa đơn: total = 6600');
  return next is(
    (select status from public.vat_pending_sales where id = v_sale),
    'issued', 'Dòng VAT chuyển sang issued');
  return next is(
    (select issuance_id from public.vat_pending_sales where id = v_sale),
    v_issuance, 'Dòng VAT gắn đúng issuance_id');

  -- Idempotent: xuất lại đúng dòng đã issued → không còn pending → báo lỗi.
  v_sql := format('select public.fn_vat_issue(array[%L]::uuid[], %L, current_date)',
                  v_sale, 'INV-TAP-2');
  return next throws_ok(v_sql,
    'Không có dòng pending hợp lệ để xuất (có thể đã xuất trước đó).',
    'Xuất lại dòng đã issued → bị chặn (không xuất trùng)');
end $$;
