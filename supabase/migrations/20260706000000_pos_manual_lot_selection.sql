-- ============================================================
-- 20260706000000_pos_manual_lot_selection.sql
-- CHO PHÉP NHÂN VIÊN CHỌN LÔ CỤ THỂ ĐỂ BÁN TẠI POS.
--   Lý do nghiệp vụ: một số khách không nhận lô cận hạn → NV cần bán đúng lô
--   khách chấp nhận (không thể ép FEFO).
--
--   Thay đổi:
--     1) order_lines + cột lot_id (nullable). NULL = FEFO tự động như cũ
--        (SP không quản lý lô / dòng quà-KM) → TƯƠNG THÍCH NGƯỢC hoàn toàn.
--     2) fn_pos_build_draft: ghi lot_id mỗi dòng + validate lô thuộc kho xuất &
--        active + CHẶN OVERSELL THEO TỪNG LÔ (dòng có lô so tồn của đúng lô đó).
--     3) fn_auto_stock_on_order_confirm: dòng có lot_id → trừ ĐÚNG lô đã chọn
--        (ghi order_line_allocations + stock_movements + giảm stock_lots), KHÔNG
--        FEFO. Dòng lot_id NULL → FEFO như cũ. Hủy đơn vẫn hồi kho đúng vì dựa
--        trên order_line_allocations (không đổi).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. CỘT LÔ ĐÃ CHỌN TRÊN DÒNG ĐƠN
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES public.stock_lots(id);

COMMENT ON COLUMN public.order_lines.lot_id IS
  'Lô cụ thể NV chọn bán (POS). NULL = FEFO tự động (SP không quản lý lô / quà KM).';

CREATE INDEX IF NOT EXISTS idx_order_lines_lot ON public.order_lines(lot_id);

