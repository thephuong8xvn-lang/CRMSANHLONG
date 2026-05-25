-- ==============================================================================
-- CRM SANHLONGVETCO – ACTIVE INGREDIENTS COMPATIBILITY & DISEASE PROTOCOLS
-- File: 20260525000005_add_active_ingredient_compatibility_and_disease_protocols.sql
-- ==============================================================================

-- 1. Alter active_ingredients table to add advanced technical, safety, and MDM fields
ALTER TABLE public.active_ingredients
  ADD COLUMN IF NOT EXISTS pharmacological_group TEXT, -- Beta-lactam, Macrolide, NSAID...
  ADD COLUMN IF NOT EXISTS standard_dosage TEXT,        -- Hàm lượng/Nồng độ tiêu chuẩn
  ADD COLUMN IF NOT EXISTS withdrawal_period_meat INTEGER, -- Thời gian ngưng thuốc (ngày)
  ADD COLUMN IF NOT EXISTS withdrawal_period_milk_egg INTEGER,
  ADD COLUMN IF NOT EXISTS contraindications TEXT;      -- Chống chỉ định & Độc tính

-- 2. Create active_ingredient_compatibility table (Ma trận Hiệp lực & Đối kháng)
CREATE TABLE IF NOT EXISTS public.active_ingredient_compatibility (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient_a_id       UUID        NOT NULL REFERENCES public.active_ingredients(id) ON DELETE CASCADE,
  ingredient_b_id       UUID        NOT NULL REFERENCES public.active_ingredients(id) ON DELETE CASCADE,
  interaction_type      TEXT        NOT NULL CHECK (interaction_type IN ('synergy', 'antagonism')),
  description           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_different_ingredients CHECK (ingredient_a_id <> ingredient_b_id),
  UNIQUE (ingredient_a_id, ingredient_b_id)
);
COMMENT ON TABLE public.active_ingredient_compatibility IS 'Ma trận tương tác (Hiệp lực/Đối kháng) giữa các hoạt chất';

-- 3. Create disease_species table (Phân loại Bệnh theo Đối tượng vật nuôi)
CREATE TABLE IF NOT EXISTS public.disease_species (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  disease_id  UUID        NOT NULL REFERENCES public.disease_dictionary(id) ON DELETE CASCADE,
  species_id  UUID        NOT NULL REFERENCES public.species(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (disease_id, species_id)
);
COMMENT ON TABLE public.disease_species IS 'Bảng liên kết giữa bệnh lý và loài vật nuôi';

-- 4. Alter disease_dictionary table to add etiology and symptoms checklist
ALTER TABLE public.disease_dictionary
  ADD COLUMN IF NOT EXISTS etiology TEXT,       -- bacteria, virus, parasite, environment_nutrition
  ADD COLUMN IF NOT EXISTS symptoms TEXT[] DEFAULT '{}'; -- Mảng các triệu chứng lâm sàng

-- 5. Create disease_treatment_protocols table (Ma trận Phác đồ điều trị đa tầng)
CREATE TABLE IF NOT EXISTS public.disease_treatment_protocols (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  disease_id            UUID        NOT NULL REFERENCES public.disease_dictionary(id) ON DELETE CASCADE,
  active_ingredient_id  UUID        NOT NULL REFERENCES public.active_ingredients(id) ON DELETE CASCADE,
  treatment_role        TEXT        NOT NULL CHECK (treatment_role IN ('treatment', 'support', 'resistance')), -- đặc trị, bổ trợ triệu chứng, nâng đề kháng
  treatment_line        INTEGER     NOT NULL DEFAULT 1 CHECK (treatment_line >= 1), -- Line 1, Line 2
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (disease_id, active_ingredient_id, treatment_role, treatment_line)
);
COMMENT ON TABLE public.disease_treatment_protocols IS 'Cấu hình phác đồ điều trị của từng bệnh lý';

-- 6. Alter orders table to store disease_id and treatment_purpose for Epidemiology analytics
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS disease_id UUID REFERENCES public.disease_dictionary(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS treatment_purpose TEXT;

-- 7. Enable RLS on new tables
ALTER TABLE public.active_ingredient_compatibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disease_species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disease_treatment_protocols ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies
-- active_ingredient_compatibility
CREATE POLICY "compat_select_all" ON public.active_ingredient_compatibility
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "compat_manage_admin" ON public.active_ingredient_compatibility
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- disease_species
CREATE POLICY "disease_spec_select_all" ON public.disease_species
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "disease_spec_manage_admin" ON public.disease_species
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('herd_projects.create'))
    AND public.fn_is_active()
  );

