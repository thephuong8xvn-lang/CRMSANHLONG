-- ============================================================
-- Migration: global_customer_debt_and_admin_pricing
-- File: 20260750000000_global_customer_debt_and_admin_pricing.sql
--
-- Khớp RLS với MÔ HÌNH KINH DOANH user chốt 2026-08-02:
--   • Chi nhánh độc lập về KHO và DÒNG TIỀN (đã đúng sẵn).
--   • KHÁCH HÀNG là của TOÀN CÔNG TY, mua ở chi nhánh nào cũng được.
--   • CÔNG NỢ là CÔNG NỢ TỔNG của một khách — mua nợ ở Hoài Ân, trả ở Mỹ Thành
--     đều được. → Ai được phép THU NỢ thì phải THẤY TOÀN BỘ nợ của khách.
--   • GIÁ BÁN dùng chung toàn công ty, CHỈ admin được sửa.
--
-- ─── LỖI ĐANG CÓ ─────────────────────────────────────────────
-- `debts_select_branch_mgr` chặn công nợ theo `customers.branch_id`:
--     branch_manager AND customers.branch_id = fn_my_branch_id()
-- → Khách gắn nhãn Phù Mỹ sang Hoài Ân trả nợ thì màn hình Hoài Ân hiện nợ = 0,
--   trong khi `fn_collect_customer_debt` (SECURITY DEFINER) vẫn cho thu. Nhân
--   viên không biết thu bao nhiêu. Trái thẳng mô hình "công nợ tổng".
--
-- Hiện nghiệp vụ vẫn chạy CHỈ VÌ 3 TK chi nhánh đang được tick thừa vai trò
-- `accountant` (tàn dư chữa cháy 2026-08-02 04:53) mà `debts_select_accountant`
-- không giới hạn chi nhánh. Gỡ vai trò thừa TRƯỚC migration này = vỡ thu nợ.
--
-- Bất nhất kèm theo: `debt_payments_select_accountant` lại cho branch_manager
-- xem MỌI phiếu thu nợ toàn công ty (không giới hạn) — chặt sai chỗ, hở sai chỗ.
--
-- ─── CÁCH VÁ ─────────────────────────────────────────────────
-- Chốt theo QUYỀN thay vì tên vai trò, và BỎ giới hạn chi nhánh trên công nợ:
--   customer_debts / debt_payments  đọc  → customers.collect_debt
--   customer_debts                  ghi  → customers.adjust_debt
--   debt_payments                   ghi  → customers.collect_debt
--
-- Vì sao KHÔNG dùng `customers.view_all`: mã đó đang thuộc gần như mọi vai trò
-- (kể cả sales, viewer, vet_consultant) → sẽ phơi toàn bộ sổ nợ 419 triệu ₫ cho
-- nhân viên bán hàng. `customers.collect_debt` = accountant, branch_manager,
-- warehouse_keeper — đúng nhóm cần thấy để thu.
-- `debts_select_sales` giữ nguyên: sales vẫn chỉ thấy nợ khách của mình.
--
-- KHÔNG đụng `order_payments_select_branch_mgr`: đó là tiền thu TẠI QUẦY của
-- đơn hàng, thuộc dòng tiền chi nhánh — giữ tách theo `orders.branch_id`.
--
-- ⚠️ Apply remote qua Management API + tracking row.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. CÔNG NỢ KHÁCH = CÔNG NỢ TỔNG (bỏ ranh giới chi nhánh)
-- ─────────────────────────────────────────────────────────────

-- Đọc: ai được thu nợ thì thấy trọn sổ nợ của khách, bất kể khách gắn nhãn
-- chi nhánh nào. Thay hẳn policy cũ bị chặn theo customers.branch_id.
DROP POLICY IF EXISTS "debts_select_branch_mgr" ON public.customer_debts;
DROP POLICY IF EXISTS "debts_select_accountant" ON public.customer_debts;

