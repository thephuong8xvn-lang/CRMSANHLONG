-- ============================================================
-- Migration: transfer_permission_not_role
-- File: 20260748000000_transfer_permission_not_role.sql
--
-- TRIỆU CHỨNG (user báo 2026-08-02): tài khoản chi nhánh Hoài Ân KHÔNG chuyển
-- được hàng sang kho Mỹ Thành; đăng nhập admin thì chạy ngon.
--
-- BẰNG CHỨNG (log prod, không phải suy đoán):
--   edge_logs   04:53:32Z  400 POST /rest/v1/rpc/fn_create_transfer
--   postgres_logs 04:53:32Z  "Không có quyền tạo phiếu chuyển kho
--                             (cần warehouse_keeper hoặc admin)."
--   → 04:53:56 / 04:54:13 / 04:54:34 user gọi fn_set_user_roles 3 lần (tick lại
--     toàn bộ ô vai trò cho 3 TK chi nhánh) = CÁCH CHỮA CHÁY, không phải fix.
--   → 04:56:08 lập lại phiếu bằng TK admin: 200 OK.
--
-- NGUYÊN NHÂN GỐC: toàn bộ vòng đời chuyển kho chốt quyền bằng TÊN VAI TRÒ
-- `fn_has_role('warehouse_keeper')` (đặt từ 20260704, giữ nguyên ở 20260738),
-- trong khi migration 20260742 (2026-08-01) đã GỘP 3 tài khoản chi nhánh xuống
-- CHỈ CÒN vai trò `branch_manager`. Từ thời điểm đó:
--   • fn_create_transfer / fn_start_transfer / fn_receive_transfer /
--     fn_cancel_transfer đều RAISE 'Không có quyền ... (cần warehouse_keeper)'
--   • RLS GHI trên stock_transfers / stock_transfer_lines chặn nốt
-- Nhưng RLS ĐỌC (20260529000013) lại chấp nhận cả `branch_manager` → chi nhánh
-- NHÌN THẤY phiếu mà không thao tác được. Đúng dạng lỗi đã báo.
--
-- Nhập kho (goods_receipts) không dính vì từ 20260528000007 đã liệt kê thêm
-- `branch_manager`; riêng chuyển kho bị bỏ sót.
--
-- CÁCH VÁ: bỏ chốt-theo-vai-trò, chốt theo QUYỀN `inventory.transfer` — đúng thứ
-- ma trận phân quyền ở màn Cấu hình đang hiển thị, nên từ nay tick/bỏ tick trên
-- UI mới thật sự có hiệu lực. Cả `branch_manager` lẫn `warehouse_keeper` đều đã
-- được cấp mã quyền này từ 20260725 → không ai mất quyền, chỉ thêm đúng người.
--
-- KHÔNG đổi: bước DUYỆT cuối (fn_complete_transfer) và TỪ CHỐI
-- (fn_reject_transfer) vẫn CHỈ Admin/CEO — chốt kiểm soát nghiệp vụ của 20260738.
--
-- Thân 4 hàm dưới đây SAO NGUYÊN VĂN từ 20260738, chỉ thay đúng dòng chốt quyền
-- + câu thông báo lỗi (sinh bằng script để không sai sót khi chép tay).
--
-- ⚠️ Apply remote qua Management API + tracking row.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. CHẶN TRƯỚC: vai trò chi nhánh phải có sẵn mã quyền, không vá nửa vời
-- ─────────────────────────────────────────────────────────────
DO $mig$
DECLARE v_thieu TEXT;
BEGIN
  SELECT string_agg(r.code, ', ') INTO v_thieu
    FROM public.roles r
   WHERE r.code IN ('branch_manager', 'warehouse_keeper')
     AND NOT EXISTS (
       SELECT 1 FROM public.role_permissions rp
         JOIN public.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = r.id AND p.code = 'inventory.transfer'
     );
  IF v_thieu IS NOT NULL THEN
    RAISE EXCEPTION 'Vai trò % chưa có quyền inventory.transfer — cấp quyền trước rồi mới đổi chốt.', v_thieu;
  END IF;
