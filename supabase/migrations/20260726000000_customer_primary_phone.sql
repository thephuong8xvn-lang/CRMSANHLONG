-- ============================================================
-- CRM SANHLONGVETCO – CUSTOMER PRIMARY PHONE (denormalize + search)
-- File: 20260726000000_customer_primary_phone.sql
-- Mô tả:
--   Denormalize SĐT của liên hệ CHÍNH (customer_contacts.is_primary)
--   lên bảng customers để:
--     1) POS / Danh sách KH tìm khách theo SĐT (trước đây KHÔNG tìm được).
--     2) Tìm server-side nhanh nhờ index gin_trgm trên SĐT đã chuẩn hóa.
--     3) Phát hiện khách TRÙNG SĐT (báo cáo audit) — chuẩn bị làm sạch dữ liệu.
--   Đồng bộ tự động bằng trigger trên customer_contacts.
--   KHÔNG ràng buộc UNIQUE cứng (dữ liệu hiện còn số ghép phẩy / dính CCCD)
--   → chống trùng ở tầng app + báo cáo audit thay cho constraint.
-- Thứ tự chạy: sau 20260725000000_permission_catalog_matrix.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Cột denormalize trên customers
--    primary_phone      : SĐT thô của liên hệ chính (hiển thị).
--    primary_phone_norm : chỉ chữ số, đã tách số đầu + chuẩn hóa +84→0
--                         (dùng để TÌM KIẾM & phát hiện trùng).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS primary_phone      TEXT,
  ADD COLUMN IF NOT EXISTS primary_phone_norm TEXT;

COMMENT ON COLUMN public.customers.primary_phone IS
  'SĐT thô của liên hệ chính (customer_contacts.is_primary). Đồng bộ bằng trigger.';
COMMENT ON COLUMN public.customers.primary_phone_norm IS
  'SĐT liên hệ chính đã chuẩn hóa (chỉ chữ số, tách số đầu, +84→0) — dùng tìm kiếm & audit trùng.';

