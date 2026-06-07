-- ============================================================
-- Migration: goods_receipt_approval
-- File: 20260619000000_goods_receipt_approval.sql
-- Mục đích: Thêm LUỒNG DUYỆT cho phiếu nhập kho (giống luồng duyệt đơn giao hàng).
--   Trước đây: insert goods_receipt_lines → trigger trg_receipt_lines_create_lot
--   tạo stock_lots NGAY → hàng vào kho tức thì, không có bước kiểm soát.
--
--   Nay: phiếu nhập có vòng đời:
--     draft     → nhân viên lập, được sửa toàn bộ (SL, giá, NCC, dòng hàng)
--     verified  → admin/ceo "xác nhận thông tin đúng"
--     completed → người lập HOẶC admin "xác nhận hoàn thành" → HÀNG MỚI VÀO KHO
--     cancelled → huỷ
--
--   Stock CHỈ được sinh 1 lần (atomic, idempotent) tại fn_complete_goods_receipt.
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Cột trạng thái + audit
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS verified_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_receipts_status_check') THEN
    ALTER TABLE public.goods_receipts
      ADD CONSTRAINT goods_receipts_status_check
      CHECK (status IN ('draft', 'verified', 'completed', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON public.goods_receipts(status);

-- Backfill: mọi phiếu HIỆN HỮU đều đã vào kho theo mô hình cũ → đánh dấu completed,
-- để KHÔNG bị xử lý lại (tránh nhân đôi tồn kho).
UPDATE public.goods_receipts
  SET status = 'completed',
      completed_at = COALESCE(completed_at, created_at),
      completed_by = COALESCE(completed_by, received_by)
  WHERE status = 'draft';

-- ─────────────────────────────────────────────────────────────
-- 2. GỠ trigger tự tạo lô khi insert dòng (chuyển vào RPC hoàn thành)
--    Giữ lại function fn_create_stock_lot_on_receipt để tham chiếu lịch sử,
--    nhưng không còn trigger nào gọi nó.
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_receipt_lines_create_lot ON public.goods_receipt_lines;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: admin/ceo DUYỆT phiếu (draft → verified)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_verify_goods_receipt(p_receipt_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_receipt RECORD;
BEGIN
  IF NOT public.fn_is_active() THEN RAISE EXCEPTION 'Tài khoản không hoạt động.'; END IF;
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ Admin/CEO được duyệt (xác nhận thông tin) phiếu nhập kho.';
  END IF;

  SELECT * INTO v_receipt FROM public.goods_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu nhập.'; END IF;
  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'Chỉ duyệt được phiếu ở trạng thái Nháp (hiện tại: %).', v_receipt.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.goods_receipt_lines WHERE receipt_id = p_receipt_id) THEN
    RAISE EXCEPTION 'Phiếu chưa có dòng sản phẩm nào để duyệt.';
  END IF;

  UPDATE public.goods_receipts
    SET status = 'verified', verified_by = v_uid, verified_at = now(), updated_at = now()
    WHERE id = p_receipt_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_verify_goods_receipt(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: HOÀN THÀNH phiếu (verified → completed) → SINH TỒN KHO
--    Quyền: người lập (received_by) HOẶC admin/ceo.
--    Atomic: tạo stock_lots + stock_movements + cập nhật giá vốn + PO.
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
      lot_number, manufacture_date, expiry_date, cost_price, quantity_on_hand
    ) VALUES (
      v_line.product_id, v_receipt.warehouse_id, v_receipt.supplier_id, p_receipt_id,
      v_lot_no, v_line.manufacture_date, v_line.expiry_date, v_line.unit_price, v_line.quantity
    )
    ON CONFLICT (product_id, lot_number, warehouse_id) DO UPDATE
      SET quantity_on_hand = stock_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
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
-- 5. RPC: HUỶ phiếu (draft|verified → cancelled). Quyền: người lập hoặc admin.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancel_goods_receipt(p_receipt_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_receipt RECORD;
BEGIN
  IF NOT public.fn_is_active() THEN RAISE EXCEPTION 'Tài khoản không hoạt động.'; END IF;

  SELECT * INTO v_receipt FROM public.goods_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu nhập.'; END IF;
  IF NOT (public.fn_is_admin() OR v_receipt.received_by = v_uid) THEN
    RAISE EXCEPTION 'Bạn không có quyền huỷ phiếu nhập này.';
  END IF;
  IF v_receipt.status NOT IN ('draft', 'verified') THEN
    RAISE EXCEPTION 'Chỉ huỷ được phiếu Nháp hoặc Đã duyệt (hiện tại: %).', v_receipt.status;
  END IF;

  UPDATE public.goods_receipts
    SET status = 'cancelled',
        notes  = CASE WHEN p_reason IS NULL OR p_reason = '' THEN notes
                      ELSE COALESCE(notes, '') || ' [Huỷ: ' || p_reason || ']' END,
        updated_at = now()
    WHERE id = p_receipt_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_cancel_goods_receipt(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. RPC: TRẢ VỀ NHÁP (verified → draft). Quyền: admin/ceo. Để sửa lại trước khi nhập kho.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reopen_goods_receipt(p_receipt_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt RECORD;
BEGIN
  IF NOT public.fn_is_active() THEN RAISE EXCEPTION 'Tài khoản không hoạt động.'; END IF;
  IF NOT public.fn_is_admin() THEN RAISE EXCEPTION 'Chỉ Admin/CEO được trả phiếu về Nháp.'; END IF;

  SELECT * INTO v_receipt FROM public.goods_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu nhập.'; END IF;
  IF v_receipt.status <> 'verified' THEN
    RAISE EXCEPTION 'Chỉ trả về Nháp được phiếu Đã duyệt (hiện tại: %).', v_receipt.status;
  END IF;

  UPDATE public.goods_receipts
    SET status = 'draft', verified_by = NULL, verified_at = NULL, updated_at = now()
    WHERE id = p_receipt_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_reopen_goods_receipt(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7. RLS bổ sung: NGƯỜI LẬP được sửa/xoá/thêm trên phiếu NHÁP của chính mình
--    (ngoài admin/warehouse_keeper sẵn có). Verify/complete đi qua RPC (SECURITY DEFINER).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "receipts_update_own_draft" ON public.goods_receipts;
CREATE POLICY "receipts_update_own_draft" ON public.goods_receipts
  FOR UPDATE
  USING (public.fn_is_active() AND received_by = auth.uid() AND status = 'draft')
  WITH CHECK (received_by = auth.uid());

DROP POLICY IF EXISTS "receipt_lines_manage_own_draft" ON public.goods_receipt_lines;
CREATE POLICY "receipt_lines_manage_own_draft" ON public.goods_receipt_lines
  FOR ALL
  USING (
    public.fn_is_active() AND EXISTS (
      SELECT 1 FROM public.goods_receipts gr
      WHERE gr.id = goods_receipt_lines.receipt_id
        AND gr.received_by = auth.uid()
        AND gr.status = 'draft'
    )
  )
  WITH CHECK (
    public.fn_is_active() AND EXISTS (
      SELECT 1 FROM public.goods_receipts gr
      WHERE gr.id = goods_receipt_lines.receipt_id
        AND gr.received_by = auth.uid()
        AND gr.status = 'draft'
    )
  );
