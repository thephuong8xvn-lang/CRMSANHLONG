-- ============================================================
-- CRM SANHLONGVETCO – GỘP KHÁCH HÀNG TRÙNG (deduplication)
-- File: 20260727000000_customer_merge.sql
-- Mô tả:
--   Công cụ GỘP nhiều bản ghi khách hàng trùng (cùng người, nhiều ID do
--   nhập liệu) về 1 bản CHUẨN — trỏ lại toàn bộ dữ liệu phụ thuộc rồi
--   ẩn mềm bản thừa (giữ vết qua merged_into_id, KHÔNG xóa cứng).
--   Quyết định: winner do UI chọn (mặc định nhiều đơn nhất→cũ nhất);
--   bản thừa is_active=false + merged_into_id.
-- Thứ tự chạy: sau 20260726000000_customer_primary_phone.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Cột truy vết bản đã gộp
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.customers.merged_into_id IS
  'Nếu khác NULL: bản ghi này đã được GỘP vào khách hàng có id = giá trị này (đã ẩn mềm).';

CREATE INDEX IF NOT EXISTS idx_customers_merged_into
  ON public.customers(merged_into_id) WHERE merged_into_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. RPC gộp khách — admin-only, nguyên tử, có audit.
--    SECURITY DEFINER: bỏ RLS để trỏ lại được mọi bảng phụ thuộc.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_merge_customers(p_winner UUID, p_losers UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_losers UUID[];
  v_merged INT := 0;
BEGIN
  -- Chỉ admin được gộp (thao tác phá hủy, ảnh hưởng công nợ/đơn hàng).
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ admin được phép gộp khách hàng.' USING ERRCODE = '42501';
  END IF;

  IF p_winner IS NULL THEN
    RAISE EXCEPTION 'Thiếu bản giữ lại (winner).';
  END IF;

  -- Chuẩn hóa danh sách bản thừa: bỏ NULL, bỏ trùng, loại chính winner.
  SELECT array_agg(DISTINCT x) INTO v_losers
  FROM unnest(p_losers) AS x
  WHERE x IS NOT NULL AND x <> p_winner;

  IF v_losers IS NULL OR array_length(v_losers, 1) = 0 THEN
    RAISE EXCEPTION 'Không có bản thừa hợp lệ để gộp.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_winner) THEN
    RAISE EXCEPTION 'Bản giữ lại không tồn tại.';
  END IF;

  -- Không cho winner là một bản đã bị gộp đi nơi khác (tránh vòng/mâu thuẫn).
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = p_winner AND merged_into_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Bản giữ lại đã bị gộp vào khách khác — chọn bản khác.';
  END IF;

  -- ── 2.1 Trỏ lại các bảng tham chiếu customer_id (RESTRICT + SET NULL + CASCADE)
  UPDATE public.orders                SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.customer_debts        SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.debt_payments         SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.herd_projects         SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.opportunities         SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.quotes                SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.period_statements     SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.cashbook_transactions SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.activities            SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.sales_schedule_slots  SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.vat_pending_sales     SET customer_id = p_winner WHERE customer_id = ANY(v_losers);
  UPDATE public.farms                 SET customer_id = p_winner WHERE customer_id = ANY(v_losers);

  -- ── 2.2 Hai bảng 1:1 (PK = customer_id): nếu winner CHƯA có thì chuyển MỘT
  --        bản của loser sang; phần còn lại bỏ (giữ thông tin của winner làm chuẩn).
  UPDATE public.customer_personal_info
     SET customer_id = p_winner
   WHERE customer_id = (
           SELECT customer_id FROM public.customer_personal_info
           WHERE customer_id = ANY(v_losers) LIMIT 1
         )
     AND NOT EXISTS (SELECT 1 FROM public.customer_personal_info w WHERE w.customer_id = p_winner);
  DELETE FROM public.customer_personal_info WHERE customer_id = ANY(v_losers);

  UPDATE public.customer_business_info
     SET customer_id = p_winner
   WHERE customer_id = (
           SELECT customer_id FROM public.customer_business_info
           WHERE customer_id = ANY(v_losers) LIMIT 1
         )
     AND NOT EXISTS (SELECT 1 FROM public.customer_business_info w WHERE w.customer_id = p_winner);
  DELETE FROM public.customer_business_info WHERE customer_id = ANY(v_losers);

  -- ── 2.3 Liên hệ: chuyển sang winner nhưng KHÔNG để thành primary
  --        (winner giữ liên hệ chính của nó). Tránh vi phạm unique 1-primary/khách.
  UPDATE public.customer_contacts
     SET customer_id = p_winner, is_primary = false
   WHERE customer_id = ANY(v_losers);

  -- Khử liên hệ TRÙNG SỐ trên winner (giữ bản primary, hoặc cũ nhất).
  DELETE FROM public.customer_contacts a
  USING public.customer_contacts b
  WHERE a.customer_id = p_winner AND b.customer_id = p_winner
    AND a.id <> b.id
    AND public.fn_normalize_phone(a.phone) IS NOT NULL
    AND public.fn_normalize_phone(a.phone) = public.fn_normalize_phone(b.phone)
    AND (
      (b.is_primary AND NOT a.is_primary)
      OR (b.is_primary = a.is_primary AND b.created_at < a.created_at)
      OR (b.is_primary = a.is_primary AND b.created_at = a.created_at AND b.id < a.id)
    );

  -- Đảm bảo winner có đúng 1 liên hệ chính.
  IF NOT EXISTS (SELECT 1 FROM public.customer_contacts WHERE customer_id = p_winner AND is_primary) THEN
    UPDATE public.customer_contacts
       SET is_primary = true
     WHERE id = (
       SELECT id FROM public.customer_contacts
       WHERE customer_id = p_winner
       ORDER BY created_at NULLS LAST LIMIT 1
     );
  END IF;

  -- ── 2.4 Ẩn mềm bản thừa + truy vết.
  UPDATE public.customers
     SET is_active = false, merged_into_id = p_winner, updated_at = now()
   WHERE id = ANY(v_losers);
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  -- ── 2.5 Đồng bộ lại SĐT chính của winner (chắc chắn, không phụ thuộc thứ tự trigger).
  UPDATE public.customers c
     SET primary_phone = sub.phone,
         primary_phone_norm = public.fn_normalize_phone(sub.phone)
  FROM (
    SELECT phone FROM public.customer_contacts
    WHERE customer_id = p_winner AND is_primary
    ORDER BY updated_at DESC NULLS LAST LIMIT 1
  ) sub
  WHERE c.id = p_winner;

  -- ── 2.6 Audit.
  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, new_data)
  VALUES (auth.uid(), 'merge_customers', 'customers', p_winner,
          jsonb_build_object('winner', p_winner, 'losers', v_losers, 'merged_count', v_merged));

  RETURN jsonb_build_object('winner', p_winner, 'losers', v_losers, 'merged_count', v_merged);