-- ─────────────────────────────────────────────────────────────
-- 2. DỰNG ĐƠN NHÁP — ghi lot_id + chặn oversell THEO TỪNG LÔ
--    (giữ nguyên guard kho-theo-chi-nhánh của 20260703)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_build_draft(
  p_payload      JSONB,
  p_sale_channel TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_branch      UUID;
  v_order_id    UUID;
  v_subtotal    NUMERIC(15,2);
  v_line_disc   NUMERIC(15,2);
  v_inv_disc    NUMERIC(15,2) := COALESCE((p_payload->>'invoice_discount')::NUMERIC, 0);
  v_grand       NUMERIC(15,2);
  v_line        JSONB;
  v_n_lines     INT := 0;
  v_wh          UUID := NULLIF(p_payload->>'warehouse_id','')::UUID;
  v_short_msg   TEXT;
BEGIN
  IF NOT public.fn_is_active() OR NOT public.fn_has_permission('orders.create') THEN
    RAISE EXCEPTION 'Không có quyền tạo đơn hàng (orders.create).';
  END IF;

  IF (p_payload->>'customer_id') IS NULL THEN
    RAISE EXCEPTION 'Thiếu khách hàng.';
  END IF;

  SELECT branch_id INTO v_branch FROM public.profiles WHERE id = v_uid;

  -- Ràng buộc kho xuất thuộc chi nhánh người tạo & active (admin miễn trừ).
  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'Chưa chọn kho xuất hàng — không thể kiểm tra tồn kho.';
  END IF;

  IF NOT public.fn_is_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = v_wh AND w.branch_id = v_branch AND w.is_active
    ) THEN
      RAISE EXCEPTION 'Kho xuất không thuộc chi nhánh của bạn hoặc không hoạt động.';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.warehouses w WHERE w.id = v_wh AND w.is_active
    ) THEN
      RAISE EXCEPTION 'Kho xuất không hợp lệ hoặc không hoạt động.';
    END IF;
  END IF;

  INSERT INTO public.orders (
    customer_id, status, sale_channel, payment_status, payment_method,
    owner_user_id, confirmed_by, branch_id, warehouse_id, price_list_id,
    delivery_address, notes, disease_id, treatment_purpose
  ) VALUES (
    (p_payload->>'customer_id')::UUID,
    'draft', p_sale_channel, 'unpaid',
    COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash'),
    v_uid, NULL, v_branch,
    v_wh,
    NULLIF(p_payload->>'price_list_id','')::UUID,
    NULLIF(p_payload->>'delivery_address',''),
    NULLIF(p_payload->>'notes',''),
    NULLIF(p_payload->>'disease_id','')::UUID,
    NULLIF(p_payload->>'treatment_purpose','')
  )
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb))
  LOOP
    INSERT INTO public.order_lines (order_id, product_id, quantity, unit_price, discount, lot_id)
    VALUES (
      v_order_id,
      (v_line->>'product_id')::UUID,
      (v_line->>'quantity')::NUMERIC,
      (v_line->>'unit_price')::NUMERIC,
      COALESCE((v_line->>'discount')::NUMERIC, 0),
      NULLIF(v_line->>'lot_id','')::UUID
    );
    v_n_lines := v_n_lines + 1;
  END LOOP;

  IF v_n_lines = 0 THEN
    RAISE EXCEPTION 'Đơn hàng phải có ít nhất 1 dòng sản phẩm.';
  END IF;

  -- ─────────────────────────────────────────────────────────────
  -- VALIDATE LÔ ĐÃ CHỌN: mọi dòng có lot_id phải thuộc kho xuất & active.
  -- ─────────────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.order_lines ol
    WHERE ol.order_id = v_order_id AND ol.lot_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_lots sl
        WHERE sl.id = ol.lot_id AND sl.warehouse_id = v_wh AND sl.status = 'active'
      )
  ) THEN
    RAISE EXCEPTION 'Lô đã chọn không hợp lệ hoặc không thuộc kho xuất.';
  END IF;

  -- ─────────────────────────────────────────────────────────────
  -- CHẶN CỨNG TỒN KHO (POS) — độc lập stock_control_mode.
  --   (A) Dòng CÓ lô: so tồn khả dụng của ĐÚNG LÔ đó (gộp nếu trùng lô).
  --   (B) Dòng KHÔNG lô: so tồn TỔNG SP tại kho (FEFO) như cũ.
  -- ─────────────────────────────────────────────────────────────
  SELECT string_agg(t.msg, '; ' ORDER BY t.msg) INTO v_short_msg
  FROM (
    -- (A) theo lô
    SELECT format('%s / Lô %s (cần %s, còn %s)',
                  p.name, sl.lot_number,
                  trim_scale(SUM(ol.quantity)),
                  trim_scale(GREATEST(sl.quantity_on_hand - sl.quantity_reserved, 0))) AS msg
    FROM public.order_lines ol
    JOIN public.products   p  ON p.id  = ol.product_id
    JOIN public.stock_lots sl ON sl.id = ol.lot_id
    WHERE ol.order_id = v_order_id AND ol.lot_id IS NOT NULL
    GROUP BY p.name, sl.lot_number, sl.quantity_on_hand, sl.quantity_reserved
    HAVING SUM(ol.quantity) > (sl.quantity_on_hand - sl.quantity_reserved)

    UNION ALL

    -- (B) theo SP (không lô)
    SELECT format('%s (cần %s, còn %s)',
                  p.name, trim_scale(SUM(ol.quantity)), trim_scale(COALESCE(s.avail, 0)))
    FROM public.order_lines ol
    JOIN public.products p ON p.id = ol.product_id
    LEFT JOIN (
      SELECT product_id, SUM(quantity_on_hand - quantity_reserved) AS avail
      FROM public.stock_lots
      WHERE warehouse_id = v_wh AND status = 'active'
      GROUP BY product_id
    ) s ON s.product_id = ol.product_id
    WHERE ol.order_id = v_order_id AND ol.lot_id IS NULL
    GROUP BY p.name, s.avail
    HAVING SUM(ol.quantity) > COALESCE(s.avail, 0)
  ) t;

  IF v_short_msg IS NOT NULL THEN
    RAISE EXCEPTION 'Không đủ tồn kho: %', v_short_msg;
  END IF;

  -- Ghi đè TỔNG có thẩm quyền (cộng chiết khấu cấp hoá đơn).
  SELECT COALESCE(SUM(unit_price * quantity), 0),
         COALESCE(SUM(discount   * quantity), 0)
    INTO v_subtotal, v_line_disc
  FROM public.order_lines WHERE order_id = v_order_id;

  v_grand := v_subtotal - v_line_disc - v_inv_disc;
  IF v_grand < 0 THEN
    RAISE EXCEPTION 'Chiết khấu vượt quá giá trị đơn hàng.';
  END IF;

  UPDATE public.orders
  SET subtotal       = v_subtotal,
      discount_total = v_line_disc + v_inv_disc,
      grand_total    = v_grand,
      updated_at     = now()
  WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_pos_build_draft(JSONB, TEXT) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────
