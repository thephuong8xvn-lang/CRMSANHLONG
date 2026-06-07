-- ============================================================
-- Migration: harden_receipt_status
-- File: 20260622000000_harden_receipt_status.sql
-- Mục đích:
--   (1) KHOÁ toàn vẹn: status của phiếu nhập CHỈ được đổi qua RPC
--       (fn_verify/complete/cancel/reopen). Trước đây RLS không ràng buộc
--       status ở INSERT/UPDATE → client (anon key là public) có thể nhét
--       thẳng status='completed', bỏ qua duyệt + bỏ qua sinh kho → phiếu
--       "Hoàn tất" nhưng tồn kho = 0.
--   (2) SỬA dữ liệu: các phiếu đã bị đánh 'completed' nhưng CHƯA hề sinh
--       kho (completed_at NULL, không có stock_movements/stock_lots) →
--       trả về 'verified' để người lập/Admin bấm "Hoàn thành" trên UI mới.
--
-- An toàn deploy: guard ÉP mọi INSERT về 'draft' (không báo lỗi) nên
-- frontend CŨ (đang nhét 'completed') vẫn chạy, chỉ là phiếu ra 'draft'.
-- UPDATE đổi status trực tiếp thì bị TỪ CHỐI. Mọi RPC duyệt được miễn trừ
-- qua cờ phiên app.receipt_rpc='on'.
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Guard: chặn thao tác status trực tiếp (ngoài RPC)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_receipt_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Thao tác đến từ RPC duyệt (đã bật cờ phiên) → cho qua nguyên trạng
  IF current_setting('app.receipt_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Phiếu mới LUÔN là nháp; xoá mọi cờ duyệt/hoàn thành nếu client cố set
    NEW.status       := 'draft';
    NEW.verified_by  := NULL;
    NEW.verified_at  := NULL;
    NEW.completed_by := NULL;
    NEW.completed_at := NULL;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Không được đổi trạng thái phiếu nhập trực tiếp. Hãy dùng chức năng Duyệt/Hoàn thành/Huỷ.';
    END IF;
    -- Không cho sửa tay các cột audit duyệt
    NEW.verified_by  := OLD.verified_by;
    NEW.verified_at  := OLD.verified_at;
    NEW.completed_by := OLD.completed_by;
    NEW.completed_at := OLD.completed_at;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_receipt_status ON public.goods_receipts;
CREATE TRIGGER trg_guard_receipt_status
  BEFORE INSERT OR UPDATE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_receipt_status();

-- ─────────────────────────────────────────────────────────────
-- 2. Bật cờ phiên trong từng RPC duyệt để được guard miễn trừ.
--    (Giữ nguyên logic cũ, chỉ thêm dòng set_config đầu hàm.)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_verify_goods_receipt(p_receipt_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_receipt RECORD;
BEGIN
  PERFORM set_config('app.receipt_rpc', 'on', true);
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

    UPDATE public.price_list_items
      SET cost_price = v_line.unit_price
      WHERE product_id = v_line.product_id;

    IF v_line.po_line_id IS NOT NULL THEN
      UPDATE public.purchase_order_lines
        SET received_qty = received_qty + v_line.quantity
        WHERE id = v_line.po_line_id;
    END IF;
  END LOOP;

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

CREATE OR REPLACE FUNCTION public.fn_cancel_goods_receipt(p_receipt_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_receipt RECORD;
BEGIN
  PERFORM set_config('app.receipt_rpc', 'on', true);
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

CREATE OR REPLACE FUNCTION public.fn_reopen_goods_receipt(p_receipt_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt RECORD;
BEGIN
  PERFORM set_config('app.receipt_rpc', 'on', true);
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

-- ─────────────────────────────────────────────────────────────
-- 3. SỬA DỮ LIỆU: phiếu 'completed' nhưng chưa sinh kho → trả về 'verified'
--    (để người lập/Admin bấm "Hoàn thành" trên UI → sinh kho qua RPC).
--    Điều kiện chặt: completed_at NULL + không có movement + không có lot.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  PERFORM set_config('app.receipt_rpc', 'on', true);
  FOR r IN
    SELECT gr.id, gr.completed_by, gr.received_by
    FROM public.goods_receipts gr
    WHERE gr.status = 'completed'
      AND gr.completed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm
                      WHERE sm.reference_id = gr.id AND sm.reference_type = 'goods_receipt')
      AND NOT EXISTS (SELECT 1 FROM public.stock_lots sl WHERE sl.receipt_id = gr.id)
  LOOP
    UPDATE public.goods_receipts
      SET status       = 'verified',
          verified_by  = COALESCE(r.completed_by, r.received_by),
          verified_at  = now(),
          completed_by = NULL,
          completed_at = NULL,
          updated_at   = now()
      WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Đã trả về verified % phiếu nhập hỏng (completed nhưng không có kho).', n;
END $$;
