---
name: dashboard-branch-scope
description: "Đang làm: Phân quyền chi nhánh cho trang Tổng quan (Dashboard) + nâng UX. Trạng thái từng lớp."
metadata:
  type: project
---

## Task: Dashboard branch-scoping + UX overhaul (bắt đầu 2026-05-30)

**Vấn đề gốc:** Trang Tổng quan (`DashboardPage`) hiển thị tổng TẤT CẢ chi nhánh dù
đã phân quyền. Nguyên nhân: RPC `get_dashboard_stats()` (SECURITY INVOKER) chỉ chạy
SUM thô dưới RLS, mà RLS có nhiều chỗ mở toàn hệ thống:
- `cashbook_transactions`: branch_manager thấy TẤT CẢ (rò rõ nhất — biểu đồ dòng tiền)
- `activities`: branch_manager thấy TẤT CẢ lịch hẹn
- `customer_debts`: branch_manager KHÔNG có policy → thấy 0
- `orders`: accountant/warehouse_keeper thấy TẤT CẢ (theo thiết kế tài chính)
- `stock_lots`: đã scoped (migration ...013)
- cashbook & customer_debts KHÔNG có cột branch_id → suy qua JOIN.

**Quyết định user:**
1. Admin/CEO: có dropdown chọn chi nhánh, mặc định "Tất cả". Vai trò khác khóa cứng chi nhánh của họ.
2. Phạm vi: sửa TOÀN DIỆN RLS + RPC + Frontend.

## Kế hoạch 4 lớp

### ✅ Lớp 1 — DB (HOÀN THÀNH) — `supabase/migrations/20260530000002_dashboard_branch_scope.sql`
- RPC `get_dashboard_stats(p_branch_id UUID DEFAULT NULL)`: lọc tường minh theo branch.
  admin/ceo → p_branch_id (NULL=tất cả); non-admin → ép `fn_my_branch_id()`.
  Trả thêm field `branch_id`. Mọi query thêm `(v_branch IS NULL OR <expr> = v_branch)`.
  - orders.branch_id; debts qua COALESCE(orders.branch_id, customers.branch_id);
    stock_lots qua warehouses.branch_id; cashbook qua COALESCE(cash_funds.branch_id, bank_accounts.branch_id).
- Vá RLS: tách branch_manager khỏi policy "toàn bộ" của `cashbook_transactions` (policy mới
  `cashbook_select_branch_mgr`) và `activities` (`activities_select_branch_mgr`); thêm
  `debts_select_branch_mgr` cho customer_debts. admin/accountant giữ nguyên toàn hệ thống.
- ⚠️ PHẢI chạy migration thủ công qua Supabase SQL Editor (remote chưa auto-apply).

### ✅ Lớp 2 — Hook frontend (HOÀN THÀNH)
- `queryClient.ts`: `qk.dashboard.stats(branchId)` đổi thành hàm; thêm `disbursements`,
  `appointments` (kèm branchId+limit) và `qk.branches.all`.
- `useDashboardStats(enabled, branchId)`: truyền `{ p_branch_id: branchId }` vào RPC; fallback
  lọc orders qua `.eq('branch_id')`, debts/lots/cashflow lọc client-side qua nested branch_id.
- `useDashboardLists.ts`: `usePendingDisbursements`/`useTodayAppointments` nhận branchId; thêm
  `.order()` (disbursements: transaction_date desc; appointments: due_date asc); over-fetch 30 rồi
  lọc client-side theo branch (cash_funds/bank_accounts cho cashbook; customers cho activities) + slice.
- Hook mới `src/hooks/queries/useBranches.ts` (id,code,name, is_active=true).

### ✅ Lớp 3 — UX DashboardPage (HOÀN THÀNH) — `src/pages/dashboard/DashboardPage.tsx`
- Thanh ngữ cảnh chi nhánh (`renderBranchContext`): admin/ceo = dropdown "Tất cả chi nhánh" + list;
  vai trò khác = badge khóa cứng tên chi nhánh. State `selectedBranchId`; `effectiveBranchId` =
  isAdmin ? selected : profile.branch_id. Truyền xuống cả 3 hook → đổi chi nhánh tự refetch (queryKey).
- Tiêu đề + chú thích động qua `scopeLabel` ("toàn hệ thống" / "chi nhánh X").
- Skeleton loading (`renderSkeleton`) thay spinner; error state có nút "Thử lại" (statsQuery.refetch).
- Nút "Tất cả" phiếu chi → navigate('/cashbook') (chỉ hiện khi hasPermission('cashbook.view')).
  (Không có route /activities nên mục Lịch hẹn không có nút Tất cả.)
- Role alerts mở rộng: thêm branch_manager (Building2) + warehouse_keeper (Boxes).
- Delta màu động (xanh nếu >=0, đỏ nếu âm).
- ✅ `tsc --noEmit` PASS, 0 lỗi TypeScript.

### 🔲 Lớp 4 — roadmap_tasks.md (đã đánh dấu Lớp 1; cập nhật Lớp 2-3)

## CÒN LẠI
- ⚠️ User PHẢI chạy migration 20260530000002 qua Supabase SQL Editor để RPC nhận p_branch_id.
- Chưa test runtime thực tế (mới typecheck). Nên verify trên app: đăng nhập branch_manager →
  Dashboard chỉ hiện số liệu chi nhánh; admin → dropdown đổi chi nhánh.

## Lưu ý kỹ thuật
- Profile (AuthContext) đã có `branch_id`, `team_id`. `userRole.code`, `hasPermission()` sẵn dùng.
- Helper RLS: fn_is_admin (admin|ceo), fn_my_branch_id, fn_has_role — tất cả SECURITY DEFINER.
- Quy ước: KHÔNG tạo file md mới ngoài yêu cầu; reload PATH trước npm; migration đặt tên YYYYMMDDXXXXXX.
