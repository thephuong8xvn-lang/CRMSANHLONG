-- ============================================================
-- Migration: inventory_policies_permission_not_role
-- File: 20260749000000_inventory_policies_permission_not_role.sql
--
-- Tiếp nối `20260748` (đã vá chuyển kho). Rà toàn bộ RLS còn chốt cứng theo TÊN
-- VAI TRÒ `warehouse_keeper` mà không chấp nhận `branch_manager` → 21 policy.
-- Đây là phần còn lại của cùng một lỗi: `20260742` gộp 3 TK chi nhánh xuống chỉ
-- còn `branch_manager`, nên mọi chốt theo tên vai trò cũ đều khoá cửa họ.
--
-- Vá 18/21. Chuyển sang mã quyền theo bảng:
--   goods_receipts, goods_receipt_lines,
--   purchase_returns, purchase_return_lines,
--   purchase_orders (update khi nhập hàng)      → inventory.receive
--   stock_lots, stock_movements,
--   inventory_settings, inventory_alerts        → inventory.adjust
--   supplier_contacts                           → suppliers.manage
--   cashbook_transactions (theo ca của mình)    → cashbook.view
--
-- Đã đối chiếu từng mã với bảng role_permissions: mọi policy chỉ **thêm đúng
-- `branch_manager`**, không vai trò nào khác lọt vào. (cashbook về danh nghĩa
-- thêm accountant/viewer, nhưng điều kiện `session_id IN (ca của chính mình)`
-- giữ nguyên nên không lộ gì.)
--
-- ⚠️ CỐ Ý KHÔNG ĐỘNG 3 policy: orders.orders_select_admin,
--    order_lines.order_lines_select_admin,
--    order_line_allocations.allocations_select_admin
--    Ba policy này KHÔNG giới hạn chi nhánh. `branch_manager` đã có policy riêng
--    `*_select_branch_mgr` chặn theo `branch_id = fn_my_branch_id()`. Nếu thêm
--    branch_manager vào đây (qua orders.view_all — vai trò này CÓ mã đó) thì chi
--    nhánh đọc được đơn hàng MỌI chi nhánh → đúng loại rò rỉ đã xảy ra 2026-08-02.
--    Chúng cũng không phải nguyên nhân kẹt: chi nhánh đã xem được đơn của mình.
--
--    HỆ QUẢ NGƯỢC ĐÁNG CHÚ Ý: hiện 3 TK chi nhánh đang được tick thêm vai trò
--    `warehouse_keeper` (cách chữa cháy 04:53 ngày 2026-08-02) nên ĐANG đọc được
--    đơn hàng toàn công ty qua chính 3 policy này. Gỡ vai trò thừa sau khi apply
--    migration này sẽ ĐÓNG lỗ đó lại.
--
-- ⚠️ `stock_lots` phải TÁCH `FOR ALL` thành 3 policy chỉ-ghi — xem giải thích tại
--    chỗ sửa. Bộ test cách ly chi nhánh bắt được lỗi này; đừng gộp ngược lại.
--
-- Thân policy sinh bằng script từ `pg_policies` của chính prod, chỉ thay đúng
-- biểu thức `fn_has_role('warehouse_keeper')`; mọi điều kiện phạm vi chi nhánh /
-- created_by / status giữ nguyên từng ký tự.
--
-- ⚠️ Apply remote qua Management API + tracking row.
-- ============================================================

BEGIN;

-- cashbook_transactions.cashbook_select_warehouse_keeper_session  [SELECT]  → cashbook.view
DROP POLICY IF EXISTS "cashbook_select_warehouse_keeper_session" ON public.cashbook_transactions;
CREATE POLICY "cashbook_select_warehouse_keeper_session" ON public.cashbook_transactions
  FOR SELECT
  USING ((fn_has_permission('cashbook.view'::text) AND fn_is_active() AND (session_id IN ( SELECT cashier_sessions.id
   FROM cashier_sessions
  WHERE (cashier_sessions.cashier_id = auth.uid())))));

