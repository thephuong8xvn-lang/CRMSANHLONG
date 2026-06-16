---
name: lesson-rpc-status-guard-flag
description: Khi CREATE OR REPLACE viết lại RPC đổi orders.status, PHẢI giữ lại set_config('app.order_rpc','on',true) nếu không guard chặn → POS không bán được
metadata:
  type: feedback
---

Trigger `trg_guard_order_status` / `fn_guard_order_status` (migration `20260624000001`) CHẶN mọi UPDATE `orders.status` trực tiếp, trừ khi cờ phiên `app.order_rpc='on'` được bật (`set_config('app.order_rpc','on',true)` — phạm vi TRANSACTION). Guard tương tự cho phiếu nhập: cờ `app.receipt_rpc`.

**Sự cố thật (2026-06-16):** migration `20260708000000` dùng `CREATE OR REPLACE FUNCTION fn_pos_quick_sale` để thêm tính năng `overpay_credit`, nhưng quên chép lại dòng `PERFORM set_config('app.order_rpc','on',true);`. Hệ quả: bán nhanh POS (draft→confirmed→completed) bị guard ném `"Không được đổi trạng thái đơn hàng trực tiếp…"` → **KHÔNG bán được hàng** (user tưởng lỗi tồn kho/công nợ). Fix: migration `20260709000000` thêm lại cờ.

**Why:** `CREATE OR REPLACE` thay TOÀN BỘ thân hàm — bất kỳ dòng nào không chép lại sẽ biến mất. Cờ guard là dòng dễ quên nhất vì nó là "hạ tầng bảo mật", không phải logic nghiệp vụ trực tiếp.

**How to apply:**
- Mọi lần viết lại RPC đụng `orders.status` (`fn_pos_quick_sale/edit_order/confirm_order/advance_delivery/complete_delivery_payment/cancel_order/confirm_generated_order`) hoặc `goods_receipts.status` → dòng ĐẦU TIÊN trong BEGIN phải là `PERFORM set_config('app.<order|receipt>_rpc','on',true);`.
- Verify trên DB THẬT sau apply: `SELECT pg_get_functiondef(p.oid) LIKE '%app.order_rpc%' FROM pg_proc p ... WHERE proname='...'` — local ≠ remote. Xem [[project-state]].
- Apply migration lẻ qua Management API `POST /v1/projects/gdotgcrtivjdpkcchrro/database/query` rồi INSERT version vào `supabase_migrations.schema_migrations` (tracking dễ lệch).
