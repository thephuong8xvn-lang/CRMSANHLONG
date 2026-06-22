-- ============================================================
-- Migration: vat_lots_and_cost
-- File: 20260712000000_vat_lots_and_cost.sql
-- Mục đích: Nền tảng QUẢN LÝ VAT theo LÔ nhập.
--   Đặc thù VN: cùng 1 SP có thể vừa có tồn nhập KÈM hóa đơn VAT (báo cáo
--   thuế), vừa có tồn nhập KHÔNG hóa đơn ("hàng trốn thuế"). Cờ VAT đặt ở
--   cấp LÔ (stock_lots), nguồn từ dòng phiếu nhập (goods_receipt_lines).
--
-- Đối tượng:
--   1. goods_receipt_lines.is_vat / vat_rate  — đánh dấu khi nhập
--   2. stock_lots.is_vat / vat_rate           — propagate khi hoàn thành phiếu
--   3. fn_complete_goods_receipt              — truyền cờ VAT vào lô
--   4. system_settings.vat_config             — markup 7% + 50% thuế DN
--   5. fn_products_list                       — thêm vat_stock / nonvat_stock
--
-- Lưu ý thuế DN: được FE tính SẴN vào unit_price khi nhập (toggle bật/tắt),
--   nên DB chỉ lưu giá nhập cuối (cost_price = unit_price) — migration này
--   chỉ lưu THAM SỐ cấu hình (markup_rate, tax_share) để FE dùng & admin sửa.
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload
--    schema + chèn tracking row vào supabase_migrations.schema_migrations.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Cờ VAT trên dòng phiếu nhập (đặt khi nhập hàng)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.goods_receipt_lines
  ADD COLUMN IF NOT EXISTS is_vat   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0;  -- 0 = không VAT; 5/10 = thuế suất
COMMENT ON COLUMN public.goods_receipt_lines.is_vat IS 'Hàng có hóa đơn VAT (báo cáo thuế) hay không (hàng trốn thuế)';

-- ─────────────────────────────────────────────────────────────
-- 2. Cờ VAT trên lô tồn (propagate từ dòng phiếu khi hoàn thành).
--    Tồn cũ trước migration mặc định = không-VAT (false/0) — hợp lý.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.stock_lots
  ADD COLUMN IF NOT EXISTS is_vat   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.stock_lots.is_vat IS 'Lô hàng thuộc nhóm có VAT (có thể xuất hóa đơn VAT)';

CREATE INDEX IF NOT EXISTS idx_stock_lots_vat ON public.stock_lots(product_id, is_vat) WHERE quantity_on_hand > 0;