-- goods_receipt_lines.receipt_lines_delete  [DELETE]  → inventory.receive
DROP POLICY IF EXISTS "receipt_lines_delete" ON public.goods_receipt_lines;
CREATE POLICY "receipt_lines_delete" ON public.goods_receipt_lines
  FOR DELETE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- goods_receipt_lines.receipt_lines_insert  [INSERT]  → inventory.receive
DROP POLICY IF EXISTS "receipt_lines_insert" ON public.goods_receipt_lines;
CREATE POLICY "receipt_lines_insert" ON public.goods_receipt_lines
  FOR INSERT
  WITH CHECK ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- goods_receipt_lines.receipt_lines_update  [UPDATE]  → inventory.receive
DROP POLICY IF EXISTS "receipt_lines_update" ON public.goods_receipt_lines;
CREATE POLICY "receipt_lines_update" ON public.goods_receipt_lines
  FOR UPDATE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- goods_receipts.receipts_delete_warehouse  [DELETE]  → inventory.receive
DROP POLICY IF EXISTS "receipts_delete_warehouse" ON public.goods_receipts;
CREATE POLICY "receipts_delete_warehouse" ON public.goods_receipts
  FOR DELETE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- goods_receipts.receipts_insert_warehouse  [INSERT]  → inventory.receive
DROP POLICY IF EXISTS "receipts_insert_warehouse" ON public.goods_receipts;
CREATE POLICY "receipts_insert_warehouse" ON public.goods_receipts
  FOR INSERT
  WITH CHECK ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- goods_receipts.receipts_update_warehouse  [UPDATE]  → inventory.receive
DROP POLICY IF EXISTS "receipts_update_warehouse" ON public.goods_receipts;
CREATE POLICY "receipts_update_warehouse" ON public.goods_receipts
  FOR UPDATE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- inventory_alerts.inv_alerts_manage_warehouse  [ALL]  → inventory.adjust
DROP POLICY IF EXISTS "inv_alerts_manage_warehouse" ON public.inventory_alerts;
CREATE POLICY "inv_alerts_manage_warehouse" ON public.inventory_alerts
  FOR ALL
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.adjust'::text))));

-- inventory_settings.inv_settings_manage_admin  [ALL]  → inventory.adjust
DROP POLICY IF EXISTS "inv_settings_manage_admin" ON public.inventory_settings;
CREATE POLICY "inv_settings_manage_admin" ON public.inventory_settings
  FOR ALL
  USING (((fn_is_admin() OR fn_has_permission('inventory.adjust'::text)) AND fn_is_active()));

-- purchase_orders.po_update_warehouse  [UPDATE]  → inventory.receive
DROP POLICY IF EXISTS "po_update_warehouse" ON public.purchase_orders;
CREATE POLICY "po_update_warehouse" ON public.purchase_orders
  FOR UPDATE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- purchase_return_lines.purchase_return_lines_manage  [ALL]  → inventory.receive
DROP POLICY IF EXISTS "purchase_return_lines_manage" ON public.purchase_return_lines;
CREATE POLICY "purchase_return_lines_manage" ON public.purchase_return_lines
  FOR ALL
  USING ((fn_is_active() AND (EXISTS ( SELECT 1
   FROM purchase_returns pr
  WHERE ((pr.id = purchase_return_lines.purchase_return_id) AND (pr.status = 'draft'::text) AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text)))))));

-- purchase_return_lines.purchase_return_lines_select  [SELECT]  → inventory.receive
DROP POLICY IF EXISTS "purchase_return_lines_select" ON public.purchase_return_lines;
CREATE POLICY "purchase_return_lines_select" ON public.purchase_return_lines
  FOR SELECT
  USING ((fn_is_active() AND (EXISTS ( SELECT 1
   FROM purchase_returns pr
  WHERE ((pr.id = purchase_return_lines.purchase_return_id) AND (fn_is_admin() OR fn_has_role('accountant'::text) OR fn_has_permission('inventory.receive'::text)))))));

-- purchase_returns.purchase_returns_delete  [DELETE]  → inventory.receive
DROP POLICY IF EXISTS "purchase_returns_delete" ON public.purchase_returns;
CREATE POLICY "purchase_returns_delete" ON public.purchase_returns
  FOR DELETE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- purchase_returns.purchase_returns_insert  [INSERT]  → inventory.receive
