-- ============================================================
-- CRM SANHLONGVETCO – SEED DATA MẪU
-- File: seed.sql
-- Mô tả: Dữ liệu mẫu thực tế cho môi trường Dev/Demo
-- CẢNH BÁO: Chỉ chạy trên môi trường Development/Staging
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. CHI NHÁNH
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.branches (id, code, name, address, phone, is_active) VALUES
  ('11111111-0000-0000-0000-000000000001', 'CN-HCM', 'Chi nhánh TP. Hồ Chí Minh',
   '123 Đường Lê Văn Việt, Quận 9, TP.HCM', '028-7777-1001', true),
  ('11111111-0000-0000-0000-000000000002', 'CN-DN',  'Chi nhánh Đà Nẵng',
   '45 Đường Nguyễn Văn Linh, Quận Hải Châu, Đà Nẵng', '0236-7777-1002', true),
  ('11111111-0000-0000-0000-000000000003', 'CN-CT',  'Chi nhánh Cần Thơ',
   '88 Đường 30 Tháng 4, Quận Ninh Kiều, Cần Thơ', '0292-7777-1003', true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. KHO HÀNG
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.warehouses (id, branch_id, code, name, type, address, is_active) VALUES
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'KHO-HCM-01', 'Kho tổng HCM', 'main', '123 Đường Lê Văn Việt, Quận 9, TP.HCM', true),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'KHO-HCM-LC', 'Kho lạnh HCM (Vaccine)', 'cold_chain', '123 Đường Lê Văn Việt, Quận 9, TP.HCM', true),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002',
   'KHO-DN-01', 'Kho tổng Đà Nẵng', 'main', '45 Đường Nguyễn Văn Linh, Quận Hải Châu, Đà Nẵng', true),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000003',
   'KHO-CT-01', 'Kho tổng Cần Thơ', 'main', '88 Đường 30 Tháng 4, Quận Ninh Kiều, Cần Thơ', true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3. NHÓM BẢNG PHÂN QUYỀN RBAC
-- ─────────────────────────────────────────────────────────────

-- 3.1 Vai trò hệ thống
INSERT INTO public.roles (id, code, name, description, is_system) VALUES
  ('33333333-0000-0000-0000-000000000001', 'admin',           'Quản trị hệ thống',     'Toàn quyền trên hệ thống', true),
  ('33333333-0000-0000-0000-000000000002', 'ceo',             'Giám đốc / CEO',         'Xem báo cáo toàn bộ, không chỉnh sửa dữ liệu nghiệp vụ', true),
  ('33333333-0000-0000-0000-000000000003', 'branch_manager',  'Quản lý chi nhánh',     'Quản lý dữ liệu trong chi nhánh', true),
  ('33333333-0000-0000-0000-000000000004', 'team_lead',       'Trưởng nhóm Sales',     'Quản lý nhóm bán hàng, xem báo cáo nhóm', true),
  ('33333333-0000-0000-0000-000000000005', 'sales',           'Nhân viên kinh doanh',  'Quản lý KH và đơn hàng của mình', true),
  ('33333333-0000-0000-0000-000000000006', 'accountant',      'Kế toán',               'Quản lý tài chính, sổ quỹ, công nợ', true),
  ('33333333-0000-0000-0000-000000000007', 'warehouse_keeper','Thủ kho',               'Quản lý kho, nhập xuất hàng', true),
  ('33333333-0000-0000-0000-000000000008', 'vet_consultant',  'Bác sĩ thú y / Tư vấn','Tư vấn kỹ thuật, xem hồ sơ đàn', true),
  ('33333333-0000-0000-0000-000000000009', 'viewer',          'Xem báo cáo',           'Chỉ xem báo cáo, không chỉnh sửa', false)
ON CONFLICT (id) DO NOTHING;

