-- ============================================================
-- Migration: Fix herd-projects schema bugs
-- File: 20260528000000_fix-herd-projects-schema.sql
-- Fixes:
--   1. Add farm_id column to herd_projects (FormPage inserts it but column was missing)
--   2. Add photos column to herd_project_steps (DetailPage reads/writes it)
--   3. Add 'failed' to status CHECK constraint (frontend uses 4 statuses)
--   4. Add UNIQUE(project_id) to herd_project_outcomes (for correct upsert behavior)
--   5. Add SELECT policy for vet_consultant on herd_projects
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ADD farm_id to herd_projects
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.herd_projects
  ADD COLUMN IF NOT EXISTS farm_id UUID REFERENCES public.farms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_herd_proj_farm ON public.herd_projects(farm_id);


-- ─────────────────────────────────────────────────────────────
-- 2. ADD photos column to herd_project_steps
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.herd_project_steps
  ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT NULL;


-- ─────────────────────────────────────────────────────────────
-- 3. FIX status CHECK constraint to include 'failed'
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.herd_project_steps
  DROP CONSTRAINT IF EXISTS herd_project_steps_status_check;

ALTER TABLE public.herd_project_steps
  ADD CONSTRAINT herd_project_steps_status_check
  CHECK (status IN ('pending', 'done', 'skipped', 'failed'));


-- ─────────────────────────────────────────────────────────────
-- 4. ADD UNIQUE constraint on herd_project_outcomes.project_id
--    Required for upsert onConflict:'project_id' to work correctly
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.herd_project_outcomes
  ADD CONSTRAINT herd_project_outcomes_project_id_unique UNIQUE (project_id);


-- ─────────────────────────────────────────────────────────────
-- 5. ADD RLS SELECT policy for vet_consultant
--    vet_consultant has herd_projects.view_all permission but no matching RLS policy
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "herd_proj_select_vet" ON public.herd_projects;

CREATE POLICY "herd_proj_select_vet" ON public.herd_projects
  FOR SELECT USING (
    public.fn_has_role('vet_consultant')
    AND public.fn_is_active()
  );
