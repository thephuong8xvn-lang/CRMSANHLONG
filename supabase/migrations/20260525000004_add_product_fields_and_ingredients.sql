-- ============================================================
-- CRM SANHLONGVETCO – ADD PRODUCT FIELDS & ACTIVE INGREDIENTS
-- File: 20260525000004_add_product_fields_and_ingredients.sql
-- ============================================================

-- 1. Alter products table to add legal, safety and withdrawal period fields
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS contraindications TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_period_meat INTEGER,
  ADD COLUMN IF NOT EXISTS withdrawal_period_milk_egg INTEGER;

-- 2. Create active_ingredients table (Master list of active ingredients)
CREATE TABLE IF NOT EXISTS public.active_ingredients (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL UNIQUE,
  code        TEXT        UNIQUE,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.active_ingredients IS 'Danh mục hoạt chất hệ thống';

-- 3. Create product_active_ingredients table (Link table with concentrations)
CREATE TABLE IF NOT EXISTS public.product_active_ingredients (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id            UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  active_ingredient_id  UUID        NOT NULL REFERENCES public.active_ingredients(id) ON DELETE RESTRICT,
  percentage_or_dosage  TEXT        NOT NULL, -- VD: "500 mg", "20%", "vừa đủ 1 liều"
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, active_ingredient_id)
);
COMMENT ON TABLE public.product_active_ingredients IS 'Thành phần hoạt chất của sản phẩm';

-- 4. Enable RLS on both tables
ALTER TABLE public.active_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_active_ingredients ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for active_ingredients
CREATE POLICY "ingredients_select_all" ON public.active_ingredients
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "ingredients_manage_admin" ON public.active_ingredients
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- 6. RLS Policies for product_active_ingredients
CREATE POLICY "prod_ingredients_select_all" ON public.product_active_ingredients
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "prod_ingredients_manage_admin" ON public.product_active_ingredients
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- 7. Seed initial data for active_ingredients
INSERT INTO public.active_ingredients (name, code) VALUES
  ('Amoxicillin Trihydrate', 'amox_tri'),
  ('Colistin Sulfate', 'col_sulf'),
  ('Tylosin Tartrate', 'tyl_tart'),
  ('Enrofloxacin', 'enro'),
  ('Florfenicol', 'flor'),
  ('Bromhexine HCl', 'brom_hcl'),
  ('Dexamethasone', 'dexa'),
  ('Ivermectin', 'iver'),
  ('Kháng nguyên vô hoạt', 'khang_nguyen_vh'),
  ('Chất bổ trợ nhũ dầu', 'bo_tro_nd'),
  ('Tá dược vừa đủ', 'ta_duoc_vd')
ON CONFLICT (name) DO NOTHING;
