-- ============================================================
-- Migration: Fix fn_fill_org_from_owner trigger bug
-- File: 20260610000000_fix-fill-org-trigger.sql
-- Mục đích:
--   Sửa lỗi: record "new" has no field "branch_id" khi tạo dự án chăn nuôi
--   (bảng herd_projects không có cột branch_id).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_fill_org_from_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team_id   UUID;
  v_branch_id UUID;
BEGIN
  SELECT team_id, branch_id INTO v_team_id, v_branch_id
  FROM public.profiles
  WHERE id = NEW.owner_user_id;

  -- Sử dụng EXCEPTION block để tự động bỏ qua nếu bảng không có cột tương ứng
  BEGIN
    IF NEW.team_id IS NULL THEN
      NEW.team_id := v_team_id;
    END IF;
  EXCEPTION WHEN undefined_column THEN
    -- Bỏ qua nếu bảng không có cột team_id
  END;

  BEGIN
    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := v_branch_id;
    END IF;
  EXCEPTION WHEN undefined_column THEN
    -- Bỏ qua nếu bảng không có cột branch_id
  END;

  RETURN NEW;
END;
$$;