-- ─────────────────────────────────────────────────────────────
-- 2. Hàm chuẩn hóa SĐT — KHỚP với helper primaryPhone() phía client
--    (src/contexts/DisplaySettingsContext.tsx):
--      • Cắt phần định danh bị ghép (cccd/cmnd/c/c/căn cước).
--      • Lấy token đầu theo dấu phân tách phổ biến.
--      • Chỉ giữ chữ số, chuẩn hóa tiền tố +84/84 → 0.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_normalize_phone(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;
  -- Cắt phần định danh bị ghép (giữ phần TRƯỚC cccd/cmnd/c/c/căn cước)
  v := regexp_replace(p_raw, '(?i)(cccd|cmnd|c/c|căn cước).*$', '');
  -- Lấy token đầu theo dấu phẩy, chấm phẩy, gạch chéo, gạch đứng, xuống dòng, ≥2 khoảng trắng
  v := (regexp_split_to_array(v, '[,;/|' || E'\n' || ']|\s{2,}'))[1];
  -- Chỉ giữ chữ số
  v := regexp_replace(COALESCE(v, ''), '\D', '', 'g');
  -- Chuẩn hóa +84 / 84 → 0 (dạng quốc tế SĐT VN: 84 + 9 chữ số = 11 chữ số)
  IF length(v) = 11 AND left(v, 2) = '84' THEN
    v := '0' || substring(v FROM 3);
  END IF;
  IF v = '' THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.fn_normalize_phone(TEXT) IS
  'Chuẩn hóa SĐT để tìm kiếm/đối chiếu trùng: tách số đầu, bỏ ký tự không phải số, +84→0.';

-- ─────────────────────────────────────────────────────────────
-- 3. Trigger đồng bộ primary_phone* khi customer_contacts đổi
--    SECURITY DEFINER: đảm bảo cập nhật được customers bất kể RLS
--    của phiên hiện tại (chỉ ghi đúng customer_id liên quan).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_customer_primary_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_phone TEXT;
BEGIN
  v_customer_id := COALESCE(NEW.customer_id, OLD.customer_id);

  SELECT cc.phone
    INTO v_phone
  FROM public.customer_contacts cc
  WHERE cc.customer_id = v_customer_id
    AND cc.is_primary = true
  ORDER BY cc.updated_at DESC NULLS LAST
  LIMIT 1;

  UPDATE public.customers
     SET primary_phone      = v_phone,
         primary_phone_norm = public.fn_normalize_phone(v_phone)
   WHERE id = v_customer_id
     AND (primary_phone IS DISTINCT FROM v_phone
          OR primary_phone_norm IS DISTINCT FROM public.fn_normalize_phone(v_phone));

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cc_sync_primary_phone ON public.customer_contacts;
CREATE TRIGGER trg_cc_sync_primary_phone
  AFTER INSERT OR UPDATE OF phone, is_primary, customer_id OR DELETE
  ON public.customer_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_customer_primary_phone();

-- ─────────────────────────────────────────────────────────────
-- 4. Backfill dữ liệu hiện có
-- ─────────────────────────────────────────────────────────────
UPDATE public.customers c
   SET primary_phone      = sub.phone,
       primary_phone_norm = public.fn_normalize_phone(sub.phone)
FROM (
  SELECT DISTINCT ON (customer_id) customer_id, phone
  FROM public.customer_contacts
  WHERE is_primary = true
  ORDER BY customer_id, updated_at DESC NULLS LAST
) sub
WHERE c.id = sub.customer_id
  AND (c.primary_phone IS DISTINCT FROM sub.phone);

-- ─────────────────────────────────────────────────────────────
-- 5. Index trgm cho tìm kiếm server-side theo SĐT chuẩn hóa
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customers_primary_phone_norm_trgm
  ON public.customers USING gin (primary_phone_norm gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- 6. Recreate customer_summary_view — thêm primary_phone(+norm)
--    (giữ NGUYÊN toàn bộ cột & logic bản 20260701000000, chỉ bổ sung 2 cột)
-- ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.customer_summary_view;
CREATE VIEW public.customer_summary_view
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.code,
  c.customer_type,
  c.farm_name,
  c.value_tier,
  c.lifecycle_stage,
  c.province,
  c.district,
  c.address,
  c.credit_limit,
  c.owner_user_id,
  c.is_active,
  c.created_at,
  c.updated_at,
  -- SĐT liên hệ chính (denormalize) — phục vụ tìm kiếm & hiển thị
  c.primary_phone,
  c.primary_phone_norm,
  -- Tổng nợ chưa thanh toán (dương = khách nợ; âm = công ty nợ khách)
  COALESCE((
    SELECT SUM(d.amount)
    FROM public.customer_debts d
    WHERE d.customer_id = c.id AND d.is_settled = false
  ), 0)::NUMERIC(15,2) AS total_debt,
  -- Cờ quá hạn: có ít nhất 1 debt chưa thanh toán và due_date < hôm nay
  EXISTS (
    SELECT 1
    FROM public.customer_debts d
    WHERE d.customer_id = c.id
      AND d.is_settled = false
      AND d.due_date IS NOT NULL
      AND d.due_date < CURRENT_DATE
  ) AS is_overdue,
  -- Tuổi nợ: số ngày từ khoản nợ CHƯA thanh toán cũ nhất (amount > 0,
  -- không tính khách trả trước). NULL nếu không có nợ.
  (
    SELECT (CURRENT_DATE - MIN(d.created_at)::date)
    FROM public.customer_debts d
    WHERE d.customer_id = c.id
      AND d.is_settled = false
      AND d.amount > 0
  )::INTEGER AS debt_age_days,
  -- Tần suất mua: số đơn trong 90 ngày gần nhất / 3 (loại đơn hủy)
  ROUND((
    SELECT COUNT(*)
    FROM public.orders o
    WHERE o.customer_id = c.id
      AND o.status <> 'cancelled'
      AND o.created_at >= now() - INTERVAL '90 days'
  )::NUMERIC / 3.0, 1) AS orders_per_month,
  -- Ngày mua hàng gần nhất
  (
    SELECT MAX(o.created_at)
    FROM public.orders o
    WHERE o.customer_id = c.id
  ) AS last_order_at,
  -- Tổng số đơn (tham khảo, không bắt buộc dùng UI)
  (
    SELECT COUNT(*)
    FROM public.orders o
    WHERE o.customer_id = c.id
  )::INTEGER AS orders_count,
  -- Primary contact
  (
    SELECT jsonb_build_object(
      'full_name', cc.full_name,
      'phone', cc.phone,
      'role_at_farm', cc.role_at_farm
    )
    FROM public.customer_contacts cc
    WHERE cc.customer_id = c.id AND cc.is_primary = true
    LIMIT 1
  ) AS primary_contact
FROM public.customers c;

COMMENT ON VIEW public.customer_summary_view IS
'Tổng hợp khách hàng + SĐT liên hệ chính + nợ + tuổi nợ + tần suất mua (90d/3) + ngày mua gần nhất + liên hệ chính. Dùng cho trang Danh sách khách hàng.';

GRANT SELECT ON public.customer_summary_view TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7. View báo cáo AUDIT khách TRÙNG SĐT (chuẩn hóa) — để dọn dần.
--    security_invoker → tôn trọng RLS của customers (đang mở select_all).
-- ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.customer_duplicate_phones;
CREATE VIEW public.customer_duplicate_phones
WITH (security_invoker = true) AS
SELECT
  primary_phone_norm,
  COUNT(*)                                  AS customer_count,
  array_agg(id        ORDER BY created_at)  AS customer_ids,
  array_agg(code      ORDER BY created_at)  AS customer_codes,
  array_agg(farm_name ORDER BY created_at)  AS farm_names
FROM public.customers
WHERE primary_phone_norm IS NOT NULL
  AND is_active = true
GROUP BY primary_phone_norm
HAVING COUNT(*) > 1;

COMMENT ON VIEW public.customer_duplicate_phones IS
'Audit: các SĐT (chuẩn hóa) đang bị ≥2 khách hàng đang hoạt động dùng chung — phục vụ làm sạch dữ liệu.';

GRANT SELECT ON public.customer_duplicate_phones TO authenticated;
