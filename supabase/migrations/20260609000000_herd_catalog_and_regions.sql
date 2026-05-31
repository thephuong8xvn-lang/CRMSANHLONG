-- ============================================================
-- Migration: Herd-Projects — danh mục Khu vực + status Vật nuôi +
--   region_id (farms/herd_projects) + chi phí con giống + nới quyền CRUD danh mục.
-- File: 20260609000000_herd_catalog_and_regions.sql
-- ============================================================

-- ── 1. species: trạng thái ──────────────────────────────────
ALTER TABLE public.species
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- ── 2. Danh mục Khu vực ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.herd_regions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  code       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_herd_regions_name ON public.herd_regions(name);

-- ── 3. region_id trên farms & herd_projects ─────────────────
ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES public.herd_regions(id) ON DELETE SET NULL;
ALTER TABLE public.herd_projects
  ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES public.herd_regions(id) ON DELETE SET NULL;

-- ── 4. Chi phí con giống (breeding_stock) ───────────────────
ALTER TABLE public.herd_project_costs DROP CONSTRAINT IF EXISTS herd_project_costs_cost_type_check;
ALTER TABLE public.herd_project_costs ADD CONSTRAINT herd_project_costs_cost_type_check
  CHECK (cost_type IN ('product','feed','labor','medicine','breeding_stock','other'));

-- ── 5. RLS ──────────────────────────────────────────────────
-- Điều kiện quản lý danh mục dùng chung: admin hoặc có quyền cập nhật dự án đàn.
ALTER TABLE public.herd_regions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS herd_regions_select ON public.herd_regions;
DROP POLICY IF EXISTS herd_regions_manage ON public.herd_regions;
CREATE POLICY herd_regions_select ON public.herd_regions
  FOR SELECT USING (public.fn_is_active());
CREATE POLICY herd_regions_manage ON public.herd_regions
  FOR ALL USING (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('herd_projects.update')))
  WITH CHECK (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('herd_projects.update')));

-- Nới quyền quản lý species / herd_project_types để modal CRUD chạy cho quản lý (không chỉ admin)
DROP POLICY IF EXISTS species_manage_admin ON public.species;
CREATE POLICY species_manage ON public.species
  FOR ALL USING (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('herd_projects.update')))
  WITH CHECK (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('herd_projects.update')));

DROP POLICY IF EXISTS herd_types_manage_admin ON public.herd_project_types;
CREATE POLICY herd_types_manage ON public.herd_project_types
  FOR ALL USING (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('herd_projects.update')))
  WITH CHECK (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('herd_projects.update')));

-- ── 6. Cập nhật view danh sách (thêm khu vực) ───────────────
CREATE OR REPLACE VIEW public.herd_project_list_view
WITH (security_invoker = true) AS
SELECT
  hp.id, hp.project_code, hp.name, hp.status, hp.start_date, hp.end_date,
  hp.head_count, hp.created_at,
  hp.customer_id, c.farm_name AS customer_name, c.province, c.district,
  hp.farm_id, f.name AS farm_name,
  hp.herd_id, h.species_id, sp.name AS species_name, h.breed, h.entry_date, h.expected_exit_date,
  hp.project_type_id, pt.name AS project_type_name,
  hp.owner_user_id, pr.full_name AS owner_name, hp.team_id,
  CASE WHEN h.entry_date IS NOT NULL THEN (CURRENT_DATE - h.entry_date) END AS age_days,
  (SELECT count(*) FROM public.herd_project_members m WHERE m.project_id = hp.id) AS member_count,
  COALESCE((SELECT sum(co.amount) FROM public.herd_project_costs co WHERE co.project_id = hp.id), 0) AS cost_to_date,
  COALESCE((SELECT sum(o.head_died) FROM public.herd_project_outcomes o WHERE o.project_id = hp.id), 0) AS died_total,
  CASE WHEN hp.head_count > 0
    THEN round(COALESCE((SELECT sum(o.head_died) FROM public.herd_project_outcomes o WHERE o.project_id = hp.id), 0)::numeric / hp.head_count * 100, 2)
    ELSE 0 END AS mortality_rate,
  COALESCE(hp.region_id, f.region_id) AS region_id,
  rg.name AS region_name
FROM public.herd_projects hp
LEFT JOIN public.customers c           ON c.id = hp.customer_id
LEFT JOIN public.farms f               ON f.id = hp.farm_id
LEFT JOIN public.herds h               ON h.id = hp.herd_id
LEFT JOIN public.species sp            ON sp.id = h.species_id
LEFT JOIN public.herd_project_types pt ON pt.id = hp.project_type_id
LEFT JOIN public.profiles pr           ON pr.id = hp.owner_user_id
LEFT JOIN public.herd_regions rg       ON rg.id = COALESCE(hp.region_id, f.region_id);
