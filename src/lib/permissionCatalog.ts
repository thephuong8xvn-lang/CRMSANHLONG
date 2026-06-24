// ─────────────────────────────────────────────────────────────
// CATALOG PHÂN QUYỀN — NGUỒN SỰ THẬT DUY NHẤT (FE)
//
// Mỗi quyền = `module.action`. Catalog này:
//   • Driver cho ma trận "Vai trò & Phân quyền" (Cấu hình → admin).
//   • Đồng bộ với bảng DB `permissions` (migration seed cùng code).
//   • THÊM CHỨC NĂNG MỚI → thêm 1 dòng action ở đây + seed DB → tự xuất
//     hiện trong màn phân quyền.
//
// `enforced: true` = đã có RLS/RPC kiểm tra theo permission (đổi quyền có
// hiệu lực THẬT ở server). `enforced: false/undefined` = đang trong lộ trình
// chuyển dần (hiện RLS vẫn theo role) → đánh nhãn "Sắp tới" ở UI để không
// gây hiểu nhầm bảo mật.
// ─────────────────────────────────────────────────────────────

export interface CatalogAction {
  action: string   // view | create | edit | delete | <đặc biệt>
  label: string    // nhãn cột/chip hiển thị
  code: string     // module.action — khớp permissions.code ở DB
  enforced?: boolean
}

export interface CatalogModule {
  key: string      // tiền tố module (vd 'customers')
  label: string    // tên hiển thị
  group: string    // nhóm để gom hàng trong ma trận
  actions: CatalogAction[]
}

// 4 hành động chuẩn (Xem / Thêm / Sửa / Xóa) — cột cố định của ma trận.
export const CORE_ACTIONS = [
  { action: 'view', label: 'Xem' },
  { action: 'create', label: 'Thêm' },
  { action: 'edit', label: 'Sửa' },
  { action: 'delete', label: 'Xóa' },
] as const

const core = (key: string): CatalogAction[] =>
  CORE_ACTIONS.map(a => ({ action: a.action, label: a.label, code: `${key}.${a.action}` }))

