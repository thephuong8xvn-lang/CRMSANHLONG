# B2 — Monitoring + cảnh báo Telegram (hướng dẫn cấu hình)

Migration `supabase/migrations/20260723000000_monitoring.sql` đã apply remote (prod + staging).
Hạ tầng DB chạy ngay; cảnh báo Telegram **chỉ hoạt động sau khi nhập secret**.

## Thành phần đã có
| Thành phần | Vai trò |
|---|---|
| `pg_cron` job `monitor-integrity-daily` | `0 1 * * *` UTC (**08:00 VN**) → `fn_monitor_tick()` |
| `fn_integrity_check()` | 7 bất biến: tồn âm, reserved>tồn, lô orphan, VAT pending/issued lệch, phiếu trả completed thiếu movement, phiếu nhập verified treo >7 ngày |
| `fn_monitor_tick()` | chạy check → ghi `monitor_runs`; có critical → gửi Telegram |
| `fn_send_telegram(text)` | đọc token+chat_id từ **Vault**, POST qua `pg_net`. Thiếu secret → no-op + ghi `app_error_logs` |
| `fn_health()` | liveness nhẹ cho uptime |
| `fn_log_client_error(...)` | FE đẩy lỗi nghiêm trọng vào `app_error_logs` |
| Edge function `health` | endpoint GET công khai cho uptime ping |

## Bước 1 — Tạo Telegram bot
1. Chat với **@BotFather** → `/newbot` → đặt tên → lấy **bot_token** (dạng `123456:ABC...`).
2. Tạo nhóm (hoặc chat thẳng với bot), gửi 1 tin bất kỳ cho bot.
3. Lấy **chat_id**: mở `https://api.telegram.org/bot<bot_token>/getUpdates` → field `chat.id`
   (nhóm thường là số âm, vd `-1001234567890`).

## Bước 2 — Nhập secret vào Vault (KHÔNG hardcode, KHÔNG dán vào git)
Chạy trong **Supabase Studio → SQL Editor** của prod (`gdotgcrtivjdpkcchrro`):
```sql
select vault.create_secret('123456:ABC_token_that_bot', 'telegram_bot_token');
select vault.create_secret('-1001234567890',            'telegram_chat_id');
```
Đổi token sau này:
```sql
select vault.update_secret(
  (select id from vault.secrets where name='telegram_bot_token'), 'token_moi');
```

## Bước 3 — Thử gửi (kiểm tra end-to-end)
```sql
select public.fn_send_telegram('✅ CRM Sanh Long: test cảnh báo monitoring');
-- → nhận tin trong Telegram. Xem trạng thái HTTP:
select id, status_code, content from net._http_response order by id desc limit 1;
```
Tạo vi phạm giả để thử luồng tick (chỉ làm trên **staging**):
```sql
-- staging njtqhaqnwnikdfcsjvlg: tạo lô reserved>onhand rồi:
select public.fn_monitor_tick();   -- → nhận cảnh báo, monitor_runs.ok=false
```

## Bước 4 — Deploy edge function health + uptime
```bash
supabase functions deploy health --no-verify-jwt --project-ref gdotgcrtivjdpkcchrro
```
Endpoint: `https://gdotgcrtivjdpkcchrro.supabase.co/functions/v1/health`
→ đăng ký **UptimeRobot** (free) hoặc **cron-job.org** ping mỗi 5'. Trả 503 → báo down.

## Vận hành / kiểm tra
```sql
select ran_at, ok, alerted, note from public.monitor_runs order by ran_at desc limit 10;
select created_at, level, source, message from public.app_error_logs order by created_at desc limit 20;
select * from cron.job_run_details where jobid=(select jobid from cron.job where jobname='monitor-integrity-daily') order by start_time desc limit 5;
```

## Bảo mật
- Token Telegram chỉ nằm trong Vault (mã hóa), KHÔNG trong git/log/CI.
- `monitor_runs` chỉ admin/ceo đọc; `app_error_logs` user chỉ ghi của mình, admin/ceo đọc.
- `fn_send_telegram`/`fn_monitor_tick` chỉ `service_role` execute (không lộ cho client).
