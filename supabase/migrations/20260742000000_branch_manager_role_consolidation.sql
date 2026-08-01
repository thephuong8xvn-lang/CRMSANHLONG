-- ============================================================
-- Migration: branch_manager_role_consolidation
-- File: 20260742000000_branch_manager_role_consolidation.sql
--
-- BỐI CẢNH: rà soát 2026-08-01 cho thấy mỗi tài khoản chi nhánh đang được gán
-- 6 vai trò (branch_manager + team_lead + sales + accountant + warehouse_keeper
-- + vet_consultant) = 67 quyền hợp nhất. Nhưng riêng `branch_manager` đã cho 54
-- quyền; 5 vai trò kia cộng lại chỉ thêm **13 quyền**, phần lớn là bản hẹp hơn
-- (view_own/view_team) của thứ branch_manager đã có bản rộng (view_all).
--
-- Chồng 6 vai trò lên nhau khiến nhìn vào không biết ai được gì, và làm mô hình
-- phân quyền mất ý nghĩa (ai cũng là tất cả).
--
-- MỤC ĐÍCH: dồn đủ 13 quyền còn thiếu vào `branch_manager` để một mình vai trò
-- này phủ trọn 67 quyền → tài khoản chi nhánh chỉ cần DUY NHẤT `branch_manager`.
--
-- Thêm ĐỦ 13 (không phải 7 "thực sự cần") để bảo toàn tuyệt đối: sau khi gộp,
-- tập quyền phải KHỚP 1-1 với trước, chứng minh được bằng phép đếm 67 = 67.
-- 6 mã hẹp (view_own/view_team/update_own/update_draft) tuy đã được bản _all
-- bao phủ về mặt nghiệp vụ, nhưng giữ lại để không phụ thuộc vào giả định đó.
--
-- KHÔNG đụng tới việc gán vai trò cho từng người (dữ liệu riêng của bản triển
-- khai này) — phần đó chạy riêng, xem ghi chú cuối file.
--
-- ⚠️ Apply remote qua Management API + tracking row.
-- ============================================================

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.code = 'branch_manager'
   AND p.code IN (
     -- Thực sự bổ sung năng lực mới cho quản lý chi nhánh
     'products.create',      -- từ warehouse_keeper
     'products.edit',        -- từ warehouse_keeper
     'promotions.view',      -- từ sales / team_lead
     'reports.sales',        -- từ team_lead
     'reports.team_kpi',     -- từ team_lead
     'reports.cashflow',     -- từ accountant
     'reports.debt',         -- từ accountant
     -- Bản hẹp: giữ cho khớp tuyệt đối tập quyền cũ
     'customers.view_own',
     'customers.view_team',
     'customers.update_own',
     'orders.view_own',
     'orders.view_team',
     'orders.update_draft'
   )
ON CONFLICT DO NOTHING;

-- Kiểm tra ngay trong migration: branch_manager phải phủ trọn hợp nhất của
-- 6 vai trò cũ. Nếu không, dừng lại thay vì để gộp vai trò rồi mất quyền.
DO $$
DECLARE
  v_thieu INTEGER;
BEGIN
  SELECT count(*) INTO v_thieu
  FROM (
    SELECT DISTINCT rp.permission_id
      FROM public.role_permissions rp
      JOIN public.roles r ON r.id = rp.role_id
     WHERE r.code IN ('branch_manager','team_lead','sales','accountant','warehouse_keeper','vet_consultant')
  ) hop_nhat
  WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp2
      JOIN public.roles r2 ON r2.id = rp2.role_id
     WHERE r2.code = 'branch_manager' AND rp2.permission_id = hop_nhat.permission_id
  );

  IF v_thieu > 0 THEN
    RAISE EXCEPTION 'branch_manager còn thiếu % quyền so với hợp nhất 6 vai trò — KHÔNG được gộp.', v_thieu;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Phần dữ liệu riêng của bản triển khai (chạy tay, không đưa vào migration
-- vì gắn với tài khoản cụ thể):
--   1. Mỗi tài khoản chi nhánh → chỉ giữ vai trò 'branch_manager'
--   2. profiles.branch_id = NULL cho tài khoản quản trị
--      → bịt lỗ leo thang: branch_manager có users.assign_role và RLS
--        user_roles_manage_manager cho sửa vai trò người CÙNG CHI NHÁNH, mà
--        tài khoản admin lại đang nằm trong Chi nhánh Hoài Ân → đã chứng minh
--        đóng vai chi nhánh xoá sạch được vai trò của admin (8 → 0).
-- ─────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
