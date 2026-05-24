-- ============================================================
-- Migration: Add job_title to profiles table
-- File: 20260524000000_add_job_title.sql
-- Mô tả: Thêm trường chức danh (job_title) cho nhân viên
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS job_title TEXT;

COMMENT ON COLUMN public.profiles.job_title IS 'Chức danh công việc (VD: Nhân viên kinh doanh, Bác sĩ thú y...)';
