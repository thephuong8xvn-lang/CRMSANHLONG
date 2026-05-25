-- ============================================================
-- CRM SANHLONGVETCO – SEED DATA: PRODUCT CATEGORIES & BRANDS
-- File: 20260525000007_seed_product_categories_and_brands.sql
-- Mô tả: Dữ liệu mẫu cho danh mục sản phẩm và thương hiệu thú y
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. SEED: product_categories (Danh mục sản phẩm thú y)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.product_categories (code, name, sort_order, is_active) VALUES
  ('VAC',  'Vaccine & Sinh phẩm',              1, true),
  ('MED',  'Thuốc điều trị & Kháng sinh',      2, true),
  ('PARA', 'Thuốc ký sinh trùng & Sát khuẩn',  3, true),
  ('NUTR', 'Dinh dưỡng & Premix',              4, true),
  ('SUPP', 'Sản phẩm hỗ trợ & Bổ sung',       5, true),
  ('DIS',  'Dụng cụ chăn nuôi & Tiêm chích',  6, true),
  ('EQU',  'Thiết bị & Máy móc chăn nuôi',    7, true),
  ('CHM',  'Hóa chất sát trùng chuồng trại',  8, true),
  ('FEED', 'Thức ăn chăn nuôi',               9, true),
  ('TRAD', 'Đông y & Thảo dược thú y',        10, true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      sort_order = EXCLUDED.sort_order,
      is_active = EXCLUDED.is_active;

-- ─────────────────────────────────────────────────────────────
-- 2. SEED: brands (Thương hiệu / Nhà sản xuất)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.brands (name, country, is_active) VALUES
  ('Navetco',         'Việt Nam',     true),
  ('Hanvet',          'Việt Nam',     true),
  ('Vemedim',         'Việt Nam',     true),
  ('Biovac',          'Việt Nam',     true),
  ('Merial (Boehringer)', 'Pháp',     true),
  ('Zoetis',          'Mỹ',           true),
  ('Elanco',          'Mỹ',           true),
  ('MSD Animal Health','Mỹ',          true),
  ('Huvepharma',      'Bulgaria',     true),
  ('Hipra',           'Tây Ban Nha',  true),
  ('Ceva',            'Pháp',         true),
  ('Intervet',        'Hà Lan',       true),
  ('Bio Pharmasin',   'Thái Lan',     true),
  ('Thysol',          'Hà Lan',       true),
  ('VET PHARMA',      'Việt Nam',     true),
  ('Khác / Không rõ', NULL,           true)
ON CONFLICT (name) DO UPDATE
  SET country = EXCLUDED.country,
      is_active = EXCLUDED.is_active;

-- ─────────────────────────────────────────────────────────────
-- 3. SEED: price_lists (Bảng giá mặc định)
-- Đảm bảo 3 bảng giá chuẩn tồn tại
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.price_lists (code, name, description, is_active) VALUES
  ('GIA-LE',  'Giá bán lẻ đề xuất', 'Giá bán lẻ cho hộ chăn nuôi nhỏ lẻ',           true),
  ('GIA-DL',  'Giá đại lý',         'Giá dành cho đại lý phân phối (Giảm ~15%)',      true),
  ('GIA-VIP', 'Giá VIP / Trang trại','Giá ưu đãi cho trang trại lớn và khách VIP (Giảm ~25%)', true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_active = EXCLUDED.is_active;

-- ─────────────────────────────────────────────────────────────
-- 4. ENSURE: product_units có đủ dữ liệu cơ bản
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.product_units (name, is_active) VALUES
  ('lọ',    true),
  ('kg',    true),
  ('gói',   true),
  ('cái',   true),
  ('lon',   true),
  ('túi',   true),
  ('chai',  true),
  ('hộp',   true),
  ('liều',  true),
  ('ml',    true),
  ('g',     true),
  ('L',     true),
  ('thùng', true),
  ('cuộn',  true)
ON CONFLICT (name) DO UPDATE
  SET is_active = EXCLUDED.is_active;
