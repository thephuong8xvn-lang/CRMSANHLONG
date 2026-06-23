import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

// ── Pivot đa chiều + so sánh kỳ ──
export type BiDimension =
  | 'month' | 'quarter' | 'year'
  | 'product' | 'brand' | 'category' | 'customer' | 'branch' | 'salesperson'
export type BiCompare = 'none' | 'mom' | 'yoy'

export interface BiPivotFilters {
  branch_id?: string | null
  customer_id?: string | null
  product_id?: string | null
  brand_id?: string | null
  category_id?: string | null
  owner_id?: string | null
}

export interface BiPivotRow {
  dim_key: string
  dim_label: string
  revenue: number
  cogs: number
  profit: number
  margin: number
  qty: number
  order_count: number
  customer_count: number
  prev_revenue: number
  prev_profit: number
  prev_qty: number
}

export interface BiPivotParams {
  from: string
  to: string
  dim: BiDimension
  compare: BiCompare
  filters?: BiPivotFilters
}

export function useBiPivot(params: BiPivotParams, enabled: boolean = true) {
  const f = params.filters ?? {}
  return useQuery<BiPivotRow[]>({
    queryKey: qk.bi.pivot(params),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_bi_pivot', {
        p_from: params.from,
        p_to: params.to,
        p_dim: params.dim,
        p_compare: params.compare,
        p_branch_id: f.branch_id ?? null,
        p_customer_id: f.customer_id ?? null,
        p_product_id: f.product_id ?? null,
        p_brand_id: f.brand_id ?? null,
        p_category_id: f.category_id ?? null,
        p_owner_id: f.owner_id ?? null,
      })
      if (error) { logger.error('[useBiPivot]', error.message); throw error }
      return (data ?? []).map((r: any) => ({
        dim_key: r.dim_key,
        dim_label: r.dim_label ?? '—',
        revenue: Number(r.revenue) || 0,
        cogs: Number(r.cogs) || 0,
        profit: Number(r.profit) || 0,
        margin: Number(r.margin) || 0,
        qty: Number(r.qty) || 0,
        order_count: Number(r.order_count) || 0,
        customer_count: Number(r.customer_count) || 0,
        prev_revenue: Number(r.prev_revenue) || 0,
        prev_profit: Number(r.prev_profit) || 0,
        prev_qty: Number(r.prev_qty) || 0,
      }))
    },
    staleTime: 60_000,
  })
}

// ── ABC / XYZ ──
export interface BiAbcRow {
  product_id: string
  sku: string
  name: string
  revenue: number
  qty: number
  rev_share: number
  cum_share: number
  abc_class: 'A' | 'B' | 'C'
  cv: number | null
  xyz_class: 'X' | 'Y' | 'Z'
}

export function useBiAbcXyz(from: string, to: string, enabled: boolean = true) {
  return useQuery<BiAbcRow[]>({
    queryKey: qk.bi.abcXyz(from, to),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_bi_abc_xyz', { p_from: from, p_to: to })
      if (error) { logger.error('[useBiAbcXyz]', error.message); throw error }
      return (data ?? []).map((r: any) => ({
        product_id: r.product_id,
        sku: r.sku,
        name: r.name,
        revenue: Number(r.revenue) || 0,
        qty: Number(r.qty) || 0,
        rev_share: Number(r.rev_share) || 0,
        cum_share: Number(r.cum_share) || 0,
        abc_class: r.abc_class,
        cv: r.cv != null ? Number(r.cv) : null,
        xyz_class: r.xyz_class,
      }))
    },
    staleTime: 60_000,
  })
}

// ── Cohort retention ──
export interface BiCohortRow {
  cohort_month: string
  cohort_size: number
  month_offset: number
  active: number
  retention_pct: number
}

export function useBiCohort(months: number, enabled: boolean = true) {
  return useQuery<BiCohortRow[]>({
    queryKey: qk.bi.cohort(months),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_bi_cohort', { p_months: months })
      if (error) { logger.error('[useBiCohort]', error.message); throw error }
      return (data ?? []).map((r: any) => ({
        cohort_month: r.cohort_month,
        cohort_size: Number(r.cohort_size) || 0,
        month_offset: Number(r.month_offset) || 0,
        active: Number(r.active) || 0,
        retention_pct: Number(r.retention_pct) || 0,
      }))
    },
    staleTime: 60_000,
  })
}

// Chiều nào là thực thể (cho phép drill-down qua chip lọc).
export const ENTITY_DIM_TO_FILTER: Partial<Record<BiDimension, keyof BiPivotFilters>> = {
  product: 'product_id',
  brand: 'brand_id',
  category: 'category_id',
  customer: 'customer_id',
  branch: 'branch_id',
  salesperson: 'owner_id',
}