-- disease_treatment_protocols
CREATE POLICY "protocols_select_all" ON public.disease_treatment_protocols
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "protocols_manage_admin" ON public.disease_treatment_protocols
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('herd_projects.create') OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- 9. Seed Initial Data for Ingredients, Compatibility, Species, Diseases & Protocols

-- 9.1 Update existing active ingredients with MDM data
-- Let's extract IDs to update, or just use their names
UPDATE public.active_ingredients SET 
  pharmacological_group = 'Kháng sinh (Beta-lactam)', 
  standard_dosage = '10%', 
  withdrawal_period_meat = 14, 
  withdrawal_period_milk_egg = 5, 
  contraindications = 'Chống chỉ định cho động vật quá mẫn cảm với penicillin. Không dùng cho thỏ và chuột lang.'
WHERE name = 'Amoxicillin Trihydrate';

UPDATE public.active_ingredients SET 
  pharmacological_group = 'Kháng sinh (Polymyxin)', 
  standard_dosage = '10%', 
  withdrawal_period_meat = 7, 
  withdrawal_period_milk_egg = 3, 
  contraindications = 'Độc cho thận khi dùng liều cao kéo dài.'
WHERE name = 'Colistin Sulfate';

UPDATE public.active_ingredients SET 
  pharmacological_group = 'Kháng sinh (Macrolide)', 
  standard_dosage = '10%', 
  withdrawal_period_meat = 21, 
  withdrawal_period_milk_egg = 0, 
  contraindications = 'Tilmicosin gây độc cho tim đối với ngựa, dê và người.'
WHERE name = 'Tylosin Tartrate';

UPDATE public.active_ingredients SET 
  pharmacological_group = 'Kháng sinh (Fluoroquinolone)', 
  standard_dosage = '10%', 
  withdrawal_period_meat = 9, 
  withdrawal_period_milk_egg = 4, 
  contraindications = 'Tránh sử dụng cho động vật non vì có thể gây thoái hóa sụn khớp.'
WHERE name = 'Enrofloxacin';

UPDATE public.active_ingredients SET 
  pharmacological_group = 'Kháng sinh (Amphenicol)', 
  standard_dosage = '45%', 
  withdrawal_period_meat = 30, 
  withdrawal_period_milk_egg = 0, 
  contraindications = 'Không sử dụng cho bò đực giống, heo đực giống.'
WHERE name = 'Florfenicol';

UPDATE public.active_ingredients SET 
  pharmacological_group = 'Bổ trợ hô hấp / Long đờm', 
  standard_dosage = '1%', 
  withdrawal_period_meat = 0, 
  withdrawal_period_milk_egg = 0, 
  contraindications = 'Cẩn thận khi dùng chung với thuốc ho ức chế trung tâm hô hấp.'
WHERE name = 'Bromhexine HCl';

UPDATE public.active_ingredients SET 
  pharmacological_group = 'Kháng viêm (Corticoid)', 
  standard_dosage = '0.1%', 
  withdrawal_period_meat = 8, 
  withdrawal_period_milk_egg = 3, 
  contraindications = 'Không dùng cho thú mang thai giai đoạn cuối vì có thể gây sảy thai.'
WHERE name = 'Dexamethasone';

UPDATE public.active_ingredients SET 
  pharmacological_group = 'Ký sinh trùng', 
  standard_dosage = '1%', 
  withdrawal_period_meat = 28, 
  withdrawal_period_milk_egg = 28, 
  contraindications = 'Độc cho giống chó Collie và các giống chó liên quan.'
WHERE name = 'Ivermectin';

