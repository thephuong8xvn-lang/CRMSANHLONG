-- ============================================================
-- 20260703000000_pos_warehouse_branch_guard.sql
-- Vá lỗ hổng: fn_pos_build_draft nhận warehouse_id THẲNG từ client rồi trừ kho
-- tại đó. Vì RPC là SECURITY DEFINER (bỏ qua RLS), một client tự chế request có
-- thể trừ kho của CHI NHÁNH KHÁC (UI luôn gửi kho chính của chi nhánh mình, nhưng
-- server trước nay không ràng buộc).
--
-- Nay: bổ sung kiểm tra warehouse_id phải thuộc chi nhánh của người tạo đơn và
-- đang hoạt động. MIỄN TRỪ admin/CEO (fn_is_admin) — có thể thao tác liên chi nhánh.
-- Giữ nguyên toàn bộ logic chặn oversell + ghi tổng có thẩm quyền của bản 20260625.
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

  -- ─────────────────────────────────────────────────────────────
  -- RÀNG BUỘC KHO XUẤT: phải thuộc chi nhánh của người tạo đơn & active.
  -- Admin/CEO được miễn trừ (thao tác liên chi nhánh hợp lệ).
  -- ─────────────────────────────────────────────────────────────
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
    -- Admin: vẫn yêu cầu kho tồn tại & active (tránh trừ kho rác).
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
