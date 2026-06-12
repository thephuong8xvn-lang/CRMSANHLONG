-- ============================================================
-- Migration: fix_sales_returns
-- File: 20260702000000_fix_sales_returns.sql
-- Bối cảnh / lý do:
--   Phát hiện migration 20260524000002_add_purchase_returns.sql CHƯA BAO GIỜ
--   được apply lên remote (bảng purchase_returns không tồn tại, trigger
--   trg_sales_returns_auto_stock không có trên sales_returns). Hệ quả:
--     • Cả 5 phiếu trả khách (TH-2026-00001 → 00005) hoàn tất mà KHÔNG hồi
--       tồn kho, KHÔNG ghi thẻ kho (stock_movements rỗng với sales_return).
--     • Hoàn kiểu 'credit_note' (Trừ vào công nợ) không có code giảm nợ ở
--       bất kỳ đâu → công nợ khách không đổi sau trả hàng.
--   Ngoài ra bản trigger cũ (file local) có 4 lỗi thiết kế:
--     (a) BEFORE-trigger đếm tổng SL trả không thấy row đang update
--         → đơn không bao giờ chuyển returned_partial/full;
--     (b) UPDATE orders.status bên trong sẽ bị trg_guard_order_status
--         (20260624000001) RAISE vì thiếu cờ app.order_rpc;
--     (c) dòng trả có lot_id NULL bị bỏ qua hoàn toàn (không hồi kho);
--     (d) client tự INSERT + flip status 3 bước — không atomic, không
--         validate SL/đơn giá phía server.
--   Migration này:
--     1. Tái lập phần purchase_returns bị thiếu (idempotent).
--     2. Guard sales_returns/_lines: status & số liệu chỉ đổi qua RPC.
--     3. fn_sales_return_apply_effects: hồi kho (fallback lot) + trừ công nợ
--        credit_note (FIFO như fn_collect_customer_debt) + cập nhật trạng
--        thái đơn — gọi từ AFTER-trigger khi phiếu → completed.
--     4. RPC fn_create_sales_return: tạo + hoàn tất phiếu atomic, validate
--        SL ≤ đã mua − đã trả, đơn giá ≤ giá bán thực tế.
--     5. RPC fn_cancel_sales_return (admin, chỉ credit_note): đảo kho + nợ.
--     6. Backfill 5 phiếu lịch sử: hồi kho cả 5; trừ nợ CHỈ TH-00003 &
--        TH-00005 (quyết định user 2026-06-12 — TH-2/4 đã xử lý ngoài hệ
--        thống, TH-1 hoàn tiền mặt đã có phiếu chi sổ quỹ).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. TÁI LẬP PHẦN BỊ THIẾU CỦA 20260524000002 (idempotent)
-- ─────────────────────────────────────────────────────────────
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