-- 3.2 Danh mục quyền (80+ permissions)
INSERT INTO public.permissions (id, code, module, action, description) VALUES
  -- === CUSTOMER PERMISSIONS ===
  ('44440001-0000-0000-0000-000000000001', 'customers.view_own',     'customers', 'view',   'Xem KH do mình phụ trách'),
  ('44440001-0000-0000-0000-000000000002', 'customers.view_team',    'customers', 'view',   'Xem KH trong nhóm'),
  ('44440001-0000-0000-0000-000000000003', 'customers.view_all',     'customers', 'view',   'Xem tất cả KH'),
  ('44440001-0000-0000-0000-000000000004', 'customers.create',       'customers', 'create', 'Tạo KH mới'),
  ('44440001-0000-0000-0000-000000000005', 'customers.update_own',   'customers', 'update', 'Cập nhật KH do mình phụ trách'),
  ('44440001-0000-0000-0000-000000000006', 'customers.update_all',   'customers', 'update', 'Cập nhật tất cả KH'),
  ('44440001-0000-0000-0000-000000000007', 'customers.delete',       'customers', 'delete', 'Xóa/vô hiệu hóa KH'),
  ('44440001-0000-0000-0000-000000000008', 'customers.reassign',     'customers', 'update', 'Chuyển phụ trách KH'),
  -- === ORDER PERMISSIONS ===
  ('44440002-0000-0000-0000-000000000001', 'orders.view_own',        'orders', 'view',     'Xem đơn hàng của mình'),
  ('44440002-0000-0000-0000-000000000002', 'orders.view_team',       'orders', 'view',     'Xem đơn hàng trong nhóm'),
  ('44440002-0000-0000-0000-000000000003', 'orders.view_all',        'orders', 'view',     'Xem tất cả đơn hàng'),
  ('44440002-0000-0000-0000-000000000004', 'orders.create',          'orders', 'create',   'Tạo đơn hàng mới'),
  ('44440002-0000-0000-0000-000000000005', 'orders.update_draft',    'orders', 'update',   'Sửa đơn hàng nháp'),
  ('44440002-0000-0000-0000-000000000006', 'orders.confirm',         'orders', 'update',   'Xác nhận đơn hàng'),
  ('44440002-0000-0000-0000-000000000007', 'orders.cancel',          'orders', 'update',   'Hủy đơn hàng'),
  ('44440002-0000-0000-0000-000000000008', 'orders.record_payment',  'orders', 'update',   'Ghi nhận thanh toán đơn'),
  ('44440002-0000-0000-0000-000000000009', 'orders.approve_return',  'orders', 'approve',  'Duyệt phiếu trả hàng'),
  -- === QUOTES PERMISSIONS ===
  ('44440003-0000-0000-0000-000000000001', 'quotes.create',          'quotes', 'create',   'Tạo báo giá'),
  ('44440003-0000-0000-0000-000000000002', 'quotes.view_all',        'quotes', 'view',     'Xem tất cả báo giá'),
  ('44440003-0000-0000-0000-000000000003', 'quotes.approve',         'quotes', 'approve',  'Duyệt báo giá'),
  -- === OPPORTUNITY PERMISSIONS ===
  ('44440004-0000-0000-0000-000000000001', 'opportunities.create',   'opportunities', 'create', 'Tạo cơ hội bán hàng'),
  ('44440004-0000-0000-0000-000000000002', 'opportunities.view_all', 'opportunities', 'view',   'Xem tất cả cơ hội'),
  ('44440004-0000-0000-0000-000000000003', 'opportunities.reassign', 'opportunities', 'update', 'Chuyển phụ trách cơ hội'),
  -- === PRODUCT PERMISSIONS ===
  ('44440005-0000-0000-0000-000000000001', 'products.view',          'products', 'view',   'Xem catalog sản phẩm'),
  ('44440005-0000-0000-0000-000000000002', 'products.manage',        'products', 'manage', 'Thêm/sửa/xóa sản phẩm'),
  ('44440005-0000-0000-0000-000000000003', 'pricing.manage',         'products', 'manage', 'Quản lý bảng giá'),
  ('44440005-0000-0000-0000-000000000004', 'promotions.manage',      'products', 'manage', 'Quản lý khuyến mãi'),
  -- === INVENTORY PERMISSIONS ===
  ('44440006-0000-0000-0000-000000000001', 'inventory.view',         'inventory', 'view',   'Xem tồn kho'),
  ('44440006-0000-0000-0000-000000000002', 'inventory.receive',      'inventory', 'create', 'Nhập kho'),
  ('44440006-0000-0000-0000-000000000003', 'inventory.adjust',       'inventory', 'update', 'Điều chỉnh tồn kho'),
  ('44440006-0000-0000-0000-000000000004', 'inventory.transfer',     'inventory', 'create', 'Chuyển kho'),
  ('44440006-0000-0000-0000-000000000005', 'purchase_orders.create', 'inventory', 'create', 'Tạo đơn đặt hàng NCC'),
  ('44440006-0000-0000-0000-000000000006', 'purchase_orders.approve','inventory', 'approve','Duyệt đơn đặt hàng NCC'),
  -- === CASHBOOK PERMISSIONS ===
  ('44440007-0000-0000-0000-000000000001', 'cashbook.view',          'cashbook', 'view',   'Xem sổ quỹ'),
  ('44440007-0000-0000-0000-000000000002', 'cashbook.create',        'cashbook', 'create', 'Tạo phiếu thu/chi'),
  ('44440007-0000-0000-0000-000000000003', 'cashbook.approve',       'cashbook', 'approve','Duyệt phiếu thu/chi'),
  ('44440007-0000-0000-0000-000000000004', 'cashbook.view_reports',  'cashbook', 'view',   'Xem báo cáo dòng tiền'),
  ('44440007-0000-0000-0000-000000000005', 'cashbook.manage_fund',   'cashbook', 'manage', 'Quản lý quỹ tiền mặt'),
  -- === HERD PROJECT PERMISSIONS ===
  ('44440008-0000-0000-0000-000000000001', 'herd_projects.create',   'herd_projects', 'create', 'Tạo dự án đàn'),
  ('44440008-0000-0000-0000-000000000002', 'herd_projects.view_all', 'herd_projects', 'view',   'Xem tất cả dự án đàn'),
  -- === REPORT PERMISSIONS ===
  ('44440009-0000-0000-0000-000000000001', 'reports.sales',          'reports', 'view', 'Xem báo cáo doanh thu'),
  ('44440009-0000-0000-0000-000000000002', 'reports.cashflow',       'reports', 'view', 'Xem báo cáo dòng tiền'),
  ('44440009-0000-0000-0000-000000000003', 'reports.inventory',      'reports', 'view', 'Xem báo cáo tồn kho'),
  ('44440009-0000-0000-0000-000000000004', 'reports.debt',           'reports', 'view', 'Xem báo cáo công nợ'),
  ('44440009-0000-0000-0000-000000000005', 'reports.team_kpi',       'reports', 'view', 'Xem KPI nhóm'),
  -- === USER MANAGEMENT PERMISSIONS ===
  ('44440010-0000-0000-0000-000000000001', 'users.manage',           'users', 'manage', 'Quản lý tài khoản nhân viên'),
  ('44440010-0000-0000-0000-000000000002', 'users.assign_role',      'users', 'manage', 'Gán vai trò cho nhân viên'),
  ('44440010-0000-0000-0000-000000000003', 'audit.view',             'system', 'view',  'Xem nhật ký hệ thống')
