-- ============================================================
-- Migration: Herd-Projects — RPC công việc sắp tới (overview + dashboard)
-- File: 20260611000000_herd_overview.sql
-- Mục đích:
--   Hàm SECURITY DEFINER trả về các bước (steps) đang chờ có ngày kế hoạch
--   trong N ngày tới (gồm cả quá hạn) của các dự án đang hoạt động.
--   Cho phép MỌI nhân sự đang hoạt động xem để nhắc nhau (widget Dashboard),
--   chỉ trả field không nhạy cảm (không lộ chi phí/lợi nhuận).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_upcoming_herd_tasks(p_days int DEFAULT 7)
RETURNS TABLE (
  step_id       uuid,
  project_id    uuid,
  project_code  text,
  project_name  text,
  customer_name text,
  step_name     text,
  planned_date  date,
  assigned_to   uuid,
  assigned_name text,
  days_left     int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, hp.id, hp.project_code, hp.name, c.farm_name,
    s.step_name, s.planned_date, s.assigned_to, pr.full_name,
    (s.planned_date - CURRENT_DATE)::int
  FROM public.herd_project_steps s
  JOIN public.herd_projects hp ON hp.id = s.project_id AND hp.status = 'active'
  LEFT JOIN public.customers c  ON c.id = hp.customer_id
  LEFT JOIN public.profiles pr  ON pr.id = s.assigned_to
  WHERE public.fn_is_active()
    AND s.status = 'pending'
    AND s.planned_date IS NOT NULL
    AND s.planned_date <= CURRENT_DATE + p_days
  ORDER BY s.planned_date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_upcoming_herd_tasks(int) TO authenticated;
