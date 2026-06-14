---
name: inventory-security-audit
description: Rà soát toàn diện Kho 2026-06-14 — vá lỗ hổng RPC chuyển kho, trigger trả NCC, RLS; còn task tài chính trả NCC
metadata:
  type: project
---

## Rà soát toàn diện Kho ✅ 2026-06-14 (Phần B)

Migration `20260704000000_harden_inventory_transfers_returns.sql` — **ĐÃ apply remote (Management API) + verify + ghi history `20260704000000`. KHÔNG đổi frontend.**

### Đã vá
- **#1 (NGHIÊM TRỌNG) RPC chuyển kho:** `fn_start_transfer/fn_receive_transfer/fn_cancel_transfer` (mig `20260528000002`, sửa giá vốn `20260530000001`) là SECURITY DEFINER + GRANT authenticated nhưng KHÔNG check quyền và ghi `performed_by`/`received_by` từ `p_user_id` client → bất kỳ user đăng nhập nào thao túng tồn kho + giả mạo audit. Vá: guard `fn_is_admin() OR fn_has_role('warehouse_keeper')` + `auth.uid()` (giữ signature `(uuid,uuid)`, BỎ QUA p_user_id → FE không phải đổi).
- **#2 Trả NCC:** trigger `fn_auto_stock_on_purchase_return_confirm` cũ trừ kho mỗi lần →confirmed/completed (double-deduct nếu qua confirmed). Vá: trừ MỘT LẦN khi rời 'draft'; HOÀN kho khi (confirmed/completed)→cancelled; guard transition. `handleConfirmReturn` (InventoryPage) vẫn UPDATE thẳng status='completed' — giờ an toàn nhờ trigger guard.
- **#4 RLS:** tách `stock_transfers_manage`/`purchase_returns_manage` → insert (WITH CHECK created_by=auth.uid() + kho thuộc chi nhánh, admin miễn trừ) / update / delete.

### #3 Mặt tài chính trả NCC — ✅ HOÀN THÀNH (mig `20260705000000`, apply + smoke-test PASS)
Trigger `fn_finance_on_purchase_return` AFTER UPDATE trên `purchase_returns`, ghi khi rời 'draft'→confirmed/completed (cùng điểm xuất kho), đảo ngược khi →cancelled:
- `credit_note` + `next_po_offset` → `suppliers.current_debt_payable -= total_amount` (giảm nợ phải trả).
- `cash_refund` → cashbook **inflow** vào `fn_default_cash_fund(branch người tạo)`, **session_id NULL** (user chọn không gắn ca), danh mục `THU-HOAN-NCC`; KHÔNG đụng công nợ. Đảo: outflow `CHI-HOAN-NCC`.
- Danh mục mới trong `expense_categories` (bảng dùng chung, phân theo `flow_type`): THU-HOAN-NCC (inflow), CHI-HOAN-NCC (outflow).
- Smoke-test transaction-rollback: credit_note → debt −1000 + lô −1; cash_refund → 1 inflow 1000 + debt delta 0. ✓
- **Lưu ý kế toán:** cash_refund coi như NCC trả lại tiền (đã ứng trước) → chỉ ghi THU, không giảm payable (chuẩn kế toán, user duyệt).

### Đã tốt (giữ nguyên)
Phiếu nhập: status guard `20260622` + công nợ NCC khi completed `20260623` + sinh kho atomic RPC. Transfer: FOR UPDATE chống race. Kiểm tồn khả dụng trước xuất ở cả transfer & return.

Liên quan: [[feature-pos-draft-persistence]], [[project-state]].
