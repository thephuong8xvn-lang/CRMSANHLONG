-- ============================================================
-- Migration: Server làm chủ chiết khấu KM + lưu vết KM trên đơn + báo cáo
-- File: 20260732000000_promo_server_authority.sql
--
-- BỐI CẢNH LỖI:
--   1. `fn_pos_build_draft` nhận `invoice_discount` THẲNG TỪ CLIENT và trừ vào
--      tổng đơn, không kiểm tra KM có tồn tại / còn hạn / đủ điều kiện hay không.
--      → sửa payload trong trình duyệt là giảm giá tuỳ ý.
--   2. Đơn hàng KHÔNG lưu vết KM nào đã áp → không đo được hiệu quả chương trình,
--      không hoàn được lượt dùng khi huỷ đơn / trả hàng.
--   3. `fn_consume_promo_usage` (20260730) được FE gọi SAU khi đơn đã tạo → nếu
--      bước đó lỗi thì đơn vẫn tồn tại mà lượt dùng không được đếm.
--
-- CÁCH SỬA:
--   • Client chỉ gửi `promotion_id` / `voucher_code`. Server TỰ TÍNH LẠI số tiền
--     giảm từ định nghĩa KM + các dòng đơn thật. `invoice_discount` của client
--     bị BỎ QUA HOÀN TOÀN.
--   • orders.promotion_id / voucher_id, order_lines.promotion_id (KM sản phẩm).
--   • Lượt dùng do TRIGGER trên orders quản: đơn sang completed/paid → +1;
--     đơn bị huỷ → −1. Nằm trong cùng giao dịch nên không còn lệch.
--     → `fn_consume_promo_usage` không còn cần, DROP.
--   • `fn_promo_performance()` — báo cáo hiệu quả cả KM đơn lẫn KM sản phẩm.
--
-- ⚠️ TƯƠNG THÍCH NGƯỢC: đơn offline đã xếp hàng TRƯỚC khi deploy bản này chỉ có
--   `invoice_discount` (không có promotion_id) → sẽ được tính giảm giá = 0.
--   Số đơn kiểu này rất ít (chỉ nằm trong IndexedDB của phiên đang mở).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. LƯU VẾT KM TRÊN ĐƠN
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS promotion_id         UUID REFERENCES public.promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voucher_id           UUID REFERENCES public.vouchers(id)   ON DELETE SET NULL,
  -- Chống đếm trùng: một đơn chỉ được cộng lượt dùng đúng 1 lần dù status đổi qua lại.
  ADD COLUMN IF NOT EXISTS promo_usage_counted  BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.promotion_id IS
  'KM cấp đơn đã áp. Số tiền giảm do server tự tính, không nhận từ client.';

-- KM theo sản phẩm áp lên dòng nào (dòng quà tặng hoặc dòng được giảm %).
ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES public.product_promotions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.order_lines.promotion_id IS
  'KM theo sản phẩm (product_promotions) sinh ra dòng quà / chiết khấu dòng này.';

