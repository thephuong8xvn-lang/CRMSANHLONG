-- ============================================================
-- Test: fn_products_list — tách tồn vat_stock / nonvat_stock và khớp tổng tồn.
-- ============================================================

create function tap.test_products_list_vat_split() returns setof text
  language plpgsql set search_path = tap, public, extensions
as $$
declare v_r1 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid();
        v_json jsonb; v_row jsonb;
begin
  perform tap.mk_verified_receipt(v_r1, 'TAP-PL-1', 'LOTPL', 10, true,  5, tap.wh());
  perform public.fn_complete_goods_receipt(v_r1);
  perform tap.mk_verified_receipt(v_r2, 'TAP-PL-2', 'LOTPL', 4,  false, 0, tap.wh());
  perform public.fn_complete_goods_receipt(v_r2);

  -- (page, size, search, category, brand, status, branch, sort_by, sort_dir)
  v_json := public.fn_products_list(1, 50, 'TAP SP', null, null, 'all', null, 'created_at', 'desc');
  select e into v_row
    from jsonb_array_elements(v_json->'rows') e
    where e->>'id' = tap.prod()::text;

  return next ok(v_row is not null, 'fn_products_list trả về SP test');
  return next is((v_row->>'vat_stock')::numeric,     10::numeric, 'vat_stock = 10');
  return next is((v_row->>'nonvat_stock')::numeric,   4::numeric, 'nonvat_stock = 4');
  return next is((v_row->>'stock_on_hand')::numeric, 14::numeric, 'tồn tổng = 14 = vat + nonvat');
end $$;