END $mig$;

-- ─────────────────────────────────────────────────────────────
-- 1. RPC vòng đời: chốt theo QUYỀN thay vì tên vai trò
-- ─────────────────────────────────────────────────────────────
-- ── fn_create_transfer — sao nguyên văn 20260738, CHỈ đổi chốt quyền ──
CREATE OR REPLACE FUNCTION public.fn_create_transfer(
  p_from_warehouse UUID,
  p_to_warehouse   UUID,
  p_lines          JSONB,
  p_notes          TEXT DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL,
  p_price_list_id  UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_id        UUID;
  v_line      JSONB;
  v_lot       RECORD;
  v_qty       NUMERIC(15,3);
  v_price     NUMERIC(15,2);
  v_list      NUMERIC(15,2);
  v_total     NUMERIC(15,2) := 0;
  v_my_branch UUID;
  v_seen      UUID[] := ARRAY[]::UUID[];
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer')) THEN
    RAISE EXCEPTION 'Không có quyền tạo phiếu chuyển kho (cần quyền Kho hàng → Chuyển kho).';
  END IF;
  IF p_from_warehouse IS NULL OR p_to_warehouse IS NULL THEN
    RAISE EXCEPTION 'Thiếu kho nguồn hoặc kho đích.';
  END IF;
  IF p_from_warehouse = p_to_warehouse THEN
    RAISE EXCEPTION 'Kho nguồn và kho đích phải khác nhau.';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Phiếu chuyển kho phải có ít nhất một dòng sản phẩm.';
  END IF;

  -- Kho nguồn phải thuộc chi nhánh của người lập (admin miễn trừ)
  IF NOT public.fn_is_admin() THEN
    SELECT branch_id INTO v_my_branch FROM public.profiles WHERE id = v_uid;
    IF NOT EXISTS (
      SELECT 1 FROM public.warehouses w
       WHERE w.id = p_from_warehouse AND w.branch_id IS NOT DISTINCT FROM v_my_branch
    ) THEN
      RAISE EXCEPTION 'Bạn chỉ được lập phiếu chuyển từ kho thuộc chi nhánh của mình.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_to_warehouse AND is_active) THEN
    RAISE EXCEPTION 'Kho đích không tồn tại hoặc đã ngừng hoạt động.';
  END IF;

  INSERT INTO public.stock_transfers (
    from_warehouse, to_warehouse, status, notes, reason, price_list_id, created_by, total_amount
  ) VALUES (
    p_from_warehouse, p_to_warehouse, 'draft', p_notes, p_reason, p_price_list_id, v_uid, 0
  ) RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT id, product_id, warehouse_id, quantity_on_hand, quantity_reserved, cost_price, status
      INTO v_lot
      FROM public.stock_lots
     WHERE id = (v_line->>'lot_id')::UUID
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng (id: %).', v_line->>'lot_id';
    END IF;
    IF v_lot.warehouse_id <> p_from_warehouse THEN
      RAISE EXCEPTION 'Lô hàng không thuộc kho nguồn đã chọn.';
    END IF;
    IF v_lot.id = ANY(v_seen) THEN
      RAISE EXCEPTION 'Một lô hàng chỉ được đưa vào phiếu một lần (lô %).', v_lot.id;
    END IF;
    v_seen := v_seen || v_lot.id;

    v_qty   := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    v_price := GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, 0), 0);
    v_list  := GREATEST(COALESCE((v_line->>'list_unit_price')::NUMERIC, v_price), 0);

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Số lượng chuyển phải lớn hơn 0.';
    END IF;
    IF v_qty > (v_lot.quantity_on_hand - v_lot.quantity_reserved) THEN
      RAISE EXCEPTION 'Lô % không đủ tồn khả dụng. Yêu cầu: %, khả dụng: %.',
        v_lot.id, v_qty, (v_lot.quantity_on_hand - v_lot.quantity_reserved);
    END IF;

    INSERT INTO public.stock_transfer_lines (
      transfer_id, lot_id, product_id, quantity, unit_price, list_unit_price
    ) VALUES (
      v_id, v_lot.id, v_lot.product_id, v_qty, v_price, v_list
    );

    v_total := v_total + (v_qty * v_price);
  END LOOP;

  UPDATE public.stock_transfers SET total_amount = v_total, updated_at = now() WHERE id = v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_create_transfer(UUID, UUID, JSONB, TEXT, TEXT, UUID) TO authenticated;