CREATE INDEX IF NOT EXISTS idx_orders_promotion   ON public.orders(promotion_id) WHERE promotion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_voucher     ON public.orders(voucher_id)   WHERE voucher_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orderlines_promo   ON public.order_lines(promotion_id) WHERE promotion_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- 2. TÍNH LẠI CHIẾT KHẤU KM CẤP ĐƠN — NGUỒN CHÂN LÝ DUY NHẤT
--    Phải khớp `calcPromoDiscount` trong src/hooks/usePromotionEngine.ts.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_promo_discount_for_order(
  p_order_id     UUID,
  p_promotion_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p               public.promotions%ROWTYPE;
  v_branch        UUID;
  v_tier          TEXT;
  v_net_subtotal  NUMERIC(15,2);   -- sau CK dòng — dùng cho ngưỡng đơn tối thiểu
  v_prod_ids      UUID[];
  v_appl_subtotal NUMERIC(15,2);   -- giá gốc các dòng thuộc phạm vi KM
  v_total_qty     NUMERIC(15,3);
  v_cheapest      NUMERIC(15,2);
  v_sets          NUMERIC(15,3);
  v_per_set       NUMERIC(15,2);
  v_pct           NUMERIC;
  v_id            UUID;
  v_qty           NUMERIC(15,3);
  v_min_price     NUMERIC(15,2);
BEGIN
  IF p_promotion_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO p FROM public.promotions WHERE id = p_promotion_id;
  IF NOT FOUND OR NOT p.is_active THEN RETURN 0; END IF;

  -- Hiệu lực & lượt dùng
  IF p.valid_from IS NOT NULL AND p.valid_from > now() THEN RETURN 0; END IF;
  IF p.valid_to   IS NOT NULL AND p.valid_to   < now() THEN RETURN 0; END IF;
  IF p.max_uses   IS NOT NULL AND p.current_uses >= p.max_uses THEN RETURN 0; END IF;

  SELECT o.branch_id, c.value_tier::TEXT
    INTO v_branch, v_tier
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.id = p_order_id;

  -- Phạm vi chi nhánh: rỗng = toàn hệ thống
  IF COALESCE(array_length(p.branch_ids, 1), 0) > 0
     AND (v_branch IS NULL OR NOT (v_branch = ANY(p.branch_ids))) THEN
    RETURN 0;
  END IF;

  -- Hạng khách hàng: rỗng = mọi hạng
  IF COALESCE(array_length(p.customer_tiers, 1), 0) > 0
     AND (v_tier IS NULL OR NOT (v_tier = ANY(p.customer_tiers))) THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM((unit_price - discount) * quantity), 0)
    INTO v_net_subtotal
  FROM public.order_lines WHERE order_id = p_order_id;

  IF v_net_subtotal < COALESCE(p.min_order_amount, 0) THEN RETURN 0; END IF;

  -- Phạm vi sản phẩm: applies_to.product_ids rỗng = áp lên mọi dòng
  SELECT COALESCE(
           array_agg((e)::UUID),
           '{}'::UUID[]
         )
    INTO v_prod_ids
  FROM jsonb_array_elements_text(COALESCE(p.applies_to->'product_ids', '[]'::jsonb)) AS e;

  SELECT COALESCE(SUM(unit_price * quantity), 0),
         COALESCE(SUM(quantity), 0),
         MIN(unit_price)
    INTO v_appl_subtotal, v_total_qty, v_cheapest
  FROM public.order_lines
  WHERE order_id = p_order_id
    AND (COALESCE(array_length(v_prod_ids, 1), 0) = 0 OR product_id = ANY(v_prod_ids));

  IF p.discount_type = 'percent' THEN
    RETURN ROUND(v_appl_subtotal * p.discount_value / 100);

  ELSIF p.discount_type = 'fixed_amount' THEN
    RETURN LEAST(p.discount_value, v_appl_subtotal);

  ELSIF p.discount_type = 'customer_tier_discount' THEN
    RETURN ROUND(v_appl_subtotal * p.discount_value / 100);

  ELSIF p.discount_type = 'buy_x_get_y' THEN
    -- Ngữ nghĩa KM cấp đơn: lấy (X+Y) món, tính tiền X món. Hàng tặng ĐÃ nằm trong
    -- giỏ → chỉ quy ra tiền. KHÁC "mua X tặng Y" của product_promotions (sinh dòng quà).
    IF COALESCE(p.buy_x_qty, 0) <= 0 OR COALESCE(p.get_y_qty, 0) <= 0 THEN RETURN 0; END IF;
    v_sets := FLOOR(v_total_qty / (p.buy_x_qty + p.get_y_qty));
    RETURN ROUND(v_sets * p.get_y_qty * COALESCE(v_cheapest, 0));

  ELSIF p.discount_type = 'combo_price' THEN
    IF COALESCE(array_length(v_prod_ids, 1), 0) = 0 OR p.combo_price IS NULL THEN RETURN 0; END IF;
    v_sets     := NULL;   -- min số lượng trên các SP của combo
    v_per_set  := 0;
    FOREACH v_id IN ARRAY v_prod_ids LOOP
      SELECT COALESCE(SUM(quantity), 0), MIN(unit_price)
        INTO v_qty, v_min_price
      FROM public.order_lines WHERE order_id = p_order_id AND product_id = v_id;

      IF v_qty <= 0 THEN RETURN 0; END IF;        -- thiếu 1 SP → không thành combo
      v_sets    := LEAST(COALESCE(v_sets, v_qty), v_qty);
      v_per_set := v_per_set + COALESCE(v_min_price, 0);
    END LOOP;
    IF COALESCE(v_sets, 0) < 1 THEN RETURN 0; END IF;
    RETURN GREATEST(0, ROUND((v_per_set - p.combo_price) * FLOOR(v_sets)));

  ELSIF p.discount_type = 'tiered_quantity' THEN
    SELECT (t->>'discount_percent')::NUMERIC INTO v_pct
    FROM jsonb_array_elements(COALESCE(p.tiers, '[]'::jsonb)) AS t
    WHERE v_total_qty >= (t->>'min_qty')::NUMERIC
    ORDER BY (t->>'min_qty')::NUMERIC DESC
    LIMIT 1;
    IF v_pct IS NULL THEN RETURN 0; END IF;
    RETURN ROUND(v_appl_subtotal * v_pct / 100);
  END IF;

  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.fn_promo_discount_for_order IS
  'Tính lại chiết khấu KM cấp đơn từ định nghĩa KM + các dòng đơn THẬT. Nguồn chân lý — không nhận số từ client.';