export const PERMISSION_CATALOG: CatalogModule[] = [
  // ── Kinh doanh ──
  {
    key: 'customers', label: 'Khách hàng', group: 'Kinh doanh',
    actions: [
      { action: 'view', label: 'Xem', code: 'customers.view_all' },
      { action: 'create', label: 'Thêm', code: 'customers.create' },
      { action: 'edit', label: 'Sửa', code: 'customers.edit' },
      { action: 'delete', label: 'Xóa', code: 'customers.delete' },
      { action: 'collect_debt', label: 'Thu nợ', code: 'customers.collect_debt', enforced: true },
      { action: 'adjust_debt', label: 'Điều chỉnh nợ', code: 'customers.adjust_debt' },
      { action: 'export', label: 'Xuất công nợ', code: 'customers.export' },
    ],
  },
  {
    key: 'orders', label: 'Đơn hàng / POS', group: 'Kinh doanh',
    actions: [
      { action: 'view', label: 'Xem', code: 'orders.view' },
      { action: 'create', label: 'Bán / Tạo đơn', code: 'orders.create' },
      { action: 'edit', label: 'Sửa', code: 'orders.edit' },
      { action: 'delete', label: 'Hủy', code: 'orders.delete' },
      { action: 'record_payment', label: 'Ghi thanh toán', code: 'orders.record_payment' },
      { action: 'approve_return', label: 'Duyệt trả hàng', code: 'orders.approve_return' },
    ],
  },
  {
    key: 'pipeline', label: 'Cơ hội / Pipeline', group: 'Kinh doanh',
    actions: [
      { action: 'view', label: 'Xem', code: 'pipeline.view' },
      { action: 'create', label: 'Thêm', code: 'pipeline.create' },
      { action: 'edit', label: 'Sửa', code: 'pipeline.edit' },
      { action: 'reassign', label: 'Phân lại', code: 'pipeline.reassign' },
    ],
  },
  {
    key: 'promotions', label: 'Khuyến mãi', group: 'Kinh doanh',
    actions: [
      { action: 'view', label: 'Xem', code: 'promotions.view' },
      { action: 'manage', label: 'Quản lý', code: 'promotions.manage' },
    ],
  },

  // ── Kho & Hàng hóa ──
  {
    key: 'products', label: 'Sản phẩm', group: 'Kho & Hàng hóa',
    actions: [
      { action: 'view', label: 'Xem', code: 'products.view' },
      { action: 'create', label: 'Thêm', code: 'products.create' },
      { action: 'edit', label: 'Sửa', code: 'products.edit' },
      { action: 'delete', label: 'Xóa', code: 'products.delete' },
      { action: 'manage', label: 'Quản lý danh mục/giá', code: 'products.manage' },
    ],
  },
  {
    key: 'inventory', label: 'Kho hàng', group: 'Kho & Hàng hóa',
    actions: [
      { action: 'view', label: 'Xem', code: 'inventory.view' },
      { action: 'receive', label: 'Nhập kho', code: 'inventory.receive' },
      { action: 'adjust', label: 'Điều chỉnh', code: 'inventory.adjust' },
      { action: 'transfer', label: 'Chuyển kho', code: 'inventory.transfer' },
    ],
  },
  {
    key: 'purchase_orders', label: 'Đặt mua / NCC', group: 'Kho & Hàng hóa',
    actions: [
      { action: 'view', label: 'Xem', code: 'purchase_orders.view' },
      { action: 'create', label: 'Thêm', code: 'purchase_orders.create' },
      { action: 'approve', label: 'Duyệt', code: 'purchase_orders.approve' },
      { action: 'manage_supplier', label: 'Quản lý NCC', code: 'suppliers.manage' },
    ],
  },

  // ── Tài chính ──
  {
    key: 'cashbook', label: 'Sổ quỹ', group: 'Tài chính',
    actions: [
      { action: 'view', label: 'Xem', code: 'cashbook.view' },
      { action: 'create_inflow', label: 'Phiếu thu', code: 'cashbook.create_inflow' },
      { action: 'create_outflow', label: 'Phiếu chi', code: 'cashbook.create_outflow' },
      { action: 'approve', label: 'Duyệt phiếu', code: 'cashbook.approve' },
      { action: 'manage_fund', label: 'Quản lý quỹ/TK', code: 'cashbook.manage_fund' },
    ],
  },

  // ── Chăn nuôi ──
  {
    key: 'herd_projects', label: 'Chăn nuôi / Kế hoạch', group: 'Chăn nuôi',
    actions: [
      { action: 'view', label: 'Xem', code: 'herd_projects.view_all' },
      { action: 'create', label: 'Thêm', code: 'herd_projects.create' },
      { action: 'update', label: 'Sửa', code: 'herd_projects.update' },
      { action: 'delete', label: 'Xóa', code: 'herd_projects.delete' },
      { action: 'manage_members', label: 'Quản lý thành viên', code: 'herd_projects.manage_members' },
    ],
  },

  // ── Báo cáo & Phân tích ──
  {
    key: 'reports', label: 'Báo cáo', group: 'Báo cáo & Phân tích',
    actions: [
      { action: 'sales', label: 'Doanh số', code: 'reports.sales' },
      { action: 'cashflow', label: 'Dòng tiền', code: 'reports.cashflow' },
      { action: 'inventory', label: 'Tồn kho/Giá vốn', code: 'reports.inventory' },
      { action: 'debt', label: 'Công nợ', code: 'reports.debt' },
      { action: 'team_kpi', label: 'KPI đội nhóm', code: 'reports.team_kpi' },
      { action: 'strategic', label: 'SP chiến lược', code: 'reports.strategic' },
    ],
  },

  // ── Hệ thống ──
  {
    key: 'system', label: 'Hệ thống & Cấu hình', group: 'Hệ thống',
    actions: [
      { action: 'users_manage', label: 'Quản lý nhân sự', code: 'users.manage' },
      { action: 'assign_role', label: 'Gán vai trò', code: 'users.assign_role' },
      { action: 'roles_manage', label: 'Quản lý phân quyền', code: 'roles.manage' },
      { action: 'settings', label: 'Cấu hình hệ thống', code: 'settings.manage' },
      { action: 'audit', label: 'Nhật ký audit', code: 'audit.view' },
    ],
  },
]

// Mọi permission code hợp lệ — dùng để kiểm tra toàn vẹn (FE dùng code có
// trong catalog) và sinh seed.
export const ALL_PERMISSION_CODES: string[] = PERMISSION_CATALOG.flatMap(m =>
  m.actions.map(a => a.code),
)

export const ENFORCED_CODES: Set<string> = new Set(
  PERMISSION_CATALOG.flatMap(m => m.actions.filter(a => a.enforced).map(a => a.code)),
)

// Nhãn module có code (tra cứu nhanh module/action từ code).
export function metaForCode(code: string): { module: string; action: string; label: string } | null {
  for (const m of PERMISSION_CATALOG) {
    const a = m.actions.find(x => x.code === code)
    if (a) return { module: m.key, action: a.action, label: `${m.label} · ${a.label}` }
  }
  return null
}
