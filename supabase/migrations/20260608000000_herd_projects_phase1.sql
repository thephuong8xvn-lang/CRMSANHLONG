-- ============================================================
-- Migration: Herd-Projects Phase 1 (nền tảng)
-- File: 20260608000000_herd_projects_phase1.sql
--
-- Bổ sung: thành viên dự án (watcher đa người, đa chi nhánh) + chi phí
-- chi tiết + field đàn (giá giống/dự kiến xuất) + đánh giá theo task +
-- RLS theo thành viên + trigger toàn vẹn + view danh sách + quyền UI.
-- herd_projects đang 0 dòng → an toàn viết lại RLS.
-- ============================================================

-- ── 1. herds: giá giống + dự kiến xuất ──────────────────────
ALTER TABLE public.herds
  ADD COLUMN IF NOT EXISTS breed_price        NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS expected_exit_date DATE;

-- ── 2. herd_project_steps: người được giao + đánh giá ───────
ALTER TABLE public.herd_project_steps
  ADD COLUMN IF NOT EXISTS assigned_to         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_rating      SMALLINT CHECK (manager_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS manager_rating_note TEXT,
  ADD COLUMN IF NOT EXISTS customer_rating     SMALLINT CHECK (customer_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS customer_rating_note TEXT;

-- ── 3. Thành viên dự án ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.herd_project_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.herd_projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','collaborator','manager')),
  added_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_herd_members_project ON public.herd_project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_herd_members_user    ON public.herd_project_members(user_id);

-- ── 4. Chi phí dự án (nguồn duy nhất của "chi phí đến hiện tại") ──
CREATE TABLE IF NOT EXISTS public.herd_project_costs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES public.herd_projects(id) ON DELETE CASCADE,
  step_id       UUID REFERENCES public.herd_project_steps(id) ON DELETE SET NULL,
  cost_type     TEXT NOT NULL DEFAULT 'other' CHECK (cost_type IN ('product','feed','labor','medicine','other')),
  product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
  quantity      NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_cost     NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  incurred_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_herd_costs_project ON public.herd_project_costs(project_id);
CREATE INDEX IF NOT EXISTS idx_herd_costs_step    ON public.herd_project_costs(step_id);

-- ── 5. Helper RLS (SECURITY DEFINER → đọc membership bỏ qua RLS, tránh đệ quy) ──
CREATE OR REPLACE FUNCTION public.fn_can_view_herd_project(p UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_is_active() AND (
    public.fn_is_admin()
    OR public.fn_has_role('branch_manager')
    OR public.fn_has_role('vet_consultant')
    OR EXISTS (
      SELECT 1 FROM public.herd_projects hp
      WHERE hp.id = p AND (
        hp.owner_user_id = auth.uid()
        OR (public.fn_has_role('team_lead') AND hp.team_id = public.fn_my_team_id())
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.herd_project_members m
      WHERE m.project_id = p AND m.user_id = auth.uid()
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_can_edit_herd_project(p UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_is_active() AND (
    public.fn_is_admin()
    OR public.fn_has_role('vet_consultant')
    OR EXISTS (
      SELECT 1 FROM public.herd_projects hp
      LEFT JOIN public.profiles pr ON pr.id = hp.owner_user_id
      WHERE hp.id = p AND (
        hp.owner_user_id = auth.uid()
        OR (public.fn_has_role('team_lead') AND hp.team_id = public.fn_my_team_id())
        OR (public.fn_has_role('branch_manager') AND pr.branch_id = public.fn_my_branch_id())
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.herd_project_members m
      WHERE m.project_id = p AND m.user_id = auth.uid() AND m.role IN ('collaborator','manager')
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_can_manage_herd_members(p UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_is_active() AND (
    public.fn_is_admin()
    OR EXISTS (SELECT 1 FROM public.herd_projects hp WHERE hp.id = p AND hp.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.herd_project_members m WHERE m.project_id = p AND m.user_id = auth.uid() AND m.role = 'manager')
  );
$$;

-- ── 6. Viết lại RLS herd_projects (SELECT/UPDATE/DELETE qua helper) ──
DROP POLICY IF EXISTS herd_proj_select_admin     ON public.herd_projects;
DROP POLICY IF EXISTS herd_proj_select_sales     ON public.herd_projects;
DROP POLICY IF EXISTS herd_proj_select_team_lead ON public.herd_projects;
DROP POLICY IF EXISTS herd_proj_select_vet       ON public.herd_projects;
DROP POLICY IF EXISTS herd_proj_update_owner     ON public.herd_projects;
DROP POLICY IF EXISTS herd_proj_delete_admin     ON public.herd_projects;

CREATE POLICY herd_proj_select ON public.herd_projects
  FOR SELECT USING (public.fn_can_view_herd_project(id));
CREATE POLICY herd_proj_update ON public.herd_projects
  FOR UPDATE USING (public.fn_can_edit_herd_project(id))
  WITH CHECK (public.fn_can_edit_herd_project(id));
CREATE POLICY herd_proj_delete ON public.herd_projects
  FOR DELETE USING (
    public.fn_is_active() AND (
      public.fn_is_admin()
      OR EXISTS (SELECT 1 FROM public.herd_projects hp WHERE hp.id = herd_projects.id AND hp.owner_user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.herd_project_members m WHERE m.project_id = herd_projects.id AND m.user_id = auth.uid() AND m.role = 'manager')
    )
  );
-- INSERT (herd_proj_insert_active) giữ nguyên — đã đúng (create permission + owner/role).

-- ── 7. RLS steps / outcomes (qua helper) ────────────────────
DROP POLICY IF EXISTS herd_steps_select ON public.herd_project_steps;
DROP POLICY IF EXISTS herd_steps_manage ON public.herd_project_steps;
CREATE POLICY herd_steps_select ON public.herd_project_steps
  FOR SELECT USING (public.fn_can_view_herd_project(project_id));
CREATE POLICY herd_steps_manage ON public.herd_project_steps
  FOR ALL USING (public.fn_can_edit_herd_project(project_id))
  WITH CHECK (public.fn_can_edit_herd_project(project_id));

DROP POLICY IF EXISTS herd_outcomes_select ON public.herd_project_outcomes;
DROP POLICY IF EXISTS herd_outcomes_manage ON public.herd_project_outcomes;
CREATE POLICY herd_outcomes_select ON public.herd_project_outcomes
  FOR SELECT USING (public.fn_can_view_herd_project(project_id));
CREATE POLICY herd_outcomes_manage ON public.herd_project_outcomes
  FOR ALL USING (public.fn_can_edit_herd_project(project_id))
  WITH CHECK (public.fn_can_edit_herd_project(project_id));

-- ── 8. RLS bảng mới ─────────────────────────────────────────
ALTER TABLE public.herd_project_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY herd_costs_select ON public.herd_project_costs
  FOR SELECT USING (public.fn_can_view_herd_project(project_id));
CREATE POLICY herd_costs_manage ON public.herd_project_costs
  FOR ALL USING (public.fn_can_edit_herd_project(project_id))
  WITH CHECK (public.fn_can_edit_herd_project(project_id));

ALTER TABLE public.herd_project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY herd_members_select ON public.herd_project_members
  FOR SELECT USING (public.fn_can_view_herd_project(project_id));
CREATE POLICY herd_members_manage ON public.herd_project_members
  FOR ALL USING (public.fn_can_manage_herd_members(project_id))
  WITH CHECK (public.fn_can_manage_herd_members(project_id));

-- ── 9. Trigger toàn vẹn customer↔farm↔herd ──────────────────
CREATE OR REPLACE FUNCTION public.fn_herd_project_check_consistency()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.herd_id IS NOT NULL AND NEW.farm_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.herds h WHERE h.id = NEW.herd_id AND h.farm_id = NEW.farm_id) THEN
      RAISE EXCEPTION 'Đàn không thuộc trại đã chọn.';
    END IF;
  END IF;
  IF NEW.farm_id IS NOT NULL AND NEW.customer_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.farms f WHERE f.id = NEW.farm_id AND f.customer_id = NEW.customer_id) THEN
      RAISE EXCEPTION 'Trại không thuộc khách hàng đã chọn.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_herd_proj_consistency ON public.herd_projects;
CREATE TRIGGER trg_herd_proj_consistency
  BEFORE INSERT OR UPDATE ON public.herd_projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_herd_project_check_consistency();

-- ── 10. View danh sách (security_invoker → giữ RLS theo thành viên) ──
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
    ELSE 0 END AS mortality_rate
FROM public.herd_projects hp
LEFT JOIN public.customers c          ON c.id = hp.customer_id
LEFT JOIN public.farms f              ON f.id = hp.farm_id
LEFT JOIN public.herds h              ON h.id = hp.herd_id
LEFT JOIN public.species sp           ON sp.id = h.species_id
LEFT JOIN public.herd_project_types pt ON pt.id = hp.project_type_id
LEFT JOIN public.profiles pr          ON pr.id = hp.owner_user_id;

-- ── 11. Quyền UI (RLS thực thi qua role+member, perm chỉ để gate nút) ──
INSERT INTO public.permissions (code, module, action, description) VALUES
  ('herd_projects.update',         'herd_projects', 'update', 'Cập nhật dự án đàn'),
  ('herd_projects.delete',         'herd_projects', 'delete', 'Xóa dự án đàn'),
  ('herd_projects.manage_members', 'herd_projects', 'manage', 'Quản lý thành viên dự án')
ON CONFLICT (code) DO NOTHING;

-- Cấp update + manage_members cho các role đang có herd_projects.create
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p2.id
FROM public.role_permissions rp
JOIN public.permissions p1 ON p1.id = rp.permission_id AND p1.code = 'herd_projects.create'
JOIN public.permissions p2 ON p2.code IN ('herd_projects.update','herd_projects.manage_members')
ON CONFLICT DO NOTHING;

-- Cấp delete cho admin / branch_manager / team_lead
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code = 'herd_projects.delete'
WHERE r.code IN ('admin','branch_manager','team_lead')
ON CONFLICT DO NOTHING;
