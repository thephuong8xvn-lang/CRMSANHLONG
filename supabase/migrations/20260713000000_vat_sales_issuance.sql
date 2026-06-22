-- ============================================================
-- Migration: vat_sales_issuance
-- File: 20260713000000_vat_sales_issuance.sql
-- Mục đích: Theo dõi hàng VAT đã bán + xuất/gộp hóa đơn VAT cuối ngày.
--   Phần mềm kế toán là phần mềm khác → CRM chỉ tổng hợp các lần bán hàng
--   thuộc nhóm CÓ VAT để kế toán cuối ngày chọn/gộp → đánh dấu đã xuất hóa
--   đơn (ngày xuất có thể là ngày sau).
--
-- Đối tượng:
--   1. vat_issuances      — đầu phiếu xuất VAT (cho phép gộp nhiều lần bán)
--   2. vat_pending_sales  — mỗi dòng-đơn có phần bán từ lô VAT (pending→issued)
--   3. fn_vat_sync_on_order — trigger AFTER UPDATE: confirmed → ghi pending,
--                             cancelled → gỡ pending chưa xuất
--   4. fn_vat_pending_sales / fn_vat_issue / fn_vat_set_lot — RPC (admin/kế toán)
--
-- Cờ VAT lấy từ stock_lots.is_vat (migration 20260712) qua order_line_allocations.
--
-- ⚠️ Apply remote qua Management API + reload schema + tracking row.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Helper guard: admin / ceo / kế toán (dùng lại nhiều RPC)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_can_manage_vat()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_is_active()
     AND (public.fn_is_admin() OR public.fn_has_role('ceo') OR public.fn_has_role('accountant'));
