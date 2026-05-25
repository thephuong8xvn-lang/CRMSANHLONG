-- ==============================================================================
-- CRM SANHLONGVETCO – DYNAMIC PATHOLOGY SETTINGS & PRODUCT DISEASE INDICATIONS
-- File: 20260525000006_add_product_diseases_and_settings_entities.sql
-- ==============================================================================

-- 1. Create table pharmacological_groups (Nhóm dược lý)
CREATE TABLE IF NOT EXISTS public.pharmacological_groups (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL UNIQUE,
  code        TEXT        UNIQUE,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pharmacological_groups IS 'Danh mục các nhóm dược lý (Beta-lactam, Macrolide, NSAID...)';

-- 2. Create table compatibility_interaction_types (Loại tương tác thuốc)
CREATE TABLE IF NOT EXISTS public.compatibility_interaction_types (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL UNIQUE,
  description TEXT,
  color_code  TEXT        NOT NULL DEFAULT 'gray',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.compatibility_interaction_types IS 'Danh mục các loại tương tác tương kỵ thuốc';

-- 3. Create table disease_etiologies (Danh mục Nguyên nhân & Phân nhóm vi sinh)
CREATE TABLE IF NOT EXISTS public.disease_etiologies (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT        NOT NULL UNIQUE,
  code          TEXT        UNIQUE,
  pathogen_type TEXT        NOT NULL CHECK (pathogen_type IN ('bacteria', 'virus', 'parasite', 'environment_nutrition', 'other')),
  subgroup      TEXT,       -- e.g., Gram-âm, Gram-dương, DNA Virus, RNA Virus, Cầu trùng, Giun sán
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.disease_etiologies IS 'Danh mục phân loại nguyên nhân dịch bệnh thú y';

-- 4. Create link table public.product_indications (Chỉ định điều trị bệnh của Sản phẩm)
CREATE TABLE IF NOT EXISTS public.product_indications (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  disease_id  UUID        NOT NULL REFERENCES public.disease_dictionary(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, disease_id)
);
COMMENT ON TABLE public.product_indications IS 'Bảng liên kết các bệnh lý chỉ định điều trị của sản phẩm thương mại';

-- 5. Alter public.active_ingredients to link with pharmacological_groups
ALTER TABLE public.active_ingredients
  ADD COLUMN IF NOT EXISTS pharmacological_group_id UUID REFERENCES public.pharmacological_groups(id) ON DELETE SET NULL;

-- 6. Alter public.disease_dictionary to link with disease_etiologies
ALTER TABLE public.disease_dictionary
  ADD COLUMN IF NOT EXISTS etiology_id UUID REFERENCES public.disease_etiologies(id) ON DELETE SET NULL;

-- 7. Modify active_ingredient_compatibility to reference compatibility_interaction_types(code)
ALTER TABLE public.active_ingredient_compatibility
  DROP CONSTRAINT IF EXISTS active_ingredient_compatibility_interaction_type_check;

-- Ensure compatibility_interaction_types has the seed data before adding the constraint
INSERT INTO public.compatibility_interaction_types (code, name, description, color_code) VALUES
  ('synergy', 'Hiệp lực', 'Tương tác có lợi, hỗ trợ hoặc nâng cao hiệu quả điều trị của nhau', 'emerald'),
  ('antagonism', 'Đối kháng / Kỵ thuốc', 'Tương tác có hại, giảm tác dụng điều trị hoặc gây ra phản ứng độc tính', 'red')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.active_ingredient_compatibility
  ADD CONSTRAINT fk_interaction_type FOREIGN KEY (interaction_type) REFERENCES public.compatibility_interaction_types(code) ON UPDATE CASCADE;

-- 8. Migrate existing text data to new entities
-- 8.1 Pharmacological groups migration
INSERT INTO public.pharmacological_groups (name, code)
SELECT DISTINCT pharmacological_group, lower(regexp_replace(pharmacological_group, '\s+', '_', 'g'))
FROM public.active_ingredients
WHERE pharmacological_group IS NOT NULL AND pharmacological_group <> ''
ON CONFLICT (name) DO NOTHING;

UPDATE public.active_ingredients ai
SET pharmacological_group_id = pg.id
FROM public.pharmacological_groups pg
WHERE ai.pharmacological_group = pg.name;

-- 8.2 Disease etiologies migration
INSERT INTO public.disease_etiologies (name, code, pathogen_type, subgroup) VALUES
  ('Vi khuẩn Gram-âm', 'gram_neg', 'bacteria', 'Gram-âm'),
  ('Vi khuẩn Gram-dương', 'gram_pos', 'bacteria', 'Gram-dương'),
  ('Virus RNA', 'rna_virus', 'virus', 'RNA Virus'),
  ('Virus DNA', 'dna_virus', 'virus', 'DNA Virus'),
  ('Ký sinh trùng đường ruột', 'gut_parasite', 'parasite', 'Ký sinh trùng'),
  ('Dinh dưỡng & Môi trường', 'nutr_env', 'environment_nutrition', 'Dinh dưỡng & Môi trường')
ON CONFLICT (name) DO NOTHING;

UPDATE public.disease_dictionary SET etiology_id = (SELECT id FROM public.disease_etiologies WHERE code = 'rna_virus') WHERE etiology = 'virus';
UPDATE public.disease_dictionary SET etiology_id = (SELECT id FROM public.disease_etiologies WHERE code = 'gram_neg') WHERE etiology = 'bacteria';
UPDATE public.disease_dictionary SET etiology_id = (SELECT id FROM public.disease_etiologies WHERE code = 'gut_parasite') WHERE etiology = 'parasite';
UPDATE public.disease_dictionary SET etiology_id = (SELECT id FROM public.disease_etiologies WHERE code = 'nutr_env') WHERE etiology = 'environment_nutrition';

-- 9. Enable RLS on new tables
ALTER TABLE public.pharmacological_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compatibility_interaction_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disease_etiologies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_indications ENABLE ROW LEVEL SECURITY;

-- 10. RLS Policies
-- public.pharmacological_groups
CREATE POLICY "pharma_groups_select_all" ON public.pharmacological_groups
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "pharma_groups_manage_admin" ON public.pharmacological_groups
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- public.compatibility_interaction_types
CREATE POLICY "interaction_types_select_all" ON public.compatibility_interaction_types
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "interaction_types_manage_admin" ON public.compatibility_interaction_types
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- public.disease_etiologies
CREATE POLICY "etiologies_select_all" ON public.disease_etiologies
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "etiologies_manage_admin" ON public.disease_etiologies
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- public.product_indications
CREATE POLICY "indications_select_all" ON public.product_indications
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "indications_manage_admin" ON public.product_indications
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- Ensure species table has robust policies for CRUD
DROP POLICY IF EXISTS "species_select_all" ON public.species;
DROP POLICY IF EXISTS "species_manage_admin" ON public.species;

CREATE POLICY "species_select_all" ON public.species
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "species_manage_admin" ON public.species
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );
