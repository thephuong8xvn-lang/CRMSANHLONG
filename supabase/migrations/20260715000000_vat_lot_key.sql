-- ============================================================
-- Migration: vat_lot_key
-- File: 20260715000000_vat_lot_key.sql
-- Mục đích: Đưa is_vat thành THUỘC TÍNH PHÂN BIỆT LÔ.
--   Trước đây stock_lots UNIQUE(product_id, lot_number, warehouse_id) →
--   khi cùng SP + số lô + kho được nhập 2 lần với trạng thái VAT khác nhau
--   (vd 10 đv có VAT, sau nhập thêm 5 đv trốn thuế cùng số lô), hàm hoàn
--   thành phiếu GỘP số lượng vào 1 dòng và GHI ĐÈ cờ is_vat → phân loại
--   thuế sai (tồn "có VAT" để xuất hóa đơn bị lệch).
--
--   Sửa: thêm is_vat vào khóa duy nhất → VAT và non-VAT của cùng một lô
--   vật lý nằm ở 2 dòng riêng. FEFO/xuất kho KHÔNG đổi (vẫn theo
--   product + warehouse + expiry). Mọi đường tạo/gộp lô được cập nhật để
--   GIỮ ĐÚNG is_vat / vat_rate:
--     1. stock_lots: đổi UNIQUE → (product_id, lot_number, warehouse_id, is_vat)
--     2. fn_complete_goods_receipt   — ON CONFLICT 4 cột, bỏ ghi đè is_vat
--     3. fn_receive_transfer         — chuyển kho copy is_vat/vat_rate lô nguồn
--     4. fn_sales_return_apply_effects — hồi kho hàng trả giữ is_vat/vat_rate lô gốc
--     5. fn_create_stock_lot_on_receipt — trigger cũ (không còn gắn), vá cho khớp
--
-- ⚠️ Đã verify trước khi viết: 0 cặp trùng trên khóa 3 cột hiện tại
--    (nới khóa duy nhất không vi phạm dữ liệu cũ); không có chỗ nào ở
--    frontend ghi trực tiếp stock_lots (đều qua RPC).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload
--    schema + chèn tracking row vào supabase_migrations.schema_migrations.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Khóa duy nhất: thêm is_vat → tách lô theo VAT
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.stock_lots
  DROP CONSTRAINT IF EXISTS stock_lots_product_id_lot_number_warehouse_id_key;

ALTER TABLE public.stock_lots
  ADD CONSTRAINT stock_lots_product_lot_wh_vat_key
  UNIQUE (product_id, lot_number, warehouse_id, is_vat);