-- ── fn_start_transfer — sao nguyên văn 20260738, CHỈ đổi chốt quyền ──
CREATE OR REPLACE FUNCTION public.fn_start_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer  RECORD;
  v_line      RECORD;
  v_lot       RECORD;
  v_uid       UUID := auth.uid();  -- actor thật, KHÔNG tin p_user_id
  v_total_cost NUMERIC(15,2) := 0;
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần quyền Kho hàng → Chuyển kho).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'Phiếu chuyển kho phải ở trạng thái Nháp để bắt đầu chuyển (hiện tại: %).', v_transfer.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id) THEN
    RAISE EXCEPTION 'Phiếu chưa có dòng sản phẩm nào.';
  END IF;

  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
    SELECT quantity_on_hand, quantity_reserved, cost_price
      INTO v_lot
      FROM public.stock_lots WHERE id = v_line.lot_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng (id: %).', v_line.lot_id;
    END IF;
    IF (v_lot.quantity_on_hand - v_lot.quantity_reserved) < v_line.quantity THEN
      RAISE EXCEPTION 'Lô hàng không đủ tồn khả dụng. Yêu cầu: %, Khả dụng: %.',
        v_line.quantity, (v_lot.quantity_on_hand - v_lot.quantity_reserved);
    END IF;

    -- CHỐT giá vốn thật tại thời điểm hàng rời kho. Con số này (không phải
    -- unit_price) sẽ trở thành giá vốn của lô ở kho đích khi admin duyệt.
    UPDATE public.stock_transfer_lines
       SET source_cost_price = v_lot.cost_price
     WHERE id = v_line.id;

    v_total_cost := v_total_cost + (v_line.quantity * COALESCE(v_lot.cost_price, 0));

    UPDATE public.stock_lots
    SET quantity_on_hand = quantity_on_hand - v_line.quantity, updated_at = now()
    WHERE id = v_line.lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
      'transfer_out', -v_line.quantity, p_transfer_id, 'transfer', v_lot.cost_price, v_uid
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'in_transit', shipped_at = now(), total_cost = v_total_cost, updated_at = now()
   WHERE id = p_transfer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_start_transfer(UUID, UUID) TO authenticated;

-- ── fn_receive_transfer — sao nguyên văn 20260738, CHỈ đổi chốt quyền ──
CREATE OR REPLACE FUNCTION public.fn_receive_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer RECORD;
  v_uid      UUID := auth.uid();
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần quyền Kho hàng → Chuyển kho).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Phiếu phải ở trạng thái Đang chuyển để xác nhận nhận hàng (hiện tại: %).', v_transfer.status;
  END IF;

  UPDATE public.stock_transfers
     SET status = 'received', received_by = v_uid, received_at = now(), updated_at = now()
   WHERE id = p_transfer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_receive_transfer(UUID, UUID) TO authenticated;