-- 3. TRỪ KHO KHI XÁC NHẬN — dòng có lot_id trừ ĐÚNG lô đã chọn.
--    (dòng lot_id NULL → FEFO như cũ; logic soft/hard giữ nguyên)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_stock_on_order_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line        RECORD;
  v_alloc       RECORD;
  v_warehouse   UUID;
  v_mode        TEXT;
  v_channel     TEXT;
  v_available   NUMERIC(15,3);
  v_allocatable NUMERIC(15,3);
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;

  v_warehouse := NEW.warehouse_id;
  v_mode      := public.fn_stock_control_mode();
  v_channel   := NEW.sale_channel;

  FOR v_line IN
    SELECT ol.id AS line_id, ol.product_id, ol.quantity, ol.lot_id
    FROM   public.order_lines ol
    WHERE  ol.order_id = NEW.id
  LOOP
    -- (a) Thiếu kho xuất hàng
    IF v_warehouse IS NULL THEN
      IF v_mode = 'hard' THEN
        RAISE EXCEPTION 'Đơn thiếu kho xuất hàng — không thể trừ kho. Hãy chọn kho.';
      END IF;
      INSERT INTO public.stock_oversell_log
        (order_id, order_line_id, product_id, warehouse_id, requested, available, shortfall, sale_channel, created_by)
      VALUES
        (NEW.id, v_line.line_id, v_line.product_id, NULL, v_line.quantity, 0, v_line.quantity, v_channel, COALESCE(NEW.confirmed_by, auth.uid()));
      CONTINUE;
    END IF;

    -- ── (b1) DÒNG CÓ LÔ CHỌN SẴN → trừ ĐÚNG lô đó (không FEFO) ──
    IF v_line.lot_id IS NOT NULL THEN
      SELECT (quantity_on_hand - quantity_reserved) INTO v_available
      FROM public.stock_lots WHERE id = v_line.lot_id FOR UPDATE;

      IF v_available IS NULL THEN
        IF v_mode = 'hard' THEN
          RAISE EXCEPTION 'Lô bán không tồn tại (SP %).', v_line.product_id;
        END IF;
        INSERT INTO public.stock_oversell_log
          (order_id, order_line_id, product_id, warehouse_id, requested, available, shortfall, sale_channel, created_by)
        VALUES
          (NEW.id, v_line.line_id, v_line.product_id, v_warehouse, v_line.quantity, 0, v_line.quantity, v_channel, COALESCE(NEW.confirmed_by, auth.uid()));
        CONTINUE;
      END IF;

      IF v_available < v_line.quantity THEN
        IF v_mode = 'hard' THEN
          RAISE EXCEPTION 'Lô bán không đủ tồn cho SP %: cần %, còn %.',
            v_line.product_id, v_line.quantity, v_available;
        END IF;
        INSERT INTO public.stock_oversell_log
          (order_id, order_line_id, product_id, warehouse_id, requested, available, shortfall, sale_channel, created_by)
        VALUES
          (NEW.id, v_line.line_id, v_line.product_id, v_warehouse, v_line.quantity, v_available,
           v_line.quantity - v_available, v_channel, COALESCE(NEW.confirmed_by, auth.uid()));
        v_allocatable := GREATEST(v_available, 0);
      ELSE
        v_allocatable := v_line.quantity;
      END IF;

      IF v_allocatable > 0 THEN
        INSERT INTO public.order_line_allocations (order_line_id, lot_id, quantity)
        VALUES (v_line.line_id, v_line.lot_id, v_allocatable);

        INSERT INTO public.stock_movements
          (lot_id, product_id, warehouse_id, movement_type, quantity,
           reference_id, reference_type, performed_by)
        VALUES
          (v_line.lot_id, v_line.product_id, v_warehouse, 'sale', -v_allocatable,
           NEW.id, 'order', COALESCE(NEW.confirmed_by, auth.uid()));

        UPDATE public.stock_lots
        SET quantity_on_hand = quantity_on_hand - v_allocatable,
            updated_at       = now()
        WHERE id = v_line.lot_id;
      END IF;

      CONTINUE;  -- xong dòng có lô
    END IF;

    -- ── (b2) DÒNG KHÔNG LÔ → FEFO như cũ ──
    SELECT COALESCE(SUM(quantity_on_hand - quantity_reserved), 0)
      INTO v_available
    FROM public.stock_lots
    WHERE product_id   = v_line.product_id
      AND warehouse_id = v_warehouse
      AND status       = 'active';

    IF v_available < v_line.quantity THEN
      IF v_mode = 'hard' THEN
        RAISE EXCEPTION 'Không đủ tồn kho cho sản phẩm %: cần %, còn %.',
          v_line.product_id, v_line.quantity, v_available;
      END IF;
      INSERT INTO public.stock_oversell_log
        (order_id, order_line_id, product_id, warehouse_id, requested, available, shortfall, sale_channel, created_by)
      VALUES
        (NEW.id, v_line.line_id, v_line.product_id, v_warehouse, v_line.quantity, v_available,
         v_line.quantity - v_available, v_channel, COALESCE(NEW.confirmed_by, auth.uid()));
      v_allocatable := GREATEST(v_available, 0);
    ELSE
      v_allocatable := v_line.quantity;
    END IF;

    IF v_allocatable > 0 THEN
      FOR v_alloc IN
        SELECT * FROM public.fn_allocate_lots_fefo(v_line.product_id, v_warehouse, v_allocatable)
      LOOP
        INSERT INTO public.order_line_allocations (order_line_id, lot_id, quantity)
        VALUES (v_line.line_id, v_alloc.lot_id, v_alloc.allocated_qty);

        INSERT INTO public.stock_movements
          (lot_id, product_id, warehouse_id, movement_type, quantity,
           reference_id, reference_type, performed_by)
        VALUES
          (v_alloc.lot_id, v_line.product_id, v_warehouse, 'sale', -v_alloc.allocated_qty,
           NEW.id, 'order', COALESCE(NEW.confirmed_by, auth.uid()));

        UPDATE public.stock_lots
        SET quantity_on_hand  = quantity_on_hand - v_alloc.allocated_qty,
            quantity_reserved = quantity_reserved - v_alloc.allocated_qty,
            updated_at        = now()
        WHERE id = v_alloc.lot_id;
      END LOOP;
    END IF;
  END LOOP;

  NEW.confirmed_at := now();

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by)
  VALUES (NEW.id, OLD.status, NEW.status, COALESCE(NEW.confirmed_by, auth.uid()));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_auto_stock ON public.orders;
CREATE TRIGGER trg_orders_auto_stock
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stock_on_order_confirm();

NOTIFY pgrst, 'reload schema';
