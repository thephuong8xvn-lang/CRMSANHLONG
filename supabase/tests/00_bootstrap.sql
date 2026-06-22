-- ============================================================
-- pgTAP bootstrap + fixtures dùng chung (schema "tap")
-- Nạp đầu tiên (tên 00_). run-tests.mjs nạp file này rồi gọi runtests('tap').
-- Mỗi test chạy trong savepoint, runtests tự ROLLBACK → không để lại rác.
-- ============================================================
create extension if not exists pgtap with schema extensions;

drop schema if exists tap cascade;
create schema tap;

-- ── Hằng số UUID cố định cho fixtures ──
create function tap.uid()    returns uuid language sql immutable as $$ select '00000000-0000-4000-a000-000000000001'::uuid $$;
create function tap.branch() returns uuid language sql immutable as $$ select '00000000-0000-4000-a000-000000000002'::uuid $$;
create function tap.wh()     returns uuid language sql immutable as $$ select '00000000-0000-4000-a000-000000000003'::uuid $$;
create function tap.wh2()    returns uuid language sql immutable as $$ select '00000000-0000-4000-a000-000000000006'::uuid $$;
create function tap.sup()    returns uuid language sql immutable as $$ select '00000000-0000-4000-a000-000000000004'::uuid $$;
create function tap.prod()   returns uuid language sql immutable as $$ select '00000000-0000-4000-a000-000000000005'::uuid $$;
create function tap.cust()   returns uuid language sql immutable as $$ select '00000000-0000-4000-a000-000000000007'::uuid $$;

-- ── setup(): chạy TRƯỚC mỗi test — seed đồ thị tối thiểu + "đăng nhập" admin ──
-- auth.uid() đọc 'sub' từ request.jwt.claims → fn_is_active/fn_is_admin trả true.
create function tap.setup() returns void
  language plpgsql
  set search_path = tap, public, extensions
as $$
declare v_role uuid;
begin
  insert into auth.users(id) values (tap.uid()) on conflict (id) do nothing;
  insert into public.branches(id, code, name)   values (tap.branch(),'TAP-BR','TAP Branch')  on conflict (id) do nothing;
  insert into public.warehouses(id, branch_id, code, name) values
    (tap.wh(),  tap.branch(),'TAP-WH','TAP Kho'),
    (tap.wh2(), tap.branch(),'TAP-WH2','TAP Kho 2') on conflict (id) do nothing;
  insert into public.suppliers(id, code, name)   values (tap.sup(),'TAP-SUP','TAP NCC')       on conflict (id) do nothing;
  insert into public.products(id, sku, name, is_lot_managed, is_active)
    values (tap.prod(),'TAP-SKU','TAP SP', true, true) on conflict (id) do nothing;
  insert into public.profiles(id, email, is_active, branch_id)
    values (tap.uid(),'tap@test.local', true, tap.branch())
    on conflict (id) do update set is_active = true, branch_id = excluded.branch_id;
  -- code_sequences: staging clone schema-only nên rỗng → seed các loại mã auto cần dùng.
  insert into public.code_sequences(code_type, prefix, year_part, current_no) values
    ('customer','KH', extract(year from now())::int, 0),
    ('order','DH',    extract(year from now())::int, 0),
    ('sales_return','TH', extract(year from now())::int, 0)
    on conflict (code_type) do nothing;
  insert into public.customers(id, farm_name, owner_user_id, branch_id)
    values (tap.cust(),'TAP Farm', tap.uid(), tap.branch()) on conflict (id) do nothing;

  select id into v_role from public.roles where code = 'admin' limit 1;
  if v_role is null then
    insert into public.roles(code, name) values ('admin','Admin') returning id into v_role;
  end if;
  insert into public.user_roles(user_id, role_id) values (tap.uid(), v_role) on conflict do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', tap.uid()::text, 'role', 'authenticated')::text, true);
end $$;

create function tap.teardown() returns void
  language plpgsql
  set search_path = tap, public, extensions
as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── Helper: tạo nhanh 1 phiếu nhập trạng thái 'verified' + 1 dòng (bỏ qua guard) ──
create function tap.mk_verified_receipt(
  p_rid uuid, p_code text, p_lot text, p_qty numeric, p_is_vat boolean, p_vat_rate numeric, p_wh uuid default null
) returns void
  language plpgsql
  set search_path = tap, public, extensions
as $$
begin
  perform set_config('app.receipt_rpc', 'on', true);  -- cho phép set status verified qua guard
  insert into public.goods_receipts(id, receipt_code, supplier_id, warehouse_id, received_by, status)
    values (p_rid, p_code, tap.sup(), coalesce(p_wh, tap.wh()), tap.uid(), 'verified');
  insert into public.goods_receipt_lines(receipt_id, product_id, quantity, unit_price, lot_number, expiry_date, is_vat, vat_rate)
    values (p_rid, tap.prod(), p_qty, 1000, p_lot, '2030-01-01', p_is_vat, p_vat_rate);
  perform set_config('app.receipt_rpc', '', true);    -- tắt cờ; RPC hoàn thành tự bật lại
end $$;

-- ── Helper: tạo 1 đơn + 1 dòng (chỉ định lô bán) rồi XÁC NHẬN qua guard.
-- Xác nhận → trigger trừ kho (phân bổ đúng lô) + sinh vat_pending_sales nếu lô CÓ VAT.
-- Trả về id của order_line để test tham chiếu (trả hàng / xuất hóa đơn).
create function tap.mk_confirmed_order(
  p_oid uuid, p_lot uuid, p_qty numeric, p_price numeric
) returns uuid
  language plpgsql
  set search_path = tap, public, extensions
as $$
declare v_lid uuid;
begin
  insert into public.orders(id, customer_id, owner_user_id, warehouse_id, status)
    values (p_oid, tap.cust(), tap.uid(), tap.wh(), 'draft');
  insert into public.order_lines(order_id, product_id, quantity, unit_price, lot_id)
    values (p_oid, tap.prod(), p_qty, p_price, p_lot) returning id into v_lid;
  perform set_config('app.order_rpc', 'on', true);   -- cho phép đổi trạng thái qua guard
  update public.orders set status = 'confirmed', confirmed_by = tap.uid() where id = p_oid;
  perform set_config('app.order_rpc', '', true);
  return v_lid;
end $$;
