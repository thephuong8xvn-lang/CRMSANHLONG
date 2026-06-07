-- ============================================================
-- Migration: orders_status_guard
-- File: 20260624000001_orders_status_guard.sql
-- Mục đích (hardening bảo mật/toàn vẹn — giống guard phiếu nhập 20260622):
--   Trạng thái đơn CHỈ được đổi qua RPC có kiểm quyền. Trước đây client
--   (vd MobileOrderPage) UPDATE thẳng status='confirmed' → bỏ duyệt Admin
--   cho đơn giao + kích trigger trừ kho ngoài luồng. Nay:
--     • INSERT: ép status='draft' (đơn mới luôn là nháp).
--     • UPDATE đổi status trực tiếp → TỪ CHỐI, trừ khi cờ phiên
--       app.order_rpc='on' (chỉ các RPC duyệt/bán/sửa/hủy bật cờ này).
--
-- set_config(...,true) có phạm vi TRANSACTION → set ở đầu RPC ngoài cùng là
-- đủ cho mọi cập nhật status lồng nhau trong cùng giao dịch; tự xoá khi commit
-- nên UPDATE trực tiếp từ client (giao dịch khác) vẫn bị chặn.
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Guard trạng thái đơn
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.order_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft';
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Không được đổi trạng thái đơn hàng trực tiếp. Hãy dùng chức năng Xác nhận/Giao/Hoàn tất/Hủy.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_status ON public.orders;
-- Tên 'trg_guard_*' < 'trg_orders_auto_stock' → guard chạy TRƯỚC trigger trừ kho.
CREATE TRIGGER trg_guard_order_status
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_order_status();

-- ─────────────────────────────────────────────────────────────
-- 2. Bật cờ phiên trong các RPC đổi trạng thái (giữ nguyên logic cũ,
--    chỉ thêm dòng set_config đầu hàm).
-- ─────────────────────────────────────────────────────────────

-- 2.1 Bán nhanh tại quầy
CREATE OR REPLACE FUNCTION public.fn_pos_quick_sale(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_order_id  UUID;
  v_code      TEXT;
  v_method    order_payment_method := COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash');
  v_paid      NUMERIC := COALESCE((p_payload->>'paid_amount')::NUMERIC, 0);
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);
  v_order_id := public.fn_pos_build_draft(p_payload, 'pos_quick');

  UPDATE public.orders
  SET status = 'confirmed', confirmed_by = v_uid
  WHERE id = v_order_id;

  UPDATE public.orders SET status = 'completed' WHERE id = v_order_id;

  PERFORM public.fn_pos_settle_payment(v_order_id, v_paid, v_method);

  SELECT order_code INTO v_code FROM public.orders WHERE id = v_order_id;
  RETURN jsonb_build_object('order_id', v_order_id, 'order_code', v_code);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_pos_quick_sale(JSONB) TO authenticated;

-- 2.2 Xác nhận đơn giao (Admin/CEO)
CREATE OR REPLACE FUNCTION public.fn_confirm_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status order_status;
  v_channel TEXT;
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ Admin/CEO được xác nhận đơn giao hàng.';
  END IF;

  SELECT status, sale_channel INTO v_status, v_channel
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_channel <> 'delivery' THEN
    RAISE EXCEPTION 'Chỉ áp dụng cho đơn giao hàng.';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Đơn không ở trạng thái nháp (hiện: %).', v_status;
  END IF;

  UPDATE public.orders
  SET status = 'confirmed', confirmed_by = auth.uid()
  WHERE id = p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_confirm_order(UUID) TO authenticated;

-- 2.3 Tiến trình giao hàng
CREATE OR REPLACE FUNCTION public.fn_advance_delivery(p_order_id UUID, p_to_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status order_status;
  v_channel TEXT;
  v_owner   UUID;
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);
  SELECT status, sale_channel, owner_user_id INTO v_status, v_channel, v_owner
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT (public.fn_is_admin() OR v_owner = auth.uid()) THEN
    RAISE EXCEPTION 'Chỉ chủ đơn hoặc Admin được cập nhật tiến trình giao hàng.';
  END IF;
  IF v_channel <> 'delivery' THEN
    RAISE EXCEPTION 'Chỉ áp dụng cho đơn giao hàng.';
  END IF;

  IF p_to_status = 'shipping' AND v_status = 'confirmed' THEN
    UPDATE public.orders SET status = 'shipping' WHERE id = p_order_id;
  ELSIF p_to_status = 'delivered' AND v_status = 'shipping' THEN
    UPDATE public.orders SET status = 'delivered' WHERE id = p_order_id;
  ELSE
    RAISE EXCEPTION 'Chuyển trạng thái không hợp lệ: % → %.', v_status, p_to_status;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_advance_delivery(UUID, TEXT) TO authenticated;

