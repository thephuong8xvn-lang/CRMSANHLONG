-- ============================================================
-- 20260704000000_harden_inventory_transfers_returns.sql
-- Gia cố bảo mật/toàn vẹn Kho sau rà soát toàn diện:
--   #1 RPC chuyển kho: thêm kiểm quyền (warehouse_keeper/admin) + ghi nhận
--      actor bằng auth.uid() thay vì p_user_id client gửi (chống giả mạo +
--      chống mọi user authenticated thao túng tồn kho). GIỮ nguyên signature
--      (p_user_id) cho tương thích frontend — nhưng BỎ QUA giá trị đó.
--   #2 Trả NCC: trigger trừ kho MỘT LẦN (rời draft) + HOÀN kho khi hủy phiếu
--      đã xuất + guard chuyển trạng thái hợp lệ.
--   #4 RLS: WITH CHECK created_by = auth.uid() + ràng buộc chi nhánh cho
--      stock_transfers & purchase_returns (admin miễn trừ).
-- Giữ nguyên logic giá vốn bình quân (20260530) + numeric (decimal qty).
-- ⚠️ Apply remote qua Management API + reload schema.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- #1a. fn_start_transfer — guard quyền + actor = auth.uid()
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_start_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer  RECORD;
  v_line      RECORD;
  v_available NUMERIC(15, 3);
  v_uid       UUID := auth.uid();  -- actor thật, KHÔNG tin p_user_id
BEGIN
  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần warehouse_keeper hoặc admin).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'Phiếu chuyển kho phải ở trạng thái Nháp để bắt đầu chuyển.';
  END IF;

  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
    SELECT (quantity_on_hand - quantity_reserved) INTO v_available
    FROM public.stock_lots WHERE id = v_line.lot_id FOR UPDATE;
    IF v_available IS NULL THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng (id: %).', v_line.lot_id;
    END IF;
    IF v_available < v_line.quantity THEN
      RAISE EXCEPTION 'Lô hàng không đủ tồn khả dụng. Yêu cầu: %, Khả dụng: %.', v_line.quantity, v_available;
    END IF;

    UPDATE public.stock_lots
    SET quantity_on_hand = quantity_on_hand - v_line.quantity, updated_at = now()
    WHERE id = v_line.lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, performed_by
    ) VALUES (
      v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
      'transfer_out', -v_line.quantity, p_transfer_id, 'transfer', v_uid
    );
  END LOOP;

  UPDATE public.stock_transfers SET status = 'in_transit', updated_at = now() WHERE id = p_transfer_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- #1b. fn_receive_transfer — guard quyền + actor = auth.uid()
--      (giữ logic giá vốn bình quân gia quyền)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_receive_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer      RECORD;
  v_line          RECORD;
  v_source_lot    RECORD;
  v_target_lot_id UUID;
  v_uid           UUID := auth.uid();
BEGIN
  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần warehouse_keeper hoặc admin).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Phiếu chuyển kho phải ở trạng thái Đang chuyển để xác nhận nhận hàng.';
  END IF;

  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
    SELECT lot_number, manufacture_date, expiry_date, cost_price, status
    INTO v_source_lot FROM public.stock_lots WHERE id = v_line.lot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng nguồn (id: %).', v_line.lot_id;
    END IF;

    SELECT id INTO v_target_lot_id
    FROM public.stock_lots
    WHERE product_id = v_line.product_id
      AND lot_number = v_source_lot.lot_number
      AND warehouse_id = v_transfer.to_warehouse
    FOR UPDATE;

    IF v_target_lot_id IS NOT NULL THEN
      UPDATE public.stock_lots
      SET cost_price = CASE
            WHEN (quantity_on_hand + v_line.quantity) > 0 THEN
              ROUND(((quantity_on_hand * cost_price) + (v_line.quantity * COALESCE(v_line.unit_price, 0))) / (quantity_on_hand + v_line.quantity), 2)
            ELSE COALESCE(v_line.unit_price, 0)
          END,
          quantity_on_hand = quantity_on_hand + v_line.quantity,
          updated_at = now()
      WHERE id = v_target_lot_id;
    ELSE
      INSERT INTO public.stock_lots (
        product_id, warehouse_id, lot_number,
        manufacture_date, expiry_date, cost_price, quantity_on_hand, status
      ) VALUES (
        v_line.product_id, v_transfer.to_warehouse, v_source_lot.lot_number,
        v_source_lot.manufacture_date, v_source_lot.expiry_date, COALESCE(v_line.unit_price, 0),
        v_line.quantity, v_source_lot.status
      ) RETURNING id INTO v_target_lot_id;
    END IF;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_target_lot_id, v_line.product_id, v_transfer.to_warehouse,
      'transfer_in', v_line.quantity, p_transfer_id, 'transfer', COALESCE(v_line.unit_price, 0), v_uid
    );
  END LOOP;

  UPDATE public.stock_transfers SET status = 'received', received_by = v_uid, updated_at = now() WHERE id = p_transfer_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- #1c. fn_cancel_transfer — guard quyền + actor = auth.uid()
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancel_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer RECORD;
  v_line     RECORD;
  v_uid      UUID := auth.uid();
