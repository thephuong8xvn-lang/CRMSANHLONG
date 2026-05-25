-- ============================================================
-- CRM SANHLONGVETCO – CREATE PRODUCT UNITS TABLE
-- File: 20260525000003_create_product_units.sql
-- Mô tả: Bảng danh mục đơn vị tính và các chính sách bảo mật RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_units (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL UNIQUE,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_units IS 'Danh mục các đơn vị tính của sản phẩm';

-- Bật Row Level Security (RLS)
ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

-- Chính sách xem danh mục đơn vị tính: Mọi tài khoản hoạt động đều xem được
CREATE POLICY "product_units_select_all" ON public.product_units
  FOR SELECT USING (public.fn_is_active());

-- Chính sách quản trị (Thêm, sửa, xóa): Chỉ Admin hoặc người có quyền quản lý sản phẩm
CREATE POLICY "product_units_manage_admin" ON public.product_units
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- Thêm một số đơn vị tính mặc định ban đầu
INSERT INTO public.product_units (name) VALUES
('lọ'),
('kg'),
('gói'),
('cái'),
('lon'),
('túi'),
('chai')
ON CONFLICT (name) DO NOTHING;
