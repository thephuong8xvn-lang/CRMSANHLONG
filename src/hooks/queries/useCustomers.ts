import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

export interface CustomerSummaryRow {
  id: string
  code: string | null
  customer_type: string
  farm_name: string
  value_tier: string
  province: string | null
  district: string | null
  address: string | null
  credit_limit: number
  owner_user_id: string
  is_active: boolean
  created_at: string
  total_debt: number
  is_overdue: boolean
  last_order_at: string | null
  orders_count: number
  primary_contact: {
    full_name: string | null
    phone: string | null
    role_at_farm: string | null
  } | null
}

export interface CustomerListParams {
  page: number          // 1-based
  pageSize: number
  search?: string       // farm_name / code (server-side via ilike)
  customerType?: string
  valueTier?: string
  ownerId?: string
  overdueOnly?: boolean
}

export interface CustomerListResult {
  rows: CustomerSummaryRow[]
  total: number
}

// ─────────────────────────────────────────────────────────────
// useCustomersList – server-side paginate/filter/search.
//   • Dùng customer_summary_view (migration 20260526000000).
//   • Search ilike trên farm_name OR code (đã có gin_trgm index).
//   • Filter is_overdue / customer_type / value_tier / owner_user_id.
// ─────────────────────────────────────────────────────────────
export function useCustomersList(params: CustomerListParams) {
  return useQuery({
    queryKey: qk.customers.list(params),
    queryFn: async (): Promise<CustomerListResult> => {
      const from = (params.page - 1) * params.pageSize
      const to = from + params.pageSize - 1

      let q = supabase
        .from('customer_summary_view')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (params.customerType)  q = q.eq('customer_type', params.customerType)
      if (params.valueTier)     q = q.eq('value_tier', params.valueTier)
      if (params.ownerId)       q = q.eq('owner_user_id', params.ownerId)
      if (params.overdueOnly)   q = q.eq('is_overdue', true)

      if (params.search && params.search.trim()) {
        const term = params.search.trim().replace(/[%_]/g, '\\$&')
        q = q.or(`farm_name.ilike.%${term}%,code.ilike.%${term}%`)
      }

      const { data, error, count } = await q

      if (error) {
        logger.error('[useCustomersList] view query error:', error.message)
        throw error
      }

      return {
        rows: (data ?? []) as CustomerSummaryRow[],
        total: count ?? 0,
      }
    },
    placeholderData: keepPreviousData,
  })
}

// ───────────────────────── Quick View (inline) ─────────────────────────
// Lịch sử giao dịch + công nợ của 1 khách hàng. Chỉ chạy khi panel xem
// nhanh được mở (enabled). RLS (orders/customer_debts theo branch/owner)
// tự lọc theo quyền user hiện tại.

export interface CustomerOrderRow {
  id: string
  order_code: string
  created_at: string
  grand_total: number
  status: string
  payment_status: string
}

export interface CustomerDebtRow {
  id: string
  amount: number
  due_date: string | null
  is_settled: boolean
  created_at: string
  debt_type: string | null
  order_id: string | null
}

/** 20 đơn hàng gần nhất của khách hàng. */
export function useCustomerOrders(customerId: string, enabled = true) {
  return useQuery({
    queryKey: qk.customers.orders(customerId),
    enabled: enabled && !!customerId,
    queryFn: async (): Promise<CustomerOrderRow[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_code, created_at, grand_total, status, payment_status')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) {
        logger.error('[useCustomerOrders] error:', error.message)
        throw error
      }
      return (data ?? []) as CustomerOrderRow[]
    },
  })
}

/** Các khoản công nợ của khách hàng (mới nhất trước). */
export function useCustomerDebts(customerId: string, enabled = true) {
  return useQuery({
    queryKey: qk.customers.debts(customerId),
    enabled: enabled && !!customerId,
    queryFn: async (): Promise<CustomerDebtRow[]> => {
      const { data, error } = await supabase
        .from('customer_debts')
        .select('id, amount, due_date, is_settled, created_at, debt_type, order_id')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
      if (error) {
        logger.error('[useCustomerDebts] error:', error.message)
        throw error
      }
      return (data ?? []) as CustomerDebtRow[]
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Sales reps + classifications + tiers – static-ish lookup data,
// cache lâu vì admin ít khi đổi.
// ─────────────────────────────────────────────────────────────
export interface SalesRep {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface CodeNameRow {
  code: string
  name: string
  is_active: boolean
}

export function useSalesReps() {
  return useQuery<SalesRep[]>({
    queryKey: qk.profiles.salesReps,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('is_active', true)
      if (error) throw error
      return (data ?? []) as SalesRep[]
    },
    staleTime: 10 * 60_000,
  })
}

export function useCustomerClassifications() {
  return useQuery<CodeNameRow[]>({
    queryKey: qk.customers.classifications,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_classifications')
        .select('code, name, is_active')
      if (error) throw error
      return (data ?? []) as CodeNameRow[]
    },
    staleTime: 10 * 60_000,
  })
}

export function useCustomerTiers() {
  return useQuery<CodeNameRow[]>({
    queryKey: qk.customers.tiers,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_tiers')
        .select('code, name, is_active')
      if (error) throw error
      return (data ?? []) as CodeNameRow[]
    },
    staleTime: 10 * 60_000,
  })
}

// 3 count nhỏ song song cho KPI footer (tổng KH / nợ quá hạn / VIP).
// Tách khỏi list query để KPI không bị reset khi user đổi filter/trang.
export function useCustomerKPIs() {
  return useQuery({
    queryKey: ['customers', 'kpis'],
    queryFn: async () => {
      const [total, overdue, vip] = await Promise.all([
        supabase.from('customers').select('id', { count: 'exact', head: true }),
        supabase.from('customer_summary_view').select('id', { count: 'exact', head: true }).eq('is_overdue', true),
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('value_tier', 'vip'),
      ])
      return {
        total:   total.count   ?? 0,
        overdue: overdue.count ?? 0,
        vip:     vip.count     ?? 0,
      }
    },
    staleTime: 60_000,
  })
}
