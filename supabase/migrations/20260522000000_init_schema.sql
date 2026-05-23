-- ============================================================
-- CRM SANHLONGVETCO – SUPABASE SCHEMA HOÀN CHỈNH
-- File: 20260522000000_init_schema.sql
-- Mô tả: Extensions, Enums, Tables, Indexes, Constraints
-- Bao gồm: Phase 1 (core) + Phase 2 (CRM) + Phase 3 (herd)
-- Thứ tự chạy: 01 → 02 → 03 → 04
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- Full-text search tiếng Việt
CREATE EXTENSION IF NOT EXISTS "unaccent";       -- Bỏ dấu để tìm kiếm không dấu

-- ─────────────────────────────────────────────────────────────
-- 1. ENUM TYPES – Toàn bộ nghiệp vụ
-- ─────────────────────────────────────────────────────────────

-- Loại hình khách hàng
CREATE TYPE customer_type AS ENUM (
  'farm_household',     -- Hộ chăn nuôi
  'farm_commercial',    -- Trang trại thương mại
  'dealer',             -- Đại lý phân phối
  'enterprise',         -- Doanh nghiệp
  'vet_clinic',         -- Phòng khám thú y
  'other'               -- Khác
);

-- Chế độ thanh toán công nợ của khách hàng
CREATE TYPE customer_billing_mode AS ENUM (
  'per_order',          -- Thanh toán từng đơn
  'period_consolidated' -- Thanh toán theo kỳ (cuối tháng)
);

-- Vòng đời khách hàng
CREATE TYPE customer_lifecycle_stage AS ENUM (
  'new',           -- Mới tiếp cận
  'active',        -- Đang giao dịch thường xuyên
  'at_risk',       -- Có dấu hiệu ngừng mua
  'churned'        -- Đã mất
);

-- Phân tier giá trị khách hàng
CREATE TYPE customer_value_tier AS ENUM (
  'normal',         -- Khách thường
  'vip',            -- VIP
  'high_potential'  -- Tiềm năng cao
);

-- Loại kho
CREATE TYPE warehouse_type AS ENUM (
  'main',           -- Kho tổng
  'cold_chain',     -- Kho lạnh (vaccine, sinh phẩm)
  'equipment',      -- Kho thiết bị chăn nuôi
  'quarantine',     -- Kho kiểm dịch
  'returns'         -- Kho hàng trả về
);

-- Trạng thái lô hàng
CREATE TYPE stock_lot_status AS ENUM (
  'active',      -- Đang bán
  'quarantine',  -- Đang kiểm định
  'expired',     -- Đã hết hạn
  'damaged',     -- Bị hỏng
  'disposed'     -- Đã hủy
);

-- Loại chuyển kho
CREATE TYPE stock_movement_type AS ENUM (
  'receipt',                -- Nhập kho từ nhà cung cấp
  'sale',                   -- Xuất bán hàng
  'return_from_customer',   -- Nhập hàng trả từ khách
  'return_to_supplier',     -- Xuất trả nhà cung cấp
  'transfer_out',           -- Xuất chuyển sang kho khác
  'transfer_in',            -- Nhập nhận từ kho khác
  'adjustment_increase',    -- Điều chỉnh tăng (kiểm kê)
  'adjustment_decrease',    -- Điều chỉnh giảm (kiểm kê)
  'expiry_writeoff',        -- Xuất hủy hết hạn
  'damage_writeoff'         -- Xuất hủy hỏng hóc
);

-- Trạng thái đơn đặt hàng NCC
CREATE TYPE purchase_order_status AS ENUM (
  'draft',              -- Nháp
  'sent',               -- Đã gửi nhà cung cấp
  'partially_received', -- Nhận một phần
  'received',           -- Đã nhận đủ
  'cancelled'           -- Đã hủy
);

-- Trạng thái đơn hàng bán
CREATE TYPE order_status AS ENUM (
  'draft',            -- Nháp
  'confirmed',        -- Đã xác nhận
  'shipping',         -- Đang giao
  'delivered',        -- Đã giao hàng
  'paid',             -- Đã thanh toán
  'completed',        -- Hoàn tất
  'cancelled',        -- Đã hủy
  'returned_partial', -- Trả hàng một phần
  'returned_full'     -- Trả hàng toàn bộ
);

-- Phương thức thanh toán đơn hàng
CREATE TYPE order_payment_method AS ENUM (
  'cash',           -- Tiền mặt
  'bank_transfer',  -- Chuyển khoản
  'card_pos',       -- Quẹt thẻ POS
  'credit',         -- Nợ (ghi công nợ)
  'voucher',        -- Phiếu giảm giá
  'loyalty_points'  -- Điểm tích lũy
);

-- Trạng thái thanh toán đơn hàng
CREATE TYPE order_payment_status AS ENUM (
  'unpaid',           -- Chưa thanh toán
  'partially_paid',   -- Đã thanh toán một phần
  'paid'              -- Đã thanh toán đủ
);

-- Trạng thái hóa đơn VAT
CREATE TYPE invoice_status AS ENUM (
  'draft',      -- Nháp
  'issued',     -- Đã xuất
  'cancelled',  -- Đã hủy
  'adjusted'    -- Đã điều chỉnh
);

-- Loại dòng tiền sổ quỹ
CREATE TYPE cashbook_flow_type AS ENUM (
  'inflow',           -- Thu tiền
  'outflow',          -- Chi tiền
  'internal_transfer' -- Chuyển nội bộ giữa quỹ/tài khoản
);

-- Trạng thái phiếu sổ quỹ
CREATE TYPE cashbook_status AS ENUM (
  'draft',            -- Nháp
  'pending_approval', -- Chờ duyệt
  'approved',         -- Đã duyệt
  'cancelled'         -- Đã hủy
);

-- Trạng thái phiên thu ngân
CREATE TYPE cashier_session_status AS ENUM (
  'open',     -- Đang mở ca
  'closed',   -- Đã đóng ca
  'reopened'  -- Mở lại để chỉnh sửa
);

-- Trạng thái cơ hội bán hàng
CREATE TYPE opportunity_status AS ENUM (
  'open',      -- Đang tiến hành
  'won',       -- Đã thắng
  'lost',      -- Đã thua
  'abandoned'  -- Bỏ cơ hội
);

-- Trạng thái hoạt động
CREATE TYPE activity_status AS ENUM (
  'planned',      -- Đã lên lịch
  'in_progress',  -- Đang thực hiện
  'done',         -- Hoàn thành
  'cancelled',    -- Đã hủy
  'missed'        -- Đã bỏ lỡ (quá hạn)
);

-- Trạng thái dự án đàn
CREATE TYPE herd_project_status AS ENUM (
  'draft',      -- Nháp
  'active',     -- Đang triển khai
  'on_hold',    -- Tạm ngừng
  'completed',  -- Hoàn thành
  'cancelled'   -- Đã hủy
);