-- ── fn_cancel_transfer — sao nguyên văn 20260738, CHỈ đổi chốt quyền ──
CREATE OR REPLACE FUNCTION public.fn_cancel_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer RECORD;
  v_line     RECORD;
  v_uid      UUID := auth.uid();
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần quyền Kho hàng → Chuyển kho).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
    RAISE EXCEPTION 'Chỉ huỷ được phiếu Nháp hoặc Đang chuyển. Phiếu đã nhận phải do Admin duyệt hoặc từ chối (hiện tại: %).', v_transfer.status;
  END IF;

  IF v_transfer.status = 'in_transit' THEN
    FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
      UPDATE public.stock_lots
         SET quantity_on_hand = quantity_on_hand + v_line.quantity, updated_at = now()
       WHERE id = v_line.lot_id;

      INSERT INTO public.stock_movements (
        lot_id, product_id, warehouse_id, movement_type,
        quantity, reference_id, reference_type, unit_cost, performed_by, notes
      ) VALUES (
        v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
        'transfer_in', v_line.quantity, p_transfer_id, 'transfer',
        v_line.source_cost_price, v_uid, 'Hoàn kho do hủy chuyển'
      );
    END LOOP;
  END IF;

  UPDATE public.stock_transfers SET status = 'cancelled', updated_at = now() WHERE id = p_transfer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_cancel_transfer(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. RLS GHI: cùng chốt quyền. Giữ nguyên mọi điều kiện còn lại
--    (created_by, ràng buộc chi nhánh kho nguồn, chỉ sửa khi còn Nháp).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "stock_transfers_insert" ON public.stock_transfers;
CREATE POLICY "stock_transfers_insert" ON public.stock_transfers
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer'))
    AND created_by = auth.uid()
    AND (public.fn_is_admin() OR EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = from_warehouse
        AND w.branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    ))
  );

DROP POLICY IF EXISTS "stock_transfers_update" ON public.stock_transfers;
CREATE POLICY "stock_transfers_update" ON public.stock_transfers
  FOR UPDATE
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer'))
    AND status = 'draft'
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer'))
  );

DROP POLICY IF EXISTS "stock_transfers_delete" ON public.stock_transfers;
CREATE POLICY "stock_transfers_delete" ON public.stock_transfers
  FOR DELETE
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer'))
    AND status IN ('draft', 'cancelled')
  );

DROP POLICY IF EXISTS "transfer_lines_manage_draft" ON public.stock_transfer_lines;
CREATE POLICY "transfer_lines_manage_draft" ON public.stock_transfer_lines
  FOR ALL
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer'))
    AND EXISTS (
      SELECT 1 FROM public.stock_transfers t
       WHERE t.id = stock_transfer_lines.transfer_id AND t.status = 'draft'
    )
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('inventory.transfer'))
    AND EXISTS (
      SELECT 1 FROM public.stock_transfers t
       WHERE t.id = stock_transfer_lines.transfer_id AND t.status = 'draft'
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 3. RLS ĐỌC: đang liệt kê tay 2 vai trò → đưa về cùng chuẩn quyền
--    (`inventory.view`) để không lặp lại đúng lỗi bỏ sót vai trò lần sau.
--    Phạm vi chi nhánh giữ nguyên 100%.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "stock_transfers_select" ON public.stock_transfers;
CREATE POLICY "stock_transfers_select" ON public.stock_transfers
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR (
        public.fn_has_permission('inventory.view')
        AND EXISTS (
          SELECT 1 FROM public.warehouses w
          WHERE (w.id = stock_transfers.from_warehouse OR w.id = stock_transfers.to_warehouse)
            AND w.branch_id = public.fn_my_branch_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS "transfer_lines_select" ON public.stock_transfer_lines;
CREATE POLICY "transfer_lines_select" ON public.stock_transfer_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND (
      public.fn_is_admin()
      OR (
        public.fn_has_permission('inventory.view')
        AND EXISTS (
          SELECT 1 FROM public.stock_transfers st
          JOIN public.warehouses w ON (w.id = st.from_warehouse OR w.id = st.to_warehouse)
          WHERE st.id = stock_transfer_lines.transfer_id
            AND w.branch_id = public.fn_my_branch_id()
        )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
