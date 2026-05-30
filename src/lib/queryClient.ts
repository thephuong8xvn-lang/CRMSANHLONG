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
  },
  products: {
    all: ['products'] as const,
    list: (params: object) => ['products', 'list', params] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
    categories: ['products', 'categories'] as const,
    brands: ['products', 'brands'] as const,
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
  },
  branches: {
    all: ['branches'] as const,
  },
  auth: {
    rolePermissions: (userId: string) => ['auth', 'role-permissions', userId] as const,
  },
  profiles: {
    salesReps: ['profiles', 'sales-reps'] as const,
  },
}