-- 9.2 Add some new active ingredients if needed (e.g. Acid Clavulanic, Toltrazuril, Paracetamol, Sulfamonomethoxine)
INSERT INTO public.active_ingredients (name, code, pharmacological_group, standard_dosage, withdrawal_period_meat, withdrawal_period_milk_egg, contraindications) VALUES
  ('Acid Clavulanic', 'acid_clav', 'Chất ức chế Beta-lactamase', '2.5%', 14, 5, 'Dùng kết hợp với Amoxicillin để chống kháng thuốc.'),
  ('Toltrazuril', 'toltra', 'Ký sinh trùng (Cầu trùng)', '2.5%', 70, 0, 'Không dùng cho gia cầm đẻ trứng thương phẩm.'),
  ('Paracetamol', 'para', 'Hạ sốt / Giảm đau', '10%', 0, 0, 'Gây độc gan nghiêm trọng cho mèo.'),
  ('Sulfamonomethoxine', 'sulfam', 'Kháng sinh (Sulfonamide)', '20%', 15, 7, 'Tránh dùng cho thú bị suy thận, suy gan nặng.')
ON CONFLICT (name) DO NOTHING;

-- 9.3 Seed compatibility rules (Synergy & Antagonism)
-- Amoxicillin + Acid Clavulanic -> Synergy (Hiệp lực chống kháng thuốc)
INSERT INTO public.active_ingredient_compatibility (ingredient_a_id, ingredient_b_id, interaction_type, description)
SELECT a.id, b.id, 'synergy', 'Hiệp lực chống kháng thuốc nhờ Acid Clavulanic ức chế enzym beta-lactamase.'
FROM public.active_ingredients a, public.active_ingredients b
WHERE a.code = 'amox_tri' AND b.code = 'acid_clav'
ON CONFLICT (ingredient_a_id, ingredient_b_id) DO NOTHING;

-- Tylosin + Bromhexine HCl -> Synergy (Macrolide kết hợp long đờm giúp thuốc thấm vào phế nang tốt hơn)
INSERT INTO public.active_ingredient_compatibility (ingredient_a_id, ingredient_b_id, interaction_type, description)
SELECT a.id, b.id, 'synergy', 'Bromhexine làm loãng dịch nhầy phế quản, giúp kháng sinh Tylosin dễ dàng thấm sâu vào các nang phổi bị viêm.'
FROM public.active_ingredients a, public.active_ingredients b
WHERE a.code = 'tyl_tart' AND b.code = 'brom_hcl'
ON CONFLICT (ingredient_a_id, ingredient_b_id) DO NOTHING;