CREATE TABLE IF NOT EXISTS public.purchase_return_lines (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_return_id  UUID          NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  lot_id              UUID          NOT NULL REFERENCES public.stock_lots(id) ON DELETE RESTRICT,
  product_id          UUID          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity            NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  unit_price          NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_purchase_returns_updated_at ON public.purchase_returns;
CREATE TRIGGER trg_purchase_returns_updated_at
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

INSERT INTO public.code_sequences (code_type, prefix, year_part, current_no) VALUES
  ('purchase_return', 'PR', EXTRACT(YEAR FROM now())::INTEGER, 0)
ON CONFLICT (code_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_auto_purchase_return_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.return_code IS NULL OR NEW.return_code = '' THEN
    NEW.return_code := public.fn_generate_code('purchase_return', 5);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_returns_code ON public.purchase_returns;
CREATE TRIGGER trg_purchase_returns_code
  BEFORE INSERT ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_purchase_return_code();

CREATE OR REPLACE FUNCTION public.fn_auto_stock_on_purchase_return_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line RECORD;
  v_available NUMERIC(15,3);
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('confirmed', 'completed') THEN RETURN NEW; END IF;

  FOR v_line IN
    SELECT prl.* FROM public.purchase_return_lines prl
    WHERE prl.purchase_return_id = NEW.id
  LOOP
    SELECT (quantity_on_hand - quantity_reserved) INTO v_available
    FROM public.stock_lots WHERE id = v_line.lot_id;

    IF v_available IS NULL OR v_available < v_line.quantity THEN
      RAISE EXCEPTION 'Không đủ hàng tồn khả dụng trong lô để trả NCC. Yêu cầu: %, Khả dụng: %',
        v_line.quantity, COALESCE(v_available, 0);
    END IF;

    UPDATE public.stock_lots
    SET quantity_on_hand = quantity_on_hand - v_line.quantity, updated_at = now()
    WHERE id = v_line.lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type, quantity, reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_line.lot_id, v_line.product_id, NEW.warehouse_id, 'return_to_supplier',
      -v_line.quantity, NEW.id, 'purchase_return', v_line.unit_price, NEW.created_by
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_returns_auto_stock ON public.purchase_returns;
CREATE TRIGGER trg_purchase_returns_auto_stock
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stock_on_purchase_return_confirm();

ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_returns_select" ON public.purchase_returns;
CREATE POLICY "purchase_returns_select" ON public.purchase_returns
  FOR SELECT USING (
    public.fn_is_active()
    AND (public.fn_is_admin()
         OR public.fn_has_role('accountant')
         OR public.fn_has_role('warehouse_keeper')
         OR public.fn_has_role('branch_manager'))
  );

DROP POLICY IF EXISTS "purchase_return_lines_select" ON public.purchase_return_lines;
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

DROP POLICY IF EXISTS "purchase_returns_manage" ON public.purchase_returns;
CREATE POLICY "purchase_returns_manage" ON public.purchase_returns
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

DROP POLICY IF EXISTS "purchase_return_lines_manage" ON public.purchase_return_lines;
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_returns, public.purchase_return_lines TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. SALES_RETURNS: thêm cột audit + status 'cancelled' + guard
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS debt_offset_total NUMERIC(15,2) NOT NULL DEFAULT 0,  -- tổng tiền đã cấn trừ vào công nợ KH
  ADD COLUMN IF NOT EXISTS order_paid_delta  NUMERIC(15,2) NOT NULL DEFAULT 0,  -- phần đã cộng vào orders.paid_amount
  ADD COLUMN IF NOT EXISTS cancelled_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;

ALTER TABLE public.sales_returns DROP CONSTRAINT IF EXISTS sales_returns_status_check;
ALTER TABLE public.sales_returns
  ADD CONSTRAINT sales_returns_status_check
  CHECK (status IN ('pending','approved','completed','rejected','cancelled'));

-- Guard: trạng thái & số liệu phiếu trả chỉ đổi qua RPC (cờ app.return_rpc).
-- Cho phép sửa tự do duy nhất: reason (admin sửa lý do từ trang Trả hàng).
CREATE OR REPLACE FUNCTION public.fn_guard_sales_return()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.return_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.debt_offset_total := 0;
    NEW.order_paid_delta  := 0;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Không được đổi trạng thái phiếu trả hàng trực tiếp. Hãy dùng chức năng Trả hàng/Hủy phiếu.';
  END IF;
  IF NEW.total_amount      IS DISTINCT FROM OLD.total_amount
     OR NEW.refund_method  IS DISTINCT FROM OLD.refund_method
     OR NEW.order_id       IS DISTINCT FROM OLD.order_id
     OR NEW.debt_offset_total IS DISTINCT FROM OLD.debt_offset_total
     OR NEW.order_paid_delta  IS DISTINCT FROM OLD.order_paid_delta THEN
    RAISE EXCEPTION 'Không được sửa số liệu phiếu trả hàng trực tiếp.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_sales_return ON public.sales_returns;
CREATE TRIGGER trg_guard_sales_return
  BEFORE INSERT OR UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_sales_return();

-- Guard dòng phiếu: khóa cứng khi phiếu cha đã chốt (completed/cancelled/rejected)
CREATE OR REPLACE FUNCTION public.fn_guard_sales_return_lines()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.return_rpc', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_status FROM public.sales_returns
  WHERE id = COALESCE(NEW.return_id, OLD.return_id);

  IF v_status IN ('completed','cancelled','rejected') THEN
    RAISE EXCEPTION 'Phiếu trả hàng đã chốt — không được thêm/sửa/xóa dòng hàng.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_sales_return_lines ON public.sales_return_lines;
CREATE TRIGGER trg_guard_sales_return_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.sales_return_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_sales_return_lines();

-- ─────────────────────────────────────────────────────────────
-- 3. HIỆU ỨNG TRẢ HÀNG: hồi kho + trừ công nợ + trạng thái đơn
--    Tách thành hàm dùng chung cho trigger + backfill. Idempotent
--    theo stock_movements(reference_type='sales_return', reference_id).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sales_return_apply_effects(
  p_return_id  UUID,
  p_apply_debt BOOLEAN DEFAULT true
)
RETURNS VOID
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
        SELECT lot_number, manufacture_date, expiry_date, cost_price, status, warehouse_id
        INTO v_orig_lot FROM public.stock_lots WHERE id = v_lot_id;
        v_has_orig_lot := FOUND;
      END IF;

      v_target_wh := COALESCE(v_target_wh,
        CASE WHEN v_has_orig_lot THEN v_orig_lot.warehouse_id END);
      IF v_target_wh IS NULL THEN
        RAISE EXCEPTION 'Phiếu trả %: không xác định được kho nhận hàng trả.', v_sr.return_code;
      END IF;

      IF v_has_orig_lot THEN
        -- Tìm/tạo lô cùng số lô tại kho nhận
        SELECT id INTO v_target_lot_id FROM public.stock_lots
        WHERE product_id = v_line.product_id
          AND lot_number = v_orig_lot.lot_number
          AND warehouse_id = v_target_wh;

        IF v_target_lot_id IS NULL THEN
          INSERT INTO public.stock_lots (
            product_id, warehouse_id, lot_number, manufacture_date, expiry_date,
            cost_price, quantity_on_hand, status, notes
          ) VALUES (
            v_line.product_id, v_target_wh, v_orig_lot.lot_number,
            v_orig_lot.manufacture_date, v_orig_lot.expiry_date,
            v_orig_lot.cost_price, 0, v_orig_lot.status,
            'Tạo khi nhận hàng trả ' || v_sr.return_code
          ) RETURNING id INTO v_target_lot_id;
        END IF;
      ELSE
        -- Không truy được lô gốc: nhận vào lô active gần nhất của SP tại kho,
        -- nếu không có thì tạo lô RETURN-<mã phiếu>.
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
REVOKE ALL ON FUNCTION public.fn_sales_return_apply_effects(UUID, BOOLEAN) FROM PUBLIC;

-- Trigger AFTER UPDATE (thay bản BEFORE cũ nếu có): phiếu → completed thì áp hiệu ứng
CREATE OR REPLACE FUNCTION public.fn_apply_sales_return_effects()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN
    PERFORM public.fn_sales_return_apply_effects(NEW.id, true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_returns_auto_stock ON public.sales_returns;
DROP TRIGGER IF EXISTS trg_sales_returns_apply_effects ON public.sales_returns;
CREATE TRIGGER trg_sales_returns_apply_effects
  AFTER UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_apply_sales_return_effects();

-- ─────────────────────────────────────────────────────────────
-- 4. RPC TẠO PHIẾU TRẢ HÀNG — atomic + validate server-side
--    p_lines: [{order_line_id, quantity, unit_price, lot_id}]
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_create_sales_return(
  p_order_id      UUID,
  p_warehouse_id  UUID,
  p_reason_code   TEXT,
  p_reason_detail TEXT,
  p_refund_method TEXT,
  p_lines         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_order      RECORD;
  v_ol         RECORD;
  v_line       JSONB;
  v_qty        NUMERIC(15,3);
  v_price      NUMERIC(15,2);
  v_max_price  NUMERIC(15,2);
  v_returned   NUMERIC(15,3);
  v_total      NUMERIC(15,2) := 0;
  v_return_id  UUID;
  v_code       TEXT;
  v_n          INT := 0;
  v_sr         RECORD;
BEGIN
  -- Quyền: khớp RLS returns_manage_active
  IF NOT (public.fn_is_active()
          AND (public.fn_is_admin()
               OR public.fn_has_role('accountant')
               OR public.fn_has_role('team_lead'))) THEN
    RAISE EXCEPTION 'Không có quyền tạo phiếu trả hàng.';
  END IF;

  IF p_refund_method NOT IN ('cash','bank_transfer','credit_note') THEN
    RAISE EXCEPTION 'Hình thức hoàn không hợp lệ.';
  END IF;
  IF p_reason_code NOT IN ('damage','wrong_product','near_expiry','quality_fail','recall','other') THEN
    RAISE EXCEPTION 'Mã lý do không hợp lệ.';
  END IF;
  IF p_warehouse_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id) THEN
    RAISE EXCEPTION 'Kho nhận hàng trả không hợp lệ.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Đơn hàng không tồn tại.'; END IF;
  IF v_order.status NOT IN ('delivered','paid','completed','returned_partial') THEN
    RAISE EXCEPTION 'Chỉ trả hàng với đơn đã giao/hoàn tất (trạng thái hiện tại: %).', v_order.status;
  END IF;

  PERFORM set_config('app.return_rpc', 'on', true);

  INSERT INTO public.sales_returns (
    order_id, reason, refund_method, total_amount, status, created_by, processed_by
  ) VALUES (
    p_order_id,
    '[' || p_reason_code || '] ' || COALESCE(NULLIF(TRIM(p_reason_detail), ''), 'Không ghi chú'),
    p_refund_method, 0, 'pending', v_uid, v_uid
  ) RETURNING id INTO v_return_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    CONTINUE WHEN v_qty <= 0;

    SELECT ol.* INTO v_ol FROM public.order_lines ol
    WHERE ol.id = (v_line->>'order_line_id')::UUID AND ol.order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dòng hàng không thuộc đơn này.';
    END IF;

    -- SL đã trả trước đó (chỉ tính phiếu có hiệu lực)
    SELECT COALESCE(SUM(srl.quantity), 0) INTO v_returned
    FROM public.sales_return_lines srl
    JOIN public.sales_returns sr ON sr.id = srl.return_id
    WHERE srl.order_line_id = v_ol.id AND sr.status IN ('approved','completed');

    IF v_qty > v_ol.quantity - v_returned THEN
      RAISE EXCEPTION 'SL trả (%) vượt quá SL còn lại có thể trả (%) của sản phẩm.',
        v_qty, v_ol.quantity - v_returned;
    END IF;

    -- Đơn giá hoàn: không vượt giá thực bán (đơn giá − chiết khấu dòng)
    v_max_price := GREATEST(v_ol.unit_price - COALESCE(v_ol.discount, 0), 0);
    v_price := LEAST(GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, v_max_price), 0), v_max_price);

    INSERT INTO public.sales_return_lines (
      return_id, order_line_id, product_id, quantity, unit_price, lot_id, return_to_warehouse_id
    ) VALUES (
      v_return_id, v_ol.id, v_ol.product_id, v_qty, v_price,
      NULLIF(v_line->>'lot_id','')::UUID, p_warehouse_id
    );

    v_total := v_total + (v_qty * v_price);
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Phiếu trả phải có ít nhất 1 dòng với số lượng > 0.';
  END IF;

  UPDATE public.sales_returns SET total_amount = v_total WHERE id = v_return_id;
  -- Hoàn tất → trigger áp hiệu ứng kho/nợ/trạng thái đơn (atomic cùng transaction)
  UPDATE public.sales_returns SET status = 'completed' WHERE id = v_return_id;

  SELECT * INTO v_sr FROM public.sales_returns WHERE id = v_return_id;
  SELECT order_code INTO v_code FROM public.orders WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'return_id',    v_return_id,
    'return_code',  v_sr.return_code,
    'total_amount', v_sr.total_amount,
    'debt_offset',  v_sr.debt_offset_total,
    'order_code',   v_code,
    'new_order_status', (SELECT status FROM public.orders WHERE id = p_order_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_create_sales_return(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_sales_return(UUID, UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. RPC HỦY PHIẾU TRẢ HÀNG — admin, chỉ credit_note
--    (cash/bank đã sinh phiếu chi sổ quỹ → xử lý qua sổ quỹ)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancel_sales_return(
  p_return_id UUID,
  p_reason    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_sr    RECORD;
  v_order RECORD;
  v_mv    RECORD;
  v_avail NUMERIC(15,3);
  v_returned_total NUMERIC(15,3);
BEGIN
  IF NOT (public.fn_is_active() AND public.fn_is_admin()) THEN
    RAISE EXCEPTION 'Chỉ Admin được hủy phiếu trả hàng.';
  END IF;

  SELECT * INTO v_sr FROM public.sales_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Phiếu trả hàng không tồn tại.'; END IF;
  IF v_sr.status <> 'completed' THEN
    RAISE EXCEPTION 'Chỉ hủy được phiếu đã hoàn tất (trạng thái hiện tại: %).', v_sr.status;
  END IF;
  IF v_sr.refund_method <> 'credit_note' THEN
    RAISE EXCEPTION 'Phiếu hoàn tiền mặt/chuyển khoản đã sinh phiếu chi sổ quỹ — hãy xử lý hoàn nhập qua Sổ quỹ rồi liên hệ quản trị hệ thống.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_sr.order_id FOR UPDATE;

  PERFORM set_config('app.return_rpc', 'on', true);
  PERFORM set_config('app.order_rpc',  'on', true);

  -- 5a. Đảo kho: trừ lại đúng các lô đã nhận hàng trả
  FOR v_mv IN
    SELECT lot_id, product_id, warehouse_id, quantity, unit_cost
    FROM public.stock_movements
    WHERE reference_type = 'sales_return' AND reference_id = p_return_id
      AND movement_type = 'return_from_customer'
  LOOP
    SELECT quantity_on_hand - quantity_reserved INTO v_avail
    FROM public.stock_lots WHERE id = v_mv.lot_id FOR UPDATE;

    IF COALESCE(v_avail, 0) < v_mv.quantity THEN
      RAISE EXCEPTION 'Không đủ tồn khả dụng để hoàn tác (lô đã xuất bán tiếp). Cần %, còn %.',
        v_mv.quantity, COALESCE(v_avail, 0);
    END IF;

    UPDATE public.stock_lots
    SET quantity_on_hand = quantity_on_hand - v_mv.quantity, updated_at = now()
    WHERE id = v_mv.lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type, quantity,
      reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_mv.lot_id, v_mv.product_id, v_mv.warehouse_id, 'adjustment_decrease',
      -v_mv.quantity, p_return_id, 'sales_return', v_mv.unit_cost, v_uid
    );
  END LOOP;

  -- 5b. Đảo công nợ: tái lập phần đã cấn trừ
  IF COALESCE(v_sr.debt_offset_total, 0) > 0 THEN
    INSERT INTO public.customer_debts (
      customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by
    ) VALUES (
      v_order.customer_id, v_sr.order_id, 'order_debt', v_sr.debt_offset_total,
      (CURRENT_DATE + INTERVAL '30 day')::date, false,
      'Tái lập công nợ do hủy phiếu trả ' || v_sr.return_code
        || COALESCE(' — ' || NULLIF(TRIM(p_reason), ''), ''),
      v_uid
    );
  END IF;
  IF COALESCE(v_sr.order_paid_delta, 0) > 0 THEN
    UPDATE public.orders
    SET paid_amount = GREATEST(paid_amount - v_sr.order_paid_delta, 0),
        payment_status = CASE
          WHEN GREATEST(paid_amount - v_sr.order_paid_delta, 0) >= grand_total THEN 'paid'::order_payment_status
          WHEN GREATEST(paid_amount - v_sr.order_paid_delta, 0) > 0            THEN 'partially_paid'::order_payment_status
          ELSE 'unpaid'::order_payment_status
        END,
        updated_at = now()
    WHERE id = v_sr.order_id;
  END IF;

  -- 5c. Chốt phiếu
  UPDATE public.sales_returns
  SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(),
      reason = reason || ' | [HỦY] ' || COALESCE(NULLIF(TRIM(p_reason), ''), 'Không ghi chú'),
      debt_offset_total = 0, order_paid_delta = 0
  WHERE id = p_return_id;

  -- 5d. Trạng thái đơn: tính lại theo các phiếu còn hiệu lực
  SELECT COALESCE(SUM(srl.quantity), 0) INTO v_returned_total
  FROM public.sales_return_lines srl
  JOIN public.sales_returns sr ON sr.id = srl.return_id
  WHERE sr.order_id = v_sr.order_id AND sr.status IN ('approved','completed');

  IF v_returned_total <= 0 AND v_order.status IN ('returned_partial','returned_full') THEN
    UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = v_sr.order_id;
  ELSIF v_returned_total > 0 THEN
    UPDATE public.orders
    SET status = CASE
      WHEN v_returned_total >= (SELECT COALESCE(SUM(quantity),0) FROM public.order_lines WHERE order_id = v_sr.order_id)
        THEN 'returned_full'::order_status ELSE 'returned_partial'::order_status END,
        updated_at = now()
    WHERE id = v_sr.order_id;
  END IF;

  RETURN jsonb_build_object('return_code', v_sr.return_code, 'cancelled', true);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cancel_sales_return(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cancel_sales_return(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5bis. fn_track_order_status: cho phép chuyển trạng thái bởi hệ thống
--   (trigger trả hàng / backfill không có auth.uid() → NOT NULL vi phạm).
--   Fallback: người xác nhận đơn → chủ đơn.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_track_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status <> 'confirmed'  -- confirmed đã được xử lý ở trigger trừ kho
  THEN
    INSERT INTO public.order_status_history
      (order_id, from_status, to_status, changed_by)
    VALUES
      (NEW.id, OLD.status, NEW.status,
       COALESCE(auth.uid(), NEW.confirmed_by, NEW.owner_user_id));
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. BACKFILL 5 PHIẾU LỊCH SỬ (idempotent — chạy lại vô hại)
--    Hồi kho: cả 5. Trừ nợ: CHỈ TH-2026-00003 & TH-2026-00005
--    (TH-1 hoàn tiền mặt đã có phiếu chi; TH-2/TH-4 user xác nhận
--     đã xử lý ngoài hệ thống — không cấn nợ, không tạo credit).
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, return_code FROM public.sales_returns
    WHERE status = 'completed'
    ORDER BY created_at
  LOOP
    PERFORM public.fn_sales_return_apply_effects(
      r.id,
      r.return_code IN ('TH-2026-00003', 'TH-2026-00005')
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
