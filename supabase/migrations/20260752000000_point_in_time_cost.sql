-- ============================================================
-- Migration: point_in_time_cost
-- File: 20260752000000_point_in_time_cost.sql
--
-- NGUYÊN TẮC (user chốt 2026-08-03):
--   "Xuất hoặc bán hoặc trả tại thời điểm nào đều có giá vốn thời điểm đó."
--   → giá vốn của một chuyển động kho được CHỤP LẠI lúc phát sinh, không
--     bao giờ đi đọc lại giá hiện hành của lô.
--   "Cùng lô thì bình quân, khác lô là 2 dòng riêng."
--   → gộp lô phải bình quân gia quyền; khác lô giữ nguyên 2 dòng.
--
-- 4 LỖI ĐANG SỬA
--
-- 1. NHẬP HÀNG CÙNG LÔ KHÔNG BÌNH QUÂN.
--    Mọi chỗ upsert stock_lots (từ 20260522 tới 20260715) đều bỏ cost_price
--    khỏi ON CONFLICT DO UPDATE → số lượng cộng dồn, giá vốn giữ nguyên của
--    dòng được xử lý TRƯỚC. Chính sách "bán 10 tặng 3" cùng lô:
--      · thực chi 1.000.000₫ / 13 SP → giá vốn đúng 76.923₫
--      · code ghi lô 13 SP @100.000₫ → giá trị tồn thổi lên 1.300.000₫
--    Vòng lặp dòng phiếu lại KHÔNG có ORDER BY → nếu dòng 0₫ chạy trước thì
--    cả lô thành giá vốn 0 → biên lợi nhuận 100% ảo. Sửa một dòng phiếu là
--    thứ tự vật lý đổi, giá vốn lô lật ngược.
--
-- 2. COGS ĐỌC GIÁ LÔ HIỆN TẠI, KHÔNG PHẢI GIÁ LÚC BÁN.
--    v_order_line_profit tính SUM(ola.quantity * sl.cost_price). Mà cost_price
--    bị sửa về sau bởi: nhận chuyển kho (bình quân gia quyền — ĐÚNG cho tồn
--    tương lai), admin sửa lô, nhập thêm cùng lô. Hệ quả: chuyển kho hôm nay
--    làm đổi lợi nhuận tháng trước; báo cáo in 2 lần ra 2 số.
--    stock_movements.unit_cost ("Giá vốn tại thời điểm xuất") đã có sẵn từ
--    init_schema nhưng đường BÁN không hề ghi vào.
--
-- 3. HÀNG TRẢ KHÔNG QUY VỀ THỜI ĐIỂM BÁN.
--    · lấy cost_price hiện tại của lô gốc thay vì giá lúc bán
--    · nhập lại vào lô đích bằng phép CỘNG SỐ LƯỢNG TRẦN, không bình quân
--      → cộng hàng vào lô có giá vốn khác hẳn, giá trị tồn sai
--    · ghi v_line.unit_price (GIÁ BÁN) vào cột unit_cost (GIÁ VỐN)
--
-- 4. PHIẾU NHẬP 0₫ XOÁ GIÁ VỐN BẢNG GIÁ.
--    UPDATE price_list_items SET cost_price = unit_price WHERE product_id=...
--    chạy trong vòng lặp → dòng CUỐI thắng. Hàng tặng 0₫ đi cuối phiếu là
--    giá vốn mọi bảng giá của SP về 0. Đây là nguồn "giá vốn dự phòng" khi
--    dòng bán không phân bổ được lô.
--
-- ⚠️ KHÔNG SỬA LỊCH SỬ. Backfill unit_cost = cost_price hiện tại của lô, nên
--    ngay sau migration MỌI BÁO CÁO GIỮ NGUYÊN SỐ. Từ đây trở đi số đóng
--    băng. Các lô đã gộp sai giá vốn trước đó vẫn sai — tính lại là quyết
--    định riêng, xem file kiểm chứng đi kèm.
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload
--    schema + chèn tracking row vào supabase_migrations.schema_migrations.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. CHỤP GIÁ VỐN TẠI THỜI ĐIỂM PHÂN BỔ
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.order_line_allocations
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,2);

