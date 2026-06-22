# Test DB (pgTAP) — RPC tồn kho / VAT

Test logic Postgres (RPC + guard + bất biến) chạy **trên project staging** (cô lập khỏi prod).
Mỗi test chạy trong savepoint và tự **ROLLBACK** → không để lại dữ liệu rác.

## Chuẩn bị (1 lần)
1. Tạo 1 **project Supabase staging** (free) cùng org. Lấy `ref`.
2. Export biến môi trường:
   ```bash
   export STAGING_PROJECT_REF=<ref-staging>
   export SUPABASE_ACCESS_TOKEN=<sbp_...>   # token cấp org, dùng được cho mọi project
   ```

## Đồng bộ schema staging (khi migrations đổi)
```bash
node scripts/db/sync-staging.mjs    # áp dụng supabase/migrations/*.sql lên staging
# hoặc: npm run db:sync
```

## Chạy test
```bash
node scripts/db/run-tests.mjs       # nạp test + runtests('tap') + in TAP
# hoặc: npm run test:db
```

## Cấu trúc
- `00_bootstrap.sql` — cài pgtap, schema `tap`, hằng số UUID, `setup()`/`teardown()`, helper.
- `10_goods_receipt.sql` — hoàn thành phiếu: giữ is_vat/vat_rate, tách lô theo VAT, gộp đúng, guard.
- `90_invariants.sql` — bất biến toàn cục (tồn âm, lô orphan, giữ chỗ vượt tồn).
- (sắp thêm) `20_transfer.sql`, `30_sales_return.sql`, `40_products_list.sql`, `50_vat_issue.sql`.

## Quy ước
- Hàm test: `tap.test_*()` trả `setof text` (dùng `ok/is/throws_ok` của pgTAP).
- `setup()` seed dữ liệu + "đăng nhập" admin qua `request.jwt.claims` (auth.uid()).
- Tạo phiếu `verified` trong test qua `tap.mk_verified_receipt(...)` (bật cờ guard tạm thời).