ON CONFLICT (id) DO NOTHING;

-- 3.3 Gán quyền cho vai trò
-- Admin: tất cả quyền
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000001', id FROM public.permissions
ON CONFLICT DO NOTHING;

-- CEO: xem báo cáo tất cả, xem KH, đơn hàng
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000002', id FROM public.permissions
WHERE code IN (
  'customers.view_all', 'orders.view_all', 'opportunities.view_all',
  'products.view', 'inventory.view', 'reports.sales', 'reports.cashflow',
  'reports.inventory', 'reports.debt', 'reports.team_kpi', 'herd_projects.view_all',
  'cashbook.view_reports', 'quotes.view_all'
)
ON CONFLICT DO NOTHING;

-- Branch Manager: quản lý chi nhánh
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000003', id FROM public.permissions
WHERE code IN (
  'customers.view_all', 'customers.update_all', 'customers.reassign',
  'orders.view_all', 'orders.confirm', 'orders.cancel',
  'opportunities.view_all', 'quotes.view_all', 'quotes.approve',
  'products.view', 'inventory.view', 'inventory.transfer',
  'reports.sales', 'reports.cashflow', 'reports.inventory', 'reports.debt', 'reports.team_kpi',
  'cashbook.view', 'cashbook.view_reports'
)
ON CONFLICT DO NOTHING;

-- Team Lead: quản lý nhóm
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000004', id FROM public.permissions
WHERE code IN (
  'customers.view_team', 'customers.create', 'customers.update_all', 'customers.reassign',
  'orders.view_team', 'orders.create', 'orders.update_draft', 'orders.confirm', 'orders.cancel',
  'orders.record_payment',
  'opportunities.create', 'opportunities.view_all', 'opportunities.reassign',
  'quotes.create', 'quotes.view_all', 'quotes.approve',
  'products.view', 'inventory.view',
  'reports.sales', 'reports.team_kpi',
  'herd_projects.create'
)
ON CONFLICT DO NOTHING;

-- Sales: quản lý KH và đơn hàng của mình
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000005', id FROM public.permissions
WHERE code IN (
  'customers.view_own', 'customers.create', 'customers.update_own',
  'orders.view_own', 'orders.create', 'orders.update_draft', 'orders.confirm',
  'orders.record_payment',
  'opportunities.create', 'quotes.create',
  'products.view', 'inventory.view',
  'herd_projects.create'
)
ON CONFLICT DO NOTHING;

-- Accountant: quản lý tài chính toàn bộ
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000006', id FROM public.permissions
WHERE code IN (
  'customers.view_all',
  'orders.view_all', 'orders.record_payment', 'orders.approve_return',
  'quotes.view_all', 'products.view',
  'cashbook.view', 'cashbook.create', 'cashbook.approve', 'cashbook.view_reports', 'cashbook.manage_fund',
  'reports.sales', 'reports.cashflow', 'reports.debt', 'reports.inventory',
  'purchase_orders.create'
)
ON CONFLICT DO NOTHING;

