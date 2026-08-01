-- ============================================================
-- Migration: transfer_line_edit
-- File: 20260739000000_transfer_line_edit.sql
--
-- MỤC ĐÍCH: cho phép SỬA số lượng và đơn giá chuyển của phiếu chuyển kho
-- sau khi đã lập — thiếu sót của 20260738.
--
-- Bối cảnh: bước Admin duyệt sinh ra là ĐỂ ADMIN ĐIỀU CHỈNH đơn giá chuyển
-- (đơn giá này trở thành giá vốn của chi nhánh nhận, là cơ sở chốt giá bán).
-- Nhưng 20260738 khoá `stock_transfer_lines` chỉ sửa được khi phiếu còn
-- 'draft', mà cũng không có đường nào sửa → admin duyệt chỉ còn đồng ý hoặc
-- từ chối, không nắn được số. Ngoài ra kho đích thường đếm thấy lệch so với
-- phiếu (thiếu/vỡ/thừa) và cần sửa SỐ LƯỢNG THỰC NHẬN trước khi duyệt.
--
-- CÁCH LÀM: RPC fn_update_transfer_lines — đường DUY NHẤT sửa dòng phiếu
-- ngoài trạng thái nháp (SECURITY DEFINER nên vượt RLS; RLS vẫn khoá đường
-- sửa trực tiếp qua PostgREST).
--
-- QUYỀN:
--   draft                  → người lập phiếu HOẶC admin/ceo
--   in_transit | received  → CHỈ admin/ceo
--   completed | rejected | cancelled → không ai (đã chốt sổ)
--
-- ĐỐI ỨNG TỒN KHO: ở draft hàng chưa rời kho nên chỉ sửa số. Từ in_transit
-- trở đi hàng ĐÃ trừ khỏi kho nguồn, nên mọi thay đổi số lượng phải bù trừ
-- lại đúng lô nguồn + ghi thẻ kho:
--   giảm SL → trả phần chênh về lô nguồn  (stock_movement 'transfer_in')
--   tăng SL → trừ thêm ở lô nguồn         (stock_movement 'transfer_out')
--   SL = 0  → xoá dòng, trả toàn bộ về lô nguồn
--
-- ⚠️ Apply remote qua Management API + reload schema + tracking row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_transfer_lines(
  p_transfer_id UUID,
  p_lines       JSONB   -- [{line_id, quantity, unit_price}]
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_transfer RECORD;
  v_item     JSONB;
  v_line     RECORD;
  v_newqty   NUMERIC(15,3);
  v_newprice NUMERIC(15,2);
  v_delta    NUMERIC(15,3);
  v_avail    NUMERIC(15,3);
  v_shipped  BOOLEAN;
  v_left     INT;
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Tài khoản không hoạt động.';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;

  IF v_transfer.status NOT IN ('draft', 'in_transit', 'received') THEN
    RAISE EXCEPTION 'Phiếu ở trạng thái % đã chốt, không sửa được.', v_transfer.status;
  END IF;

  -- Quyền theo trạng thái
  IF v_transfer.status = 'draft' THEN
    IF NOT (public.fn_is_admin() OR v_transfer.created_by = v_uid) THEN
      RAISE EXCEPTION 'Chỉ người lập phiếu hoặc Admin được sửa phiếu nháp.';
    END IF;
  ELSE
    IF NOT public.fn_is_admin() THEN
      RAISE EXCEPTION 'Hàng đã xuất kho — chỉ Admin/CEO được sửa số lượng hoặc đơn giá.';
    END IF;
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Không có dòng nào để cập nhật.';
  END IF;

  -- Từ in_transit trở đi, hàng đã trừ khỏi kho nguồn → phải bù trừ đối ứng
  v_shipped := v_transfer.status IN ('in_transit', 'received');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_line
      FROM public.stock_transfer_lines
     WHERE id = (v_item->>'line_id')::UUID AND transfer_id = p_transfer_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dòng không thuộc phiếu này (id: %).', v_item->>'line_id';
    END IF;

    v_newqty   := COALESCE((v_item->>'quantity')::NUMERIC, v_line.quantity);
    v_newprice := GREATEST(COALESCE((v_item->>'unit_price')::NUMERIC, v_line.unit_price), 0);

    IF v_newqty < 0 THEN
      RAISE EXCEPTION 'Số lượng không được âm.';
    END IF;

    v_delta := v_newqty - v_line.quantity;

    -- ── Đối ứng tồn kho ở lô nguồn ──
    IF v_shipped AND v_delta <> 0 THEN
      IF v_delta > 0 THEN
        -- Cần lấy thêm hàng khỏi lô nguồn
        SELECT (quantity_on_hand - quantity_reserved) INTO v_avail
          FROM public.stock_lots WHERE id = v_line.lot_id FOR UPDATE;
        IF v_avail IS NULL THEN
          RAISE EXCEPTION 'Không tìm thấy lô hàng nguồn (id: %).', v_line.lot_id;
        END IF;
        IF v_avail < v_delta THEN
          RAISE EXCEPTION 'Lô nguồn không đủ tồn để tăng thêm %. Khả dụng: %.', v_delta, v_avail;
        END IF;

        UPDATE public.stock_lots
           SET quantity_on_hand = quantity_on_hand - v_delta, updated_at = now()
         WHERE id = v_line.lot_id;

        INSERT INTO public.stock_movements (
          lot_id, product_id, warehouse_id, movement_type,
          quantity, reference_id, reference_type, unit_cost, performed_by, notes
        ) VALUES (
          v_line.lot_id, v_line.product_id, v_transfer.from_warehouse, 'transfer_out',
          -v_delta, p_transfer_id, 'transfer', v_line.source_cost_price, v_uid,
          'Điều chỉnh tăng SL phiếu chuyển'
        );
      ELSE
        -- Trả phần chênh về lô nguồn
        UPDATE public.stock_lots
           SET quantity_on_hand = quantity_on_hand + (-v_delta), updated_at = now()
         WHERE id = v_line.lot_id;

        INSERT INTO public.stock_movements (
          lot_id, product_id, warehouse_id, movement_type,
          quantity, reference_id, reference_type, unit_cost, performed_by, notes
        ) VALUES (
          v_line.lot_id, v_line.product_id, v_transfer.from_warehouse, 'transfer_in',
          -v_delta, p_transfer_id, 'transfer', v_line.source_cost_price, v_uid,
          'Điều chỉnh giảm SL phiếu chuyển'
        );
      END IF;
    END IF;

    -- Ở draft chưa xuất kho: chỉ cần đảm bảo không vượt tồn khả dụng
    IF NOT v_shipped AND v_newqty > 0 THEN
      SELECT (quantity_on_hand - quantity_reserved) INTO v_avail
        FROM public.stock_lots WHERE id = v_line.lot_id;
      IF v_avail IS NULL OR v_avail < v_newqty THEN
        RAISE EXCEPTION 'Lô không đủ tồn khả dụng. Yêu cầu: %, khả dụng: %.',
          v_newqty, COALESCE(v_avail, 0);
      END IF;
    END IF;

    IF v_newqty = 0 THEN
      DELETE FROM public.stock_transfer_lines WHERE id = v_line.id;
    ELSE
      UPDATE public.stock_transfer_lines
         SET quantity = v_newqty, unit_price = v_newprice
       WHERE id = v_line.id;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_left FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id;
  IF v_left = 0 THEN
    RAISE EXCEPTION 'Phiếu phải còn ít nhất một dòng. Muốn bỏ hẳn thì Huỷ hoặc Từ chối phiếu.';
  END IF;

  -- Chốt lại tổng: total_amount theo đơn giá chuyển, total_cost theo giá vốn bên bán
  UPDATE public.stock_transfers t
     SET total_amount = COALESCE((
           SELECT SUM(l.quantity * COALESCE(l.unit_price, 0))
             FROM public.stock_transfer_lines l WHERE l.transfer_id = t.id), 0),
         total_cost = COALESCE((
           SELECT SUM(l.quantity * COALESCE(l.source_cost_price, 0))
             FROM public.stock_transfer_lines l WHERE l.transfer_id = t.id), 0),
         updated_at = now()
   WHERE t.id = p_transfer_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_update_transfer_lines(UUID, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
