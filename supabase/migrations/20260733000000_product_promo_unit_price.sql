-- ============================================================
-- Migration: KM sản phẩm — loại "giá ưu đãi theo số lượng"
-- File: 20260733000000_product_promo_unit_price.sql
--
-- NHU CẦU: mua đủ SL thì hưởng ĐƠN GIÁ cố định, không phải giảm %/giảm tiền.
--   VD: mua 1 gói = 100.000₫; mua từ 25 gói = 90.000₫/gói.
--
-- CÁCH LƯU: promo_type = 'unit_price'
--   • min_qty        = số lượng tối thiểu để hưởng (25)
--   • discount_value = ĐƠN GIÁ ưu đãi (90000)  ← ý nghĩa cột đổi theo promo_type
--
-- Không cần cột mới: `discount_value` vốn đã đa nghĩa theo promo_type
--   (percent → %, fixed_amount → ₫ giảm/đơn vị, unit_price → ₫ giá bán/đơn vị).
--
-- POS quy về chiết khấu dòng: discountPercent = (giá gốc − giá ưu đãi) / giá gốc,
-- nên order_lines.unit_price vẫn giữ GIÁ GỐC và order_lines.discount ghi phần giảm
-- → báo cáo vẫn thấy được giá niêm yết và chi phí KM. Nếu giá ưu đãi ≥ giá đang bán
-- thì KM tự vô hiệu (không bao giờ làm khách trả đắt hơn).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

ALTER TABLE public.product_promotions
  DROP CONSTRAINT IF EXISTS product_promotions_promo_type_check;

ALTER TABLE public.product_promotions
  ADD CONSTRAINT product_promotions_promo_type_check
  CHECK (promo_type IN (
    'buy_x_get_y',   -- Mua X tặng Y (sinh dòng quà)
    'percent',       -- Giảm % theo số lượng
    'fixed_amount',  -- Giảm tiền/đơn vị theo số lượng
    'unit_price'     -- Giá ưu đãi/đơn vị khi mua đủ min_qty
  ));

COMMENT ON COLUMN public.product_promotions.discount_value IS
  'Ý nghĩa theo promo_type: percent → %; fixed_amount → ₫ giảm mỗi đơn vị; unit_price → ĐƠN GIÁ bán ưu đãi mỗi đơn vị.';
COMMENT ON COLUMN public.product_promotions.min_qty IS
  'SL tối thiểu để hưởng KM (percent / fixed_amount / unit_price). buy_x_get_y dùng buy_qty.';

NOTIFY pgrst, 'reload schema';
