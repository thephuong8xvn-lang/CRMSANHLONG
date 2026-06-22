# 11 — Kế hoạch "Đầu tư độ tin cậy" (Reliability)

> Trạng thái: **CHỜ DUYỆT** · Lập 2026-06-22 · Thứ tự thực thi: **B1 → A → B2 → C**

Mục tiêu tổng: giảm rủi ro mất dữ liệu, bắt sớm lỗi toàn vẹn (đặc biệt tồn kho/VAT theo lô),
và cho phép bán hàng khi rớt mạng. Không làm 2 mục còn lại (HĐĐT, cầu nối MISA) ở đợt này.

## Quyết định đã chốt (qua AskUserQuestion 2026-06-22)
- **Cô lập test:** project Supabase **staging riêng (free)**, không chạy đè prod.
- **Nơi backup:** **Google Drive của người dùng** qua **rclone** (tài khoản zendviet@gmail.com). ⚠️ KHÔNG dùng service account để upload — Gmail cá nhân (không phải Workspace) chặn SA lưu file (`storageQuotaExceeded`). SA chỉ đọc được, không ghi được.
- **Kênh cảnh báo:** **Telegram bot**.
- **Hạ tầng DB:** Postgres 17, region ap-southeast-1. Extensions sẵn sàng (chưa cài): `pgtap`, `pg_cron`, `pg_net`, `http`.
- **Backup hiện tại:** `pitr_enabled=false`, `backups=[]` → CHƯA có lưới an toàn (rủi ro cao).
- **Máy local:** không Docker / Supabase CLI / psql → test & backup chạy trên cloud (Management API + GitHub Actions).

Ký hiệu: **[TÔI]** = Claude làm trong repo · **[BẠN]** = cần thao tác/secret của người dùng.

---

## Workstream B1 — Backup logic định kỳ (làm trước, lấp rủi ro ngay)

**Cách làm:** GitHub Actions cron hằng ngày (01:00 VN) → `pg_dump -Fc` (custom format, nén) → `rclone copy` lên thư mục Drive của người dùng → giữ luân phiên 30 ngày + 1 bản artifact GitHub (off-site lớp 2, 14 ngày).

### Secrets dùng
- `SUPABASE_DB_URL` — chuỗi Session pooler `postgresql://postgres.<ref>:<pass>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`. ✅ đã tạo.
- `GDRIVE_BACKUP_FOLDER_ID` — ID thư mục Drive đích (bạn sở hữu). ✅ đã tạo.
- `RCLONE_CONF` — **CẦN TẠO**: toàn bộ nội dung `rclone.conf` (remote tên `gdrive`, type drive, token tài khoản bạn). Hướng dẫn ở mục cuối.
- ~~`GDRIVE_SA_KEY`~~ — KHÔNG dùng cho backup (SA không lưu được Drive cá nhân). Có thể xoá.

### Việc đã làm [TÔI]
- `.github/workflows/db-backup.yml`: cài pg17 client → precheck kết nối (`psql select 1`) → `pg_dump --format=custom --compress=6 --no-owner --no-privileges` → `rclone copy --drive-root-folder-id` → prune `--min-age 30d` → upload artifact lớp 2. KHÔNG in chuỗi kết nối ra log.

### Khôi phục (restore) — chạy khi cần
```bash
# 1. Tải file crm-YYYYMMDD-HHMM.dump từ Drive về.
# 2. Restore vào STAGING (không restore đè prod trừ khi thảm họa):
pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "postgresql://postgres.<staging-ref>:<pass>@<pooler-host>:5432/postgres" \
  crm-YYYYMMDD-HHMM.dump
```

### Tiêu chí nghiệm thu
- Run workflow tay → log "Kết nối DB OK" + file `crm-*.dump` xuất hiện trong thư mục Drive.
- Thử **restore** 1 bản vào staging không lỗi (chứng minh backup dùng được).
- Cron chạy đúng giờ; bản > 30 ngày tự xoá.

**Rủi ro:** thấp (chú ý bảo mật secret; KHÔNG in connection string ra log).

### Hướng dẫn tạo `RCLONE_CONF` [BẠN]
1. Cài rclone trên máy: PowerShell `winget install Rclone.Rclone` (hoặc tải tại rclone.org/downloads).
2. Mở PowerShell, chạy `rclone config`:
   - `n` (New remote) → name nhập **`gdrive`** (đúng tên này).
   - Storage: gõ **`drive`** (Google Drive).
   - `client_id` / `client_secret`: để TRỐNG (Enter).
   - `scope`: chọn **`1`** (Full access).
   - `service_account_file`: để TRỐNG.
   - Edit advanced config: **`n`**.
   - Use auto config: **`y`** → trình duyệt mở → đăng nhập tài khoản zendviet@gmail.com → Allow.
   - Configure as Shared Drive: **`n`** → `y` xác nhận → `q` thoát.
3. Lấy đường dẫn file config: `rclone config file` (vd `C:\Users\Admin\AppData\Roaming\rclone\rclone.conf`).
4. Mở file đó, **copy toàn bộ** nội dung → tạo GitHub secret tên **`RCLONE_CONF`**, dán vào Value.

---

## Workstream A — Test tự động RPC tồn kho/VAT (pgTAP trên staging)