COMMENT ON COLUMN public.order_line_allocations.unit_cost IS
  'Giá vốn của lô TẠI THỜI ĐIỂM trừ kho. Bất biến — không đổi khi lô được bình quân lại về sau.';

-- Backfill: nguồn tốt nhất còn lại là giá lô hiện tại (đường bán chưa từng
-- ghi stock_movements.unit_cost nên không truy ngược được giá thật lúc bán).
-- Chủ ý: giữ nguyên con số báo cáo đang hiển thị, chỉ đóng băng từ nay.
UPDATE public.order_line_allocations ola
SET    unit_cost = sl.cost_price
FROM   public.stock_lots sl
WHERE  sl.id = ola.lot_id
  AND  ola.unit_cost IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. NHẬP HÀNG: BÌNH QUÂN GIA QUYỀN KHI TRÙNG LÔ
--    Thay đổi so với 20260715:
--      · ON CONFLICT nay bình quân cost_price theo số lượng
--      · vòng lặp có ORDER BY created_at, id → hết phụ thuộc thứ tự vật lý
--      · đồng bộ bảng giá bỏ qua dòng 0₫ (hàng tặng không xoá giá vốn)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_complete_goods_receipt(p_receipt_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt  RECORD;
  v_line     RECORD;
  v_uid      UUID := auth.uid();
  v_all_recv BOOLEAN;
  v_lot_id   UUID;
  v_lot_no   TEXT;
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

  -- ORDER BY: kết quả không được phụ thuộc thứ tự vật lý của heap.
  FOR v_line IN
    SELECT * FROM public.goods_receipt_lines
    WHERE receipt_id = p_receipt_id
    ORDER BY created_at, id
  LOOP
    v_lot_no := COALESCE(v_line.lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MISS'));

    INSERT INTO public.stock_lots (
      product_id, warehouse_id, supplier_id, receipt_id,
      lot_number, manufacture_date, expiry_date, cost_price, quantity_on_hand,
      is_vat, vat_rate
    ) VALUES (
      v_line.product_id, v_receipt.warehouse_id, v_receipt.supplier_id, p_receipt_id,
      v_lot_no, v_line.manufacture_date, v_line.expiry_date, v_line.unit_price, v_line.quantity,
      v_line.is_vat, v_line.vat_rate
    )
    -- Khóa gồm is_vat: VAT và non-VAT của cùng lô là 2 dòng riêng.
    -- TRÙNG LÔ → BÌNH QUÂN GIA QUYỀN theo tồn hiện có (bình quân di động).
    -- Lô đã bán hết (tồn 0) thì công thức tự cho ra giá của lần nhập mới.
    ON CONFLICT (product_id, lot_number, warehouse_id, is_vat) DO UPDATE
      SET cost_price = CASE
            WHEN (GREATEST(stock_lots.quantity_on_hand, 0) + EXCLUDED.quantity_on_hand) > 0
              THEN ROUND(
                     ( GREATEST(stock_lots.quantity_on_hand, 0) * stock_lots.cost_price
                     + EXCLUDED.quantity_on_hand * EXCLUDED.cost_price )
                     / ( GREATEST(stock_lots.quantity_on_hand, 0) + EXCLUDED.quantity_on_hand ), 2)
            ELSE EXCLUDED.cost_price
          END,
          quantity_on_hand = stock_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
          vat_rate         = EXCLUDED.vat_rate,
          updated_at       = now()
    RETURNING id INTO v_lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type, quantity,
      reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_lot_id, v_line.product_id, v_receipt.warehouse_id, 'receipt', v_line.quantity,
      p_receipt_id, 'goods_receipt', v_line.unit_price, COALESCE(v_receipt.received_by, v_uid)
    );

    -- Đồng bộ giá vốn bảng giá — BỎ QUA dòng 0₫ (hàng tặng theo chính sách
    -- "bán 10 tặng 3" không được phép xoá giá vốn của sản phẩm).
    IF COALESCE(v_line.unit_price, 0) > 0 THEN
      UPDATE public.price_list_items
        SET cost_price = v_line.unit_price
        WHERE product_id = v_line.product_id;
    END IF;

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
GRANT EXECUTE ON FUNCTION public.fn_complete_goods_receipt(UUID) TO authenticated;

-- fn_create_stock_lot_on_receipt: trigger CŨ đã gỡ khỏi goods_receipt_lines
-- (20260715 mục 5). Vá cùng công thức để không thành mìn ngầm nếu gắn lại.
CREATE OR REPLACE FUNCTION public.fn_create_stock_lot_on_receipt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt RECORD;
  v_lot_no  TEXT := COALESCE(NEW.lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MISS'));
BEGIN
  SELECT supplier_id, warehouse_id, received_by
  INTO v_receipt
  FROM public.goods_receipts
  WHERE id = NEW.receipt_id;

  INSERT INTO public.stock_lots (
    product_id, warehouse_id, supplier_id, receipt_id,
    lot_number, manufacture_date, expiry_date,
    cost_price, quantity_on_hand, is_vat, vat_rate
  )
  VALUES (
    NEW.product_id, v_receipt.warehouse_id, v_receipt.supplier_id, NEW.receipt_id,
    v_lot_no, NEW.manufacture_date, NEW.expiry_date,
    NEW.unit_price, NEW.quantity, NEW.is_vat, NEW.vat_rate
  )
  ON CONFLICT (product_id, lot_number, warehouse_id, is_vat) DO UPDATE
    SET cost_price = CASE
          WHEN (GREATEST(stock_lots.quantity_on_hand, 0) + EXCLUDED.quantity_on_hand) > 0
            THEN ROUND(
                   ( GREATEST(stock_lots.quantity_on_hand, 0) * stock_lots.cost_price
                   + EXCLUDED.quantity_on_hand * EXCLUDED.cost_price )
                   / ( GREATEST(stock_lots.quantity_on_hand, 0) + EXCLUDED.quantity_on_hand ), 2)
          ELSE EXCLUDED.cost_price
        END,
        quantity_on_hand = stock_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
        vat_rate         = EXCLUDED.vat_rate,
        updated_at       = now();

  INSERT INTO public.stock_movements (
    lot_id, product_id, warehouse_id,
    movement_type, quantity,
    reference_id, reference_type,
    unit_cost, performed_by
  )
  SELECT
    sl.id, NEW.product_id, v_receipt.warehouse_id,
    'receipt', NEW.quantity,
    NEW.receipt_id, 'goods_receipt',
    NEW.unit_price, v_receipt.received_by
  FROM public.stock_lots sl
  WHERE sl.product_id   = NEW.product_id
    AND sl.lot_number   = v_lot_no
    AND sl.warehouse_id = v_receipt.warehouse_id
    AND sl.is_vat       = NEW.is_vat;

  IF COALESCE(NEW.unit_price, 0) > 0 THEN
    UPDATE public.price_list_items
    SET cost_price = NEW.unit_price
    WHERE product_id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. BÁN HÀNG: GHI GIÁ VỐN TẠI THỜI ĐIỂM TRỪ KHO
--    Giữ NGUYÊN toàn bộ logic 20260706 (lô chọn tay → trừ đúng lô;
--    không chọn → FEFO; soft/hard; oversell log). Chỉ thêm chụp giá vốn
--    vào order_line_allocations.unit_cost và stock_movements.unit_cost.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_stock_on_order_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line        RECORD;
  v_alloc       RECORD;
  v_warehouse   UUID;
  v_mode        TEXT;
  v_channel     TEXT;
  v_available   NUMERIC(15,3);
  v_allocatable NUMERIC(15,3);
  v_lot_cost    NUMERIC(15,2);
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;

  v_warehouse := NEW.warehouse_id;
  v_mode      := public.fn_stock_control_mode();
  v_channel   := NEW.sale_channel;

  FOR v_line IN
    SELECT ol.id AS line_id, ol.product_id, ol.quantity, ol.lot_id
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

    -- ── (b1) DÒNG CÓ LÔ CHỌN SẴN → trừ ĐÚNG lô đó (không FEFO) ──
    IF v_line.lot_id IS NOT NULL THEN
      SELECT (quantity_on_hand - quantity_reserved), cost_price
        INTO v_available, v_lot_cost
      FROM public.stock_lots WHERE id = v_line.lot_id FOR UPDATE;

      IF v_available IS NULL THEN
        IF v_mode = 'hard' THEN
          RAISE EXCEPTION 'Lô bán không tồn tại (SP %).', v_line.product_id;
        END IF;
        INSERT INTO public.stock_oversell_log
          (order_id, order_line_id, product_id, warehouse_id, requested, available, shortfall, sale_channel, created_by)
        VALUES
          (NEW.id, v_line.line_id, v_line.product_id, v_warehouse, v_line.quantity, 0, v_line.quantity, v_channel, COALESCE(NEW.confirmed_by, auth.uid()));
        CONTINUE;
      END IF;

      IF v_available < v_line.quantity THEN
        IF v_mode = 'hard' THEN
          RAISE EXCEPTION 'Lô bán không đủ tồn cho SP %: cần %, còn %.',
            v_line.product_id, v_line.quantity, v_available;
        END IF;
        INSERT INTO public.stock_oversell_log
          (order_id, order_line_id, product_id, warehouse_id, requested, available, shortfall, sale_channel, created_by)
        VALUES
          (NEW.id, v_line.line_id, v_line.product_id, v_warehouse, v_line.quantity, v_available,
           v_line.quantity - v_available, v_channel, COALESCE(NEW.confirmed_by, auth.uid()));
        v_allocatable := GREATEST(v_available, 0);
      ELSE
        v_allocatable := v_line.quantity;
      END IF;

      IF v_allocatable > 0 THEN
        INSERT INTO public.order_line_allocations (order_line_id, lot_id, quantity, unit_cost)
        VALUES (v_line.line_id, v_line.lot_id, v_allocatable, COALESCE(v_lot_cost, 0));

        INSERT INTO public.stock_movements
          (lot_id, product_id, warehouse_id, movement_type, quantity,
           reference_id, reference_type, unit_cost, performed_by)
        VALUES
          (v_line.lot_id, v_line.product_id, v_warehouse, 'sale', -v_allocatable,
           NEW.id, 'order', COALESCE(v_lot_cost, 0), COALESCE(NEW.confirmed_by, auth.uid()));

        UPDATE public.stock_lots
        SET quantity_on_hand = quantity_on_hand - v_allocatable,
            updated_at       = now()
        WHERE id = v_line.lot_id;
      END IF;

      CONTINUE;  -- xong dòng có lô
    END IF;

    -- ── (b2) DÒNG KHÔNG LÔ → FEFO như cũ ──
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
      INSERT INTO public.stock_oversell_log
        (order_id, order_line_id, product_id, warehouse_id, requested, available, shortfall, sale_channel, created_by)
      VALUES
        (NEW.id, v_line.line_id, v_line.product_id, v_warehouse, v_line.quantity, v_available,
         v_line.quantity - v_available, v_channel, COALESCE(NEW.confirmed_by, auth.uid()));
      v_allocatable := GREATEST(v_available, 0);
    ELSE
      v_allocatable := v_line.quantity;
    END IF;

    IF v_allocatable > 0 THEN
      FOR v_alloc IN
        SELECT * FROM public.fn_allocate_lots_fefo(v_line.product_id, v_warehouse, v_allocatable)
      LOOP
        SELECT cost_price INTO v_lot_cost
        FROM public.stock_lots WHERE id = v_alloc.lot_id;

        INSERT INTO public.order_line_allocations (order_line_id, lot_id, quantity, unit_cost)
        VALUES (v_line.line_id, v_alloc.lot_id, v_alloc.allocated_qty, COALESCE(v_lot_cost, 0));

        INSERT INTO public.stock_movements
          (lot_id, product_id, warehouse_id, movement_type, quantity,
           reference_id, reference_type, unit_cost, performed_by)
        VALUES
          (v_alloc.lot_id, v_line.product_id, v_warehouse, 'sale', -v_alloc.allocated_qty,
           NEW.id, 'order', COALESCE(v_lot_cost, 0), COALESCE(NEW.confirmed_by, auth.uid()));

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

-- ─────────────────────────────────────────────────────────────
-- 4. BÁO CÁO ĐỌC GIÁ VỐN ĐÃ CHỤP
--    COALESCE(ola.unit_cost, sl.cost_price): dòng cũ chưa backfill vẫn chạy.
--    Thêm cột unalloc_qty = SL bán KHÔNG truy được lô → phân biệt
--    "giá vốn 0 thật" (hàng tặng) với "không biết giá vốn" (thiếu dữ liệu).
-- ─────────────────────────────────────────────────────────────
-- CREATE OR REPLACE (không DROP): cột mới chỉ THÊM VÀO CUỐI nên thay được
-- tại chỗ, giữ nguyên quyền đã REVOKE và không đụng consumer nào.
CREATE OR REPLACE VIEW public.v_order_line_profit AS
WITH alloc AS (
  SELECT ola.order_line_id,
         SUM(ola.quantity) AS alloc_qty,
         SUM(ola.quantity * COALESCE(ola.unit_cost, sl.cost_price)) AS alloc_cogs
  FROM public.order_line_allocations ola
  JOIN public.stock_lots sl ON sl.id = ola.lot_id
  GROUP BY ola.order_line_id
)
SELECT
  ol.id AS order_line_id, o.id AS order_id,
  o.created_at, o.status, o.customer_id, o.branch_id,
  ol.product_id, p.brand_id, ol.quantity, ol.line_total AS revenue,
  (COALESCE(a.alloc_cogs, 0)
   + GREATEST(ol.quantity - COALESCE(a.alloc_qty, 0), 0) * COALESCE(pss.retail_cost, 0)
  )::NUMERIC(15,2) AS cogs,
  GREATEST(ol.quantity - COALESCE(a.alloc_qty, 0), 0)::NUMERIC(15,3) AS unalloc_qty
FROM public.order_lines ol
JOIN public.orders o ON o.id = ol.order_id
JOIN public.products p ON p.id = ol.product_id
LEFT JOIN alloc a ON a.order_line_id = ol.id
LEFT JOIN public.product_stock_summary_view pss ON pss.id = ol.product_id
WHERE o.status IN ('confirmed', 'shipping', 'delivered', 'paid', 'completed');

REVOKE ALL ON public.v_order_line_profit FROM PUBLIC, anon, authenticated;
COMMENT ON VIEW public.v_order_line_profit IS
  'Lợi nhuận cấp dòng đơn. COGS = Σ(SL × giá vốn CHỤP LÚC BÁN) + phần chưa phân bổ × giá vốn hiện hành. Chỉ truy cập qua RPC báo cáo (admin-only).';

CREATE OR REPLACE VIEW public.v_order_line_profit_ext AS
WITH alloc AS (
  SELECT ola.order_line_id,
         SUM(ola.quantity) AS alloc_qty,
         SUM(ola.quantity * COALESCE(ola.unit_cost, sl.cost_price)) AS alloc_cogs
  FROM public.order_line_allocations ola
  JOIN public.stock_lots sl ON sl.id = ola.lot_id
  GROUP BY ola.order_line_id
)
SELECT
  ol.id AS order_line_id, o.id AS order_id,
  o.created_at, o.status, o.customer_id, o.branch_id,
  ol.product_id, p.brand_id, ol.quantity, ol.line_total AS revenue,
  (COALESCE(a.alloc_cogs, 0)
   + GREATEST(ol.quantity - COALESCE(a.alloc_qty, 0), 0) * COALESCE(pss.retail_cost, 0)
  )::NUMERIC(15,2) AS cogs,
  GREATEST(ol.quantity - COALESCE(a.alloc_qty, 0), 0)::NUMERIC(15,3) AS unalloc_qty
FROM public.order_lines ol
JOIN public.orders o ON o.id = ol.order_id
JOIN public.products p ON p.id = ol.product_id
LEFT JOIN alloc a ON a.order_line_id = ol.id
LEFT JOIN public.product_stock_summary_view pss ON pss.id = ol.product_id
WHERE o.status IN ('confirmed', 'shipping', 'delivered', 'paid', 'completed',
                   'returned_partial', 'returned_full');

REVOKE ALL ON public.v_order_line_profit_ext FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. HÀNG TRẢ: QUY GIÁ VỐN VỀ THỜI ĐIỂM BÁN
--    Giữ NGUYÊN toàn bộ phần công nợ (3b) và trạng thái đơn (3c) của
--    20260715. Chỉ đổi khối hồi kho (3a):
--      · giá vốn hàng trả = giá vốn đã chụp lúc bán chính dòng đơn đó
--      · nhập lại vào lô đích bằng BÌNH QUÂN GIA QUYỀN, không cộng trần
--      · stock_movements.unit_cost nhận GIÁ VỐN, không phải giá bán
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sales_return_apply_effects(p_return_id uuid, p_apply_debt boolean DEFAULT true)
RETURNS void
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
  v_ret_cost      NUMERIC(15,2);
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

      -- GIÁ VỐN TẠI THỜI ĐIỂM BÁN của chính dòng đơn bị trả.
      -- Ưu tiên đúng lô nếu dòng trả chỉ đích danh một lô; nếu không thì
      -- bình quân gia quyền các lô đã xuất cho dòng đơn đó.
      v_ret_cost := NULL;
      IF v_line.lot_id IS NOT NULL THEN
        SELECT COALESCE(ola.unit_cost, sl.cost_price) INTO v_ret_cost
        FROM public.order_line_allocations ola
        JOIN public.stock_lots sl ON sl.id = ola.lot_id
        WHERE ola.order_line_id = v_line.order_line_id
          AND ola.lot_id = v_line.lot_id
        LIMIT 1;
      END IF;
      IF v_ret_cost IS NULL THEN
        SELECT SUM(ola.quantity * COALESCE(ola.unit_cost, sl.cost_price))
               / NULLIF(SUM(ola.quantity), 0)
          INTO v_ret_cost
        FROM public.order_line_allocations ola
        JOIN public.stock_lots sl ON sl.id = ola.lot_id
        WHERE ola.order_line_id = v_line.order_line_id;
      END IF;

      v_has_orig_lot := false;
      IF v_lot_id IS NOT NULL THEN
        SELECT lot_number, manufacture_date, expiry_date, cost_price, status, warehouse_id, is_vat, vat_rate
        INTO v_orig_lot FROM public.stock_lots WHERE id = v_lot_id;
        v_has_orig_lot := FOUND;
      END IF;

      -- Chưa truy được giá lúc bán (đơn cũ không có phân bổ) → giá lô gốc.
      v_ret_cost := COALESCE(v_ret_cost,
                             CASE WHEN v_has_orig_lot THEN v_orig_lot.cost_price END);

      v_target_wh := COALESCE(v_target_wh,
        CASE WHEN v_has_orig_lot THEN v_orig_lot.warehouse_id END);
      IF v_target_wh IS NULL THEN
        RAISE EXCEPTION 'Phiếu trả %: không xác định được kho nhận hàng trả.', v_sr.return_code;
      END IF;

      IF v_has_orig_lot THEN
        -- Tìm/tạo lô cùng số lô + cùng trạng thái VAT tại kho nhận
        SELECT id INTO v_target_lot_id FROM public.stock_lots
        WHERE product_id = v_line.product_id
          AND lot_number = v_orig_lot.lot_number
          AND warehouse_id = v_target_wh
          AND is_vat = v_orig_lot.is_vat;

        IF v_target_lot_id IS NULL THEN
          INSERT INTO public.stock_lots (
            product_id, warehouse_id, lot_number, manufacture_date, expiry_date,
            cost_price, quantity_on_hand, status, notes, is_vat, vat_rate
          ) VALUES (
            v_line.product_id, v_target_wh, v_orig_lot.lot_number,
            v_orig_lot.manufacture_date, v_orig_lot.expiry_date,
            COALESCE(v_ret_cost, v_orig_lot.cost_price, 0), 0, v_orig_lot.status,
            'Tạo khi nhận hàng trả ' || v_sr.return_code,
            v_orig_lot.is_vat, v_orig_lot.vat_rate
          ) RETURNING id INTO v_target_lot_id;
        END IF;
      ELSE
        -- Không truy được lô gốc: nhận vào lô active gần nhất của SP tại kho,
        -- nếu không có thì tạo lô RETURN-<mã phiếu> (mặc định non-VAT).
        SELECT id INTO v_target_lot_id FROM public.stock_lots
        WHERE product_id = v_line.product_id AND warehouse_id = v_target_wh
          AND status = 'active'
        ORDER BY received_at DESC LIMIT 1;

        IF v_target_lot_id IS NULL THEN
          INSERT INTO public.stock_lots (
            product_id, warehouse_id, lot_number, cost_price, quantity_on_hand, status, notes
          ) VALUES (
            v_line.product_id, v_target_wh, 'RETURN-' || v_sr.return_code,
            COALESCE(v_ret_cost,
                     (SELECT cost_price FROM public.stock_lots
                      WHERE product_id = v_line.product_id AND warehouse_id = v_target_wh
                      ORDER BY received_at DESC LIMIT 1), 0),
            0, 'active', 'Tạo khi nhận hàng trả ' || v_sr.return_code || ' (không truy được lô gốc)'
          ) RETURNING id INTO v_target_lot_id;
        END IF;
      END IF;

      -- Nhập lại kho: BÌNH QUÂN GIA QUYỀN giá vốn lúc bán vào lô đích.
      -- Không biết giá lúc bán thì giữ nguyên giá lô (chỉ cộng số lượng).
      UPDATE public.stock_lots
      SET cost_price = CASE
            WHEN v_ret_cost IS NULL THEN cost_price
            WHEN (GREATEST(quantity_on_hand, 0) + v_line.quantity) > 0
              THEN ROUND(
                     ( GREATEST(quantity_on_hand, 0) * cost_price
                     + v_line.quantity * v_ret_cost )
                     / ( GREATEST(quantity_on_hand, 0) + v_line.quantity ), 2)
            ELSE cost_price
          END,
          quantity_on_hand = quantity_on_hand + v_line.quantity,
          updated_at = now()
      WHERE id = v_target_lot_id;

      INSERT INTO public.stock_movements (
        lot_id, product_id, warehouse_id, movement_type, quantity,
        reference_id, reference_type, unit_cost, performed_by
      ) VALUES (
        v_target_lot_id, v_line.product_id, v_target_wh, 'return_from_customer',
        v_line.quantity, p_return_id, 'sales_return', COALESCE(v_ret_cost, 0), v_performer
      );
    END LOOP;
  END IF;

  -- ── 3b. TRỪ CÔNG NỢ (credit_note) — FIFO như fn_collect_customer_debt ──
  IF p_apply_debt
     AND v_sr.refund_method = 'credit_note'
     AND COALESCE(v_sr.total_amount, 0) > 0
     AND COALESCE(v_sr.debt_offset_total, 0) = 0 THEN   -- idempotent

    v_remaining := v_sr.total_amount;

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

    IF v_remaining > 0 THEN
      INSERT INTO public.customer_debts (
        customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by
      ) VALUES (
        v_order.customer_id, v_sr.order_id, 'advance_from_customer', -v_remaining, NULL, false,
        'Khách trả trước (trả hàng ' || v_sr.return_code || ' vượt công nợ)', v_performer
      );
      v_offset_total := v_offset_total + v_remaining;
    END IF;

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

NOTIFY pgrst, 'reload schema';
