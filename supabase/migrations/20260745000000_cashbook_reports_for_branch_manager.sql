-- ============================================================
-- Migration: cashbook_reports_for_branch_manager
-- File: 20260745000000_cashbook_reports_for_branch_manager.sql
--
-- User chốt 2026-08-02: "báo cáo cũng chặn cứng và tách menu này vào phần cấu
-- hình, đưa menu sổ quỹ độc lập và đưa vào quyền quản trị chi nhánh".
--
-- Phần "chặn cứng" KHÔNG cần làm gì: đã rà 19 hàm báo cáo
-- (`fn_profit_*`, `fn_strategic_*`, `fn_bi_*`, `fn_demand_*`) — tất cả đều mở
-- đầu bằng `IF NOT fn_has_role('admin') THEN RAISE EXCEPTION`, tức đúng vai trò
-- admin, không tính cả `ceo`. Đã test đóng vai tài khoản chi nhánh: 4/4 bị chặn.
-- Route `/reports*` phía FE cũng `adminOnly` sẵn. Việc còn lại chỉ là dời menu.
--
-- Phần DB duy nhất phải làm: Sổ quỹ đứng độc lập và thuộc về Quản trị chi nhánh
-- → `branch_manager` phải sở hữu TRỌN cụm `cashbook.*`. Đang thiếu đúng 1 mã:
--
--   cashbook.view_reports (Báo cáo quỹ)  — chỉ admin / ceo / viewer có
--
-- 5 mã còn lại (`view`, `create`, `create_inflow`, `create_outflow`, `approve`,
-- `manage_fund`) branch_manager đã có. Thiếu mã này thì ma trận phân quyền nói
-- sai sự thật: vai trò làm chủ Sổ quỹ mà không được xem báo cáo quỹ.
--
-- KHÔNG cấp `reports.inventory` (Tồn kho/Giá vốn) — đó là báo cáo toàn công ty,
-- lộ giá vốn mọi chi nhánh, thuộc cụm Báo cáo vừa chặn cứng cho admin.
--
-- ⚠️ Apply remote qua Management API + tracking row.
-- ============================================================

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, pm.id
  FROM public.roles r
  CROSS JOIN public.permissions pm
 WHERE r.code = 'branch_manager'
   AND pm.code = 'cashbook.view_reports'
ON CONFLICT DO NOTHING;

-- Kiểm chứng ngay: branch_manager phải phủ trọn cụm cashbook.*
DO $$
DECLARE
  v_thieu INTEGER;
  v_tong  INTEGER;
BEGIN
  SELECT count(*) INTO v_thieu
    FROM public.permissions pm
   WHERE pm.code LIKE 'cashbook.%'
     AND NOT EXISTS (
       SELECT 1 FROM public.role_permissions rp
         JOIN public.roles r ON r.id = rp.role_id
        WHERE r.code = 'branch_manager' AND rp.permission_id = pm.id);
  IF v_thieu > 0 THEN
    RAISE EXCEPTION 'branch_manager còn thiếu % mã cashbook.*', v_thieu;
  END IF;

  SELECT count(*) INTO v_tong
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
   WHERE r.code = 'branch_manager';
  RAISE NOTICE 'branch_manager: % quyền, phủ trọn cashbook.*', v_tong;

  -- Báo cáo vẫn phải nằm ngoài tầm với: không hàm báo cáo nào nới cho vai trò khác
  SELECT count(*) INTO v_thieu
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.proname LIKE 'fn_profit\_%' OR p.proname LIKE 'fn_strategic\_%'
          OR p.proname LIKE 'fn_bi\_%' OR p.proname LIKE 'fn_demand\_%')
     AND p.prosecdef
     AND pg_get_functiondef(p.oid) NOT LIKE '%fn_has_role(''admin'')%';
  IF v_thieu > 0 THEN
    RAISE EXCEPTION 'Có % hàm báo cáo SECURITY DEFINER không chốt fn_has_role(admin).', v_thieu;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