END;
$$;

COMMENT ON FUNCTION public.fn_merge_customers(UUID, UUID[]) IS
  'Gộp các khách hàng thừa (losers) vào 1 bản chuẩn (winner): trỏ lại mọi FK, gộp liên hệ, ẩn mềm bản thừa. Admin-only, có audit.';

GRANT EXECUTE ON FUNCTION public.fn_merge_customers(UUID, UUID[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. View thành viên các nhóm trùng (member-level) cho UI quản lý.
--    Kèm số đơn/nợ + cờ gợi ý winner (nhiều đơn nhất → cũ nhất).
-- ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.customer_duplicate_members;
CREATE VIEW public.customer_duplicate_members
WITH (security_invoker = true) AS
SELECT
  c.primary_phone_norm,
  c.id,
  c.code,
  c.farm_name,
  c.value_tier,
  c.created_at,
  (SELECT count(*) FROM public.orders o          WHERE o.customer_id = c.id)                          AS order_count,
  (SELECT count(*) FROM public.customer_debts d  WHERE d.customer_id = c.id AND d.is_settled = false) AS open_debt_count,
  (SELECT count(*) FROM public.herd_projects h   WHERE h.customer_id = c.id)                          AS herd_count,
  (row_number() OVER (
     PARTITION BY c.primary_phone_norm
     ORDER BY (SELECT count(*) FROM public.orders o WHERE o.customer_id = c.id) DESC, c.created_at ASC
   ) = 1) AS is_suggested_winner
FROM public.customers c
WHERE c.is_active = true
  AND c.primary_phone_norm IN (SELECT primary_phone_norm FROM public.customer_duplicate_phones);

COMMENT ON VIEW public.customer_duplicate_members IS
  'Thành viên từng nhóm khách trùng SĐT (kèm số đơn/nợ + gợi ý bản giữ). Dùng cho trang gộp khách.';

GRANT SELECT ON public.customer_duplicate_members TO authenticated;
