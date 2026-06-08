-- ============================================================
-- 20260625000000_pos_block_oversell.sql
-- Mục đích: CHẶN CỨNG bán khi tồn kho < số lượng bán tại POS
--   (áp cho CẢ 2 luồng: Bán nhanh fn_pos_quick_sale + Bán giao hàng
--    fn_create_delivery_draft — vì cả hai đều đi qua fn_pos_build_draft).
--
--   Trước đây: fn_pos_build_draft chỉ dựng đơn nháp, KHÔNG kiểm tồn. Việc
--   kiểm/trừ tồn dồn về bước xác nhận (trigger fn_auto_stock_on_order_confirm)
--   và còn phụ thuộc chế độ stock_control_mode (soft → cho bán âm + ghi log).
--   → POS vẫn tạo được đơn dù tồn 0.
--
--   Nay: thêm bước kiểm tồn HARD ngay khi dựng đơn POS, ĐỘC LẬP với
--   stock_control_mode. Tồn khả dụng tính tại KHO của đơn (warehouse_id) —
--   khớp đúng nơi hệ thống thực trừ kho. Thiếu hàng → RAISE → rollback.
--
--   Lưu ý: chế độ soft toàn cục VẪN áp dụng cho các luồng xác nhận khác
--   (đơn sinh tự động chăn nuôi...). Chỉ riêng 2 luồng POS bị chặn cứng tại
--   bước tạo đơn (quyết định nghiệp vụ đã duyệt).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

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
    INSERT INTO public.order_lines (order_id, product_id, quantity, unit_price, discount)
    VALUES (
      v_order_id,
      (v_line->>'product_id')::UUID,
      (v_line->>'quantity')::NUMERIC,
      (v_line->>'unit_price')::NUMERIC,
      COALESCE((v_line->>'discount')::NUMERIC, 0)
    );
    v_n_lines := v_n_lines + 1;
  END LOOP;

  IF v_n_lines = 0 THEN
    RAISE EXCEPTION 'Đơn hàng phải có ít nhất 1 dòng sản phẩm.';
  END IF;

  -- ─────────────────────────────────────────────────────────────
  -- CHẶN CỨNG TỒN KHO (POS) — độc lập stock_control_mode.
  -- Gộp theo product (gồm cả dòng quà tặng/KM giá 0), so tồn khả dụng
  -- (quantity_on_hand - quantity_reserved) tại kho của đơn (v_wh).
  -- ─────────────────────────────────────────────────────────────
  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'Chưa chọn kho xuất hàng — không thể kiểm tra tồn kho.';
  END IF;

  SELECT string_agg(
           format('%s (cần %s, còn %s)', t.pname, trim_scale(t.req), trim_scale(t.avail)),
           '; ' ORDER BY t.pname
         )
    INTO v_short_msg
  FROM (
    SELECT p.name AS pname,
           SUM(ol.quantity)        AS req,
           COALESCE(s.avail, 0)    AS avail
    FROM public.order_lines ol
    JOIN public.products p ON p.id = ol.product_id
    LEFT JOIN (
      SELECT product_id, SUM(quantity_on_hand - quantity_reserved) AS avail
      FROM public.stock_lots
      WHERE warehouse_id = v_wh AND status = 'active'
      GROUP BY product_id
    ) s ON s.product_id = ol.product_id
    WHERE ol.order_id = v_order_id
    GROUP BY p.name, s.avail
    HAVING SUM(ol.quantity) > COALESCE(s.avail, 0)
  ) t;

  IF v_short_msg IS NOT NULL THEN
    RAISE EXCEPTION 'Không đủ tồn kho: %', v_short_msg;
  END IF;

  -- Trigger trg_order_lines_recalc đã set subtotal/discount_total/grand_total theo CK dòng.
  -- Ghi đè TỔNG có thẩm quyền: cộng thêm chiết khấu cấp hoá đơn (voucher/KM).
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

NOTIFY pgrst, 'reload schema';