BEGIN
  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần warehouse_keeper hoặc admin).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
    RAISE EXCEPTION 'Chỉ có thể hủy phiếu ở trạng thái Nháp hoặc Đang chuyển.';
  END IF;

  IF v_transfer.status = 'in_transit' THEN
    FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
      UPDATE public.stock_lots
      SET quantity_on_hand = quantity_on_hand + v_line.quantity, updated_at = now()
      WHERE id = v_line.lot_id;

      INSERT INTO public.stock_movements (
        lot_id, product_id, warehouse_id, movement_type,
        quantity, reference_id, reference_type, performed_by, notes
      ) VALUES (
        v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
        'transfer_in', v_line.quantity, p_transfer_id, 'transfer', v_uid, 'Hoàn kho do hủy chuyển'
      );
    END LOOP;
  END IF;

  UPDATE public.stock_transfers SET status = 'cancelled', updated_at = now() WHERE id = p_transfer_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- #2. Trả NCC — trừ kho MỘT LẦN + hoàn kho khi hủy + guard transition
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_stock_on_purchase_return_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line      RECORD;
  v_available NUMERIC;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Guard: chỉ cho phép các bước chuyển trạng thái hợp lệ.
  IF NOT (
    (OLD.status = 'draft'     AND NEW.status IN ('confirmed','completed','cancelled')) OR
    (OLD.status = 'confirmed' AND NEW.status IN ('completed','cancelled')) OR
    (OLD.status = 'completed' AND NEW.status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Chuyển trạng thái phiếu trả NCC không hợp lệ: % → %.', OLD.status, NEW.status;
  END IF;

  -- TRỪ kho MỘT LẦN duy nhất khi rời 'draft' sang confirmed/completed.
  IF OLD.status = 'draft' AND NEW.status IN ('confirmed','completed') THEN
    FOR v_line IN SELECT * FROM public.purchase_return_lines WHERE purchase_return_id = NEW.id LOOP
      SELECT (quantity_on_hand - quantity_reserved) INTO v_available
      FROM public.stock_lots WHERE id = v_line.lot_id FOR UPDATE;
      IF v_available IS NULL OR v_available < v_line.quantity THEN
        RAISE EXCEPTION 'Không đủ tồn khả dụng trong lô để trả NCC. Cần: %, còn: %.', v_line.quantity, COALESCE(v_available, 0);
      END IF;

      UPDATE public.stock_lots
      SET quantity_on_hand = quantity_on_hand - v_line.quantity, updated_at = now()
      WHERE id = v_line.lot_id;

      INSERT INTO public.stock_movements (
        lot_id, product_id, warehouse_id, movement_type, quantity, reference_id, reference_type, unit_cost, performed_by
      ) VALUES (
        v_line.lot_id, v_line.product_id, NEW.warehouse_id,
        'return_to_supplier', -v_line.quantity, NEW.id, 'purchase_return', v_line.unit_price, NEW.created_by
      );
    END LOOP;

  -- HOÀN kho khi hủy phiếu ĐÃ xuất kho (confirmed/completed → cancelled).
  ELSIF OLD.status IN ('confirmed','completed') AND NEW.status = 'cancelled' THEN
    FOR v_line IN SELECT * FROM public.purchase_return_lines WHERE purchase_return_id = NEW.id LOOP
      UPDATE public.stock_lots
      SET quantity_on_hand = quantity_on_hand + v_line.quantity, updated_at = now()
      WHERE id = v_line.lot_id;

      INSERT INTO public.stock_movements (
        lot_id, product_id, warehouse_id, movement_type, quantity, reference_id, reference_type, unit_cost, performed_by, notes
      ) VALUES (
        v_line.lot_id, v_line.product_id, NEW.warehouse_id,
        'return_to_supplier', v_line.quantity, NEW.id, 'purchase_return', v_line.unit_price, NEW.created_by, 'Hoàn kho do hủy phiếu trả NCC'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- #4. RLS WITH CHECK: created_by = auth.uid() + ràng buộc chi nhánh
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "stock_transfers_manage" ON public.stock_transfers;

CREATE POLICY "stock_transfers_insert" ON public.stock_transfers
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND created_by = auth.uid()
    AND (public.fn_is_admin() OR EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = from_warehouse
        AND w.branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    ))
  );

CREATE POLICY "stock_transfers_update" ON public.stock_transfers
  FOR UPDATE
  USING (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')))
  WITH CHECK (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')));

CREATE POLICY "stock_transfers_delete" ON public.stock_transfers
  FOR DELETE
  USING (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')));

DROP POLICY IF EXISTS "purchase_returns_manage" ON public.purchase_returns;

CREATE POLICY "purchase_returns_insert" ON public.purchase_returns
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND created_by = auth.uid()
    AND (public.fn_is_admin() OR EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = warehouse_id
        AND w.branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    ))
  );

CREATE POLICY "purchase_returns_update" ON public.purchase_returns
  FOR UPDATE
  USING (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')))
  WITH CHECK (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')));

CREATE POLICY "purchase_returns_delete" ON public.purchase_returns
  FOR DELETE
  USING (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')));

NOTIFY pgrst, 'reload schema';
