-- ============================================================
-- Test bất biến toàn cục — chạy trên dữ liệu hiện có của DB.
-- Không cần fixtures; bắt các tình trạng dữ liệu "không thể đúng".
-- ============================================================

create function tap.test_no_negative_stock() returns setof text
  language sql set search_path = tap, public, extensions
as $$
  select is(
    (select count(*)::int from public.stock_lots where quantity_on_hand < 0),
    0, 'Không có lô nào tồn âm');
$$;

create function tap.test_no_orphan_warehouse_lots() returns setof text
  language sql set search_path = tap, public, extensions
as $$
  select is(
    (select count(*)::int
       from public.stock_lots sl
       left join public.warehouses w on w.id = sl.warehouse_id
       where sl.quantity_on_hand > 0 and w.id is null),
    0, 'Không có lô tồn > 0 thuộc kho không tồn tại');
$$;

create function tap.test_reserved_not_exceed_onhand() returns setof text
  language sql set search_path = tap, public, extensions
as $$
  select is(
    (select count(*)::int from public.stock_lots
       where coalesce(quantity_reserved,0) > quantity_on_hand),
    0, 'Không có lô bị giữ chỗ vượt tồn thực');
$$;