-- ─────────────────────────────────────────────────────────────
-- 3. Cấu hình thuế doanh nghiệp (markup tối thiểu + tỷ lệ thuế trên lợi nhuận)
--    giá bán tối thiểu = giá nhập × (1 + markup_rate)
--    thuế DN          = (giá nhập × markup_rate) × tax_share
--    giá nhập mới     = giá nhập × (1 + markup_rate × tax_share)
--    Mặc định 7% & 50% → giá nhập mới = giá nhập × 1,035.
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES ('vat_config', jsonb_build_object(
  'markup_rate', 0.07,   -- markup quy định để ra giá bán tối thiểu
  'tax_share',   0.5     -- thuế DN = 50% lợi nhuận
))
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. HOÀN THÀNH phiếu nhập → SINH TỒN KHO (propagate is_vat / vat_rate).
--    Giữ NGUYÊN mọi hành vi cũ; chỉ thêm 2 cột VAT vào stock_lots.
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
      lot_number, manufacture_date, expiry_date, cost_price, quantity_on_hand,
      is_vat, vat_rate
    ) VALUES (
      v_line.product_id, v_receipt.warehouse_id, v_receipt.supplier_id, p_receipt_id,
      v_lot_no, v_line.manufacture_date, v_line.expiry_date, v_line.unit_price, v_line.quantity,
      v_line.is_vat, v_line.vat_rate
    )
    ON CONFLICT (product_id, lot_number, warehouse_id) DO UPDATE
      SET quantity_on_hand = stock_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
          is_vat           = EXCLUDED.is_vat,
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
-- 5. fn_products_list — thêm vat_stock / nonvat_stock (tách tồn theo VAT).
--    Tôn trọng p_branch_id giống branch_stock; toàn cục = mọi kho.
--    Chỉ THÊM 2 cột, giữ nguyên phân trang/sort/clamp/whitelist.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_products_list(
  p_page        INT  DEFAULT 1,
  p_page_size   INT  DEFAULT 10,
  p_search      TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_brand_id    UUID DEFAULT NULL,
  p_status      TEXT DEFAULT 'active',
  p_branch_id   UUID DEFAULT NULL,
  p_sort_by     TEXT DEFAULT 'created_at',
  p_sort_dir    TEXT DEFAULT 'desc'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page   INT := GREATEST(COALESCE(p_page, 1), 1);
  v_size   INT := LEAST(GREATEST(COALESCE(p_page_size, 10), 1), 5000);
  v_offset INT := 0;
  v_search TEXT;
  v_result JSONB;
BEGIN
  IF p_sort_by NOT IN ('created_at', 'stock') THEN
    RAISE EXCEPTION 'invalid p_sort_by: %', p_sort_by;
  END IF;
  IF p_sort_dir NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'invalid p_sort_dir: %', p_sort_dir;
  END IF;
  IF p_status NOT IN ('active', 'inactive', 'all') THEN
    RAISE EXCEPTION 'invalid p_status: %', p_status;
  END IF;

  v_offset := (v_page - 1) * v_size;
  v_search := NULLIF(TRIM(p_search), '');
  IF v_search IS NOT NULL THEN
    v_search := REPLACE(REPLACE(REPLACE(v_search, '\', '\\'), '%', '\%'), '_', '\_');
  END IF;

  WITH
  branch_stock AS (
    SELECT sl.product_id, COALESCE(SUM(sl.quantity_on_hand), 0)::NUMERIC AS qty
    FROM public.stock_lots sl
    JOIN public.warehouses w ON w.id = sl.warehouse_id
    WHERE p_branch_id IS NOT NULL
      AND w.branch_id = p_branch_id
      AND sl.quantity_on_hand > 0
    GROUP BY sl.product_id
  ),
  branch_orders AS (
    SELECT ol.product_id, COALESCE(SUM(ol.quantity), 0)::NUMERIC AS qty
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE p_branch_id IS NOT NULL
      AND o.branch_id = p_branch_id
      AND o.status IN ('confirmed', 'shipping')
    GROUP BY ol.product_id
  ),
  -- Tách tồn theo VAT (cùng phạm vi chi nhánh với branch_stock; toàn cục = mọi kho)
  vat_split AS (
    SELECT sl.product_id,
      COALESCE(SUM(sl.quantity_on_hand) FILTER (WHERE sl.is_vat),     0)::NUMERIC AS vat_qty,
      COALESCE(SUM(sl.quantity_on_hand) FILTER (WHERE NOT sl.is_vat), 0)::NUMERIC AS nonvat_qty
    FROM public.stock_lots sl
    JOIN public.warehouses w ON w.id = sl.warehouse_id
    WHERE sl.quantity_on_hand > 0
      AND (p_branch_id IS NULL OR w.branch_id = p_branch_id)
    GROUP BY sl.product_id
  ),
  base0 AS (
    SELECT
      v.*,
      CASE WHEN p_branch_id IS NULL THEN v.stock_on_hand::NUMERIC ELSE COALESCE(bs.qty, 0) END AS eff_stock,
      CASE WHEN p_branch_id IS NULL THEN v.on_order_qty::NUMERIC  ELSE COALESCE(bo.qty, 0) END AS eff_on_order,
      COALESCE(vs.vat_qty, 0)    AS vat_stock,
      COALESCE(vs.nonvat_qty, 0) AS nonvat_stock
    FROM public.product_stock_summary_view v
    LEFT JOIN branch_stock  bs ON bs.product_id = v.id
    LEFT JOIN branch_orders bo ON bo.product_id = v.id
    LEFT JOIN vat_split     vs ON vs.product_id = v.id
    WHERE (p_category_id IS NULL OR v.category_id = p_category_id)
      AND (p_brand_id    IS NULL OR v.brand_id    = p_brand_id)
      AND (p_status = 'all' OR v.is_active = (p_status = 'active'))
      AND (v_search IS NULL
           OR v.name ILIKE '%' || v_search || '%'
           OR v.sku  ILIKE '%' || v_search || '%')
  ),
  base AS (
    SELECT
      b.*,
      CASE
        WHEN p_branch_id IS NULL THEN b.days_to_oos
        WHEN COALESCE(b.sold_30d, 0) > 0 AND b.eff_stock > 0
          THEN ROUND(b.eff_stock / (b.sold_30d::NUMERIC / 30.0))::INT
        WHEN b.eff_stock = 0 THEN 0
        ELSE NULL
      END AS eff_days
    FROM base0 b
  ),
  rows_page AS (
    SELECT
      b.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_sort_by = 'stock'      AND p_sort_dir = 'asc'  THEN b.eff_stock  END ASC  NULLS LAST,
          CASE WHEN p_sort_by = 'stock'      AND p_sort_dir = 'desc' THEN b.eff_stock  END DESC NULLS LAST,
          CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN b.created_at END ASC  NULLS LAST,
          b.created_at DESC
      ) AS rn
    FROM base b
    ORDER BY rn
    LIMIT v_size OFFSET v_offset
  ),
  agg AS (
    SELECT
      COUNT(*)                       AS total,
      COALESCE(SUM(eff_stock), 0)    AS total_stock,
      COALESCE(SUM(eff_on_order), 0) AS total_on_order
    FROM base
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      (SELECT jsonb_agg(
          (to_jsonb(r) - 'eff_stock' - 'eff_on_order' - 'eff_days' - 'rn')
          || jsonb_build_object(
               'stock_on_hand', r.eff_stock,
               'on_order_qty',  r.eff_on_order,
               'days_to_oos',   r.eff_days
             )
          ORDER BY r.rn
        )
       FROM rows_page r),
      '[]'::jsonb
    ),
    'total',          (SELECT total          FROM agg),
    'total_stock',    (SELECT total_stock    FROM agg),
    'total_on_order', (SELECT total_on_order FROM agg)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.fn_products_list IS
'Danh sách sản phẩm phân trang + filter + sort + tồn/khách đặt theo chi nhánh + tổng filtered + tách tồn VAT/không-VAT.';

GRANT EXECUTE ON FUNCTION public.fn_products_list(INT, INT, TEXT, UUID, UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
