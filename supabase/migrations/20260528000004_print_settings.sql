-- ============================================================
-- CRM SANHLONGVETCO
-- Migration: 20260528000004_print_settings.sql
-- Mô tả: Thêm cột cấu hình in ấn (print settings) vào bảng display_settings
--        Cho phép admin cấu hình header công ty trên chứng từ và khổ giấy mặc định
-- Thứ tự chạy: sau 20260523000000_display_settings.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Thêm cột print settings vào display_settings
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.display_settings
  ADD COLUMN IF NOT EXISTS print_company_name       TEXT    NOT NULL DEFAULT 'CÔNG TY VẬT TƯ THUỐC THÚ Y SANH LONG',
  ADD COLUMN IF NOT EXISTS print_company_address    TEXT    NOT NULL DEFAULT '789 Đường Thú Y, Phường Bình An, TP. Hồ Chí Minh',
  ADD COLUMN IF NOT EXISTS print_company_phone      TEXT    NOT NULL DEFAULT '0945.195.156 - 1900 6789',
  ADD COLUMN IF NOT EXISTS print_company_email      TEXT    NOT NULL DEFAULT 'lienhe@sanhlongvetco.vn',
  ADD COLUMN IF NOT EXISTS print_company_mst        TEXT    NOT NULL DEFAULT '4101672005',
  ADD COLUMN IF NOT EXISTS print_company_website    TEXT    NOT NULL DEFAULT 'www.sanhlongvetco.vn',
  ADD COLUMN IF NOT EXISTS print_company_logo_url   TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS print_default_paper      TEXT    NOT NULL DEFAULT 'A4'   CHECK (print_default_paper IN ('A4', 'A5')),
  ADD COLUMN IF NOT EXISTS print_default_orientation TEXT   NOT NULL DEFAULT 'portrait' CHECK (print_default_orientation IN ('portrait', 'landscape'));

-- ─────────────────────────────────────────────────────────────
-- 2. Comment mô tả các cột mới
-- ─────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.display_settings.print_company_name        IS 'Tên công ty hiển thị trên header chứng từ in';
COMMENT ON COLUMN public.display_settings.print_company_address     IS 'Địa chỉ công ty trên chứng từ in';
COMMENT ON COLUMN public.display_settings.print_company_phone       IS 'Số điện thoại liên hệ trên chứng từ';
COMMENT ON COLUMN public.display_settings.print_company_email       IS 'Email liên hệ trên chứng từ';
COMMENT ON COLUMN public.display_settings.print_company_mst         IS 'Mã số thuế doanh nghiệp';
COMMENT ON COLUMN public.display_settings.print_company_website     IS 'Website công ty';
COMMENT ON COLUMN public.display_settings.print_company_logo_url    IS 'URL logo công ty (tuỳ chọn, hiển thị thay chữ SL)';
COMMENT ON COLUMN public.display_settings.print_default_paper       IS 'Khổ giấy mặc định: A4 | A5';
COMMENT ON COLUMN public.display_settings.print_default_orientation IS 'Hướng in mặc định: portrait | landscape';