-- ─────────────────────────────────────────────────────────────
-- 2. fn_complete_goods_receipt — ON CONFLICT 4 cột, bỏ ghi đè is_vat
--    (is_vat nay nằm trong khóa nên không còn bị gộp nhầm).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_complete_goods_receipt(p_receipt_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_receipt    RECORD;
  v_line       RECORD;
  v_lot_no     TEXT;
  v_lot_id     UUID;
  v_all_recv   BOOLEAN;
BEGIN
  -- Miễn trừ guard trg_guard_receipt_status (cho phép RPC đổi status sang
  -- 'completed'). Cờ phiên local=true → chỉ sống trong transaction này.
  -- (Bản 20260712 viết lại hàm cho VAT đã bỏ sót dòng này → hoàn thành phiếu lỗi.)
  PERFORM set_config('app.receipt_rpc', 'on', true);
  IF NOT public.fn_is_active() THEN RAISE EXCEPTION 'Tài khoản không hoạt động.'; END IF;

  SELECT * INTO v_receipt FROM public.goods_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu nhập.'; END IF;

  IF NOT (public.fn_is_admin() OR v_receipt.received_by = v_uid) THEN
    RAISE EXCEPTION 'Bạn không có quyền hoàn thành phiếu nhập này.';
  END IF;
  IF v_receipt.status <> 'verified' THEN
    RAISE EXCEPTION 'Phiếu phải ở trạng thái Đã duyệt mới hoàn thành được (hiện tại: %).', v_receipt.status;
  END IF;

  -- Tạo lô + ghi thẻ kho cho từng dòng
  FOR v_line IN SELECT * FROM public.goods_receipt_lines WHERE receipt_id = p_receipt_id LOOP
    v_lot_no := COALESCE(v_line.lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MISS'));

    INSERT INTO public.stock_lots (
      product_id, warehouse_id, supplier_id, receipt_id,
      lot_number, manufacture_date, expiry_date, cost_price, quantity_on_hand,
      is_vat, vat_rate
    ) VALUES (
      v_line.product_id, v_receipt.warehouse_id, v_receipt.supplier_id, p_receipt_id,
      v_lot_no, v_line.manufacture_date, v_line.expiry_date, v_line.unit_price, v_line.quantity,
      v_line.is_vat, v_line.vat_rate
    )
    -- Khóa nay gồm is_vat: VAT và non-VAT của cùng lô là 2 dòng riêng,
    -- chỉ gộp số lượng khi TRÙNG CẢ trạng thái VAT.
    ON CONFLICT (product_id, lot_number, warehouse_id, is_vat) DO UPDATE
      SET quantity_on_hand = stock_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
          vat_rate         = EXCLUDED.vat_rate,
          updated_at       = now()
    RETURNING id INTO v_lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type, quantity,
      reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_lot_id, v_line.product_id, v_receipt.warehouse_id, 'receipt', v_line.quantity,
      p_receipt_id, 'goods_receipt', v_line.unit_price, COALESCE(v_receipt.received_by, v_uid)
    );

    -- Đồng bộ giá vốn (giữ nguyên hành vi cũ của trigger)
    UPDATE public.price_list_items
      SET cost_price = v_line.unit_price
      WHERE product_id = v_line.product_id;

    -- Cập nhật số đã nhận của dòng PO (nếu phiếu gắn PO)
    IF v_line.po_line_id IS NOT NULL THEN
      UPDATE public.purchase_order_lines
        SET received_qty = received_qty + v_line.quantity
        WHERE id = v_line.po_line_id;
    END IF;
  END LOOP;

  -- Cập nhật trạng thái PO tổng (nếu có)
  IF v_receipt.po_id IS NOT NULL THEN
    SELECT bool_and(received_qty >= quantity) INTO v_all_recv
    FROM public.purchase_order_lines WHERE po_id = v_receipt.po_id;

    UPDATE public.purchase_orders
      SET status = CASE WHEN COALESCE(v_all_recv, false) THEN 'received' ELSE 'partially_received' END,
          updated_at = now()
      WHERE id = v_receipt.po_id;
  END IF;

  UPDATE public.goods_receipts
    SET status = 'completed', completed_by = v_uid, completed_at = now(), updated_at = now()
    WHERE id = p_receipt_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_complete_goods_receipt(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. fn_receive_transfer — chuyển kho GIỮ is_vat / vat_rate của lô nguồn.
--    (VAT là thuộc tính của hàng, không phụ thuộc vị trí kho.)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_receive_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    SELECT lot_number, manufacture_date, expiry_date, cost_price, status, is_vat, vat_rate
    INTO v_source_lot FROM public.stock_lots WHERE id = v_line.lot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng nguồn (id: %).', v_line.lot_id;
    END IF;

    -- Khớp lô đích theo CẢ is_vat → không trộn VAT vào non-VAT.
    SELECT id INTO v_target_lot_id
    FROM public.stock_lots
    WHERE product_id = v_line.product_id
      AND lot_number = v_source_lot.lot_number
      AND warehouse_id = v_transfer.to_warehouse
      AND is_vat = v_source_lot.is_vat
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
        manufacture_date, expiry_date, cost_price, quantity_on_hand, status,
        is_vat, vat_rate
      ) VALUES (
        v_line.product_id, v_transfer.to_warehouse, v_source_lot.lot_number,
        v_source_lot.manufacture_date, v_source_lot.expiry_date, COALESCE(v_line.unit_price, 0),
        v_line.quantity, v_source_lot.status,
        v_source_lot.is_vat, v_source_lot.vat_rate
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
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. fn_sales_return_apply_effects — hồi kho hàng trả GIỮ is_vat/vat_rate
--    của lô gốc (khi truy được). Nhánh fallback (không truy được lô gốc,
--    tạo lô RETURN-…) vẫn để mặc định non-VAT — hiếm, chấp nhận.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sales_return_apply_effects(p_return_id uuid, p_apply_debt boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sr            RECORD;
  v_order         RECORD;
  v_line          RECORD;
  v_orig_lot      RECORD;
  v_has_orig_lot  BOOLEAN;
  v_lot_id        UUID;
  v_target_wh     UUID;
  v_target_lot_id UUID;
  v_performer     UUID;
  v_remaining     NUMERIC(15,2);
  v_order_settled NUMERIC(15,2) := 0;
  v_offset_total  NUMERIC(15,2) := 0;
  v_paid_delta    NUMERIC(15,2);
  v_ordered_total NUMERIC(15,3);
  v_returned_total NUMERIC(15,3);
  r               RECORD;
BEGIN
  SELECT * INTO v_sr FROM public.sales_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND OR v_sr.status NOT IN ('approved','completed') THEN RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_sr.order_id FOR UPDATE;
  v_performer := COALESCE(v_sr.processed_by, v_sr.created_by);

  -- Cờ phiên: cho phép hàm này cập nhật sales_returns/orders qua guard.
  PERFORM set_config('app.return_rpc', 'on', true);
  PERFORM set_config('app.order_rpc',  'on', true);

  -- ── 3a. HỒI KHO (bỏ qua nếu phiếu đã có thẻ kho — idempotent) ──
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE reference_type = 'sales_return' AND reference_id = p_return_id
  ) THEN
    FOR v_line IN
      SELECT * FROM public.sales_return_lines WHERE return_id = p_return_id
    LOOP
      v_target_wh := COALESCE(v_line.return_to_warehouse_id, v_order.warehouse_id);

      -- Resolve lô gốc: lot_id của dòng → lô đã phân bổ cho order_line → NULL
      v_lot_id := v_line.lot_id;
      IF v_lot_id IS NULL THEN
        SELECT ola.lot_id INTO v_lot_id
        FROM public.order_line_allocations ola
        WHERE ola.order_line_id = v_line.order_line_id
        ORDER BY ola.quantity DESC LIMIT 1;
      END IF;

      v_has_orig_lot := false;
      IF v_lot_id IS NOT NULL THEN
        SELECT lot_number, manufacture_date, expiry_date, cost_price, status, warehouse_id, is_vat, vat_rate
        INTO v_orig_lot FROM public.stock_lots WHERE id = v_lot_id;
        v_has_orig_lot := FOUND;
      END IF;

      v_target_wh := COALESCE(v_target_wh,
        CASE WHEN v_has_orig_lot THEN v_orig_lot.warehouse_id END);
      IF v_target_wh IS NULL THEN
        RAISE EXCEPTION 'Phiếu trả %: không xác định được kho nhận hàng trả.', v_sr.return_code;
      END IF;

      IF v_has_orig_lot THEN
        -- Tìm/tạo lô cùng số lô + cùng trạng thái VAT tại kho nhận
        SELECT id INTO v_target_lot_id FROM public.stock_lots
        WHERE product_id = v_line.product_id
          AND lot_number = v_orig_lot.lot_number
          AND warehouse_id = v_target_wh
          AND is_vat = v_orig_lot.is_vat;

        IF v_target_lot_id IS NULL THEN
          INSERT INTO public.stock_lots (
            product_id, warehouse_id, lot_number, manufacture_date, expiry_date,
            cost_price, quantity_on_hand, status, notes, is_vat, vat_rate
          ) VALUES (
            v_line.product_id, v_target_wh, v_orig_lot.lot_number,
            v_orig_lot.manufacture_date, v_orig_lot.expiry_date,
            v_orig_lot.cost_price, 0, v_orig_lot.status,
            'Tạo khi nhận hàng trả ' || v_sr.return_code,
            v_orig_lot.is_vat, v_orig_lot.vat_rate
          ) RETURNING id INTO v_target_lot_id;
        END IF;
      ELSE
        -- Không truy được lô gốc: nhận vào lô active gần nhất của SP tại kho,
        -- nếu không có thì tạo lô RETURN-<mã phiếu> (mặc định non-VAT).
        SELECT id INTO v_target_lot_id FROM public.stock_lots
        WHERE product_id = v_line.product_id AND warehouse_id = v_target_wh
          AND status = 'active'
        ORDER BY received_at DESC LIMIT 1;

        IF v_target_lot_id IS NULL THEN
          INSERT INTO public.stock_lots (
            product_id, warehouse_id, lot_number, cost_price, quantity_on_hand, status, notes
          ) VALUES (
            v_line.product_id, v_target_wh, 'RETURN-' || v_sr.return_code,
            COALESCE((SELECT cost_price FROM public.stock_lots
                      WHERE product_id = v_line.product_id
                      ORDER BY received_at DESC LIMIT 1), 0),
            0, 'active', 'Tạo khi nhận hàng trả ' || v_sr.return_code || ' (không truy được lô gốc)'
          ) RETURNING id INTO v_target_lot_id;
        END IF;
      END IF;

      UPDATE public.stock_lots
      SET quantity_on_hand = quantity_on_hand + v_line.quantity, updated_at = now()
      WHERE id = v_target_lot_id;

      INSERT INTO public.stock_movements (
        lot_id, product_id, warehouse_id, movement_type, quantity,
        reference_id, reference_type, unit_cost, performed_by
      ) VALUES (
        v_target_lot_id, v_line.product_id, v_target_wh, 'return_from_customer',
        v_line.quantity, p_return_id, 'sales_return', v_line.unit_price, v_performer
      );
    END LOOP;
  END IF;

  -- ── 3b. TRỪ CÔNG NỢ (credit_note) — FIFO như fn_collect_customer_debt ──
  IF p_apply_debt
     AND v_sr.refund_method = 'credit_note'
     AND COALESCE(v_sr.total_amount, 0) > 0
     AND COALESCE(v_sr.debt_offset_total, 0) = 0 THEN   -- idempotent

    v_remaining := v_sr.total_amount;

    -- Ưu tiên nợ của chính đơn này, sau đó nợ mở khác của khách
    FOR r IN
      SELECT id, amount, (order_id = v_sr.order_id) AS is_this_order
      FROM public.customer_debts
      WHERE customer_id = v_order.customer_id
        AND is_settled = false AND amount > 0
      ORDER BY (order_id = v_sr.order_id) DESC, due_date NULLS LAST, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_remaining >= r.amount THEN
        UPDATE public.customer_debts
        SET is_settled = true, settled_at = now(),
            notes = COALESCE(notes,'') || ' | Cấn trừ trả hàng ' || v_sr.return_code
        WHERE id = r.id;
        v_offset_total := v_offset_total + r.amount;
        IF r.is_this_order THEN v_order_settled := v_order_settled + r.amount; END IF;
        v_remaining := v_remaining - r.amount;
      ELSE
        UPDATE public.customer_debts
        SET amount = amount - v_remaining,
            notes = COALESCE(notes,'') || ' | Cấn trừ một phần trả hàng ' || v_sr.return_code
        WHERE id = r.id;
        v_offset_total := v_offset_total + v_remaining;
        IF r.is_this_order THEN v_order_settled := v_order_settled + v_remaining; END IF;
        v_remaining := 0;
      END IF;
    END LOOP;

    -- Phần vượt tổng nợ mở → khách trả trước (amount âm)
    IF v_remaining > 0 THEN
      INSERT INTO public.customer_debts (
        customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by
      ) VALUES (
        v_order.customer_id, v_sr.order_id, 'advance_from_customer', -v_remaining, NULL, false,
        'Khách trả trước (trả hàng ' || v_sr.return_code || ' vượt công nợ)', v_performer
      );
      v_offset_total := v_offset_total + v_remaining;
    END IF;

    -- Đồng bộ trang đơn hàng: phần cấn vào nợ của CHÍNH đơn này
    v_paid_delta := LEAST(v_order_settled, GREATEST(v_order.grand_total - v_order.paid_amount, 0));
    IF v_paid_delta > 0 THEN
      UPDATE public.orders
      SET paid_amount = paid_amount + v_paid_delta,
          payment_status = CASE
            WHEN paid_amount + v_paid_delta >= grand_total THEN 'paid'::order_payment_status
            WHEN paid_amount + v_paid_delta > 0            THEN 'partially_paid'::order_payment_status
            ELSE 'unpaid'::order_payment_status
          END,
          updated_at = now()
      WHERE id = v_sr.order_id;
    END IF;

    UPDATE public.sales_returns
    SET debt_offset_total = v_offset_total,
        order_paid_delta  = COALESCE(v_paid_delta, 0)
    WHERE id = p_return_id;
  END IF;

  -- ── 3c. TRẠNG THÁI ĐƠN: returned_partial / returned_full ──
  SELECT COALESCE(SUM(quantity), 0) INTO v_ordered_total
  FROM public.order_lines WHERE order_id = v_sr.order_id;

  SELECT COALESCE(SUM(srl.quantity), 0) INTO v_returned_total
  FROM public.sales_return_lines srl
  JOIN public.sales_returns sr ON sr.id = srl.return_id
  WHERE sr.order_id = v_sr.order_id AND sr.status IN ('approved','completed');

  IF v_returned_total >= v_ordered_total AND v_ordered_total > 0 THEN
    UPDATE public.orders SET status = 'returned_full', updated_at = now()
    WHERE id = v_sr.order_id AND status <> 'returned_full';
  ELSIF v_returned_total > 0 THEN
    UPDATE public.orders SET status = 'returned_partial', updated_at = now()
    WHERE id = v_sr.order_id AND status NOT IN ('returned_partial','returned_full');
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. fn_create_stock_lot_on_receipt — trigger function CŨ (đã verify
--    KHÔNG còn gắn vào goods_receipt_lines). Vá ON CONFLICT 4 cột +
--    propagate is_vat/vat_rate để không thành "mìn ngầm" nếu bị gắn lại.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_create_stock_lot_on_receipt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt RECORD;
  v_lot_no  TEXT := COALESCE(NEW.lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MISS'));
BEGIN
  SELECT supplier_id, warehouse_id, received_by
  INTO v_receipt
  FROM public.goods_receipts
  WHERE id = NEW.receipt_id;

  INSERT INTO public.stock_lots (
    product_id, warehouse_id, supplier_id, receipt_id,
    lot_number, manufacture_date, expiry_date,
    cost_price, quantity_on_hand, is_vat, vat_rate
  )
  VALUES (
    NEW.product_id, v_receipt.warehouse_id, v_receipt.supplier_id, NEW.receipt_id,
    v_lot_no, NEW.manufacture_date, NEW.expiry_date,
    NEW.unit_price, NEW.quantity, NEW.is_vat, NEW.vat_rate
  )
  ON CONFLICT (product_id, lot_number, warehouse_id, is_vat) DO UPDATE
    SET quantity_on_hand = stock_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
        vat_rate         = EXCLUDED.vat_rate,
        updated_at       = now();

  INSERT INTO public.stock_movements (
    lot_id, product_id, warehouse_id,
    movement_type, quantity,
    reference_id, reference_type,
    unit_cost, performed_by
  )
  SELECT
    sl.id, NEW.product_id, v_receipt.warehouse_id,
    'receipt', NEW.quantity,
    NEW.receipt_id, 'goods_receipt',
    NEW.unit_price, v_receipt.received_by
  FROM public.stock_lots sl
  WHERE sl.product_id   = NEW.product_id
    AND sl.lot_number   = v_lot_no
    AND sl.warehouse_id = v_receipt.warehouse_id
    AND sl.is_vat       = NEW.is_vat;

  UPDATE public.price_list_items
  SET cost_price = NEW.unit_price
  WHERE product_id = NEW.product_id;

  RETURN NEW;
END;
$$;