### Việc cần làm
- [BẠN] Tạo **project staging** (free) cùng org; gửi tôi `ref` + access token (hoặc cấp token hiện có quyền).
- [TÔI] Script `scripts/db/sync-staging.mjs`: apply toàn bộ `supabase/migrations/*` lên staging qua Management API (idempotent).
- [TÔI] `supabase/tests/00_fixtures.sql`: seed tối thiểu (chi nhánh, kho, NCC, sản phẩm lot-managed, user giả lập + role) — chạy trong test, rollback.
- [TÔI] Cài `pgtap`; viết test theo nhóm:
  - `10_goods_receipt.sql` — hoàn thành phiếu: is_vat/vat_rate đúng; gộp lô khóa 4 cột; **không** trộn VAT≠; guard set_config; Σtồn=Σdòng; chặn khi chưa verified.
  - `20_transfer.sql` — chuyển kho giữ is_vat; bảo toàn tổng tồn.
  - `30_sales_return.sql` — hồi kho giữ is_vat lô gốc; idempotent; cấn nợ đúng.
  - `40_products_list.sql` — vat_stock+nonvat_stock=tồn; lọc chi nhánh; whitelist sort.
  - `50_vat_issue.sql` — gộp tiền/VAT đúng; chống xuất trùng; chỉ lô is_vat vào pending.
  - `90_invariants.sql` — bất biến toàn cục: không tồn âm; không lô orphan kho; không phiếu verified treo bất thường.
- [TÔI] `scripts/db/run-tests.mjs` + `npm run test:db`: chạy `select * from runtests()`, parse TAP, exit ≠0 nếu đỏ.
- [TÔI] (tuỳ chọn) thêm bước `test:db` vào workflow CI để chạy mỗi PR.

### Tiêu chí nghiệm thu
- `npm run test:db` xanh; cố tình phá 1 RPC → test đỏ đúng chỗ (chứng minh test có hiệu lực).
- Mỗi RPC trọng yếu có ≥1 test "happy" + ≥1 test "chặn sai".

**Ước lượng:** ~2–3 ngày. **Rủi ro:** thấp (staging cô lập).

---

## Workstream B2 — Monitoring + cảnh báo (Telegram)

### Việc cần làm
- [BẠN] Tạo Telegram bot (@BotFather) → lấy `bot_token`; lấy `chat_id` nhóm/cá nhân.
- [BẠN] Đặt secret DB cho webhook (lưu token trong `vault`/bảng config, KHÔNG hardcode).
- [TÔI] Migration `monitoring`:
  - Bật `pg_cron`, `pg_net`.
  - Bảng `app_error_logs` (FE đẩy lỗi RPC/uncaught, có sampling).
  - `fn_health()` nhẹ (đếm sống) cho uptime.
  - `fn_integrity_check()` — gom các truy vấn bất biến (tồn âm, lệch vat/nonvat, lô orphan, phiếu treo, pending VAT bất thường) → trả danh sách vi phạm.
  - `pg_cron`: mỗi sáng gọi `fn_integrity_check`; nếu có vi phạm → `pg_net` POST Telegram. Digest lỗi FE hằng ngày.
- [TÔI] FE: `logger` đẩy lỗi nghiêm trọng vào `app_error_logs` (RLS chặt, ẩn PII).
- [TÔI] [BẠN] Uptime: UptimeRobot (free) ping `/healthz` mỗi 5' (hoặc Actions cron).

### Tiêu chí nghiệm thu
- Cố tạo 1 vi phạm bất biến (vd lô orphan trong staging) → nhận tin Telegram.
- Tắt app → UptimeRobot báo down.

**Ước lượng:** ~2 ngày. **Rủi ro:** thấp–trung (quản lý token; pg_net bật).

---

## Workstream C — POS offline cơ bản (làm cuối, đứng trên nền A)

### Thành phần
1. [TÔI] **Snapshot danh mục offline** (IndexedDB): sản phẩm + giá theo nhóm + tồn lô theo kho của user; làm tươi khi online; hiển thị "Dữ liệu offline cập nhật lúc …".
2. [TÔI] **Hàng đợi ghi offline** (IndexedDB): offline → đơn nhận **UUID + idempotency key** client → xếp hàng; online → flush tuần tự qua RPC tạo đơn (idempotent chống tạo trùng).
3. [TÔI] **UI trạng thái**: chỉ báo Online/Offline; badge "N đơn chờ đồng bộ"; màn hình đơn lỗi đồng bộ.
4. [TÔI] **Giới hạn an toàn (ghi rõ cho NV):** offline không đảm bảo tồn realtime (oversell → cảnh báo + reconcile khi sync); hoãn kiểm tra hạn mức công nợ tới lúc đồng bộ; FEFO theo snapshot.

> [BẠN] [TÔI] **Cần bổ sung DB:** RPC tạo đơn phải nhận **idempotency key** (cột + unique) để flush an toàn. Sẽ thêm migration nhỏ ở đầu C.

### Tiêu chí nghiệm thu
- Ngắt mạng (DevTools offline): tra cứu + lập đơn được; có mạng lại → đơn tự lên server đúng 1 lần (không trùng).
- Flush 2 lần cùng key → chỉ 1 đơn.

**Ước lượng:** ~4–6 ngày. **Rủi ro:** TRUNG–CAO (idempotency, reconcile tồn, double-submit).

---

## Phụ thuộc khởi động (checklist [BẠN])
| Cho workstream | Secret/Thao tác |
|---|---|
| B1 | `SUPABASE_DB_URL` ✅, `GDRIVE_BACKUP_FOLDER_ID` ✅, **`RCLONE_CONF`** (cần tạo qua rclone config) |
| A | Tạo project **staging** + ref/token |
| B2 | Telegram `bot_token` + `chat_id` |
| C | (không secret; có migration idempotency) |

## Rủi ro & nguyên tắc
- KHÔNG in connection string/secret ra log CI.
- Mọi thay đổi DB qua migration + tracking row + verify (theo [[infra-verify-remote-schema]]).
- C chỉ bắt đầu sau khi A xanh (test bảo vệ RPC tạo đơn).