$$;
GRANT EXECUTE ON FUNCTION public.fn_can_manage_vat() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 1. Đầu phiếu xuất VAT
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vat_issuances (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_no     TEXT,
  issue_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
  buyer_name     TEXT,
  buyer_tax_code TEXT,
  buyer_address  TEXT,
  subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  status         TEXT          NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued')),
  note           TEXT,
  created_by     UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.vat_issuances IS 'Phiếu xuất hóa đơn VAT (có thể gộp nhiều lần bán)';

ALTER TABLE public.vat_issuances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vat_issuances_manage" ON public.vat_issuances;
CREATE POLICY "vat_issuances_manage" ON public.vat_issuances
  FOR ALL USING (public.fn_can_manage_vat()) WITH CHECK (public.fn_can_manage_vat());

-- ─────────────────────────────────────────────────────────────
-- 2. Hàng VAT đã bán, chờ xuất
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vat_pending_sales (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID          NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_line_id UUID          NOT NULL UNIQUE REFERENCES public.order_lines(id) ON DELETE CASCADE,
  product_id    UUID          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity      NUMERIC(15,3) NOT NULL,
  unit_price    NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_rate      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  sold_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  customer_id   UUID          REFERENCES public.customers(id) ON DELETE SET NULL,
  branch_id     UUID,
  status        TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued')),
  issuance_id   UUID          REFERENCES public.vat_issuances(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.vat_pending_sales IS 'Hàng nhóm VAT đã bán (suy từ lô VAT), chờ kế toán xuất hóa đơn';

CREATE INDEX IF NOT EXISTS idx_vat_pending_status_sold ON public.vat_pending_sales(status, sold_at);
CREATE INDEX IF NOT EXISTS idx_vat_pending_issuance    ON public.vat_pending_sales(issuance_id);

ALTER TABLE public.vat_pending_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vat_pending_manage" ON public.vat_pending_sales;
CREATE POLICY "vat_pending_manage" ON public.vat_pending_sales
  FOR ALL USING (public.fn_can_manage_vat()) WITH CHECK (public.fn_can_manage_vat());

-- ─────────────────────────────────────────────────────────────
-- 3. Trigger AFTER UPDATE orders: ghi/gỡ pending theo trạng thái.
--    Chạy SAU trg_orders_auto_stock (BEFORE) nên order_line_allocations đã có.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_vat_sync_on_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF NEW.status = 'confirmed' THEN
    -- Mỗi dòng-đơn: tổng phần phân bổ từ lô CÓ VAT → 1 dòng pending.
    INSERT INTO public.vat_pending_sales
      (order_id, order_line_id, product_id, quantity, unit_price, line_amount,
       vat_rate, sold_at, customer_id, branch_id)
    SELECT
      NEW.id, ol.id, ol.product_id,
      SUM(a.quantity),
      ol.unit_price,
      (ol.unit_price - COALESCE(ol.discount, 0)) * SUM(a.quantity),
      MAX(sl.vat_rate),
      COALESCE(NEW.confirmed_at, now()),
      NEW.customer_id, NEW.branch_id
    FROM public.order_lines ol
    JOIN public.order_line_allocations a ON a.order_line_id = ol.id
    JOIN public.stock_lots sl ON sl.id = a.lot_id AND sl.is_vat
    WHERE ol.order_id = NEW.id
    GROUP BY ol.id, ol.product_id, ol.unit_price, ol.discount
    ON CONFLICT (order_line_id) DO NOTHING;

  ELSIF NEW.status = 'cancelled' THEN
    -- Hủy đơn → gỡ các dòng VAT CHƯA xuất (đã xuất thì giữ, không tự thu hồi).
    DELETE FROM public.vat_pending_sales
    WHERE order_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_vat_sync ON public.orders;
CREATE TRIGGER trg_orders_vat_sync
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_vat_sync_on_order();

-- ─────────────────────────────────────────────────────────────
-- 4a. RPC: danh sách hàng VAT chờ xuất (theo khoảng ngày bán)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_vat_pending_sales(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT public.fn_can_manage_vat() THEN
    RAISE EXCEPTION 'Bạn không có quyền xem danh sách VAT.';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.sold_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      vps.id, vps.order_id, o.order_code,
      vps.order_line_id, vps.product_id, p.name AS product_name,
      vps.quantity, vps.unit_price, vps.line_amount, vps.vat_rate,
      vps.sold_at, vps.customer_id,
      COALESCE(c.farm_name, c.code) AS customer_name,
      vps.status
    FROM public.vat_pending_sales vps
    LEFT JOIN public.orders    o ON o.id = vps.order_id
    LEFT JOIN public.products  p ON p.id = vps.product_id
    LEFT JOIN public.customers c ON c.id = vps.customer_id
    WHERE vps.status = 'pending'
      AND vps.sold_at::date BETWEEN p_from AND p_to
  ) x;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_vat_pending_sales(DATE, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4b. RPC: xuất/gộp hóa đơn VAT cho các dòng pending đã chọn.
--    Tính tổng trong RPC (không tin client). Chỉ gắn dòng đang 'pending'.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_vat_issue(
  p_sale_ids       UUID[],
  p_invoice_no     TEXT,
  p_issue_date     DATE,
  p_buyer_name     TEXT DEFAULT NULL,
  p_buyer_tax_code TEXT DEFAULT NULL,
  p_buyer_address  TEXT DEFAULT NULL,
  p_note           TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_issuance  UUID;
  v_subtotal  NUMERIC(15,2);
  v_vat       NUMERIC(15,2);
  v_count     INT;
BEGIN
  IF NOT public.fn_can_manage_vat() THEN
    RAISE EXCEPTION 'Bạn không có quyền xuất hóa đơn VAT.';
  END IF;
  IF p_sale_ids IS NULL OR array_length(p_sale_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Chưa chọn dòng bán nào để xuất.';
  END IF;

  -- Tổng từ các dòng ĐANG pending trong danh sách chọn
  SELECT COUNT(*),
         COALESCE(SUM(line_amount), 0),
         COALESCE(SUM(ROUND(line_amount * vat_rate / 100.0, 2)), 0)
    INTO v_count, v_subtotal, v_vat
  FROM public.vat_pending_sales
  WHERE id = ANY(p_sale_ids) AND status = 'pending';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Không có dòng pending hợp lệ để xuất (có thể đã xuất trước đó).';
  END IF;

  INSERT INTO public.vat_issuances
    (invoice_no, issue_date, buyer_name, buyer_tax_code, buyer_address,
     subtotal, vat_amount, total, status, note, created_by)
  VALUES
    (NULLIF(btrim(p_invoice_no), ''), COALESCE(p_issue_date, CURRENT_DATE),
     p_buyer_name, p_buyer_tax_code, p_buyer_address,
     v_subtotal, v_vat, v_subtotal + v_vat, 'issued', p_note, v_uid)
  RETURNING id INTO v_issuance;

  UPDATE public.vat_pending_sales
    SET status = 'issued', issuance_id = v_issuance
    WHERE id = ANY(p_sale_ids) AND status = 'pending';

  RETURN v_issuance;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_vat_issue(UUID[], TEXT, DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4c. RPC: đính chính cờ VAT của 1 lô (admin/kế toán)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_vat_set_lot(p_lot_id UUID, p_is_vat BOOLEAN, p_vat_rate NUMERIC DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_can_manage_vat() THEN
    RAISE EXCEPTION 'Bạn không có quyền sửa cờ VAT của lô.';
  END IF;
  UPDATE public.stock_lots
    SET is_vat = p_is_vat,
        vat_rate = CASE WHEN p_is_vat THEN COALESCE(p_vat_rate, 0) ELSE 0 END,
        updated_at = now()
    WHERE id = p_lot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy lô.'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_vat_set_lot(UUID, BOOLEAN, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