-- 2.4 Hoàn tất giao + thu tiền
CREATE OR REPLACE FUNCTION public.fn_complete_delivery_payment(
  p_order_id       UUID,
  p_paid_amount    NUMERIC,
  p_payment_method order_payment_method
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status  order_status;
  v_channel TEXT;
  v_owner   UUID;
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);
  SELECT status, sale_channel, owner_user_id INTO v_status, v_channel, v_owner
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT (public.fn_is_admin() OR v_owner = auth.uid()) THEN
    RAISE EXCEPTION 'Chỉ chủ đơn hoặc Admin được thu tiền đơn giao hàng.';
  END IF;
  IF v_channel <> 'delivery' THEN
    RAISE EXCEPTION 'Chỉ áp dụng cho đơn giao hàng.';
  END IF;
  IF v_status <> 'delivered' THEN
    RAISE EXCEPTION 'Đơn chưa ở trạng thái "Đã giao" (hiện: %).', v_status;
  END IF;

  UPDATE public.orders SET status = 'completed' WHERE id = p_order_id;
  PERFORM public.fn_pos_settle_payment(p_order_id, p_paid_amount, p_payment_method);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_complete_delivery_payment(UUID, NUMERIC, order_payment_method) TO authenticated;

-- 2.5 Hủy đơn (hoàn kho + đảo thu + xóa nợ)
CREATE OR REPLACE FUNCTION public.fn_cancel_order(
  p_order_id UUID,
  p_reason   TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status order_status;
  v_perms  JSONB;
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);
  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn hàng.';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Đơn hàng đã ở trạng thái hủy.';
  END IF;

  v_perms := public.fn_order_edit_perms(p_order_id);
  IF NOT (v_perms->>'can_cancel')::boolean THEN
    RAISE EXCEPTION '%', COALESCE(v_perms->>'reason', 'Không có quyền hủy đơn hàng.');
  END IF;

  PERFORM public.fn_reverse_order_effects(p_order_id);

  UPDATE public.orders
  SET status = 'cancelled',
      cancel_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      updated_at = now()
  WHERE id = p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_cancel_order(UUID, TEXT) TO authenticated;

-- 2.6 Sửa đơn (draft: dựng lại dòng; đã trừ kho: hoàn tác → áp lại)
CREATE OR REPLACE FUNCTION public.fn_pos_edit_order(
  p_order_id UUID,
  p_payload  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_perms   JSONB;
  v_status  order_status;
  v_channel TEXT;
  v_code    TEXT;
  v_method  order_payment_method := COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash');
  v_paid    NUMERIC := COALESCE((p_payload->>'paid_amount')::NUMERIC, 0);
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);
  SELECT status, sale_channel INTO v_status, v_channel
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn hàng.';
  END IF;

  v_perms := public.fn_order_edit_perms(p_order_id);
  IF NOT (v_perms->>'can_edit')::boolean THEN
    RAISE EXCEPTION '%', COALESCE(v_perms->>'reason', 'Không có quyền sửa đơn hàng.');
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Đơn đã hủy — không thể sửa.';
  END IF;

  IF v_status = 'draft' THEN
    PERFORM public.fn_pos_apply_lines(p_order_id, p_payload);
  ELSE
    PERFORM public.fn_reverse_order_effects(p_order_id);
    PERFORM public.fn_pos_apply_lines(p_order_id, p_payload);

    UPDATE public.orders SET status = 'draft' WHERE id = p_order_id;
    UPDATE public.orders SET status = 'confirmed', confirmed_by = v_uid WHERE id = p_order_id;
    UPDATE public.orders SET status = 'completed' WHERE id = p_order_id;

    PERFORM public.fn_pos_settle_payment(
      p_order_id,
      CASE WHEN v_method = 'credit' THEN 0 ELSE v_paid END,
      v_method
    );
  END IF;

  SELECT order_code INTO v_code FROM public.orders WHERE id = p_order_id;
  RETURN jsonb_build_object('order_id', p_order_id, 'order_code', v_code);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_pos_edit_order(UUID, JSONB) TO authenticated;

-- 2.7 Xác nhận đơn SINH TỰ ĐỘNG (vd từ dự án chăn nuôi) — giữ nguyên tổng tiền
--     (có phí dịch vụ cộng ngoài dòng hàng) nên KHÔNG recompute như fn_pos_quick_sale.
--     Chỉ chuyển draft → confirmed (trigger trừ kho FEFO theo chế độ soft/hard).
CREATE OR REPLACE FUNCTION public.fn_confirm_generated_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status order_status;
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);
  IF NOT public.fn_is_active() OR NOT public.fn_has_permission('orders.create') THEN
    RAISE EXCEPTION 'Không có quyền xác nhận đơn (orders.create).';
  END IF;

  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn hàng.'; END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Chỉ xác nhận được đơn ở trạng thái nháp (hiện: %).', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_lines WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'Đơn chưa có dòng sản phẩm.';
  END IF;

  UPDATE public.orders
  SET status = 'confirmed', confirmed_by = auth.uid()
  WHERE id = p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_confirm_generated_order(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
