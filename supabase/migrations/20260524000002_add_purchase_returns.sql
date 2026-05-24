-- ============================================================
-- CRM SANHLONGVETCO – PURCHASE RETURNS & STOCK LOGICS
-- File: 20260524000002_add_purchase_returns.sql
-- Mô tả: Thêm bảng purchase_returns, triggers xử lý tự động tồn kho
-- ============================================================

-- 1. BẢNG PHIẾU TRẢ HÀNG NCC (PURCHASE RETURNS)
CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_code     TEXT          UNIQUE,
  supplier_id     UUID          NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  warehouse_id    UUID          NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  source_goods_receipt_id UUID  REFERENCES public.goods_receipts(id) ON DELETE SET NULL,
  status          TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','completed','cancelled')),
  reason_code     TEXT          NOT NULL CHECK (reason_code IN ('damage','wrong_product','near_expiry','quality_fail','recall','other')),
  reason_detail   TEXT,
  refund_method   TEXT          NOT NULL CHECK (refund_method IN ('cash_refund','credit_note','next_po_offset')),
  total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by      UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by     UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 2. BẢNG CHI TIẾT PHIẾU TRẢ HÀNG NCC (PURCHASE RETURN LINES)
CREATE TABLE IF NOT EXISTS public.purchase_return_lines (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_return_id  UUID          NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  lot_id              UUID          NOT NULL REFERENCES public.stock_lots(id) ON DELETE RESTRICT,
  product_id          UUID          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity            INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price          NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 3. GẮN TRIGGER CẬP NHẬT UPDATED_AT
CREATE TRIGGER trg_purchase_returns_updated_at
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 4. ĐĂNG KÝ TIỀN TỐ TRONG CODE_SEQUENCES
INSERT INTO public.code_sequences (code_type, prefix, year_part, current_no) VALUES
  ('purchase_return', 'PR', EXTRACT(YEAR FROM now())::INTEGER, 0)
ON CONFLICT (code_type) DO NOTHING;

-- 5. TRIGGER TỰ SINH MÃ PHIẾU
CREATE OR REPLACE FUNCTION public.fn_auto_purchase_return_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.return_code IS NULL OR NEW.return_code = '' THEN
    NEW.return_code := public.fn_generate_code('purchase_return', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_purchase_returns_code
  BEFORE INSERT ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_purchase_return_code();

-- 6. TRIGGER TỰ ĐỘNG XUẤT KHO KHI PHIẾU TRẢ NCC ĐƯỢC XÁC NHẬN
CREATE OR REPLACE FUNCTION public.fn_auto_stock_on_purchase_return_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line RECORD;
  v_available INTEGER;
BEGIN
  -- Chỉ kích hoạt khi chuyển sang confirmed hoặc completed
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('confirmed', 'completed') THEN RETURN NEW; END IF;

  FOR v_line IN
    SELECT prl.*
    FROM public.purchase_return_lines prl
    WHERE prl.purchase_return_id = NEW.id
  LOOP
    -- Kiểm tra tồn khả dụng của lô hàng
    SELECT (quantity_on_hand - quantity_reserved) INTO v_available
    FROM public.stock_lots
    WHERE id = v_line.lot_id;

    IF v_available IS NULL OR v_available < v_line.quantity THEN
      RAISE EXCEPTION 'Không đủ hàng tồn khả dụng trong lô hàng để trả nhà cung cấp. Yêu cầu: %, Khả dụng: %', v_line.quantity, COALESCE(v_available, 0);
    END IF;

    -- Trừ số lượng tồn thực tế của lô hàng
    UPDATE public.stock_lots
    SET quantity_on_hand = quantity_on_hand - v_line.quantity,
        updated_at = now()
    WHERE id = v_line.lot_id;

    -- Ghi nhận phiếu xuất kho
    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type, quantity, reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_line.lot_id,
      v_line.product_id,
      NEW.warehouse_id,
      'return_to_supplier',
      -v_line.quantity,
      NEW.id,
      'purchase_return',
      v_line.unit_price,
      NEW.created_by
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_purchase_returns_auto_stock
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stock_on_purchase_return_confirm();

-- 7. TRIGGER TỰ ĐỘNG NHẬP KHO VÀ UPDATE STATUS KHI KHÁCH TRẢ HÀNG
CREATE OR REPLACE FUNCTION public.fn_auto_stock_on_sales_return_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line RECORD;
  v_orig_lot RECORD;
  v_target_lot_id UUID;
  v_ordered_qty_total INTEGER;
  v_returned_qty_total INTEGER;
BEGIN
  -- Chỉ kích hoạt khi chuyển sang approved, completed hoặc received
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved', 'completed', 'received') THEN RETURN NEW; END IF;

  FOR v_line IN
    SELECT srl.*, o.warehouse_id AS target_warehouse_id, sr.created_by AS user_id
    FROM public.sales_return_lines srl
    JOIN public.sales_returns sr ON sr.id = srl.return_id
    JOIN public.orders o ON o.id = sr.order_id
    WHERE srl.return_id = NEW.id
  LOOP
    IF v_line.lot_id IS NOT NULL THEN
      -- Lấy thông tin lô hàng gốc
      SELECT lot_number, manufacture_date, expiry_date, cost_price, status
      INTO v_orig_lot
      FROM public.stock_lots
      WHERE id = v_line.lot_id;

      IF FOUND THEN
        -- Tìm hoặc tạo lô hàng tại kho nhận lại
        SELECT id INTO v_target_lot_id
        FROM public.stock_lots
        WHERE product_id = v_line.product_id
          AND lot_number = v_orig_lot.lot_number
          AND warehouse_id = COALESCE(v_line.return_to_warehouse_id, v_line.target_warehouse_id);

        IF v_target_lot_id IS NOT NULL THEN
          UPDATE public.stock_lots
          SET quantity_on_hand = quantity_on_hand + v_line.quantity,
              updated_at = now()
          WHERE id = v_target_lot_id;
        ELSE
          INSERT INTO public.stock_lots (
            product_id, warehouse_id, lot_number, manufacture_date, expiry_date, cost_price, quantity_on_hand, status
          ) VALUES (
            v_line.product_id,
            COALESCE(v_line.return_to_warehouse_id, v_line.target_warehouse_id),
            v_orig_lot.lot_number,
            v_orig_lot.manufacture_date,
            v_orig_lot.expiry_date,
            v_orig_lot.cost_price,
            v_line.quantity,
            v_orig_lot.status
          ) RETURNING id INTO v_target_lot_id;
        END IF;

        -- Ghi phiếu nhập kho nhận hàng trả
        INSERT INTO public.stock_movements (
          lot_id, product_id, warehouse_id, movement_type, quantity, reference_id, reference_type, unit_cost, performed_by
        ) VALUES (
          v_target_lot_id,
          v_line.product_id,
          COALESCE(v_line.return_to_warehouse_id, v_line.target_warehouse_id),
          'return_from_customer',
          v_line.quantity,
          NEW.id,
          'sales_return',
          v_line.unit_price,
          NEW.created_by
        );
      END IF;
    END IF;
  END LOOP;

  -- Tính toán tổng số lượng đặt vs tổng trả để tự cập nhật trạng thái đơn hàng
  SELECT COALESCE(SUM(quantity), 0) INTO v_ordered_qty_total 
  FROM public.order_lines 
  WHERE order_id = NEW.order_id;

  SELECT COALESCE(SUM(srl.quantity), 0) INTO v_returned_qty_total
  FROM public.sales_return_lines srl
  JOIN public.sales_returns sr ON sr.id = srl.return_id
  WHERE sr.order_id = NEW.order_id AND sr.status IN ('approved', 'completed', 'received');

  IF v_returned_qty_total >= v_ordered_qty_total THEN
    UPDATE public.orders SET status = 'returned_full' WHERE id = NEW.order_id;
  ELSIF v_returned_qty_total > 0 THEN
    UPDATE public.orders SET status = 'returned_partial' WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_returns_auto_stock ON public.sales_returns;
CREATE TRIGGER trg_sales_returns_auto_stock
  BEFORE UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stock_on_sales_return_confirm();

-- 8. THIẾT LẬP ROW LEVEL SECURITY (RLS)
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchase_returns_select" ON public.purchase_returns
  FOR SELECT USING (
    public.fn_is_active()
    AND (public.fn_is_admin()
         OR public.fn_has_role('accountant')
         OR public.fn_has_role('warehouse_keeper')
         OR public.fn_has_role('branch_manager'))
  );

CREATE POLICY "purchase_return_lines_select" ON public.purchase_return_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.purchase_returns pr
      WHERE pr.id = purchase_return_lines.purchase_return_id
        AND (public.fn_is_admin()
             OR public.fn_has_role('accountant')
             OR public.fn_has_role('warehouse_keeper'))
    )
  );

CREATE POLICY "purchase_returns_manage" ON public.purchase_returns
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "purchase_return_lines_manage" ON public.purchase_return_lines
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.purchase_returns pr
      WHERE pr.id = purchase_return_lines.purchase_return_id
        AND pr.status = 'draft'
        AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    )
  );
