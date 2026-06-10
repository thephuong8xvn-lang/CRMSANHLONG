-- ─────────────────────────────────────────────────────────────
-- CRM SANHLONGVETCO – GIA CỐ BẢO MẬT SỔ QUỸ (Cashbook hardening)
-- File: 20260627000000_cashbook_harden.sql
-- AUDIT-2026-06-10 — Cashbook re-audit hardening
--
-- Vá 4 lỗ hổng phát hiện khi audit lại (đã chứng minh exploit trên prod
-- trong transaction rollback):
--   C1 (NGHIÊM TRỌNG): fn_apply_fund_delta là SECURITY DEFINER cộng/trừ
--     thẳng số dư quỹ, chưa REVOKE → mọi user đăng nhập gọi rpc() sửa số dư.
--   C2 (CAO): ngưỡng duyệt 10M chỉ chặn ở client → nhân viên INSERT thẳng
--     phiếu chi 'approved' số tiền bất kỳ qua API, né duyệt + cô lập chi nhánh.
--   C3 (CAO): policy INSERT có clause hở flow_type='internal_transfer' →
--     mọi user active chèn được dòng chuyển quỹ rác.
--   C4 (TRUNG): không có state machine; sửa số tiền/quỹ phiếu đã 'approved'
--     không re-balance → lệch số dư im lặng.
--
-- Cơ chế: trigger auto sinh phiếu (order/debt/supplier/advance/transfer) là
-- SECURITY DEFINER owner=postgres, bảng KHÔNG bật FORCE RLS → các trigger này
-- BỎ QUA RLS. Nhờ vậy ràng buộc RLS dưới đây CHỈ áp cho phiếu nhập tay từ
-- client (role authenticated), KHÔNG ảnh hưởng luồng auto.
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- 1. (C1, C5) Thu hồi quyền EXECUTE các hàm tài chính nội bộ
--    — chỉ trigger/định nghĩa nội bộ gọi, KHÔNG cho PostgREST RPC.
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_apply_fund_delta(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_default_cash_fund(UUID)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_default_bank_account(UUID)            FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. (C2, C3) Tạo lại policy INSERT phiếu sổ quỹ
--    - Bỏ clause hở flow_type='internal_transfer' (leg chuyển quỹ do
--      trigger definer tạo, bypass RLS — không cần clause này).
--    - Phiếu chi 'approved' vượt 10.000.000đ KHÔNG được tạo thẳng (phải
--      'pending_approval' → người khác duyệt; self-approval guard ở UPDATE).
--    - Cô lập chi nhánh: chỉ thao tác trên quỹ/TK thuộc chi nhánh mình.
--    Admin/CEO (fn_is_admin) miễn toàn bộ ràng buộc.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cashbook_insert_staff" ON public.cashbook_transactions;
CREATE POLICY "cashbook_insert_staff" ON public.cashbook_transactions
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND created_by = auth.uid()
    AND (
      public.fn_is_admin()
      OR (
        (
          (flow_type = 'inflow'
            AND (public.fn_has_permission('cashbook.create_inflow')  OR public.fn_has_permission('cashbook.create')))
          OR (flow_type = 'outflow'
            AND (public.fn_has_permission('cashbook.create_outflow') OR public.fn_has_permission('cashbook.create')))
        )
        -- Chỉ cho phép trạng thái khởi tạo hợp lệ
        AND status IN ('draft', 'pending_approval', 'approved')
        -- Phiếu CHI vượt ngưỡng 10tr: không được tạo thẳng 'approved'
        AND NOT (flow_type = 'outflow' AND status = 'approved' AND amount > 10000000)
        -- Cô lập chi nhánh: quỹ/TK của phiếu phải thuộc chi nhánh người tạo
        AND (
          EXISTS (SELECT 1 FROM public.cash_funds cf
                  WHERE cf.id = cash_fund_id AND cf.branch_id = public.fn_my_branch_id())
          OR EXISTS (SELECT 1 FROM public.bank_accounts ba
                  WHERE ba.id = bank_account_id AND ba.branch_id = public.fn_my_branch_id())
        )
      )
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 3. (C4) Guard chuyển trạng thái + khóa trường tài chính khi đã duyệt
--    Trigger BEFORE UPDATE: áp cho MỌI update (kể cả luồng definer như
--    fn_reverse_order_effects: approved→cancelled — nằm trong danh sách hợp lệ).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_cashbook_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Phiếu đã hủy là chung cuộc
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Phiếu sổ quỹ đã hủy — không thể thay đổi';
  END IF;

  -- Chỉ cho phép chuyển trạng thái theo state machine
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'draft'            AND NEW.status IN ('pending_approval', 'approved', 'cancelled'))
      OR (OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'cancelled', 'draft'))
      OR (OLD.status = 'approved'         AND NEW.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Chuyển trạng thái phiếu % → % không hợp lệ', OLD.status, NEW.status;
    END IF;
  END IF;

  -- Phiếu đã duyệt: khóa số tiền/loại/quỹ (trigger số dư không re-balance khi
  -- sửa amount của phiếu approved → tránh lệch số dư im lặng). Muốn sửa → hủy + tạo mới.
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    IF NEW.amount         IS DISTINCT FROM OLD.amount
    OR NEW.flow_type      IS DISTINCT FROM OLD.flow_type
    OR NEW.cash_fund_id   IS DISTINCT FROM OLD.cash_fund_id
    OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id THEN
      RAISE EXCEPTION 'Phiếu đã duyệt — không được sửa số tiền/loại/quỹ. Hãy hủy và tạo phiếu mới.';
    END IF;
  END IF;

  -- Đóng dấu thời điểm hủy
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_cashbook_update ON public.cashbook_transactions;
CREATE TRIGGER trg_guard_cashbook_update
  BEFORE UPDATE ON public.cashbook_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_cashbook_update();