-- Doxycycline + Penicillin / Amoxicillin -> Antagonism (Kháng sinh kìm khuẩn và diệt khuẩn kỵ nhau)
-- Penicillin/Amoxicillin (diệt khuẩn) cần tế bào vi khuẩn đang phân chia. Doxycycline (kìm khuẩn) ức chế phân chia nên làm mất tác dụng diệt khuẩn.
-- Note: Doxycycline is not in initial seed but we can add it, let's create a rule between Amoxicillin and Enrofloxacin/Colistin or add Doxycycline
INSERT INTO public.active_ingredients (name, code, pharmacological_group, standard_dosage, withdrawal_period_meat, withdrawal_period_milk_egg, contraindications)
VALUES ('Doxycycline Hyclate', 'doxy', 'Kháng sinh (Tetracycline)', '10%', 7, 0, 'Làm hỏng men răng của động vật non. Không dùng chung với sắt/canxi.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.active_ingredient_compatibility (ingredient_a_id, ingredient_b_id, interaction_type, description)
SELECT a.id, b.id, 'antagonism', 'Doxycycline (kìm khuẩn) ức chế sự nhân lên của vi khuẩn, làm giảm hiệu năng diệt khuẩn của Amoxicillin (đòi hỏi vi khuẩn đang phân chia để tác dụng).'
FROM public.active_ingredients a, public.active_ingredients b
WHERE a.code = 'amox_tri' AND b.code = 'doxy'
ON CONFLICT (ingredient_a_id, ingredient_b_id) DO NOTHING;

-- 9.4 Update existing diseases with etiology and symptoms, and link to species
UPDATE public.disease_dictionary SET 
  etiology = 'virus', 
  symptoms = ARRAY['Sốt cao', 'Tai tím/Da tím', 'Sảy thai', 'Chảy máu mũi', 'Chết nhanh đột ngột']
WHERE code = 'ASF';

UPDATE public.disease_dictionary SET 
  etiology = 'virus', 
  symptoms = ARRAY['Sốt cao', 'Tiêu chảy', 'Mắt có ghèn', 'Nốt đỏ xuất huyết trên da', 'Co giật']
WHERE code = 'CSF';

UPDATE public.disease_dictionary SET 
  etiology = 'virus', 
  symptoms = ARRAY['Tai xanh/Tai tím', 'Ho khan', 'Khó thở', 'Sốt chu kỳ', 'Sảy thai giai đoạn cuối']
WHERE code = 'PRRS';

UPDATE public.disease_dictionary SET 
  etiology = 'virus', 
  symptoms = ARRAY['Mụn nước quanh miệng/mũi', 'Loét móng', 'Khập khiễng', 'Bỏ ăn', 'Chảy nước bọt nhiều']
WHERE code = 'FMD';

UPDATE public.disease_dictionary SET 
  etiology = 'virus', 
  symptoms = ARRAY['Tiêu chảy cấp', 'Nôn mửa', 'Mất nước nghiêm trọng', 'Tỷ lệ chết 100% ở heo con sơ sinh']
WHERE code = 'PED';

UPDATE public.disease_dictionary SET 
  etiology = 'bacteria', 
  symptoms = ARRAY['Ho thở bụng', 'Thở thể chó ngồi', 'Sốt cao', 'Chảy máu mũi', 'Chết cấp tính']
WHERE code = 'APP';

-- Add some new diseases (e.g. Cầu trùng gà, Salmonella ở heo)
INSERT INTO public.disease_dictionary (id, code, name, category, description, is_notifiable, etiology, symptoms) VALUES
  ('bbbb0001-0000-0000-0000-000000000007', 'COCCI_GA', 'Bệnh Cầu trùng Gà (Coccidiosis)', 'Ký sinh trùng', 'Bệnh đường ruột phổ biến gây tiêu chảy phân sáp/máu tươi ở gà', false, 'parasite', ARRAY['Tiêu chảy phân sáp', 'Phân có máu tươi', 'Ủ rũ', 'Xù lông', 'Chậm lớn']),
  ('bbbb0001-0000-0000-0000-000000000008', 'SAL_HEO', 'Bệnh Thương hàn Heo (Salmonellosis)', 'Vi khuẩn', 'Gây tiêu chảy và nhiễm trùng huyết ở heo', false, 'bacteria', ARRAY['Sốt cao', 'Tiêu chảy phân vàng/xám mùi thối', 'Tai tím', 'Nốt tím ở bụng', 'Bỏ ăn'])
ON CONFLICT (id) DO NOTHING;

-- Link diseases to species
-- Heo thịt & Heo nái & Heo đực giống -> ASF, CSF, PRRS, FMD, PED, APP, SAL_HEO
INSERT INTO public.disease_species (disease_id, species_id)
SELECT d.id, s.id
FROM public.disease_dictionary d, public.species s
WHERE d.code IN ('ASF', 'CSF', 'PRRS', 'FMD', 'PED', 'APP', 'SAL_HEO')
  AND s.name IN ('Heo', 'Heo thịt', 'Heo nái', 'Heo đực giống') -- Match species by name since species table does not have a code column
ON CONFLICT DO NOTHING;

-- Fallback to match species by name if code structure is different
INSERT INTO public.disease_species (disease_id, species_id)
SELECT d.id, s.id
FROM public.disease_dictionary d, public.species s
WHERE d.code IN ('ASF', 'CSF', 'PRRS', 'FMD', 'PED', 'APP', 'SAL_HEO')
  AND s.name LIKE 'Heo%'
ON CONFLICT DO NOTHING;

-- Gà thịt & Gà đẻ -> Cầu trùng Gà
INSERT INTO public.disease_species (disease_id, species_id)
SELECT d.id, s.id
FROM public.disease_dictionary d, public.species s
WHERE d.code = 'COCCI_GA'
  AND s.name LIKE 'Gà%'
ON CONFLICT DO NOTHING;

-- Bò thịt & Dê -> FMD
INSERT INTO public.disease_species (disease_id, species_id)
SELECT d.id, s.id
FROM public.disease_dictionary d, public.species s
WHERE d.code = 'FMD'
  AND (s.name LIKE 'Bò%' OR s.name LIKE 'Dê%')
ON CONFLICT DO NOTHING;

-- 9.5 Seed disease treatment protocols (Phác đồ đa tầng)
-- Bệnh Viêm phổi dính sườn (APP) Phác đồ Line 1:
-- 1. Đặc trị: Florfenicol
-- 2. Bổ trợ triệu chứng: Dexamethasone + Bromhexine HCl
-- 3. Nâng đề kháng: Vitamin C
INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'treatment', 1, 'Florfenicol đặc trị vi khuẩn APP gây viêm phổi màng phổi.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'APP' AND a.code = 'flor'
ON CONFLICT DO NOTHING;

INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'support', 1, 'Bromhexine giúp long đờm, thông phế quản.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'APP' AND a.code = 'brom_hcl'
ON CONFLICT DO NOTHING;

INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'support', 1, 'Dexamethasone giúp kháng viêm, chống phù nề phế nang.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'APP' AND a.code = 'dexa'
ON CONFLICT DO NOTHING;

INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'resistance', 1, 'Vitamin C nâng cao sức đề kháng cơ thể, giảm sốc.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'APP' AND a.code = 'ta_duoc_vd' -- Or use Vitamin C if added
ON CONFLICT DO NOTHING;

-- Check and link Vitamin C (vit_c or check code)
UPDATE public.active_ingredients SET code = 'vit_c' WHERE name LIKE 'Vitamin C%';
INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'resistance', 1, 'Vitamin C nâng cao sức đề kháng cơ thể.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'APP' AND a.code = 'vit_c'
ON CONFLICT DO NOTHING;

-- Bệnh Viêm phổi dính sườn (APP) Phác đồ Line 2 (Thay thế khi lờn thuốc):
-- 1. Đặc trị: Enrofloxacin
-- 2. Bổ trợ triệu chứng: Paracetamol
INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'treatment', 2, 'Enrofloxacin đặc trị hô hấp phổ rộng thay thế Florfenicol.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'APP' AND a.code = 'enro'
ON CONFLICT DO NOTHING;

INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'support', 2, 'Paracetamol hạ sốt hạ nhiệt cho đàn heo bị viêm phổi sốt cao.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'APP' AND a.code = 'para'
ON CONFLICT DO NOTHING;

-- Cầu trùng Gà (COCCI_GA) Phác đồ Line 1:
-- 1. Đặc trị: Toltrazuril
-- 2. Bổ trợ triệu chứng: Điện giải
INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'treatment', 1, 'Toltrazuril đặc trị các loại cầu trùng gây tiêu chảy phân sáp/máu tươi ở gà.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'COCCI_GA' AND a.code = 'toltra'
ON CONFLICT DO NOTHING;

INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'support', 1, 'Điện giải bù nước và phục hồi thể trạng khi gà bị tiêu chảy mất nước.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'COCCI_GA' AND a.code = 'ta_duoc_vd' -- Or map to a supplement ingredient
ON CONFLICT DO NOTHING;

-- Bệnh Thương hàn Heo (SAL_HEO) Phác đồ Line 1:
-- 1. Đặc trị: Amoxicillin Trihydrate + Colistin Sulfate
-- 2. Bổ trợ: Paracetamol
INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'treatment', 1, 'Amoxicillin Trihydrate kết hợp Colistin diệt vi khuẩn Gram âm Salmonella.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'SAL_HEO' AND a.code = 'amox_tri'
ON CONFLICT DO NOTHING;

INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'treatment', 1, 'Colistin Sulfate hiệp lực tác dụng điều trị thương hàn phân thối.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'SAL_HEO' AND a.code = 'col_sulf'
ON CONFLICT DO NOTHING;

INSERT INTO public.disease_treatment_protocols (disease_id, active_ingredient_id, treatment_role, treatment_line, notes)
SELECT d.id, a.id, 'support', 1, 'Hạ sốt giảm đau do sốt thương hàn.'
FROM public.disease_dictionary d, public.active_ingredients a
WHERE d.code = 'SAL_HEO' AND a.code = 'para'
ON CONFLICT DO NOTHING;
