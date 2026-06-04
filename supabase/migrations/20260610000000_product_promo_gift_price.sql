-- ============================================================
-- Migration: Giá quà tặng cho KM theo sản phẩm (buy_x_get_y)
-- File: 20260610000000_product_promo_gift_price.sql
--
-- Mục tiêu:
--   1. Thêm cột get_price — giá mỗi đơn vị quà tặng (Mua X tặng Y).
--      0 = tặng miễn phí; > 0 = giá ưu đãi. Cho phép đa dạng hình thức KM:
--      "mua A tặng B với giá ưu đãi" thay vì chỉ tặng 0đ.
--   2. Vá toàn vẹn dữ liệu bằng CHECK (NOT VALID để không vỡ data cũ):
--      - get_price >= 0
--      - percent: discount_value trong [0, 100]
--
-- ⚠️ Chạy thủ công qua Supabase Management API (KHÔNG dùng supabase db push).
--    Sau khi chạy: NOTIFY pgrst, 'reload schema';
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Cột giá quà tặng
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.product_promotions
  ADD COLUMN IF NOT EXISTS get_price NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.product_promotions.get_price IS
  'Giá mỗi đơn vị quà tặng (buy_x_get_y). 0 = miễn phí; > 0 = giá ưu đãi.';

-- ─────────────────────────────────────────────────────────────
-- 2. Vá toàn vẹn (CHECK NOT VALID — chỉ áp cho bản ghi mới/cập nhật,
--    không kiểm tra lại data cũ để tránh vỡ nếu lịch sử lệch)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_prodpromo_get_price_nonneg'
  ) THEN
    ALTER TABLE public.product_promotions
      ADD CONSTRAINT chk_prodpromo_get_price_nonneg CHECK (get_price >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_prodpromo_percent_range'
  ) THEN
    ALTER TABLE public.product_promotions
      ADD CONSTRAINT chk_prodpromo_percent_range
      CHECK (promo_type <> 'percent' OR (discount_value >= 0 AND discount_value <= 100)) NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. Reload PostgREST schema cache
-- ─────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