CREATE POLICY "debts_select_collector" ON public.customer_debts
  FOR SELECT
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('customers.collect_debt'))
  );

-- Ghi (tạo / điều chỉnh / cấn trừ nợ thủ công)
DROP POLICY IF EXISTS "debts_manage_accountant" ON public.customer_debts;

CREATE POLICY "debts_manage_adjuster" ON public.customer_debts
  FOR ALL
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('customers.adjust_debt'))
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('customers.adjust_debt'))
  );

-- Phiếu thu nợ: đọc + ghi theo quyền thu nợ (vốn đã không giới hạn chi nhánh,
-- nay nói rõ ra bằng mã quyền thay vì liệt kê tên vai trò).
DROP POLICY IF EXISTS "debt_payments_select_accountant" ON public.debt_payments;
DROP POLICY IF EXISTS "debt_payments_manage_accountant" ON public.debt_payments;

CREATE POLICY "debt_payments_select_collector" ON public.debt_payments
  FOR SELECT
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('customers.collect_debt'))
  );

CREATE POLICY "debt_payments_manage_collector" ON public.debt_payments
  FOR ALL
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('customers.collect_debt'))
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('customers.collect_debt'))
  );

-- ─────────────────────────────────────────────────────────────
-- 2. GIÁ BÁN: dùng chung toàn công ty, CHỈ admin sửa
--    RLS price_lists / price_list_items đã chốt theo `pricing.manage` — không
--    cần đổi policy, chỉ cần THU HỒI mã quyền khỏi các vai trò chi nhánh.
--    Trước: accountant, admin, branch_manager, team_lead, warehouse_keeper.
--    Sau  : admin (ceo vẫn qua được nhờ fn_is_admin — xem ghi chú cuối file).
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.role_permissions rp
 USING public.roles r, public.permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND p.code = 'pricing.manage'
   AND r.code <> 'admin';

-- Chi nhánh Mỹ Thành chưa có bảng giá mặc định → POS không có giá để bán.
-- Gán cùng bảng giá lẻ như Phù Mỹ / Hoài Ân (mô hình: giá dùng chung).
UPDATE public.branches
   SET default_price_list_id = (
     SELECT id FROM public.price_lists
      WHERE is_default AND is_active AND usage = 'sales' LIMIT 1)
 WHERE is_active
   AND default_price_list_id IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. KIỂM TRA NGAY TRONG MIGRATION
-- ─────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_thua  TEXT;
  v_thieu INT;
BEGIN
  SELECT string_agg(r.code, ', ') INTO v_thua
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
   WHERE p.code = 'pricing.manage' AND r.code <> 'admin';
  IF v_thua IS NOT NULL THEN
    RAISE EXCEPTION 'Vai trò % vẫn còn pricing.manage.', v_thua;
  END IF;

  SELECT count(*) INTO v_thieu FROM public.branches
   WHERE is_active AND default_price_list_id IS NULL;
  IF v_thieu > 0 THEN
    RAISE EXCEPTION 'Còn % chi nhánh đang hoạt động chưa có bảng giá mặc định.', v_thieu;
  END IF;

  -- Công nợ không được còn ranh giới chi nhánh nào
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('customer_debts','debt_payments')
       AND COALESCE(qual,'') LIKE '%fn_my_branch_id%'
  ) THEN
    RAISE EXCEPTION 'Vẫn còn policy công nợ giới hạn theo chi nhánh.';
  END IF;
END $mig$;

COMMIT;

-- GHI CHÚ: `fn_is_admin()` = admin OR ceo, nên vai trò `ceo` vẫn sửa được giá.
-- Hiện không ảnh hưởng ai (chỉ TK admin đang giữ `ceo`). Muốn siết đúng như
-- Cấu hình/Báo cáo ở `20260744` thì đổi sang `fn_is_sysadmin()` — là quyết định
-- nghiệp vụ riêng, không tự làm ở đây.

NOTIFY pgrst, 'reload schema';