-- ─────────────────────────────────────────────────────────────
-- 3. TÍNH LẠI CHIẾT KHẤU VOUCHER
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_voucher_discount_for_order(
  p_order_id   UUID,
  p_voucher_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v         public.vouchers%ROWTYPE;
  v_sub     NUMERIC(15,2);
  v_disc    NUMERIC(15,2);
BEGIN
  IF p_voucher_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher_id;
  IF NOT FOUND OR NOT v.is_active THEN RETURN 0; END IF;
  IF v.valid_from IS NOT NULL AND v.valid_from > now() THEN RETURN 0; END IF;
  IF v.valid_to   IS NOT NULL AND v.valid_to   < now() THEN RETURN 0; END IF;
  IF v.current_uses >= v.max_uses THEN RETURN 0; END IF;

  SELECT COALESCE(SUM((unit_price - discount) * quantity), 0)
    INTO v_sub
  FROM public.order_lines WHERE order_id = p_order_id;

  IF v_sub < COALESCE(v.min_order_amount, 0) THEN RETURN 0; END IF;

  IF v.discount_type = 'percent' THEN
    v_disc := ROUND(v_sub * v.discount_value / 100);
  ELSE
    v_disc := v.discount_value;
  END IF;

  IF v.max_discount IS NOT NULL THEN
    v_disc := LEAST(v_disc, v.max_discount);
  END IF;

  RETURN LEAST(GREATEST(v_disc, 0), v_sub);
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 4. DỰNG ĐƠN NHÁP — SERVER TỰ TÍNH CHIẾT KHẤU (bỏ qua số client gửi)
--    Giữ NGUYÊN toàn bộ guard kho/lô/oversell của 20260706.
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
  v_inv_disc    NUMERIC(15,2) := 0;   -- ⚠️ KHÔNG đọc từ p_payload nữa
  v_grand       NUMERIC(15,2);
  v_line        JSONB;
  v_n_lines     INT := 0;
  v_wh          UUID := NULLIF(p_payload->>'warehouse_id','')::UUID;
  v_short_msg   TEXT;
  v_promo_id    UUID := NULLIF(p_payload->>'promotion_id','')::UUID;
  v_vou_code    TEXT := NULLIF(p_payload->>'voucher_code','');
  v_vou_id      UUID;
BEGIN
  IF NOT public.fn_is_active() OR NOT public.fn_has_permission('orders.create') THEN
    RAISE EXCEPTION 'Không có quyền tạo đơn hàng (orders.create).';
  END IF;

  IF (p_payload->>'customer_id') IS NULL THEN
    RAISE EXCEPTION 'Thiếu khách hàng.';
  END IF;

  SELECT branch_id INTO v_branch FROM public.profiles WHERE id = v_uid;

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

  -- Voucher: client gửi MÃ, server tra ra id (không nhận id để tránh đoán mò).
  IF v_vou_code IS NOT NULL THEN
    SELECT id INTO v_vou_id FROM public.vouchers
    WHERE upper(code) = upper(v_vou_code) AND is_active;
    IF v_vou_id IS NULL THEN
      RAISE EXCEPTION 'Voucher "%" không tồn tại hoặc đã ngưng.', v_vou_code;
    END IF;
  END IF;

  INSERT INTO public.orders (
    customer_id, status, sale_channel, payment_status, payment_method,
    owner_user_id, confirmed_by, branch_id, warehouse_id, price_list_id,
    delivery_address, notes, disease_id, treatment_purpose,
    promotion_id, voucher_id
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
    NULLIF(p_payload->>'treatment_purpose',''),
    v_promo_id, v_vou_id
  )
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb))
  LOOP
    INSERT INTO public.order_lines (order_id, product_id, quantity, unit_price, discount, lot_id, promotion_id)
    VALUES (
      v_order_id,
      (v_line->>'product_id')::UUID,
      (v_line->>'quantity')::NUMERIC,
      (v_line->>'unit_price')::NUMERIC,
      COALESCE((v_line->>'discount')::NUMERIC, 0),
      NULLIF(v_line->>'lot_id','')::UUID,
      NULLIF(v_line->>'promotion_id','')::UUID
    );
    v_n_lines := v_n_lines + 1;
  END LOOP;

  IF v_n_lines = 0 THEN
    RAISE EXCEPTION 'Đơn hàng phải có ít nhất 1 dòng sản phẩm.';
  END IF;

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

  SELECT string_agg(t.msg, '; ' ORDER BY t.msg) INTO v_short_msg
  FROM (
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

  -- ─────────────────────────────────────────────────────────────
  -- CHIẾT KHẤU CẤP HOÁ ĐƠN — SERVER TỰ TÍNH.
  -- Voucher và KM cấp đơn KHÔNG cộng dồn (khớp POS: voucher đè KM).
  -- ─────────────────────────────────────────────────────────────
  IF v_vou_id IS NOT NULL THEN
    v_inv_disc := public.fn_voucher_discount_for_order(v_order_id, v_vou_id);
    IF v_inv_disc <= 0 THEN
      RAISE EXCEPTION 'Voucher "%" không đủ điều kiện áp dụng cho đơn này.', v_vou_code;
    END IF;
    UPDATE public.orders SET promotion_id = NULL WHERE id = v_order_id;
  ELSIF v_promo_id IS NOT NULL THEN
    v_inv_disc := public.fn_promo_discount_for_order(v_order_id, v_promo_id);
    IF v_inv_disc <= 0 THEN
      -- KM tự áp ở POS có thể hết hạn/hết lượt giữa chừng → gỡ, KHÔNG chặn bán.
      UPDATE public.orders SET promotion_id = NULL WHERE id = v_order_id;
      v_inv_disc := 0;
    END IF;
  END IF;

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
-- 4b. BÁN NHANH — trả về grand_total & trả ĐỦ theo tổng SERVER tính.
--
--   Vì server có thể ra số giảm KHÁC client (KM vừa hết hạn/hết lượt giữa chừng),
--   tổng đơn thật có thể CAO HƠN số POS đang hiển thị. Nếu vẫn lấy paid_amount do
--   client tính, phần chênh sẽ âm thầm biến thành CÔNG NỢ của khách.
--   → `pay_full = true` (khách trả đủ, không gõ số cụ thể) thì server tự lấy
--     grand_total của chính nó làm số tiền thu.
--   Trả thêm grand_total để POS đối chiếu và cảnh báo nếu lệch.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_quick_sale(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_order_id  UUID;
  v_code      TEXT;
  v_grand     NUMERIC(15,2);
  v_method    order_payment_method := COALESCE((p_payload->>'payment_method')::order_payment_method, 'cash');
  v_paid      NUMERIC := COALESCE((p_payload->>'paid_amount')::NUMERIC, 0);
  v_pay_full  BOOLEAN := COALESCE((p_payload->>'pay_full')::BOOLEAN, false);
  v_overpay   BOOLEAN := COALESCE((p_payload->>'overpay_credit')::BOOLEAN, false);
BEGIN
  PERFORM set_config('app.order_rpc', 'on', true);

  v_order_id := public.fn_pos_build_draft(p_payload, 'pos_quick');

  SELECT grand_total INTO v_grand FROM public.orders WHERE id = v_order_id;

  -- Trả đủ → bám theo tổng SERVER, không theo số client tính từ KM có thể đã hết hạn.
  IF v_pay_full AND v_method <> 'credit' THEN
    v_paid := v_grand;
  END IF;

  UPDATE public.orders
  SET status = 'confirmed', confirmed_by = v_uid
  WHERE id = v_order_id;

  UPDATE public.orders SET status = 'completed' WHERE id = v_order_id;

  PERFORM public.fn_pos_settle_payment(v_order_id, v_paid, v_method, v_overpay);

  SELECT order_code, grand_total INTO v_code, v_grand
  FROM public.orders WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id',    v_order_id,
    'order_code',  v_code,
    'grand_total', v_grand
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_pos_quick_sale(JSONB) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- 5. LƯỢT DÙNG KM — do TRIGGER quản, nằm trong cùng giao dịch với đơn.
--    Thay cho fn_consume_promo_usage (FE gọi rời → có thể lệch).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_promo_usage_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_done      BOOLEAN := NEW.status IN ('completed', 'paid');
  -- Huỷ đơn HOẶC trả hàng toàn bộ → khách không thực sự dùng KM → hoàn lượt.
  -- (Trả một phần vẫn giữ lượt: đơn vẫn có hiệu lực.)
  v_cancelled BOOLEAN := NEW.status IN ('cancelled', 'returned_full');
BEGIN
  IF NEW.promotion_id IS NULL AND NEW.voucher_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Đơn hoàn tất → +1 lượt (chỉ 1 lần duy nhất nhờ cờ promo_usage_counted)
  IF v_done AND NOT NEW.promo_usage_counted THEN
    IF NEW.promotion_id IS NOT NULL THEN
      UPDATE public.promotions
      SET current_uses = current_uses + 1,
          is_active    = CASE WHEN max_uses IS NOT NULL AND current_uses + 1 >= max_uses
                              THEN false ELSE is_active END,
          updated_at   = now()
      WHERE id = NEW.promotion_id;
    END IF;

    IF NEW.voucher_id IS NOT NULL THEN
      UPDATE public.vouchers
      SET current_uses = current_uses + 1,
          is_active    = CASE WHEN current_uses + 1 >= max_uses THEN false ELSE is_active END,
          updated_at   = now()
      WHERE id = NEW.voucher_id;
    END IF;

    NEW.promo_usage_counted := true;

  -- Huỷ đơn đã đếm → trả lại lượt (và bật lại KM nếu nó bị tắt vì chạm trần)
  ELSIF v_cancelled AND NEW.promo_usage_counted THEN
    IF NEW.promotion_id IS NOT NULL THEN
      UPDATE public.promotions
      SET current_uses = GREATEST(current_uses - 1, 0),
          is_active    = CASE WHEN max_uses IS NOT NULL AND current_uses - 1 < max_uses
                              THEN true ELSE is_active END,
          updated_at   = now()
      WHERE id = NEW.promotion_id;
    END IF;

    IF NEW.voucher_id IS NOT NULL THEN
      UPDATE public.vouchers
      SET current_uses = GREATEST(current_uses - 1, 0),
          is_active    = true,
          updated_at   = now()
      WHERE id = NEW.voucher_id;
    END IF;

    NEW.promo_usage_counted := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promo_usage_sync ON public.orders;
CREATE TRIGGER trg_promo_usage_sync
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_promo_usage_sync();

-- FE không còn gọi hàm này; lượt dùng nay do trigger trên lo (atomic với đơn).
DROP FUNCTION IF EXISTS public.fn_consume_promo_usage(UUID, UUID);


-- ─────────────────────────────────────────────────────────────
-- 6. BÁO CÁO HIỆU QUẢ KM (cả KM cấp đơn lẫn KM theo sản phẩm)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_promo_performance(
  p_from DATE DEFAULT (CURRENT_DATE - 30),
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  scope          TEXT,      -- 'order' | 'product'
  promo_id       UUID,
  promo_name     TEXT,
  promo_type     TEXT,
  order_count    BIGINT,
  revenue        NUMERIC,   -- doanh thu các đơn có dùng KM này
  discount_given NUMERIC    -- tiền đã giảm / giá trị quà đã tặng
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_is_active()
     OR NOT (public.fn_is_admin() OR public.fn_has_role('ceo')
             OR public.fn_has_permission('promotions.view')
             OR public.fn_has_permission('promotions.manage')) THEN
    RAISE EXCEPTION 'Không có quyền xem báo cáo khuyến mãi.';
  END IF;

  RETURN QUERY
  -- KM cấp đơn: tiền giảm = discount_total trừ phần CK dòng
  SELECT 'order'::TEXT,
         pr.id,
         pr.name,
         pr.discount_type,
         COUNT(DISTINCT o.id),
         COALESCE(SUM(o.grand_total), 0),
         COALESCE(SUM(o.discount_total
                      - COALESCE((SELECT SUM(ol.discount * ol.quantity)
                                  FROM public.order_lines ol WHERE ol.order_id = o.id), 0)), 0)
  FROM public.orders o
  JOIN public.promotions pr ON pr.id = o.promotion_id
  WHERE o.status IN ('completed', 'paid')
    AND o.created_at::DATE BETWEEN p_from AND p_to
  GROUP BY pr.id, pr.name, pr.discount_type

  UNION ALL

  -- KM sản phẩm: chi phí = CK dòng + giá VỐN của hàng tặng (đơn giá 0 → vẫn tốn kho)
  SELECT 'product'::TEXT,
         pp.id,
         pp.name,
         pp.promo_type,
         COUNT(DISTINCT o.id),
         COALESCE(SUM(ol.line_total), 0),
         COALESCE(SUM(
           ol.discount * ol.quantity
           + CASE WHEN ol.unit_price = 0
                  THEN ol.quantity * COALESCE((
                        SELECT AVG(sl.cost_price) FROM public.stock_lots sl
                        WHERE sl.product_id = ol.product_id AND sl.cost_price > 0), 0)
                  ELSE 0 END
         ), 0)
  FROM public.order_lines ol
  JOIN public.orders o             ON o.id  = ol.order_id
  JOIN public.product_promotions pp ON pp.id = ol.promotion_id
  WHERE o.status IN ('completed', 'paid')
    AND o.created_at::DATE BETWEEN p_from AND p_to
  GROUP BY pp.id, pp.name, pp.promo_type

  ORDER BY 7 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_promo_performance(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_promo_performance(DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
