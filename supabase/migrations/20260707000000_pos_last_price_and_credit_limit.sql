-- ============================================================
-- Migration: POS vòng 4 — gợi ý giá bán gần nhất + sửa hạn mức nợ tại quầy
-- File: 20260707000000_pos_last_price_and_credit_limit.sql
-- Mô tả:
--   1. fn_pos_last_sold_prices: trả GIÁ BÁN GẦN NHẤT của 1 KH cho danh sách SP.
--      SECURITY DEFINER để bỏ RLS orders (sales chỉ thấy đơn của mình) — chỉ ĐỌC,
--      phạm vi đúng 1 customer_id mà thu ngân đang bán. Không đổi schema.
--   2. fn_pos_set_credit_limit: cho thu ngân (mọi nhân viên active) set hạn mức nợ
--      cho BẤT KỲ KH (user chốt: tiện thao tác khi KH chưa có hạn mức → không bán
--      được). Bỏ RLS qua SECURITY DEFINER nhưng GHI AUDIT (ai/khi nào/cũ→mới) để
--      truy vết tự-duyệt-nợ.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Giá bán gần nhất của KH cho từng SP (DISTINCT ON product)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_last_sold_prices(
  p_customer_id uuid,
  p_product_ids uuid[]
)
RETURNS TABLE(product_id uuid, unit_price numeric, discount numeric, sold_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Chỉ nhân viên đang hoạt động mới được tra cứu lịch sử giá.
  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Không có quyền truy cập.' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NULL OR p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ol.product_id)
    ol.product_id,
    ol.unit_price,
    ol.discount,
    o.created_at
  FROM public.order_lines ol
  JOIN public.orders o ON o.id = ol.order_id
  WHERE o.customer_id = p_customer_id
    AND o.status <> 'cancelled'
    AND ol.product_id = ANY(p_product_ids)
  ORDER BY ol.product_id, o.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.fn_pos_last_sold_prices(uuid, uuid[]) IS
  'POS: giá bán gần nhất của 1 KH cho danh sách SP (đọc, bỏ RLS orders, guard fn_is_active).';

GRANT EXECUTE ON FUNCTION public.fn_pos_last_sold_prices(uuid, uuid[]) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. Set hạn mức nợ tại POS (mọi NV active — bỏ RLS, có audit)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pos_set_credit_limit(
  p_customer_id uuid,
  p_credit_limit numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Không có quyền.' USING ERRCODE = '42501';
  END IF;

  IF p_credit_limit IS NULL OR p_credit_limit < 0 THEN
    RAISE EXCEPTION 'Hạn mức nợ không hợp lệ (phải ≥ 0).' USING ERRCODE = '22023';
  END IF;

  SELECT credit_limit INTO v_old
  FROM public.customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy khách hàng.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.customers
  SET credit_limit = p_credit_limit,
      updated_at   = now()
  WHERE id = p_customer_id;

  -- Audit bất biến: truy vết thay đổi hạn mức nợ từ POS.
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_uid,
    'UPDATE',
    'customers',
    p_customer_id,
    jsonb_build_object('credit_limit', v_old),
    jsonb_build_object('credit_limit', p_credit_limit, 'source', 'pos_set_credit_limit')
  );

  RETURN p_credit_limit;
END;
$$;

COMMENT ON FUNCTION public.fn_pos_set_credit_limit(uuid, numeric) IS
  'POS: set hạn mức nợ cho bất kỳ KH (bỏ RLS, guard fn_is_active, ghi audit_logs).';

GRANT EXECUTE ON FUNCTION public.fn_pos_set_credit_limit(uuid, numeric) TO authenticated;