-- Warehouse Keeper: quản lý kho
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000007', id FROM public.permissions
WHERE code IN (
  'products.view', 'inventory.view', 'inventory.receive', 'inventory.adjust', 'inventory.transfer',
  'purchase_orders.create', 'orders.view_all', 'reports.inventory'
)
ON CONFLICT DO NOTHING;

-- Vet Consultant: xem hồ sơ đàn, KH liên quan
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000008', id FROM public.permissions
WHERE code IN (
  'customers.view_team', 'products.view', 'inventory.view', 'herd_projects.view_all'
)
ON CONFLICT DO NOTHING;

-- Viewer: xem báo cáo
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '33333333-0000-0000-0000-000000000009', id FROM public.permissions
WHERE code IN (
  'reports.sales', 'reports.inventory', 'products.view'
)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. NHÓM BÁN HÀNG
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.teams (id, branch_id, code, name, description, is_active) VALUES
  ('55555555-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'TEAM-MD', 'Nhóm Miền Đông', 'Phụ trách tỉnh thành Đông Nam Bộ', true),
  ('55555555-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'TEAM-MT', 'Nhóm Miền Tây', 'Phụ trách tỉnh thành Đồng bằng sông Cửu Long', true),
  ('55555555-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002',
   'TEAM-DN', 'Nhóm Đà Nẵng', 'Phụ trách khu vực miền Trung', true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5. DANH MỤC SẢN PHẨM
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.product_categories (id, code, name, sort_order, is_active) VALUES
  ('66660001-0000-0000-0000-000000000001', 'VACCINE',    'Vaccine & Sinh phẩm',        1, true),
  ('66660001-0000-0000-0000-000000000002', 'THUOC',      'Thuốc thú y',                2, true),
  ('66660001-0000-0000-0000-000000000003', 'THIET-BI',   'Thiết bị chăn nuôi',         3, true),
  ('66660001-0000-0000-0000-000000000004', 'THUC-AN',    'Thức ăn bổ sung & Premix',   4, true),
  ('66660001-0000-0000-0000-000000000005', 'DUNG-CU',    'Dụng cụ & Vật tư chăn nuôi',5, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, name, country, is_active) VALUES
  ('66660002-0000-0000-0000-000000000001', 'Merial (Boehringer Ingelheim)', 'Pháp', true),
  ('66660002-0000-0000-0000-000000000002', 'MSD Animal Health', 'Mỹ', true),
  ('66660002-0000-0000-0000-000000000003', 'Zoetis', 'Mỹ', true),
  ('66660002-0000-0000-0000-000000000004', 'Navetco', 'Việt Nam', true),
  ('66660002-0000-0000-0000-000000000005', 'Hanvet', 'Việt Nam', true),
  ('66660002-0000-0000-0000-000000000006', 'Sanh Long Private Label', 'Việt Nam', true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 6. SẢN PHẨM MẪU
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.products (id, sku, name, category_id, brand_id, unit, storage_condition, is_lot_managed, min_stock_level, is_active) VALUES
  -- Vaccine heo
  ('77770001-0000-0000-0000-000000000001', 'VAC-CSF-50',
   'Vaccine Dịch tả heo cổ điển (CSF) 50 liều',
   '66660001-0000-0000-0000-000000000001', '66660002-0000-0000-0000-000000000001',
   'lọ', 'Bảo quản 2-8°C, tránh ánh sáng', true, 50, true),

  ('77770001-0000-0000-0000-000000000002', 'VAC-PRRS-100',
   'Vaccine PRRS (Tai xanh heo) 100 liều',
   '66660001-0000-0000-0000-000000000001', '66660002-0000-0000-0000-000000000002',
   'lọ', 'Bảo quản 2-8°C, tránh ánh sáng', true, 30, true),

  ('77770001-0000-0000-0000-000000000003', 'VAC-FMD-50',
   'Vaccine Lở mồm long móng (FMD) Type O 50ml',
   '66660001-0000-0000-0000-000000000001', '66660002-0000-0000-0000-000000000003',
   'lọ', 'Bảo quản 2-8°C', true, 20, true),

  -- Thuốc thú y
  ('77770001-0000-0000-0000-000000000004', 'THU-AMOX-10',
   'Amoxicillin 10% Injectable 100ml',
   '66660001-0000-0000-0000-000000000002', '66660002-0000-0000-0000-000000000004',
   'lọ', 'Nhiệt độ phòng, dưới 30°C', false, 100, true),

  ('77770001-0000-0000-0000-000000000005', 'THU-TYLMICO-1KG',
   'Tylmicosin Phosphate 10% premix 1kg',
   '66660001-0000-0000-0000-000000000002', '66660002-0000-0000-0000-000000000005',
   'kg', 'Nhiệt độ phòng, tránh ẩm', false, 50, true),

  ('77770001-0000-0000-0000-000000000006', 'THU-OXYTET-20',
   'Oxytetracycline HCl 20% 100ml',
   '66660001-0000-0000-0000-000000000002', '66660002-0000-0000-0000-000000000004',
   'lọ', 'Bảo quản mát, tránh ánh sáng', false, 80, true),

  -- Thiết bị chăn nuôi
  ('77770001-0000-0000-0000-000000000007', 'TB-MANGUONG-05',
   'Máng uống núm tự động (inox) heo thịt',
   '66660001-0000-0000-0000-000000000003', '66660002-0000-0000-0000-000000000006',
   'cái', 'Bảo quản nơi khô ráo', false, 200, true),

  ('77770001-0000-0000-0000-000000000008', 'TB-MANGAO-05',
   'Máng ăn inox dài 60cm cho heo con cai sữa',
   '66660001-0000-0000-0000-000000000003', '66660002-0000-0000-0000-000000000006',
   'cái', 'Bảo quản nơi khô ráo', false, 100, true),

  -- Thức ăn bổ sung
  ('77770001-0000-0000-0000-000000000009', 'TA-BSELECTRO-1KG',
   'Bột điện giải BS-Electro 1kg',
   '66660001-0000-0000-0000-000000000004', '66660002-0000-0000-0000-000000000006',
   'kg', 'Nhiệt độ phòng, tránh ẩm', false, 50, true),

  ('77770001-0000-0000-0000-000000000010', 'TA-VITAMINC-1KG',
   'Vitamin C 97.5% Feed Grade 1kg',
   '66660001-0000-0000-0000-000000000004', '66660002-0000-0000-0000-000000000006',
   'kg', 'Nhiệt độ phòng, tránh ánh sáng', false, 30, true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 7. BẢNG GIÁ
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.price_lists (id, code, name, description, currency, is_default, is_active) VALUES
  ('88880001-0000-0000-0000-000000000001', 'GIA-LE',    'Giá lẻ (Hộ chăn nuôi)',  'Áp dụng cho hộ chăn nuôi, khách lẻ', 'VND', true,  true),
  ('88880001-0000-0000-0000-000000000002', 'GIA-DL',    'Giá đại lý',             'Áp dụng cho đại lý phân phối', 'VND', false, true),
  ('88880001-0000-0000-0000-000000000003', 'GIA-VIP',   'Giá VIP / Trang trại lớn','Dành cho trang trại thương mại lớn, VIP', 'VND', false, true)
ON CONFLICT (id) DO NOTHING;

-- Giá sản phẩm theo bảng giá
INSERT INTO public.price_list_items (price_list_id, product_id, cost_price, selling_price) VALUES
  -- Giá lẻ
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000001', 120000, 180000),  -- Vaccine CSF
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000002', 250000, 380000),  -- Vaccine PRRS
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000003', 180000, 280000),  -- Vaccine FMD
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000004',  45000,  85000),  -- Amoxicillin
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000005', 180000, 320000),  -- Tylmicosin
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000006',  35000,  65000),  -- Oxytet
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000007',  55000,  95000),  -- Máng uống
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000008',  80000, 140000),  -- Máng ăn
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000009', 120000, 200000),  -- Điện giải
  ('88880001-0000-0000-0000-000000000001', '77770001-0000-0000-0000-000000000010',  85000, 150000),  -- Vitamin C
  -- Giá đại lý (~15% thấp hơn giá lẻ)
  ('88880001-0000-0000-0000-000000000002', '77770001-0000-0000-0000-000000000001', 120000, 153000),
  ('88880001-0000-0000-0000-000000000002', '77770001-0000-0000-0000-000000000002', 250000, 323000),
  ('88880001-0000-0000-0000-000000000002', '77770001-0000-0000-0000-000000000003', 180000, 238000),
  ('88880001-0000-0000-0000-000000000002', '77770001-0000-0000-0000-000000000004',  45000,  72250),
  ('88880001-0000-0000-0000-000000000002', '77770001-0000-0000-0000-000000000005', 180000, 272000),
  -- Giá VIP (~25% thấp hơn giá lẻ)
  ('88880001-0000-0000-0000-000000000003', '77770001-0000-0000-0000-000000000001', 120000, 135000),
  ('88880001-0000-0000-0000-000000000003', '77770001-0000-0000-0000-000000000002', 250000, 285000),
  ('88880001-0000-0000-0000-000000000003', '77770001-0000-0000-0000-000000000003', 180000, 210000)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 8. NHÀ CUNG CẤP
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.suppliers (id, code, name, tax_code, address, payment_terms, is_active) VALUES
  ('99990001-0000-0000-0000-000000000001', 'NCC-MERIAL',   'Boehringer Ingelheim Vietnam',
   '0301234567', 'Tầng 10, 115 Nguyễn Huệ, Quận 1, TP.HCM', 'Net 30', true),
  ('99990001-0000-0000-0000-000000000002', 'NCC-NAVETCO',  'Công ty Navetco',
   '0302345678', 'Đường số 12, Khu Công nghiệp Tân Bình, TP.HCM', 'Net 45', true),
  ('99990001-0000-0000-0000-000000000003', 'NCC-HANVET',   'Công ty Hanvet',
   '0100123456', '15 Trương Quốc Dung, Phú Nhuận, TP.HCM', 'Net 30', true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 9. DANH MỤC LOÀI VẬT NUÔI
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.species (id, name, category) VALUES
  ('aaaa0001-0000-0000-0000-000000000001', 'Heo thịt', 'livestock'),
  ('aaaa0001-0000-0000-0000-000000000002', 'Heo nái', 'livestock'),
  ('aaaa0001-0000-0000-0000-000000000003', 'Heo đực giống', 'livestock'),
  ('aaaa0001-0000-0000-0000-000000000004', 'Gà thịt (broiler)', 'poultry'),
  ('aaaa0001-0000-0000-0000-000000000005', 'Gà đẻ (layer)', 'poultry'),
  ('aaaa0001-0000-0000-0000-000000000006', 'Vịt thịt', 'poultry'),
  ('aaaa0001-0000-0000-0000-000000000007', 'Bò thịt', 'livestock'),
  ('aaaa0001-0000-0000-0000-000000000008', 'Dê', 'livestock')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 10. TỪ ĐIỂN BỆNH PHỔ BIẾN
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.disease_dictionary (id, code, name, category, description, is_notifiable) VALUES
  ('bbbb0001-0000-0000-0000-000000000001', 'ASF',  'Dịch tả heo Châu Phi (ASF)', 'Virus', 'African Swine Fever – không có vaccine', true),
  ('bbbb0001-0000-0000-0000-000000000002', 'CSF',  'Dịch tả heo cổ điển (CSF)', 'Virus', 'Classical Swine Fever – có vaccine phòng', true),
  ('bbbb0001-0000-0000-0000-000000000003', 'PRRS', 'Hội chứng rối loạn sinh sản và hô hấp (PRRS)', 'Virus', 'Tai xanh heo – có vaccine', true),
  ('bbbb0001-0000-0000-0000-000000000004', 'FMD',  'Lở mồm long móng (FMD)', 'Virus', 'Foot and Mouth Disease – có vaccine', true),
  ('bbbb0001-0000-0000-0000-000000000005', 'PED',  'Tiêu chảy dịch tả heo (PED)', 'Virus', 'Porcine Epidemic Diarrhea', false),
  ('bbbb0001-0000-0000-0000-000000000006', 'APP',  'Viêm phổi màng phổi heo (APP)', 'Vi khuẩn', 'Actinobacillus Pleuropneumoniae', false)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 11. PIPELINE & LOẠI HOẠT ĐỘNG
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.pipeline_definitions (id, code, name, description, is_default, is_active) VALUES
  ('cccc0001-0000-0000-0000-000000000001', 'MAIN', 'Pipeline Bán hàng Thú y', 'Pipeline chính cho bán vaccine, thuốc, thiết bị', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (pipeline_id, code, name, sort_order, win_probability, is_won_stage, is_lost_stage, color_hex) VALUES
  ('cccc0001-0000-0000-0000-000000000001', 'TIEP_CAN',  'Tiếp cận',    1, 10,  false, false, '#94a3b8'),
  ('cccc0001-0000-0000-0000-000000000001', 'TU_VAN',    'Tư vấn',      2, 25,  false, false, '#60a5fa'),
  ('cccc0001-0000-0000-0000-000000000001', 'BAO_GIA',   'Báo giá',     3, 50,  false, false, '#a78bfa'),
  ('cccc0001-0000-0000-0000-000000000001', 'DAM_PHAN',  'Đàm phán',    4, 70,  false, false, '#f97316'),
  ('cccc0001-0000-0000-0000-000000000001', 'CHOT_DON',  'Chốt đơn',    5, 90,  false, false, '#22c55e'),
  ('cccc0001-0000-0000-0000-000000000001', 'THANG',     'Thắng ✓',     6, 100, true,  false, '#16a34a'),
  ('cccc0001-0000-0000-0000-000000000001', 'THUA',      'Thua ✗',      7, 0,   false, true,  '#ef4444')
ON CONFLICT DO NOTHING;

INSERT INTO public.activity_types (id, code, name, icon, color_hex) VALUES
  ('dddd0001-0000-0000-0000-000000000001', 'call',    'Gọi điện',     'phone',        '#3b82f6'),
  ('dddd0001-0000-0000-0000-000000000002', 'visit',   'Ghé thăm',     'map-pin',      '#22c55e'),
  ('dddd0001-0000-0000-0000-000000000003', 'demo',    'Demo sản phẩm','presentation', '#a78bfa'),
  ('dddd0001-0000-0000-0000-000000000004', 'email',   'Gửi email',    'mail',         '#f97316'),
  ('dddd0001-0000-0000-0000-000000000005', 'zalo',    'Zalo',         'message',      '#1d4ed8'),
  ('dddd0001-0000-0000-0000-000000000006', 'note',    'Ghi chú',      'sticky-note',  '#94a3b8'),
  ('dddd0001-0000-0000-0000-000000000007', 'training','Tập huấn KT',  'graduation',   '#06b6d4'),
  ('dddd0001-0000-0000-0000-000000000008', 'sample',  'Cấp mẫu thử', 'gift',         '#f59e0b')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 12. LÝ DO THUA CƠ HỘI
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.lost_reasons (name, description, is_active) VALUES
  ('Giá cao hơn đối thủ',     'Khách hàng chọn sản phẩm có giá thấp hơn', true),
  ('Sản phẩm không phù hợp',  'Sản phẩm không đáp ứng nhu cầu kỹ thuật của trại', true),
  ('Khách mua qua kênh khác', 'Khách mua trực tiếp qua đại lý địa phương', true),
  ('Không có nhu cầu',         'Trại tạm ngừng hoặc giảm quy mô chăn nuôi', true),
  ('Mất liên lạc',             'Không liên hệ được sau nhiều lần thử', true),
  ('Không đủ ngân sách',       'Khách thiếu vốn, trì hoãn mua hàng', true),
  ('Đối thủ cạnh tranh mạnh', 'Đối thủ có quan hệ tốt hơn hoặc chính sách hấp dẫn hơn', true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 13. LOẠI DỰ ÁN ĐÀN MẪU
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.herd_project_types (id, code, name, species_id, description, is_active) VALUES
  ('eeee0001-0000-0000-0000-000000000001', 'KH-HEO-NAI', 'Kế hoạch theo dõi heo nái đẻ',
   'aaaa0001-0000-0000-0000-000000000002',
   'Kế hoạch vaccine và điều trị cho chu kỳ đẻ của heo nái', true),
  ('eeee0001-0000-0000-0000-000000000002', 'KH-HEO-THIT', 'Kế hoạch heo thịt xuất chuồng',
   'aaaa0001-0000-0000-0000-000000000001',
   'Theo dõi từ nhập đàn đến xuất chuồng heo thịt', true),
  ('eeee0001-0000-0000-0000-000000000003', 'KH-GA-THIT', 'Kế hoạch gà thịt (broiler)',
   'aaaa0001-0000-0000-0000-000000000004',
   'Kế hoạch nuôi gà thịt 42 ngày', true)
ON CONFLICT (id) DO NOTHING;

-- Bước mặc định cho kế hoạch heo nái đẻ
INSERT INTO public.herd_project_type_default_steps (project_type_id, step_name, sort_order, days_offset, description) VALUES
  ('eeee0001-0000-0000-0000-000000000001', 'Phối giống / Thụ tinh nhân tạo', 1, 0,   'Ghi nhận ngày phối'),
  ('eeee0001-0000-0000-0000-000000000001', 'Chẩn đoán mang thai (30 ngày)', 2, 30,  'Siêu âm chẩn đoán thai'),
  ('eeee0001-0000-0000-0000-000000000001', 'Vaccine PRRS trước đẻ',          3, 80,  'Tiêm vaccine PRRS trước đẻ 1 tháng'),
  ('eeee0001-0000-0000-0000-000000000001', 'Vaccine CSF trước đẻ',           4, 85,  'Tiêm vaccine CSF'),
  ('eeee0001-0000-0000-0000-000000000001', 'Chuyển chuồng đẻ',               5, 110, 'Chuyển nái vào chuồng đẻ'),
  ('eeee0001-0000-0000-0000-000000000001', 'Đẻ heo con',                     6, 115, 'Ghi nhận số con sinh ra, trọng lượng'),
  ('eeee0001-0000-0000-0000-000000000001', 'Cai sữa heo con (21-28 ngày)',    7, 136, 'Cai sữa và tách đàn'),
  ('eeee0001-0000-0000-0000-000000000001', 'Kết thúc chu kỳ',                 8, 140, 'Đánh giá hiệu quả cả chu kỳ')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 14. QUỸ TIỀN MẶT & TÀI KHOẢN NGÂN HÀNG
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.cash_funds (id, branch_id, code, name, balance, currency, is_active) VALUES
  ('ffff0001-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'QUY-HCM', 'Quỹ tiền mặt HCM', 50000000, 'VND', true),
  ('ffff0001-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002',
   'QUY-DN', 'Quỹ tiền mặt Đà Nẵng', 20000000, 'VND', true),
  ('ffff0001-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000003',
   'QUY-CT', 'Quỹ tiền mặt Cần Thơ', 15000000, 'VND', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bank_accounts (id, branch_id, bank_name, account_name, account_no, branch_name, balance, currency, is_active) VALUES
  ('ffff0002-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'Vietcombank', 'CÔNG TY TNHH SANH LONG VETCO',
   '0071003456789', 'CN Bình Dương', 500000000, 'VND', true),
  ('ffff0002-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'Techcombank', 'CÔNG TY TNHH SANH LONG VETCO',
   '19038765432101', 'CN TP.HCM', 200000000, 'VND', true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 15. DANH MỤC KHOẢN CHI PHÍ
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.expense_categories (id, code, name, flow_type, is_active) VALUES
  ('e0e00001-0000-0000-0000-000000000001', 'CHI-NCC',      'Thanh toán nhà cung cấp',     'outflow', true),
  ('e0e00001-0000-0000-0000-000000000002', 'CHI-LUONG',    'Lương và thưởng nhân viên',   'outflow', true),
  ('e0e00001-0000-0000-0000-000000000003', 'CHI-VAN-PHONG','Chi phí văn phòng',            'outflow', true),
  ('e0e00001-0000-0000-0000-000000000004', 'CHI-XANG',     'Xăng xe, đi lại',             'outflow', true),
  ('e0e00001-0000-0000-0000-000000000005', 'CHI-VAN-CHUYEN','Vận chuyển, giao hàng',      'outflow', true),
  ('e0e00001-0000-0000-0000-000000000006', 'CHI-TIEP-THI', 'Chi phí tiếp thị, quảng cáo', 'outflow', true),
  ('e0e00001-0000-0000-0000-000000000007', 'CHI-TAM-UNG',  'Tạm ứng nhân viên',           'outflow', true),
  ('e0e00001-0000-0000-0000-000000000008', 'THU-DON-HANG', 'Thu tiền đơn hàng',            'inflow',  true),
  ('e0e00001-0000-0000-0000-000000000009', 'THU-NO',       'Thu công nợ khách hàng',       'inflow',  true),
  ('e0e00001-0000-0000-0000-000000000010', 'THU-KHAC',     'Thu khác',                     'inflow',  true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 16. GHI CHÚ CHO DBA / DEV
-- ─────────────────────────────────────────────────────────────
-- Dữ liệu khách hàng mẫu, đơn hàng mẫu, cơ hội mẫu và các hoạt động
-- KHÔNG được seed ở đây vì cần có user thực (profiles) đã tồn tại
-- để gán owner_user_id.
--
-- Quy trình seed đầy đủ:
-- 1. Chạy file này: seed.sql (dữ liệu tĩnh)
-- 2. Tạo tài khoản Admin trong Supabase Auth Dashboard
-- 3. Admin đăng nhập, trigger fn_handle_new_user() tự tạo profile
-- 4. Admin gán role 'admin' qua Dashboard hoặc SQL
-- 5. Admin tạo thêm nhân viên, nhóm, phân quyền qua UI
-- 6. Chạy script seed_demo_data.sql riêng (nếu cần dữ liệu demo)

-- Kiểm tra xem dữ liệu seed đã được nạp thành công
DO $$
BEGIN
  RAISE NOTICE '✅ Seed data loaded successfully!';
  RAISE NOTICE '   - Branches:            %', (SELECT COUNT(*) FROM public.branches);
  RAISE NOTICE '   - Warehouses:          %', (SELECT COUNT(*) FROM public.warehouses);
  RAISE NOTICE '   - Teams:               %', (SELECT COUNT(*) FROM public.teams);
  RAISE NOTICE '   - Roles:               %', (SELECT COUNT(*) FROM public.roles);
  RAISE NOTICE '   - Permissions:         %', (SELECT COUNT(*) FROM public.permissions);
  RAISE NOTICE '   - Role-Permissions:    %', (SELECT COUNT(*) FROM public.role_permissions);
  RAISE NOTICE '   - Product Categories:  %', (SELECT COUNT(*) FROM public.product_categories);
  RAISE NOTICE '   - Products:            %', (SELECT COUNT(*) FROM public.products);
  RAISE NOTICE '   - Price Lists:         %', (SELECT COUNT(*) FROM public.price_lists);
  RAISE NOTICE '   - Suppliers:           %', (SELECT COUNT(*) FROM public.suppliers);
  RAISE NOTICE '   - Species:             %', (SELECT COUNT(*) FROM public.species);
  RAISE NOTICE '   - Disease Dictionary:  %', (SELECT COUNT(*) FROM public.disease_dictionary);
  RAISE NOTICE '   - Pipeline Stages:     %', (SELECT COUNT(*) FROM public.pipeline_stages);
  RAISE NOTICE '   - Cash Funds:          %', (SELECT COUNT(*) FROM public.cash_funds);
  RAISE NOTICE '   - Bank Accounts:       %', (SELECT COUNT(*) FROM public.bank_accounts);
END
$$;
