-- ============================================================
-- Migration: Bù schema KM cấp đơn + Voucher cho production
-- File: 20260731000000_promotions_schema_catchup.sql
--
-- BỐI CẢNH:
--   `20260526000020_promotions_vouchers_loyalty.sql` CHƯA BAO GIỜ chạy trên
--   production (phát hiện 2026-07-13). Trên DB thật:
--     • promotions thiếu: buy_x_qty, get_y_qty, get_y_product_id, combo_price,
--       tiers, customer_tiers, priority, created_by
--     • CHECK discount_type chỉ cho percent | fixed_amount | buy_x_get_y
--     • bảng vouchers KHÔNG tồn tại
--   Hệ quả: trang /promotions luôn trống (order by "priority" lỗi), bấm Tạo mới
--   luôn thất bại (insert cột không tồn tại) → bảng promotions rỗng 0 dòng.
--   KM cấp đơn & Voucher thực tế CHƯA BAO GIỜ dùng được.
--
--   Migration này KHÔNG chạy lại file cũ: phần RLS trong đó viết theo mô hình vai
--   trò cũ ('admin','super_admin') — không khớp mô hình hiện tại (admin/ceo +
--   quyền `promotions.manage`), sẽ khiến CEO không quản lý được voucher.
--   `loyalty_points` cố tình BỎ QUA: chưa có giao diện nào dùng điểm.
--
-- AN TOÀN: promotions đang rỗng (0 dòng) nên mọi ALTER đều không đụng dữ liệu.
--
-- ⚠️ Chạy thủ công qua Supabase SQL Editor / scripts (KHÔNG `supabase db push`).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Bù cột cho promotions
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS buy_x_qty        INTEGER,
  ADD COLUMN IF NOT EXISTS get_y_qty        INTEGER,
  ADD COLUMN IF NOT EXISTS get_y_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS combo_price      NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS tiers            JSONB   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS customer_tiers   TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS priority         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.promotions.combo_price IS
  'Giá cố định cho 1 bộ combo (1 đơn vị mỗi SP trong applies_to.product_ids).';
COMMENT ON COLUMN public.promotions.tiers IS
  'Bậc thang SL: [{min_qty:int, discount_percent:numeric}]';
COMMENT ON COLUMN public.promotions.customer_tiers IS
  'Hạng KH được hưởng — khớp enum customer_value_tier: normal | vip | high_potential. Rỗng = mọi hạng.';

-- Nới CHECK cho đủ 6 loại (bản cũ chỉ có 3).
ALTER TABLE public.promotions DROP CONSTRAINT IF EXISTS promotions_discount_type_check;
ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_discount_type_check
  CHECK (discount_type IN (
    'percent',                -- Giảm % đơn hàng
    'fixed_amount',           -- Giảm tiền cố định
    'buy_x_get_y',            -- Lấy X+Y, tính tiền X (KM cũ; KM sản phẩm mới là "mua X tặng Y")
    'combo_price',            -- Combo giá trọn bộ
    'tiered_quantity',        -- Bậc thang số lượng
    'customer_tier_discount'  -- Theo hạng khách hàng
  ));

-- POS/danh sách đều sắp theo priority giảm dần trong nhóm đang bật.
CREATE INDEX IF NOT EXISTS idx_promotions_active_priority
  ON public.promotions (priority DESC) WHERE is_active;


-- ─────────────────────────────────────────────────────────────
-- 2. Bảng vouchers
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vouchers (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  code             TEXT          NOT NULL UNIQUE,
  promotion_id     UUID          REFERENCES public.promotions(id) ON DELETE SET NULL,
  discount_type    TEXT          NOT NULL CHECK (discount_type IN ('percent', 'fixed_amount')),
  discount_value   NUMERIC(15,2) NOT NULL,
  min_order_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_discount     NUMERIC(15,2),                       -- trần giảm khi discount_type = percent
  valid_from       TIMESTAMPTZ,
  valid_to         TIMESTAMPTZ,
  max_uses         INTEGER       NOT NULL DEFAULT 1,
  current_uses     INTEGER       NOT NULL DEFAULT 0,
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_by       UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT vouchers_uses_check CHECK (current_uses <= max_uses)
);

COMMENT ON TABLE public.vouchers IS
  'Mã giảm giá nhập tay tại POS. Lượt dùng do fn_consume_promo_usage() tăng khi chốt đơn.';

CREATE INDEX IF NOT EXISTS idx_vouchers_code   ON public.vouchers (code);
CREATE INDEX IF NOT EXISTS idx_vouchers_active ON public.vouchers (is_active);

DROP TRIGGER IF EXISTS trg_vouchers_updated_at ON public.vouchers;
CREATE TRIGGER trg_vouchers_updated_at
  BEFORE UPDATE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 3. RLS vouchers — theo mô hình quyền HIỆN TẠI (admin/ceo + promotions.manage)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

-- Mọi user đang hoạt động đọc được: POS phải tra mã voucher khách đưa.
DROP POLICY IF EXISTS "vouchers_select"     ON public.vouchers;
DROP POLICY IF EXISTS "vouchers_select_all" ON public.vouchers;
CREATE POLICY "vouchers_select_all" ON public.vouchers
  FOR SELECT USING (public.fn_is_active());

-- Tạo/sửa/xoá: admin, ceo, hoặc người có quyền promotions.manage.
DROP POLICY IF EXISTS "vouchers_manage" ON public.vouchers;
CREATE POLICY "vouchers_manage" ON public.vouchers
  FOR ALL
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('ceo') OR public.fn_has_permission('promotions.manage'))
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('ceo') OR public.fn_has_permission('promotions.manage'))
  );

-- PostgREST cache schema: bắt buộc, nếu không frontend vẫn không thấy object mới.
NOTIFY pgrst, 'reload schema';