DROP POLICY IF EXISTS "purchase_returns_insert" ON public.purchase_returns;
CREATE POLICY "purchase_returns_insert" ON public.purchase_returns
  FOR INSERT
  WITH CHECK ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text)) AND (created_by = auth.uid()) AND (fn_is_admin() OR (EXISTS ( SELECT 1
   FROM warehouses w
  WHERE ((w.id = purchase_returns.warehouse_id) AND (w.branch_id = ( SELECT profiles.branch_id
           FROM profiles
          WHERE (profiles.id = auth.uid())))))))));

-- purchase_returns.purchase_returns_update  [UPDATE]  → inventory.receive
DROP POLICY IF EXISTS "purchase_returns_update" ON public.purchase_returns;
CREATE POLICY "purchase_returns_update" ON public.purchase_returns
  FOR UPDATE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))))
  WITH CHECK ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.receive'::text))));

-- stock_lots.stock_lots_manage_warehouse  [ALL]  → inventory.adjust
--
-- ⚠️ TÁCH THÀNH 3 POLICY CHỈ-GHI, KHÔNG giữ FOR ALL.
-- `FOR ALL` bao gồm cả SELECT. Bản gốc chốt `warehouse_keeper` nên khi chuyển
-- sang `inventory.adjust` (branch_manager CÓ mã này) thì chi nhánh đọc được lô
-- hàng — kèm GIÁ VỐN — của MỌI chi nhánh. Bộ test bắt được: 3 chi nhánh thay vì 1.
-- Bỏ nhánh SELECT đi thì quyền đọc rơi về `stock_lots_select_all` (20260529000013)
-- vốn đã chặn đúng theo `w.branch_id = fn_my_branch_id()`. Quyền GHI giữ y nguyên.
DROP POLICY IF EXISTS "stock_lots_manage_warehouse" ON public.stock_lots;

CREATE POLICY "stock_lots_insert_warehouse" ON public.stock_lots
  FOR INSERT
  WITH CHECK ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.adjust'::text))));

CREATE POLICY "stock_lots_update_warehouse" ON public.stock_lots
  FOR UPDATE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.adjust'::text))))
  WITH CHECK ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.adjust'::text))));

CREATE POLICY "stock_lots_delete_warehouse" ON public.stock_lots
  FOR DELETE
  USING ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.adjust'::text))));

-- stock_movements.stock_mov_insert_warehouse  [INSERT]  → inventory.adjust
DROP POLICY IF EXISTS "stock_mov_insert_warehouse" ON public.stock_movements;
CREATE POLICY "stock_mov_insert_warehouse" ON public.stock_movements
  FOR INSERT
  WITH CHECK ((fn_is_active() AND (fn_is_admin() OR fn_has_permission('inventory.adjust'::text)) AND (performed_by = auth.uid())));

-- supplier_contacts.supplier_contacts_manage_admin  [ALL]  → suppliers.manage
DROP POLICY IF EXISTS "supplier_contacts_manage_admin" ON public.supplier_contacts;
CREATE POLICY "supplier_contacts_manage_admin" ON public.supplier_contacts
  FOR ALL
  USING (((fn_is_admin() OR fn_has_permission('suppliers.manage'::text)) AND fn_is_active()));

-- ─────────────────────────────────────────────────────────────
-- KIỂM TRA NGAY TRONG MIGRATION: chỉ còn đúng 3 policy nhóm orders được phép
-- giữ chốt theo tên vai trò. Còn sót chỗ khác → dừng, rollback cả gói.
-- ─────────────────────────────────────────────────────────────
DO $mig$
DECLARE v_sot TEXT;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_sot
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (COALESCE(qual,'') || COALESCE(with_check,'')) LIKE '%warehouse_keeper%'
     AND (COALESCE(qual,'') || COALESCE(with_check,'')) NOT LIKE '%branch_manager%'
     AND tablename NOT IN ('orders', 'order_lines', 'order_line_allocations');
  IF v_sot IS NOT NULL THEN
    RAISE EXCEPTION 'Còn sót policy chốt theo vai trò: %', v_sot;
  END IF;
END $mig$;

COMMIT;

NOTIFY pgrst, 'reload schema';
