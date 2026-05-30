-- ============================================================
-- Migration: Khuyến mãi theo hàng hóa + Phân quyền KM theo chi nhánh
-- File: 20260530000003_product_promotions_and_branch_scope.sql
--
-- Mục tiêu:
--   1. Thêm cột branch_ids cho promotions (KM toàn đơn) — scope theo chi nhánh.
--   2. Tạo bảng product_promotions — KM gắn thẳng vào từng sản phẩm
--      (mua X tặng Y / giảm % / giảm tiền theo số lượng).
--   3. RLS phân quyền: admin/ceo quản lý mọi chi nhánh (tick nhiều CN);
--      nhân viên có quyền promotions.manage chỉ tạo/sửa KM khóa cứng
--      tại đúng chi nhánh của mình.
--
-- ⚠️ Chạy thủ công qua Supabase SQL Editor.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Thêm scope chi nhánh cho bảng promotions (KM toàn đơn)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS branch_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.promotions.branch_ids IS
  'Danh sách chi nhánh áp dụng KM. Rỗng = toàn hệ thống (chỉ admin/ceo tạo được).';


-- ─────────────────────────────────────────────────────────────
-- 2. Bảng product_promotions — KM theo hàng hóa
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_promotions (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id     UUID          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name           TEXT          NOT NULL,                       -- VD: "Mua 10 tặng 2"
  promo_type     TEXT          NOT NULL CHECK (promo_type IN ('buy_x_get_y', 'percent', 'fixed_amount')),
  buy_qty        INTEGER,                                      -- Ngưỡng mua (buy_x_get_y)
  get_qty        INTEGER,                                      -- Số lượng tặng (buy_x_get_y)
  get_product_id UUID          REFERENCES public.products(id) ON DELETE SET NULL, -- SP tặng (NULL = chính SP đó)
  discount_value NUMERIC(15,2) NOT NULL DEFAULT 0,             -- % (percent) hoặc ₫ (fixed_amount) trên mỗi đơn vị
  min_qty        INTEGER       NOT NULL DEFAULT 1,             -- SL tối thiểu để hưởng percent/fixed
  branch_ids     UUID[]        NOT NULL DEFAULT '{}',          -- Rỗng = mọi chi nhánh
  priority       INTEGER       NOT NULL DEFAULT 0,             -- Cao hơn = ưu tiên gợi ý trước
  valid_from     TIMESTAMPTZ,
  valid_to       TIMESTAMPTZ,
  is_active      BOOLEAN       NOT NULL DEFAULT true,
  created_by     UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.product_promotions IS
  'Khuyến mãi gắn theo sản phẩm: mua X tặng Y / giảm % / giảm tiền theo số lượng. Gợi ý tại POS.';
COMMENT ON COLUMN public.product_promotions.branch_ids IS
  'Danh sách chi nhánh áp dụng. Rỗng = mọi chi nhánh (chỉ admin/ceo).';
COMMENT ON COLUMN public.product_promotions.get_product_id IS
  'Sản phẩm tặng kèm (buy_x_get_y). NULL = tặng chính sản phẩm đang mua.';

CREATE INDEX IF NOT EXISTS idx_prodpromo_product ON public.product_promotions(product_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_prodpromo_active  ON public.product_promotions(is_active);

-- Trigger tự cập nhật updated_at (dùng lại hàm chung nếu có; fallback tạo riêng)
DROP TRIGGER IF EXISTS trg_prodpromo_updated_at ON public.product_promotions;
CREATE TRIGGER trg_prodpromo_updated_at
  BEFORE UPDATE ON public.product_promotions
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 3. RLS cho product_promotions
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.product_promotions ENABLE ROW LEVEL SECURITY;

-- Mọi user đã đăng nhập đọc được (để POS gợi ý KM)
DROP POLICY IF EXISTS "prodpromo_select_all" ON public.product_promotions;
CREATE POLICY "prodpromo_select_all" ON public.product_promotions
  FOR SELECT USING (public.fn_is_active());

-- Admin / CEO: toàn quyền mọi chi nhánh
DROP POLICY IF EXISTS "prodpromo_manage_admin" ON public.product_promotions;
CREATE POLICY "prodpromo_manage_admin" ON public.product_promotions
  FOR ALL
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('ceo'))
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('ceo'))
  );

-- Nhân viên có quyền promotions.manage: chỉ KM khóa cứng đúng 1 chi nhánh của họ
DROP POLICY IF EXISTS "prodpromo_manage_branch" ON public.product_promotions;
CREATE POLICY "prodpromo_manage_branch" ON public.product_promotions
  FOR ALL
  USING (
    public.fn_is_active()
    AND public.fn_has_permission('promotions.manage')
    AND public.fn_my_branch_id() = ANY(branch_ids)
  )
  WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('promotions.manage')
    AND public.fn_my_branch_id() IS NOT NULL
    AND branch_ids = ARRAY[public.fn_my_branch_id()]::uuid[]
  );


-- ─────────────────────────────────────────────────────────────
-- 4. Cập nhật RLS promotions (KM toàn đơn) — scope theo chi nhánh
--    Thay policy cũ promotions_manage_admin bằng cặp admin/branch.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "promotions_manage_admin"  ON public.promotions;
DROP POLICY IF EXISTS "promotions_manage_branch" ON public.promotions;

-- Admin / CEO: toàn quyền, tick nhiều chi nhánh hoặc để rỗng (toàn hệ thống)
CREATE POLICY "promotions_manage_admin" ON public.promotions
  FOR ALL
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('ceo'))
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('ceo'))
  );

-- Nhân viên có quyền promotions.manage: chỉ KM khóa cứng đúng 1 chi nhánh của họ
CREATE POLICY "promotions_manage_branch" ON public.promotions
  FOR ALL
  USING (
    public.fn_is_active()
    AND public.fn_has_permission('promotions.manage')
    AND public.fn_my_branch_id() = ANY(branch_ids)
  )
  WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('promotions.manage')
    AND public.fn_my_branch_id() IS NOT NULL
    AND branch_ids = ARRAY[public.fn_my_branch_id()]::uuid[]
  );
