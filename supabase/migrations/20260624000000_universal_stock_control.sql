-- ============================================================
-- Migration: universal_stock_control
-- File: 20260624000000_universal_stock_control.sql
-- Mục đích: VÁ LỖ HỔNG bán âm tồn kho.
--   Gốc rễ: fn_auto_stock_on_order_confirm CHỈ trừ kho + chặn thiếu hàng khi
--   product.is_lot_managed = true. Mặc định cột là false → 1007/1029 sản phẩm
--   bỏ qua HOÀN TOÀN kiểm tra/trừ kho khi bán → bán được dù tồn = 0, không có lô.
--
--   Nay: ÁP DỤNG kiểm soát tồn cho MỌI sản phẩm (lô hay không), với 2 chế độ:
--     soft  (mặc định) : thiếu hàng vẫn cho bán nhưng GHI NHẬT KÝ (stock_oversell_log)
--                        + chỉ trừ phần khả dụng → dữ liệu tự đúng dần qua nhập kho.
--     hard             : thiếu hàng → RAISE → rollback toàn bộ giao dịch bán.
--   Lật chế độ qua system_settings.stock_control_mode (admin, không cần deploy).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Chế độ kiểm soát tồn kho (system_settings key/value JSONB)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES ('stock_control_mode', '{"mode":"soft"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_stock_control_mode()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT value->>'mode' FROM public.system_settings WHERE key = 'stock_control_mode'),
    'soft'
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_stock_control_mode() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Nhật ký bán thiếu/âm tồn (soft mode) — đồng thời là worklist
--    các sản phẩm cần nhập kho trước khi bật chế độ hard.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_oversell_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  order_line_id UUID,
  product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
  warehouse_id  UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  requested     NUMERIC(15,3) NOT NULL,
  available     NUMERIC(15,3) NOT NULL,
  shortfall     NUMERIC(15,3) NOT NULL,
  sale_channel  TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oversell_product ON public.stock_oversell_log(product_id);
CREATE INDEX IF NOT EXISTS idx_oversell_created ON public.stock_oversell_log(created_at DESC);

ALTER TABLE public.stock_oversell_log ENABLE ROW LEVEL SECURITY;

-- Đọc: admin/CEO hoặc người có quyền xem kho. Ghi: chỉ qua trigger SECURITY DEFINER.
DROP POLICY IF EXISTS oversell_select_managers ON public.stock_oversell_log;
CREATE POLICY oversell_select_managers ON public.stock_oversell_log
  FOR SELECT USING (
    public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('inventory.view'))
  );

GRANT SELECT ON public.stock_oversell_log TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. FEFO: chỉ phân bổ phần KHẢ DỤNG, KHÔNG còn RAISE nội bộ.
--    Quyền quyết định thiếu hàng (soft/hard) chuyển lên trigger gọi.
--    (Trigger fn_auto_stock_on_order_confirm là caller duy nhất.)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_allocate_lots_fefo(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_quantity     NUMERIC(15, 3)
)
RETURNS TABLE (lot_id UUID, allocated_qty NUMERIC(15, 3))
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lot       RECORD;
  v_remaining NUMERIC(15, 3) := p_quantity;
  v_available NUMERIC(15, 3);
  v_alloc     NUMERIC(15, 3);
BEGIN
  FOR v_lot IN
    SELECT id, quantity_on_hand, quantity_reserved
    FROM public.stock_lots
    WHERE product_id   = p_product_id
      AND warehouse_id = p_warehouse_id
      AND status       = 'active'
      AND quantity_on_hand > quantity_reserved
    ORDER BY
      expiry_date ASC NULLS LAST,   -- Lô hết hạn trước → xuất trước
      received_at ASC               -- Tiebreak: nhập trước → xuất trước
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_available := v_lot.quantity_on_hand - v_lot.quantity_reserved;
    v_alloc     := LEAST(v_remaining, v_available);

    UPDATE public.stock_lots
    SET quantity_reserved = quantity_reserved + v_alloc,
        updated_at        = now()
    WHERE id = v_lot.id;

    v_remaining   := v_remaining - v_alloc;
    lot_id        := v_lot.id;
    allocated_qty := v_alloc;
    RETURN NEXT;
  END LOOP;
  -- Hết lô mà còn thiếu → KHÔNG raise nữa (caller xử lý soft/hard).
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. Trừ kho khi xác nhận đơn — ÁP CHO MỌI SẢN PHẨM + theo chế độ.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_stock_on_order_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line       RECORD;
  v_alloc      RECORD;
  v_warehouse  UUID;
  v_mode       TEXT;
  v_channel    TEXT;
  v_available  NUMERIC(15,3);
  v_allocatable NUMERIC(15,3);
BEGIN
  -- Chỉ kích hoạt khi chuyển sang 'confirmed'
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;

  v_warehouse := NEW.warehouse_id;
  v_mode      := public.fn_stock_control_mode();
  v_channel   := NEW.sale_channel;

  FOR v_line IN
    SELECT ol.id AS line_id, ol.product_id, ol.quantity
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

    -- (b) Tính tồn khả dụng của SP tại kho
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
      -- soft: ghi nhật ký phần thiếu, chỉ phân bổ tới mức khả dụng
      INSERT INTO public.stock_oversell_log
        (order_id, order_line_id, product_id, warehouse_id, requested, available, shortfall, sale_channel, created_by)
      VALUES
        (NEW.id, v_line.line_id, v_line.product_id, v_warehouse, v_line.quantity, v_available,
         v_line.quantity - v_available, v_channel, COALESCE(NEW.confirmed_by, auth.uid()));
      v_allocatable := GREATEST(v_available, 0);
    ELSE
      v_allocatable := v_line.quantity;
    END IF;

    -- (c) Phân bổ FEFO phần khả dụng + ghi thẻ kho + trừ tồn thật
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

-- Trigger giữ nguyên (BEFORE UPDATE) — chỉ thay thân hàm ở trên.
-- (Tạo lại để chắc chắn tồn tại sau CREATE OR REPLACE.)
DROP TRIGGER IF EXISTS trg_orders_auto_stock ON public.orders;
CREATE TRIGGER trg_orders_auto_stock
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stock_on_order_confirm();

NOTIFY pgrst, 'reload schema';
