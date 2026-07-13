import { QueryClient } from '@tanstack/react-query'

// Sprint P1-1 (2026-05-26): QueryClient dùng chung toàn app.
// Default chọn cân bằng cho ERP:
//   • staleTime 60s: phần lớn list/báo cáo không cần realtime, 1 phút là OK
//     để dedup nhiều component cùng query một entity.
//   • gcTime 5 phút: giữ cache khi user navigate qua lại.
//   • refetchOnWindowFocus false: tránh fetch dồn khi alt-tab; user có nút
//     refresh thủ công nếu cần dữ liệu mới ngay.
//   • retry 1: mạng kém vẫn cho 1 cơ hội, không đợi quá lâu.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// Key factory tập trung – tránh typo + để invalidate dễ.
export const qk = {
  customers: {
    all: ['customers'] as const,
    list: (params: object) => ['customers', 'list', params] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
    classifications: ['customers', 'classifications'] as const,
    tiers: ['customers', 'tiers'] as const,
    orders: (id: string) => ['customers', 'orders', id] as const,
    debts: (id: string) => ['customers', 'debts', id] as const,
    churnWorklist: (ownerId: string | null) => ['customers', 'churn-worklist', ownerId] as const,
  },
  bi: {
    pivot: (params: object) => ['bi', 'pivot', params] as const,
    abcXyz: (from: string, to: string) => ['bi', 'abc-xyz', from, to] as const,
    cohort: (months: number) => ['bi', 'cohort', months] as const,
  },
  forecast: {
    demandHistory: (weeks: number) => ['forecast', 'demand-history', weeks] as const,
    config: ['forecast', 'config'] as const,
  },
  products: {
    all: ['products'] as const,
    list: (params: object) => ['products', 'list', params] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
    categories: ['products', 'categories'] as const,
    brands: ['products', 'brands'] as const,
    lots: (id: string, branchId?: string | null, scope: 'in_stock' | 'depleted' = 'in_stock', page = 1) =>
      ['products', 'lots', id, branchId ?? 'all', scope, page] as const,
    lotsDepletedCount: (id: string, branchId?: string | null) =>
      ['products', 'lots', id, branchId ?? 'all', 'depleted_count'] as const,
    movements: (id: string, branchId?: string | null) => ['products', 'movements', id, branchId ?? 'all'] as const,
    promotions: (id: string) => ['products', 'promotions', id] as const,
  },
  orders: {
    all: ['orders'] as const,
    list: (params: object) => ['orders', 'list', params] as const,
    detail: (id: string) => ['orders', 'detail', id] as const,
  },
  dashboard: {
    stats: (branchId: string | null = null) => ['dashboard', 'stats', branchId] as const,
    disbursements: (branchId: string | null, limit: number) =>
      ['dashboard', 'pending-disbursements', branchId, limit] as const,
    appointments: (branchId: string | null, limit: number) =>
      ['dashboard', 'today-appointments', branchId, limit] as const,
    atRiskRegulars: (limit: number) => ['dashboard', 'at-risk-regulars', limit] as const,
    upcomingDebts: (days: number, limit: number) => ['dashboard', 'upcoming-debts', days, limit] as const,
  },
  inventory: {
    expiringLots: (maxDays: number) => ['inventory', 'expiring-lots', maxDays] as const,
    reorder: (params: object) => ['inventory', 'reorder', params] as const,
    reorderPlanning: (minOrders: number) => ['inventory', 'reorder-planning', minOrders] as const,
    reorderConfig: ['inventory', 'reorder-config'] as const,
    expiryBuckets: ['inventory', 'expiry-buckets'] as const,
    expiryDiscountTiers: ['inventory', 'expiry-discount-tiers'] as const,
  },
  branches: {
    all: ['branches'] as const,
  },
  herdProjects: {
    all: ['herd-projects'] as const,
    list: (params: object) => ['herd-projects', 'list', params] as const,
    detail: (id: string) => ['herd-projects', 'detail', id] as const,
    types: ['herd-projects', 'types'] as const,
    species: ['herd-projects', 'species'] as const,
    regions: ['herd-projects', 'regions'] as const,
    herds: (params: object) => ['herd-projects', 'herds', params] as const,
    members: (id: string) => ['herd-projects', 'members', id] as const,
    costs: (id: string) => ['herd-projects', 'costs', id] as const,
    upcomingTasks: (days: number) => ['herd-projects', 'upcoming-tasks', days] as const,
    overview: ['herd-projects', 'overview'] as const,
    feedback: (limit: number) => ['herd-projects', 'feedback', limit] as const,
  },
  reports: {
    invSummary: (params: object) => ['reports', 'inv-valuation', 'summary', params] as const,
    invByProduct: (params: object) => ['reports', 'inv-valuation', 'by-product', params] as const,
    invByGroup: (groupBy: string, params: object) => ['reports', 'inv-valuation', 'by-group', groupBy, params] as const,
    // SP chiến lược — prefix chung ['reports','strategic'] để invalidate 1 phát (realtime)
    strategicAll: ['reports', 'strategic'] as const,
    stratSummary: (params: object) => ['reports', 'strategic', 'summary', params] as const,
    stratProducts: (params: object) => ['reports', 'strategic', 'products', params] as const,
    stratSuggestions: (params: object) => ['reports', 'strategic', 'suggestions', params] as const,
    stratAlerts: (params: object) => ['reports', 'strategic', 'alerts', params] as const,
    stratTrend: (params: object) => ['reports', 'strategic', 'trend', params] as const,
    stratToday: (params: object) => ['reports', 'strategic', 'today', params] as const,
    stratTodayOrders: (params: object) => ['reports', 'strategic', 'today-orders', params] as const,
    stratTargets: (params: object) => ['reports', 'strategic', 'targets', params] as const,
    stratConfig: ['reports', 'strategic', 'config'] as const,
  },
  gdrive: {
    sources: ['gdrive', 'sources'] as const,
    files: (sourceId: string) => ['gdrive', 'files', sourceId] as const,
    sheetInfo: (fileId: string) => ['gdrive', 'sheet-info', fileId] as const,
    sheet: (fileId: string, tab: string) => ['gdrive', 'sheet', fileId, tab] as const,
    aliases: (supplierId: string) => ['gdrive', 'aliases', supplierId] as const,
    saEmail: ['gdrive', 'sa-email'] as const,
  },
  vat: {
    config: ['vat', 'config'] as const,
    pending: (from: string, to: string) => ['vat', 'pending', from, to] as const,
    issuances: ['vat', 'issuances'] as const,
    stock: ['vat', 'stock'] as const,
  },
  auth: {
    rolePermissions: (userId: string) => ['auth', 'role-permissions', userId] as const,
  },
  profiles: {
    salesReps: ['profiles', 'sales-reps'] as const,
  },
}