-- Mức độ cảnh báo tồn kho
CREATE TYPE alert_severity AS ENUM (
  'info',     -- Thông tin
  'warning',  -- Cảnh báo
  'critical'  -- Khẩn cấp
);

-- Trạng thái cảnh báo
CREATE TYPE alert_status AS ENUM (
  'active',       -- Đang kích hoạt
  'acknowledged', -- Đã xác nhận
  'resolved'      -- Đã giải quyết
);

-- ─────────────────────────────────────────────────────────────
-- 2. NHÓM BẢNG TỔ CHỨC
-- ─────────────────────────────────────────────────────────────

-- Chi nhánh
CREATE TABLE public.branches (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,   -- VD: CN-HCM, CN-DN, CN-CT
  name        TEXT        NOT NULL,
  address     TEXT,
  phone       TEXT,
  manager_id  UUID,                          -- FK → profiles (set sau)
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.branches IS 'Danh sách chi nhánh của Sanh Long Vetco';

-- Kho hàng
CREATE TABLE public.warehouses (
  id           UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id    UUID           NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  code         TEXT           NOT NULL UNIQUE,  -- VD: KHO-HCM-01
  name         TEXT           NOT NULL,
  type         warehouse_type NOT NULL DEFAULT 'main',
  address      TEXT,
  temperature_min NUMERIC(5,1),  -- Nhiệt độ tối thiểu (kho lạnh)
  temperature_max NUMERIC(5,1),  -- Nhiệt độ tối đa (kho lạnh)
  is_active    BOOLEAN        NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.warehouses IS 'Kho hàng theo chi nhánh';

-- Nhóm sales
CREATE TABLE public.teams (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id   UUID        NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  code        TEXT        NOT NULL UNIQUE,   -- VD: TEAM-MD, TEAM-MT
  name        TEXT        NOT NULL,
  description TEXT,
  lead_id     UUID,                          -- FK → profiles (set sau)
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.teams IS 'Nhóm bán hàng theo chi nhánh';

-- Hồ sơ người dùng (1-1 với auth.users)
CREATE TABLE public.profiles (
  id             UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT        NOT NULL UNIQUE,
  full_name      TEXT,
  phone          TEXT,
  branch_id      UUID        REFERENCES public.branches(id) ON DELETE SET NULL,
  team_id        UUID        REFERENCES public.teams(id) ON DELETE SET NULL,
  employee_code  TEXT        UNIQUE,  -- Mã nhân viên nội bộ
  auth_providers TEXT[]      NOT NULL DEFAULT ARRAY['email'],
  avatar_url     TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  notes          TEXT,       -- Ghi chú nội bộ (VD: nghỉ thai sản)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.profiles IS 'Hồ sơ nhân viên, 1-1 với auth.users';

-- Thêm FK từ branches/teams về profiles sau khi profiles đã được tạo
ALTER TABLE public.branches
  ADD CONSTRAINT fk_branches_manager
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.teams
  ADD CONSTRAINT fk_teams_lead
  FOREIGN KEY (lead_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. NHÓM BẢNG PHÂN QUYỀN ĐỘNG (TABLE-BASED RBAC)
-- ─────────────────────────────────────────────────────────────

-- Vai trò hệ thống
CREATE TABLE public.roles (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,  -- VD: admin, sales, accountant
  name        TEXT        NOT NULL,         -- Tên hiển thị
  description TEXT,
  is_system   BOOLEAN     NOT NULL DEFAULT false,  -- Role hệ thống không xóa được
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.roles IS 'Danh mục vai trò trong hệ thống RBAC';

-- Danh mục quyền
CREATE TABLE public.permissions (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,   -- VD: customers.create, orders.view_all
  module      TEXT        NOT NULL,          -- VD: customers, orders, cashbook
  action      TEXT        NOT NULL,          -- VD: create, view, update, delete, approve
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.permissions IS 'Danh mục quyền chi tiết';

-- Gán quyền cho vai trò
CREATE TABLE public.role_permissions (
  role_id       UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
COMMENT ON TABLE public.role_permissions IS 'Bảng giao nhau: role → permissions';

-- Gán vai trò cho người dùng (1 user có thể có nhiều role)
CREATE TABLE public.user_roles (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
COMMENT ON TABLE public.user_roles IS 'Bảng giao nhau: user → roles';

-- ─────────────────────────────────────────────────────────────
-- 4. NHÓM BẢNG SẢN PHẨM & GIÁ
-- ─────────────────────────────────────────────────────────────

-- Danh mục sản phẩm
CREATE TABLE public.product_categories (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id   UUID        REFERENCES public.product_categories(id) ON DELETE SET NULL,
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.product_categories IS 'Danh mục sản phẩm đa cấp';

-- Thương hiệu / Nhà sản xuất
CREATE TABLE public.brands (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL UNIQUE,
  country     TEXT,       -- Quốc gia sản xuất
  website     TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.brands IS 'Thương hiệu/nhà sản xuất';

-- Sản phẩm (Catalog)
CREATE TABLE public.products (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku                  TEXT        NOT NULL UNIQUE,
  name                 TEXT        NOT NULL,
  category_id          UUID        REFERENCES public.product_categories(id) ON DELETE SET NULL,
  brand_id             UUID        REFERENCES public.brands(id) ON DELETE SET NULL,
  unit                 TEXT        NOT NULL DEFAULT 'lọ',    -- Đơn vị tính
  secondary_unit       TEXT,                                   -- Đơn vị phụ (VD: thùng/hộp)
  conversion_factor    NUMERIC(10,4),                          -- Quy đổi: 1 thùng = 12 lọ
  package_specs        TEXT,       -- Thông tin đóng gói
  storage_condition    TEXT,       -- Điều kiện bảo quản
  usage_instructions   TEXT,       -- Hướng dẫn sử dụng
  substitute_product_ids UUID[]    DEFAULT '{}',               -- Sản phẩm thay thế
  image_urls           TEXT[]      DEFAULT '{}',
  document_urls        TEXT[]      DEFAULT '{}',               -- Tài liệu kỹ thuật
  min_stock_level      INTEGER     NOT NULL DEFAULT 0,         -- Tồn kho tối thiểu cảnh báo
  max_stock_level      INTEGER,                                -- Tồn kho tối đa
  is_lot_managed       BOOLEAN     NOT NULL DEFAULT false,     -- Quản lý theo lô/hạn
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.products IS 'Catalog sản phẩm: vaccine, thuốc, thiết bị chăn nuôi';

-- Biến thể sản phẩm (VD: cùng vaccine nhưng quy cách 50ml / 100ml)
CREATE TABLE public.product_variants (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku_variant TEXT          NOT NULL UNIQUE,
  name        TEXT          NOT NULL,
  attributes  JSONB         NOT NULL DEFAULT '{}',  -- {"dosage": "50ml", "color": "xanh"}
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Bảng giá
CREATE TABLE public.price_lists (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,    -- VD: Giá lẻ, Giá đại lý, Giá VIP
  description TEXT,
  currency    TEXT        NOT NULL DEFAULT 'VND',
  is_default  BOOLEAN     NOT NULL DEFAULT false,
  valid_from  DATE,
  valid_to    DATE,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Giá sản phẩm theo bảng giá
CREATE TABLE public.price_list_items (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  price_list_id   UUID          NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  product_id      UUID          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id      UUID          REFERENCES public.product_variants(id) ON DELETE CASCADE,
  cost_price      NUMERIC(15,2) NOT NULL DEFAULT 0,   -- Giá vốn
  selling_price   NUMERIC(15,2) NOT NULL DEFAULT 0,   -- Giá bán
  min_quantity    INTEGER       NOT NULL DEFAULT 1,    -- Số lượng tối thiểu áp dụng giá này
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, product_id, variant_id, min_quantity)
);

-- Chương trình khuyến mãi
CREATE TABLE public.promotions (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  code             TEXT          NOT NULL UNIQUE,
  name             TEXT          NOT NULL,
  description      TEXT,
  discount_type    TEXT          NOT NULL CHECK (discount_type IN ('percent', 'fixed_amount', 'buy_x_get_y')),
  discount_value   NUMERIC(15,2) NOT NULL DEFAULT 0,
  min_order_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  applies_to       JSONB         NOT NULL DEFAULT '{}',  -- {product_ids, category_ids, customer_tiers}
  valid_from       TIMESTAMPTZ,
  valid_to         TIMESTAMPTZ,
  max_uses         INTEGER,
  current_uses     INTEGER       NOT NULL DEFAULT 0,
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 5. NHÓM BẢNG KHÁCH HÀNG & TRANG TRẠI
-- ─────────────────────────────────────────────────────────────

-- Khách hàng chính
CREATE TABLE public.customers (
  id                   UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                 TEXT                    UNIQUE,           -- Tự sinh: KH-2026-00001
  customer_type        customer_type           NOT NULL DEFAULT 'farm_household',
  farm_name            TEXT                    NOT NULL,         -- Tên trang trại/doanh nghiệp
  lifecycle_stage      customer_lifecycle_stage NOT NULL DEFAULT 'new',
  value_tier           customer_value_tier     NOT NULL DEFAULT 'normal',
  billing_mode         customer_billing_mode   NOT NULL DEFAULT 'per_order',
  billing_cycle_day    INTEGER CHECK (billing_cycle_day BETWEEN 1 AND 31),  -- Ngày chốt công nợ cuối tháng
  price_list_id        UUID                    REFERENCES public.price_lists(id) ON DELETE SET NULL,
  credit_limit         NUMERIC(15,2)           NOT NULL DEFAULT 0,  -- Hạn mức công nợ
  province             TEXT,
  district             TEXT,
  address              TEXT,
  gps_lat              NUMERIC(10,7),
  gps_lng              NUMERIC(10,7),
  tags                 TEXT[]                  DEFAULT '{}',
  notes                TEXT,
  owner_user_id        UUID                    NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  team_id              UUID                    REFERENCES public.teams(id) ON DELETE SET NULL,
  branch_id            UUID                    REFERENCES public.branches(id) ON DELETE SET NULL,
  is_active            BOOLEAN                 NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ             NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.customers IS 'Hồ sơ trang trại/khách hàng';

-- Thông tin doanh nghiệp (cho đại lý, doanh nghiệp)
CREATE TABLE public.customer_business_info (
  customer_id       UUID    PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  tax_code          TEXT,                     -- Mã số thuế
  legal_name        TEXT,                     -- Tên pháp nhân
  legal_rep         TEXT,                     -- Người đại diện pháp luật
  business_license  TEXT,                     -- Số GPKD
  bank_name         TEXT,                     -- Tên ngân hàng
  bank_branch       TEXT,                     -- Chi nhánh ngân hàng
  bank_account_no   TEXT,                     -- Số tài khoản
  invoice_address   TEXT,                     -- Địa chỉ xuất hóa đơn
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thông tin cá nhân (cho hộ chăn nuôi)
CREATE TABLE public.customer_personal_info (
  customer_id     UUID    PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  id_card_no      TEXT,           -- CCCD/CMND
  date_of_birth   DATE,
  gender          TEXT CHECK (gender IN ('male', 'female', 'other')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Người liên hệ tại trang trại
CREATE TABLE public.customer_contacts (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id   UUID        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  full_name     TEXT        NOT NULL,
  role_at_farm  TEXT,       -- Chủ trại | Kỹ thuật | Kế toán | Người quyết định mua hàng
  phone         TEXT,
  zalo_id       TEXT,
  email         TEXT,
  is_primary    BOOLEAN     NOT NULL DEFAULT false,
  is_decision_maker BOOLEAN NOT NULL DEFAULT false,  -- Người quyết định mua hàng
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trang trại (chuồng trại) của khách hàng
CREATE TABLE public.farms (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id    UUID        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  address        TEXT,
  area_sqm       NUMERIC(10,2),    -- Diện tích (m2)
  capacity_heads INTEGER,          -- Sức chứa (đầu con)
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Loài vật nuôi (từ điển)
CREATE TABLE public.species (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT        NOT NULL UNIQUE,   -- Heo, Gà, Vịt, Bò, Cá,...
  category   TEXT,                          -- livestock | poultry | aquatic
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Đàn vật nuôi của trang trại
CREATE TABLE public.herds (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id           UUID        NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  species_id        UUID        NOT NULL REFERENCES public.species(id) ON DELETE RESTRICT,
  name              TEXT        NOT NULL,    -- Tên đàn (VD: Đàn heo nái 2026)
  current_quantity  INTEGER     NOT NULL DEFAULT 0,
  breed             TEXT,                    -- Giống (VD: Duroc, Yorkshire)
  avg_age_weeks     INTEGER,                 -- Tuổi trung bình (tuần)
  entry_date        DATE,                    -- Ngày nhập đàn
  notes             TEXT,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Từ điển bệnh
CREATE TABLE public.disease_dictionary (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,   -- VD: PRRS, ASF, FMD
  name        TEXT        NOT NULL,
  category    TEXT,       -- Virus | Vi khuẩn | Ký sinh trùng
  description TEXT,
  is_notifiable BOOLEAN   NOT NULL DEFAULT false,  -- Bệnh phải báo cáo nhà nước
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lịch sử bệnh của đàn
CREATE TABLE public.disease_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  herd_id     UUID        NOT NULL REFERENCES public.herds(id) ON DELETE CASCADE,
  disease_id  UUID        NOT NULL REFERENCES public.disease_dictionary(id) ON DELETE RESTRICT,
  onset_date  DATE        NOT NULL,
  resolved_date DATE,
  affected_heads INTEGER,                    -- Số đầu con bị nhiễm
  mortality_heads INTEGER NOT NULL DEFAULT 0,  -- Số đầu chết
  treatment   TEXT,                          -- Phác đồ điều trị
  notes       TEXT,
  recorded_by UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 6. NHÓM BẢNG BÁN HÀNG & ĐƠN HÀNG
-- ─────────────────────────────────────────────────────────────

-- Báo giá
CREATE TABLE public.quotes (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_code      TEXT          NOT NULL UNIQUE,
  customer_id     UUID          NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  price_list_id   UUID          REFERENCES public.price_lists(id) ON DELETE SET NULL,
  status          TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  valid_until     DATE,
  subtotal        NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_total  NUMERIC(15,2) NOT NULL DEFAULT 0,
  grand_total     NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  owner_user_id   UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  team_id         UUID          REFERENCES public.teams(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Dòng chi tiết báo giá
CREATE TABLE public.quote_lines (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id    UUID          NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  product_id  UUID          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id  UUID          REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity    INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(15,2) NOT NULL,
  discount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total  NUMERIC(15,2) GENERATED ALWAYS AS ((unit_price - discount) * quantity) STORED,
  notes       TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Đơn hàng bán
CREATE TABLE public.orders (
  id               UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_code       TEXT                 NOT NULL UNIQUE,
  customer_id      UUID                 NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  quote_id         UUID                 REFERENCES public.quotes(id) ON DELETE SET NULL,
  opportunity_id   UUID,                                             -- FK → opportunities (set sau)
  price_list_id    UUID                 REFERENCES public.price_lists(id) ON DELETE SET NULL,
  status           order_status         NOT NULL DEFAULT 'draft',
  payment_status   order_payment_status NOT NULL DEFAULT 'unpaid',
  payment_method   order_payment_method DEFAULT 'bank_transfer',
  owner_user_id    UUID                 NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  team_id          UUID                 REFERENCES public.teams(id) ON DELETE SET NULL,
  branch_id        UUID                 REFERENCES public.branches(id) ON DELETE SET NULL,
  warehouse_id     UUID                 REFERENCES public.warehouses(id) ON DELETE SET NULL,
  subtotal         NUMERIC(15,2)        NOT NULL DEFAULT 0,
  discount_total   NUMERIC(15,2)        NOT NULL DEFAULT 0,
  shipping_fee     NUMERIC(15,2)        NOT NULL DEFAULT 0,
  grand_total      NUMERIC(15,2)        NOT NULL DEFAULT 0,
  paid_amount      NUMERIC(15,2)        NOT NULL DEFAULT 0,
  debt_amount      NUMERIC(15,2)        GENERATED ALWAYS AS (grand_total - paid_amount) STORED,
  delivery_date    DATE,
  delivery_address TEXT,
  delivery_partner TEXT,                -- VD: Giao hàng nhanh, tự giao
  notes            TEXT,
  confirmed_at     TIMESTAMPTZ,
  confirmed_by     UUID                 REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ          NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.orders IS 'Đơn hàng bán của khách hàng';

-- Dòng chi tiết đơn hàng
CREATE TABLE public.order_lines (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID          NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id  UUID          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id  UUID          REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity    INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(15,2) NOT NULL,
  discount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total  NUMERIC(15,2) GENERATED ALWAYS AS ((unit_price - discount) * quantity) STORED,
  notes       TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Phân bổ lô hàng cho dòng đơn hàng (FEFO)
CREATE TABLE public.order_line_allocations (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_line_id UUID  NOT NULL REFERENCES public.order_lines(id) ON DELETE CASCADE,
  lot_id      UUID    NOT NULL,                                           -- FK → stock_lots (set sau)
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lịch sử thay đổi trạng thái đơn hàng
CREATE TABLE public.order_status_history (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID         NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status   order_status NOT NULL,
  reason      TEXT,
  changed_by  UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Ghi nhận thanh toán đơn hàng (có thể nhiều lần)
CREATE TABLE public.order_payments (
  id             UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id       UUID                 NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_method order_payment_method NOT NULL,
  amount         NUMERIC(15,2)        NOT NULL CHECK (amount > 0),
  reference_no   TEXT,               -- Số tham chiếu giao dịch ngân hàng
  payment_date   DATE                 NOT NULL DEFAULT CURRENT_DATE,
  notes          TEXT,
  created_by     UUID                 NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ          NOT NULL DEFAULT now()
);

-- Hóa đơn VAT
CREATE TABLE public.invoices (
  id             UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_no     TEXT           NOT NULL UNIQUE,  -- Số hóa đơn theo series
  order_id       UUID           NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  status         invoice_status NOT NULL DEFAULT 'draft',
  issue_date     DATE           NOT NULL DEFAULT CURRENT_DATE,
  buyer_name     TEXT           NOT NULL,
  buyer_tax_code TEXT,
  buyer_address  TEXT,
  subtotal       NUMERIC(15,2)  NOT NULL DEFAULT 0,
  vat_rate       NUMERIC(5,2)   NOT NULL DEFAULT 10.0,   -- % VAT
  vat_amount     NUMERIC(15,2)  NOT NULL DEFAULT 0,
  total          NUMERIC(15,2)  NOT NULL DEFAULT 0,
  notes          TEXT,
  issued_by      UUID           REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- Phiếu trả hàng
CREATE TABLE public.sales_returns (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_code     TEXT          NOT NULL UNIQUE,
  order_id        UUID          NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  reason          TEXT          NOT NULL,
  total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  refund_method   TEXT CHECK (refund_method IN ('cash', 'bank_transfer', 'credit_note')),
  status          TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','completed','rejected')),
  processed_by    UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by      UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Chi tiết phiếu trả hàng
CREATE TABLE public.sales_return_lines (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id      UUID          NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  order_line_id  UUID          NOT NULL REFERENCES public.order_lines(id) ON DELETE RESTRICT,
  product_id     UUID          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity       INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price     NUMERIC(15,2) NOT NULL,
  line_total     NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  lot_id         UUID,                                    -- FK → stock_lots
  return_to_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Sổ công nợ khách hàng
CREATE TABLE public.customer_debts (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     UUID          NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  order_id        UUID          REFERENCES public.orders(id) ON DELETE SET NULL,
  debt_type       TEXT          NOT NULL CHECK (debt_type IN ('order_debt', 'advance_from_customer', 'refund_due')),
  amount          NUMERIC(15,2) NOT NULL,                   -- Dương = khách nợ; Âm = công ty nợ khách
  due_date        DATE,
  is_settled      BOOLEAN       NOT NULL DEFAULT false,
  settled_at      TIMESTAMPTZ,
  notes           TEXT,
  created_by      UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Kỳ công nợ tổng hợp (billing_mode = period_consolidated)
CREATE TABLE public.period_statements (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     UUID          NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  period_month    INTEGER       NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year     INTEGER       NOT NULL,
  opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_orders    NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_paid      NUMERIC(15,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_confirmed    BOOLEAN       NOT NULL DEFAULT false,
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (customer_id, period_month, period_year)
);

-- Ghi nhận thanh toán công nợ
CREATE TABLE public.debt_payments (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     UUID          NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  statement_id    UUID          REFERENCES public.period_statements(id) ON DELETE SET NULL,
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method  order_payment_method NOT NULL,
  payment_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  reference_no    TEXT,
  notes           TEXT,
  recorded_by     UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 7. NHÓM BẢNG NHẬP HÀNG & TỒN KHO
-- ─────────────────────────────────────────────────────────────

-- Nhà cung cấp
CREATE TABLE public.suppliers (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code           TEXT        NOT NULL UNIQUE,
  name           TEXT        NOT NULL,
  tax_code       TEXT,
  website        TEXT,
  address        TEXT,
  payment_terms  TEXT,       -- Điều khoản thanh toán (VD: Net 30)
  notes          TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Người liên hệ nhà cung cấp
CREATE TABLE public.supplier_contacts (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID        NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  full_name   TEXT        NOT NULL,
  position    TEXT,
  phone       TEXT,
  email       TEXT,
  is_primary  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Đơn đặt hàng nhà cung cấp
CREATE TABLE public.purchase_orders (
  id              UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_code         TEXT                  NOT NULL UNIQUE,
  supplier_id     UUID                  NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  warehouse_id    UUID                  NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status          purchase_order_status NOT NULL DEFAULT 'draft',
  expected_date   DATE,
  subtotal        NUMERIC(15,2)         NOT NULL DEFAULT 0,
  discount_total  NUMERIC(15,2)         NOT NULL DEFAULT 0,
  grand_total     NUMERIC(15,2)         NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      UUID                  NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by     UUID                  REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT now()
);

-- Dòng chi tiết đơn đặt hàng NCC
CREATE TABLE public.purchase_order_lines (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id         UUID          NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id    UUID          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity      INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(15,2) NOT NULL,
  total         NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  received_qty  INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Phiếu nhập kho
CREATE TABLE public.goods_receipts (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_code  TEXT        NOT NULL UNIQUE,
  po_id         UUID        REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  supplier_id   UUID        NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  warehouse_id  UUID        NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  receipt_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  total_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  received_by   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dòng chi tiết phiếu nhập kho
CREATE TABLE public.goods_receipt_lines (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id      UUID          NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  po_line_id      UUID          REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL,
  product_id      UUID          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity        INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(15,2) NOT NULL,
  line_total      NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  lot_number      TEXT,         -- Số lô (bắt buộc nếu is_lot_managed)
  manufacture_date DATE,
  expiry_date     DATE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Lô hàng trong kho (quản lý FEFO)
CREATE TABLE public.stock_lots (
  id               UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id       UUID              NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  warehouse_id     UUID              NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  supplier_id      UUID              REFERENCES public.suppliers(id) ON DELETE SET NULL,
  receipt_id       UUID              REFERENCES public.goods_receipts(id) ON DELETE SET NULL,
  lot_number       TEXT              NOT NULL,
  manufacture_date DATE,
  expiry_date      DATE,
  received_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),
  cost_price       NUMERIC(15,2)     NOT NULL DEFAULT 0,    -- Giá vốn lô này
  quantity_on_hand INTEGER           NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved INTEGER          NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  status           stock_lot_status  NOT NULL DEFAULT 'active',
  notes            TEXT,
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE (product_id, lot_number, warehouse_id)
);
COMMENT ON TABLE public.stock_lots IS 'Lô hàng trong kho, dùng cho FEFO';

-- Phiếu xuất nhập kho (lịch sử di chuyển)
CREATE TABLE public.stock_movements (
  id             UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  lot_id         UUID                NOT NULL REFERENCES public.stock_lots(id) ON DELETE RESTRICT,
  product_id     UUID                NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  warehouse_id   UUID                NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  movement_type  stock_movement_type NOT NULL,
  quantity       INTEGER             NOT NULL,   -- Dương = nhập, Âm = xuất
  reference_id   UUID,
  reference_type TEXT,              -- 'order' | 'goods_receipt' | 'transfer' | 'adjustment'
  unit_cost      NUMERIC(15,2),    -- Giá vốn tại thời điểm xuất
  performed_by   UUID              NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  notes          TEXT,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- Cài đặt tồn kho theo sản phẩm/kho
CREATE TABLE public.inventory_settings (
  id                 UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id         UUID    NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id       UUID    NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  min_stock_level    INTEGER NOT NULL DEFAULT 0,
  max_stock_level    INTEGER,
  reorder_point      INTEGER NOT NULL DEFAULT 0,    -- Điểm đặt hàng lại
  reorder_quantity   INTEGER,                       -- Số lượng đặt hàng lại khuyến nghị
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, warehouse_id)
);

-- Phiếu chuyển kho
CREATE TABLE public.stock_transfers (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_code   TEXT        NOT NULL UNIQUE,
  from_warehouse  UUID        NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  to_warehouse    UUID        NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','received','cancelled')),
  transfer_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  notes           TEXT,
  created_by      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  received_by     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_different_warehouses CHECK (from_warehouse <> to_warehouse)
);

-- Dòng chi tiết phiếu chuyển kho
CREATE TABLE public.stock_transfer_lines (
  id           UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id  UUID    NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  lot_id       UUID    NOT NULL REFERENCES public.stock_lots(id) ON DELETE RESTRICT,
  product_id   UUID    NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cảnh báo tồn kho
CREATE TABLE public.inventory_alerts (
  id             UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id     UUID           NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id   UUID           NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  lot_id         UUID           REFERENCES public.stock_lots(id) ON DELETE CASCADE,
  alert_type     TEXT           NOT NULL, -- 'low_stock' | 'expiring_soon' | 'expired' | 'overstock'
  severity       alert_severity NOT NULL DEFAULT 'warning',
  status         alert_status   NOT NULL DEFAULT 'active',
  message        TEXT           NOT NULL,
  threshold_value NUMERIC(15,2),
  actual_value    NUMERIC(15,2),
  acknowledged_by UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 8. NHÓM BẢNG SỔ QUỸ DÒNG TIỀN
-- ─────────────────────────────────────────────────────────────

-- Quỹ tiền mặt
CREATE TABLE public.cash_funds (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id   UUID          NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  code        TEXT          NOT NULL UNIQUE,  -- VD: QUY-HCM
  name        TEXT          NOT NULL,
  balance     NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency    TEXT          NOT NULL DEFAULT 'VND',
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Tài khoản ngân hàng
CREATE TABLE public.bank_accounts (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id      UUID          NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  bank_name      TEXT          NOT NULL,    -- VD: Vietcombank, Techcombank
  account_name   TEXT          NOT NULL,   -- Tên tài khoản
  account_no     TEXT          NOT NULL UNIQUE,
  branch_name    TEXT,                     -- Chi nhánh ngân hàng
  balance        NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency       TEXT          NOT NULL DEFAULT 'VND',
  is_active      BOOLEAN       NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Phiên thu ngân (POS)
CREATE TABLE public.cashier_sessions (
  id              UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  cash_fund_id    UUID                  NOT NULL REFERENCES public.cash_funds(id) ON DELETE RESTRICT,
  cashier_id      UUID                  NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status          cashier_session_status NOT NULL DEFAULT 'open',
  opening_balance NUMERIC(15,2)         NOT NULL DEFAULT 0,
  closing_balance NUMERIC(15,2),
  cash_actual     NUMERIC(15,2),        -- Số tiền đếm thực tế khi đóng ca
  variance        NUMERIC(15,2),        -- Chênh lệch = closing_balance - cash_actual
  opened_at       TIMESTAMPTZ           NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  notes           TEXT
);

-- Phiếu thu chi sổ quỹ
CREATE TABLE public.cashbook_transactions (
  id               UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_code TEXT                NOT NULL UNIQUE,   -- Tự sinh: PT-2026-0001 / PC-2026-0001
  flow_type        cashbook_flow_type  NOT NULL,
  status           cashbook_status     NOT NULL DEFAULT 'draft',
  cash_fund_id     UUID                REFERENCES public.cash_funds(id) ON DELETE RESTRICT,
  bank_account_id  UUID                REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  session_id       UUID                REFERENCES public.cashier_sessions(id) ON DELETE SET NULL,
  amount           NUMERIC(15,2)       NOT NULL CHECK (amount > 0),
  transaction_date DATE                NOT NULL DEFAULT CURRENT_DATE,
  -- Liên kết đối tượng
  customer_id      UUID                REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id      UUID                REFERENCES public.suppliers(id) ON DELETE SET NULL,
  order_id         UUID                REFERENCES public.orders(id) ON DELETE SET NULL,
  employee_id      UUID                REFERENCES public.profiles(id) ON DELETE SET NULL,
  expense_category_id UUID,                                            -- FK → expense_categories
  description      TEXT                NOT NULL,
  reference_no     TEXT,              -- Số chứng từ / mã giao dịch ngân hàng
  attachments      TEXT[]             DEFAULT '{}',
  created_by       UUID               NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by      UUID               REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ        NOT NULL DEFAULT now(),
  CONSTRAINT chk_cashbook_account CHECK (
    (cash_fund_id IS NOT NULL AND bank_account_id IS NULL)
    OR (cash_fund_id IS NULL AND bank_account_id IS NOT NULL)
    OR (flow_type = 'internal_transfer')
  )
);
COMMENT ON TABLE public.cashbook_transactions IS 'Phiếu thu/chi sổ quỹ, bảo mật nghiêm ngặt';

-- Danh mục khoản chi
CREATE TABLE public.expense_categories (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id   UUID        REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  flow_type   cashbook_flow_type NOT NULL DEFAULT 'outflow',
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thêm FK expense_category vào cashbook_transactions sau khi bảng đã tạo
ALTER TABLE public.cashbook_transactions
  ADD CONSTRAINT fk_cashbook_expense_category
  FOREIGN KEY (expense_category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;

-- Phiếu trả tiền nhà cung cấp
CREATE TABLE public.supplier_payments (
  id               UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_code     TEXT                 NOT NULL UNIQUE,
  supplier_id      UUID                 NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  transaction_id   UUID                 REFERENCES public.cashbook_transactions(id) ON DELETE SET NULL,
  amount           NUMERIC(15,2)        NOT NULL CHECK (amount > 0),
  payment_date     DATE                 NOT NULL DEFAULT CURRENT_DATE,
  payment_method   order_payment_method NOT NULL,
  reference_no     TEXT,
  notes            TEXT,
  created_by       UUID                 NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT now()
);

-- Phân bổ thanh toán NCC vào các đơn nhập hàng
CREATE TABLE public.supplier_payment_allocations (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id  UUID          NOT NULL REFERENCES public.supplier_payments(id) ON DELETE CASCADE,
  po_id       UUID          NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Tạm ứng nhân viên
CREATE TABLE public.employee_advances (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  advance_code     TEXT          NOT NULL UNIQUE,
  employee_id      UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  transaction_id   UUID          REFERENCES public.cashbook_transactions(id) ON DELETE SET NULL,
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  purpose          TEXT          NOT NULL,
  advance_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  settled_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_settled       BOOLEAN       NOT NULL DEFAULT false,
  created_by       UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Chuyển tiền nội bộ (giữa các quỹ)
CREATE TABLE public.internal_transfers (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_code    TEXT          NOT NULL UNIQUE,
  from_fund_id     UUID          REFERENCES public.cash_funds(id) ON DELETE RESTRICT,
  from_bank_id     UUID          REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  to_fund_id       UUID          REFERENCES public.cash_funds(id) ON DELETE RESTRICT,
  to_bank_id       UUID          REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  transfer_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  notes            TEXT,
  created_by       UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by      UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 9. NHÓM BẢNG CƠ HỘI & HOẠT ĐỘNG
-- ─────────────────────────────────────────────────────────────

-- Định nghĩa pipeline
CREATE TABLE public.pipeline_definitions (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_default  BOOLEAN     NOT NULL DEFAULT false,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Giai đoạn pipeline
CREATE TABLE public.pipeline_stages (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id     UUID    NOT NULL REFERENCES public.pipeline_definitions(id) ON DELETE CASCADE,
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  win_probability INTEGER NOT NULL DEFAULT 0 CHECK (win_probability BETWEEN 0 AND 100),
  is_won_stage    BOOLEAN NOT NULL DEFAULT false,
  is_lost_stage   BOOLEAN NOT NULL DEFAULT false,
  color_hex       TEXT    DEFAULT '#6366f1',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, code)
);

-- Cơ hội bán hàng
CREATE TABLE public.opportunities (
  id                   UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
  opp_code             TEXT               NOT NULL UNIQUE,
  customer_id          UUID               NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  pipeline_id          UUID               REFERENCES public.pipeline_definitions(id) ON DELETE SET NULL,
  stage_id             UUID               REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  title                TEXT               NOT NULL,
  status               opportunity_status NOT NULL DEFAULT 'open',
  estimated_value      NUMERIC(15,2)      NOT NULL DEFAULT 0,
  win_probability      INTEGER            NOT NULL DEFAULT 0 CHECK (win_probability BETWEEN 0 AND 100),
  expected_close_date  DATE,
  actual_close_date    DATE,
  owner_user_id        UUID               NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  team_id              UUID               REFERENCES public.teams(id) ON DELETE SET NULL,
  expected_products    JSONB              NOT NULL DEFAULT '[]',
  close_reason         TEXT,
  lost_reason_id       UUID,                                          -- FK → lost_reasons
  notes                TEXT,
  created_at           TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ        NOT NULL DEFAULT now()
);

-- Thêm FK opportunity_id vào orders
ALTER TABLE public.orders
  ADD CONSTRAINT fk_orders_opportunity
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;

-- Danh mục lý do thua/bỏ
CREATE TABLE public.lost_reasons (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL UNIQUE,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thêm FK lost_reason_id vào opportunities
ALTER TABLE public.opportunities
  ADD CONSTRAINT fk_opp_lost_reason
  FOREIGN KEY (lost_reason_id) REFERENCES public.lost_reasons(id) ON DELETE SET NULL;

-- Danh mục loại hoạt động
CREATE TABLE public.activity_types (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,   -- VD: call, visit, demo, email
  name        TEXT        NOT NULL,
  icon        TEXT,                          -- Icon name
  color_hex   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hoạt động tương tác
CREATE TABLE public.activities (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_type_id UUID           NOT NULL REFERENCES public.activity_types(id) ON DELETE RESTRICT,
  status          activity_status NOT NULL DEFAULT 'planned',
  customer_id     UUID            NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  contact_id      UUID            REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  opportunity_id  UUID            REFERENCES public.opportunities(id) ON DELETE SET NULL,
  order_id        UUID            REFERENCES public.orders(id) ON DELETE SET NULL,
  title           TEXT            NOT NULL,
  content         TEXT,
  outcome         TEXT,           -- Kết quả sau khi hoàn thành
  attachments     TEXT[]          DEFAULT '{}',
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_mins   INTEGER,        -- Thời lượng (phút)
  owner_user_id   UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  team_id         UUID            REFERENCES public.teams(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Lịch công tác
CREATE TABLE public.sales_schedules (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  schedule_date   DATE        NOT NULL,
  title           TEXT        NOT NULL,
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','done','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Slot trong lịch công tác
CREATE TABLE public.sales_schedule_slots (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id     UUID        NOT NULL REFERENCES public.sales_schedules(id) ON DELETE CASCADE,
  activity_id     UUID        REFERENCES public.activities(id) ON DELETE SET NULL,
  customer_id     UUID        REFERENCES public.customers(id) ON DELETE SET NULL,
  start_time      TIME        NOT NULL,
  end_time        TIME,
  title           TEXT        NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 10. NHÓM BẢNG DỰ ÁN ĐÀN
-- ─────────────────────────────────────────────────────────────

-- Loại dự án đàn (mẫu kế hoạch)
CREATE TABLE public.herd_project_types (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,     -- VD: Kế hoạch heo nái đẻ, Kế hoạch gà thịt
  species_id  UUID        REFERENCES public.species(id) ON DELETE SET NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bước mặc định của loại dự án
CREATE TABLE public.herd_project_type_default_steps (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_type_id UUID    NOT NULL REFERENCES public.herd_project_types(id) ON DELETE CASCADE,
  step_name       TEXT    NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  days_offset     INTEGER NOT NULL DEFAULT 0,    -- Số ngày từ ngày bắt đầu
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dự án đàn thực tế
CREATE TABLE public.herd_projects (
  id               UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_code     TEXT               NOT NULL UNIQUE,
  customer_id      UUID               NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  herd_id          UUID               REFERENCES public.herds(id) ON DELETE SET NULL,
  project_type_id  UUID               REFERENCES public.herd_project_types(id) ON DELETE SET NULL,
  name             TEXT               NOT NULL,
  status           herd_project_status NOT NULL DEFAULT 'draft',
  start_date       DATE,
  end_date         DATE,
  head_count       INTEGER            NOT NULL DEFAULT 0,
  owner_user_id    UUID               NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  team_id          UUID               REFERENCES public.teams(id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ        NOT NULL DEFAULT now()
);

-- Bước thực tế của dự án đàn
CREATE TABLE public.herd_project_steps (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID        NOT NULL REFERENCES public.herd_projects(id) ON DELETE CASCADE,
  default_step_id UUID        REFERENCES public.herd_project_type_default_steps(id) ON DELETE SET NULL,
  step_name       TEXT        NOT NULL,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  planned_date    DATE,
  actual_date     DATE,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  products_used   JSONB       DEFAULT '[]',     -- [{product_id, quantity, unit}]
  notes           TEXT,
  completed_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kết quả dự án đàn
CREATE TABLE public.herd_project_outcomes (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id         UUID          NOT NULL REFERENCES public.herd_projects(id) ON DELETE CASCADE,
  record_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  head_born          INTEGER,      -- Số con sinh ra
  head_weaned        INTEGER,      -- Số con cai sữa
  head_sold          INTEGER,      -- Số con xuất bán
  head_died          INTEGER       NOT NULL DEFAULT 0,
  avg_weight_kg      NUMERIC(8,2), -- Trọng lượng trung bình (kg)
  revenue            NUMERIC(15,2),
  cost               NUMERIC(15,2),
  fcr                NUMERIC(5,3), -- Feed Conversion Ratio
  notes              TEXT,
  recorded_by        UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 11. NHÓM BẢNG HỆ THỐNG & TIỆN ÍCH
-- ─────────────────────────────────────────────────────────────

-- Nhật ký thay đổi dữ liệu (bất biến)
CREATE TABLE public.audit_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,   -- INSERT | UPDATE | DELETE
  table_name  TEXT        NOT NULL,
  record_id   UUID,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.audit_logs IS 'Nhật ký bất biến. Không UPDATE/DELETE trực tiếp';

-- Thông báo trong app
CREATE TABLE public.notifications (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  body        TEXT,
  link        TEXT,
  type        TEXT        NOT NULL DEFAULT 'info' CHECK (type IN ('info','success','warning','error')),
  is_read     BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bảng quản lý chuỗi số tự sinh mã
CREATE TABLE public.code_sequences (
  code_type  TEXT    PRIMARY KEY,          -- VD: 'customer', 'order', 'receipt', 'payment'
  prefix     TEXT    NOT NULL,             -- VD: 'KH', 'DH', 'PT', 'PC'
  year_part  INTEGER NOT NULL,             -- Năm hiện tại
  current_no INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 12. INDEXES TỐI ƯU HIỆU NĂNG
-- ─────────────────────────────────────────────────────────────

-- === BRANCHES & TEAMS ===
CREATE INDEX idx_branches_is_active ON public.branches(is_active);
CREATE INDEX idx_warehouses_branch  ON public.warehouses(branch_id);
CREATE INDEX idx_teams_branch       ON public.teams(branch_id);

-- === PROFILES ===
CREATE INDEX idx_profiles_branch    ON public.profiles(branch_id);
CREATE INDEX idx_profiles_team      ON public.profiles(team_id);
CREATE INDEX idx_profiles_is_active ON public.profiles(is_active);

-- === RBAC ===
CREATE INDEX idx_user_roles_user    ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_role    ON public.user_roles(role_id);
CREATE INDEX idx_role_perms_role    ON public.role_permissions(role_id);
CREATE INDEX idx_role_perms_perm    ON public.role_permissions(permission_id);

-- === PRODUCTS ===
CREATE INDEX idx_products_category  ON public.products(category_id);
CREATE INDEX idx_products_brand     ON public.products(brand_id);
CREATE INDEX idx_products_is_active ON public.products(is_active);
CREATE INDEX idx_products_name_trgm ON public.products USING gin(name gin_trgm_ops);
CREATE INDEX idx_products_sku_trgm  ON public.products USING gin(sku gin_trgm_ops);

-- === CUSTOMERS ===
CREATE INDEX idx_customers_owner     ON public.customers(owner_user_id);
CREATE INDEX idx_customers_team      ON public.customers(team_id);
CREATE INDEX idx_customers_branch    ON public.customers(branch_id);
CREATE INDEX idx_customers_type      ON public.customers(customer_type);
CREATE INDEX idx_customers_lifecycle ON public.customers(lifecycle_stage);
CREATE INDEX idx_customers_province  ON public.customers(province);
CREATE INDEX idx_customers_name_trgm ON public.customers USING gin(farm_name gin_trgm_ops);
CREATE INDEX idx_customers_code_trgm ON public.customers USING gin(code gin_trgm_ops);
CREATE INDEX idx_customers_tags      ON public.customers USING gin(tags);
CREATE INDEX idx_customers_created   ON public.customers(created_at DESC);

-- === CONTACTS ===
CREATE INDEX idx_contacts_customer   ON public.customer_contacts(customer_id);
CREATE INDEX idx_contacts_is_primary ON public.customer_contacts(customer_id, is_primary);

-- === ORDERS ===
CREATE INDEX idx_orders_customer     ON public.orders(customer_id);
CREATE INDEX idx_orders_owner        ON public.orders(owner_user_id);
CREATE INDEX idx_orders_team         ON public.orders(team_id);
CREATE INDEX idx_orders_branch       ON public.orders(branch_id);
CREATE INDEX idx_orders_status       ON public.orders(status);
CREATE INDEX idx_orders_pay_status   ON public.orders(payment_status);
CREATE INDEX idx_orders_code_trgm    ON public.orders USING gin(order_code gin_trgm_ops);
CREATE INDEX idx_orders_created      ON public.orders(created_at DESC);
CREATE INDEX idx_orders_delivery     ON public.orders(delivery_date);

-- === ORDER LINES ===
CREATE INDEX idx_order_lines_order   ON public.order_lines(order_id);
CREATE INDEX idx_order_lines_product ON public.order_lines(product_id);

-- === STOCK LOTS (FEFO critical) ===
CREATE INDEX idx_lots_product        ON public.stock_lots(product_id);
CREATE INDEX idx_lots_warehouse      ON public.stock_lots(warehouse_id);
CREATE INDEX idx_lots_expiry         ON public.stock_lots(expiry_date ASC NULLS LAST);  -- FEFO sort
CREATE INDEX idx_lots_received       ON public.stock_lots(received_at ASC);             -- FEFO tiebreak
CREATE INDEX idx_lots_status         ON public.stock_lots(status);
CREATE INDEX idx_lots_active_fefo    ON public.stock_lots(product_id, warehouse_id, expiry_date, received_at)
  WHERE status = 'active' AND quantity_on_hand > 0;                                     -- FEFO partial index

-- === STOCK MOVEMENTS ===
CREATE INDEX idx_stockmov_lot        ON public.stock_movements(lot_id);
CREATE INDEX idx_stockmov_product    ON public.stock_movements(product_id);
CREATE INDEX idx_stockmov_warehouse  ON public.stock_movements(warehouse_id);
CREATE INDEX idx_stockmov_type       ON public.stock_movements(movement_type);
CREATE INDEX idx_stockmov_ref        ON public.stock_movements(reference_id, reference_type);
CREATE INDEX idx_stockmov_created    ON public.stock_movements(created_at DESC);

-- === OPPORTUNITIES ===
CREATE INDEX idx_opp_customer        ON public.opportunities(customer_id);
CREATE INDEX idx_opp_owner           ON public.opportunities(owner_user_id);
CREATE INDEX idx_opp_team            ON public.opportunities(team_id);
CREATE INDEX idx_opp_status          ON public.opportunities(status);
CREATE INDEX idx_opp_close_date      ON public.opportunities(expected_close_date);
CREATE INDEX idx_opp_stage           ON public.opportunities(stage_id);

-- === ACTIVITIES ===
CREATE INDEX idx_act_customer        ON public.activities(customer_id);
CREATE INDEX idx_act_owner           ON public.activities(owner_user_id);
CREATE INDEX idx_act_team            ON public.activities(team_id);
CREATE INDEX idx_act_status          ON public.activities(status);
CREATE INDEX idx_act_scheduled       ON public.activities(scheduled_at);

-- === CASHBOOK (sensitive) ===
CREATE INDEX idx_cashbook_fund       ON public.cashbook_transactions(cash_fund_id);
CREATE INDEX idx_cashbook_bank       ON public.cashbook_transactions(bank_account_id);
CREATE INDEX idx_cashbook_flow       ON public.cashbook_transactions(flow_type);
CREATE INDEX idx_cashbook_status     ON public.cashbook_transactions(status);
CREATE INDEX idx_cashbook_date       ON public.cashbook_transactions(transaction_date DESC);
CREATE INDEX idx_cashbook_customer   ON public.cashbook_transactions(customer_id);
CREATE INDEX idx_cashbook_order      ON public.cashbook_transactions(order_id);
CREATE INDEX idx_cashbook_code_trgm  ON public.cashbook_transactions USING gin(transaction_code gin_trgm_ops);

-- === HERD PROJECTS ===
CREATE INDEX idx_herd_proj_customer  ON public.herd_projects(customer_id);
CREATE INDEX idx_herd_proj_owner     ON public.herd_projects(owner_user_id);
CREATE INDEX idx_herd_proj_status    ON public.herd_projects(status);

-- === AUDIT ===
CREATE INDEX idx_audit_user          ON public.audit_logs(user_id);
CREATE INDEX idx_audit_table         ON public.audit_logs(table_name);
CREATE INDEX idx_audit_record        ON public.audit_logs(record_id);
CREATE INDEX idx_audit_created       ON public.audit_logs(created_at DESC);

-- === NOTIFICATIONS ===
CREATE INDEX idx_notif_user          ON public.notifications(user_id);
CREATE INDEX idx_notif_unread        ON public.notifications(user_id, is_read) WHERE is_read = false;

-- ─────────────────────────────────────────────────────────────
-- 13. SEED code_sequences khởi tạo
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.code_sequences (code_type, prefix, year_part, current_no) VALUES
  ('customer',         'KH',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('order',            'DH',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('quote',            'BG',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('opportunity',      'CH',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('herd_project',     'DA',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('goods_receipt',    'NK',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('purchase_order',   'PO',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('stock_transfer',   'CT',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('cash_receipt',     'PT',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('cash_payment',     'PC',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('supplier_payment', 'TT',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('sales_return',     'TH',  EXTRACT(YEAR FROM now())::INTEGER, 0),
  ('invoice',          'HDN', EXTRACT(YEAR FROM now())::INTEGER, 0)
ON CONFLICT (code_type) DO NOTHING;
