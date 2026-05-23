-- 1. Drop existing indexes and default values that depend on the old enums
DROP INDEX IF EXISTS idx_customers_type;
ALTER TABLE public.customers ALTER COLUMN customer_type DROP DEFAULT;
ALTER TABLE public.customers ALTER COLUMN value_tier DROP DEFAULT;

-- 2. Alter column types in customers to TEXT
ALTER TABLE public.customers ALTER COLUMN customer_type TYPE TEXT USING customer_type::TEXT;
ALTER TABLE public.customers ALTER COLUMN value_tier TYPE TEXT USING value_tier::TEXT;

-- 3. Create tables for dynamic classifications and tiers
CREATE TABLE public.customer_classifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Seed the tables with initial/legacy enum values
INSERT INTO public.customer_classifications (code, name, is_active) VALUES
  ('farm_household', 'Hộ chăn nuôi', true),
  ('farm_commercial', 'Trang trại lớn', true),
  ('dealer', 'Đại lý', true),
  ('enterprise', 'Doanh nghiệp', true),
  ('vet_clinic', 'Phòng khám', true),
  ('other', 'Khác', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.customer_tiers (code, name, is_active) VALUES
  ('normal', 'Thường', true),
  ('vip', 'VIP', true),
  ('high_potential', 'Tiềm năng', true)
ON CONFLICT (code) DO NOTHING;

-- 5. Set default values on customers table as text strings
ALTER TABLE public.customers ALTER COLUMN customer_type SET DEFAULT 'farm_household';
ALTER TABLE public.customers ALTER COLUMN value_tier SET DEFAULT 'normal';

-- 6. Recreate indexes
CREATE INDEX idx_customers_type ON public.customers(customer_type);
CREATE INDEX idx_customers_value_tier ON public.customers(value_tier);

-- 7. Enable RLS and create policies
ALTER TABLE public.customer_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_classifications_select_all" ON public.customer_classifications
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "customer_classifications_manage_admin" ON public.customer_classifications
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "customer_tiers_select_all" ON public.customer_tiers
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "customer_tiers_manage_admin" ON public.customer_tiers
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());
