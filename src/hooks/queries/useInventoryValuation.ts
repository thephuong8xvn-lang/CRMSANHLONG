import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

// ─────────────────────────────────────────────────────────────
// Báo cáo Kho hàng theo Giá vốn — hooks gọi 3 RPC admin-only:
//   fn_inventory_valuation_summary / _by_product / _by_group
// Giá vốn TB = bình quân gia quyền theo lô active còn hàng.
// ─────────────────────────────────────────────────────────────

// Supabase trả NUMERIC/BIGINT dạng string → ép về number
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export interface InvSummary {
  total_qty: number
  total_value: number
  product_count: number
  lot_count: number
  warehouse_count: number
  missing_cost_products: number
  expiring_90d_value: number
  expired_active_lots: number
  non_active_value: number
}

export interface InvProductRow {
  product_id: string
  sku: string
  product_name: string
  unit: string
  brand_name: string
  category_name: string
  total_qty: number
  avg_cost: number
  total_value: number
  lot_count: number
  warehouse_count: number
  nearest_expiry: string | null
  missing_cost: boolean
  sold_30d: number
  sold_90d: number
  turnover_90d: number
  days_of_stock: number | null
  last_sale_at: string | null
  total_count: number
}

export interface InvGroupRow {
  group_id: string | null
  group_name: string
  product_count: number
  lot_count: number
  total_qty: number
  total_value: number
  value_share: number
  missing_cost_products: number
}

export type InvGroupBy = 'brand' | 'category' | 'warehouse'
export type InvProductSort = 'value' | 'qty' | 'avg_cost' | 'turnover' | 'days_of_stock' | 'idle'

export interface InvProductParams {
  search?: string
  warehouseId?: string
  brandId?: string
  categoryId?: string
  sort?: InvProductSort
  limit?: number
  offset?: number
}

export function useInventoryValuationSummary(warehouseId?: string) {
  return useQuery<InvSummary | null>({
    queryKey: qk.reports.invSummary({ warehouseId: warehouseId || null }),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_inventory_valuation_summary', {
        p_warehouse_id: warehouseId || null,
      })
      if (error) { logger.error('[useInventoryValuationSummary]', error.message); throw error }
      const r = data?.[0]
      if (!r) return null
      return {
        total_qty: num(r.total_qty),
        total_value: num(r.total_value),
        product_count: num(r.product_count),
        lot_count: num(r.lot_count),
        warehouse_count: num(r.warehouse_count),
        missing_cost_products: num(r.missing_cost_products),
        expiring_90d_value: num(r.expiring_90d_value),
        expired_active_lots: num(r.expired_active_lots),
        non_active_value: num(r.non_active_value),
      }
    },
    staleTime: 5 * 60_000,
  })
}

export function useInventoryValuationByProduct(params: InvProductParams) {
  return useQuery<InvProductRow[]>({
    queryKey: qk.reports.invByProduct(params as object),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_inventory_valuation_by_product', {
        p_search: params.search || null,
        p_warehouse_id: params.warehouseId || null,
        p_brand_id: params.brandId || null,
        p_category_id: params.categoryId || null,
        p_sort: params.sort ?? 'value',
        p_limit: params.limit ?? 100,
        p_offset: params.offset ?? 0,
      })
      if (error) { logger.error('[useInventoryValuationByProduct]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        product_id: r.product_id as string,
        sku: (r.sku as string) || '',
        product_name: (r.product_name as string) || '—',
        unit: (r.unit as string) || '',
        brand_name: (r.brand_name as string) || '',
        category_name: (r.category_name as string) || '',
        total_qty: num(r.total_qty),
        avg_cost: num(r.avg_cost),
        total_value: num(r.total_value),
        lot_count: num(r.lot_count),
        warehouse_count: num(r.warehouse_count),
        nearest_expiry: (r.nearest_expiry as string) || null,
        missing_cost: !!r.missing_cost,
        sold_30d: num(r.sold_30d),
        sold_90d: num(r.sold_90d),
        turnover_90d: num(r.turnover_90d),
        days_of_stock: r.days_of_stock == null ? null : num(r.days_of_stock),
        last_sale_at: (r.last_sale_at as string) || null,
        total_count: num(r.total_count),
      }))
    },
    placeholderData: keepPreviousData, // giữ trang cũ khi chuyển trang server-side → không nháy
    staleTime: 5 * 60_000,
  })
}

export function useInventoryValuationByGroup(groupBy: InvGroupBy, warehouseId?: string) {
  return useQuery<InvGroupRow[]>({
    queryKey: qk.reports.invByGroup(groupBy, { warehouseId: warehouseId || null }),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_inventory_valuation_by_group', {
        p_group_by: groupBy,
        p_warehouse_id: warehouseId || null,
        p_sort: 'value',
        p_limit: 200,
        p_offset: 0,
      })
      if (error) { logger.error('[useInventoryValuationByGroup]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        group_id: (r.group_id as string) || null,
        group_name: (r.group_name as string) || '—',
        product_count: num(r.product_count),
        lot_count: num(r.lot_count),
        total_qty: num(r.total_qty),
        total_value: num(r.total_value),
        value_share: num(r.value_share),
        missing_cost_products: num(r.missing_cost_products),
      }))
    },
    staleTime: 5 * 60_000,
  })
}
