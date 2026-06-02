-- ============================================================
-- 20260615000000_cashbook_categories_handover.sql
-- Hạng mục nội bộ (is_internal) + hạng mục "Nộp quỹ cuối ca".
--
-- Bối cảnh / lý do:
--   - Cuối ngày thủ quỹ nộp tiền mặt về công ty/kế toán giữ. Trước đây không
--     có bút toán nào → cash_funds.balance (trigger) lệch với tiền thật trong
--     két (đóng ca 20tr, mai mở 1tr thì 19tr "biến mất"). Nay đóng ca sinh
--     PHIẾU CHI hạng mục CHI-NOP-QUY → balance luôn = tiền mặt thật còn lại.
--   - Tiền nộp quỹ / lệch quỹ là LUÂN CHUYỂN NỘI BỘ, không phải chi phí vận
--     hành → gắn cờ is_internal=true để báo cáo loại khỏi tổng thu/chi & lãi/lỗ
--     (vẫn vào số dư lũy kế vì có làm đổi tiền thật trong két).
-- ⚠️ Chạy thủ công qua Supabase SQL Editor / `supabase db push` (cần token).
-- ============================================================

-- 1. Cờ hạng mục nội bộ (luân chuyển, không tính vào thu/chi vận hành)
ALTER TABLE public.expense_categories
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.expense_categories.is_internal IS
'true = luân chuyển nội bộ (nộp quỹ, lệch quỹ...) — báo cáo loại khỏi tổng thu/chi vận hành & lãi/lỗ, nhưng vẫn ảnh hưởng số dư quỹ.';

-- 2. Hạng mục "Nộp quỹ cuối ca" (phiếu chi nội bộ khi đóng ca)
INSERT INTO public.expense_categories (id, code, name, flow_type, is_active, is_internal) VALUES
  ('e0e00001-0000-0000-0000-000000000014', 'CHI-NOP-QUY', 'Nộp quỹ cuối ca / Giao tiền về công ty', 'outflow', true, true)
ON CONFLICT (id) DO UPDATE SET is_internal = true, is_active = true;

-- 3. Đánh dấu nội bộ cho 2 hạng mục lệch quỹ (đã có từ migration S4)
UPDATE public.expense_categories
  SET is_internal = true
  WHERE code IN ('THU-LECH-QUY', 'CHI-LECH-QUY');
