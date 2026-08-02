import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

// ─────────────────────────────────────────────────────────────
// Báo cáo Kho hàng theo Giá vốn — hooks gọi 3 RPC admin-only:
//   fn_inventory_valuation_summary / _by_product / _by_group
// Giá vốn TB = bình quân gia quyền theo lô active còn hàng.
//
// Dòng vốn (migration 20260746): mọi con số bán là CẦU RÒNG
// (bán − hàng khách trả). Với cửa sổ N ngày tự chọn (mặc định 20):
//   excess_qty       = max(0, tồn − bán ròng N ngày)   → VỐN THỪA
//   days_to_stockout = tồn × N / bán ròng N ngày       → NGÀY HẾT HÀNG
// ─────────────────────────────────────────────────────────────

/** Cửa sổ mặc định cho mọi chỉ số dòng vốn (ngày). */
export const DEFAULT_WINDOW_DAYS = 20

// Supabase trả NUMERIC/BIGINT dạng string → ép về number
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v))

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
  // ── Dòng "Tổng cộng" trên đầu bảng ──
  /** Tập đang lọc chỉ gồm 1 ĐVT? Nếu false → KHÔNG được cộng cột số lượng. */
  unit_uniform: boolean
  unit_label: string | null
  avg_cost_weighted: number
  nearest_expiry: string | null
  // ── Dòng vốn ──
  sold_window: number
  excess_qty: number
  excess_value: number
  dead_value: number
  dead_products: number
  stockout_soon_products: number
  stockout_soon_value: number
  window_days: number
  /** Số ngày lịch sử xuất bán THỰC CÓ (hệ thống chạy từ 2026-05-28). Chọn N lớn
   *  hơn con số này thì "vốn thừa" bị thổi lên vì mẫu số N ngày nhưng tử số chỉ
   *  có chừng này ngày dữ liệu. */
  history_days: number
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
  /** RÒNG — đã trừ hàng khách trả. */
  sold_30d: number
  /** RÒNG — đã trừ hàng khách trả. */
  sold_90d: number
  turnover_90d: number
  days_of_stock: number | null
  last_sale_at: string | null
  total_count: number
  // ── Dòng vốn theo cửa sổ N ngày ──
  sold_window: number
  daily_demand: number
  days_to_stockout: number | null
  stockout_date: string | null
  excess_qty: number
  excess_value: number
  window_days: number
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
  sold_window: number
  excess_value: number
  dead_value: number
  unit_uniform: boolean
  window_days: number
}

export type InvGroupBy = 'brand' | 'category' | 'warehouse' | 'branch'
export type InvProductSort =
  | 'value' | 'qty' | 'avg_cost' | 'turnover' | 'days_of_stock' | 'idle'
  | 'excess'    // vốn thừa giảm dần
  | 'stockout'  // sắp hết hàng tăng dần

export interface InvFilterParams {
  search?: string
  warehouseId?: string
  brandId?: string
  categoryId?: string
  windowDays?: number
}

export interface InvProductParams extends InvFilterParams {
  sort?: InvProductSort
  limit?: number
  offset?: number
}

export function useInventoryValuationSummary(params: InvFilterParams) {
  const key = {
    search: params.search || null,
    warehouseId: params.warehouseId || null,
    brandId: params.brandId || null,
    categoryId: params.categoryId || null,
    windowDays: params.windowDays ?? DEFAULT_WINDOW_DAYS,
  }
  return useQuery<InvSummary | null>({
    queryKey: qk.reports.invSummary(key),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_inventory_valuation_summary', {
        p_search: params.search || null,
        p_warehouse_id: params.warehouseId || null,
        p_brand_id: params.brandId || null,
        p_category_id: params.categoryId || null,
        p_window_days: params.windowDays ?? DEFAULT_WINDOW_DAYS,
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
        unit_uniform: !!r.unit_uniform,
        unit_label: (r.unit_label as string) || null,
        avg_cost_weighted: num(r.avg_cost_weighted),
        nearest_expiry: (r.nearest_expiry as string) || null,
        sold_window: num(r.sold_window),
        excess_qty: num(r.excess_qty),
        excess_value: num(r.excess_value),
        dead_value: num(r.dead_value),
        dead_products: num(r.dead_products),
        stockout_soon_products: num(r.stockout_soon_products),
        stockout_soon_value: num(r.stockout_soon_value),
        window_days: num(r.window_days) || DEFAULT_WINDOW_DAYS,
        history_days: num(r.history_days),
      }
    },
    placeholderData: keepPreviousData, // đổi N ngày không làm KPI nháy về "…"
    staleTime: 5 * 60_000,
  })
}

/** Map 1 dòng RPC → InvProductRow (dùng chung cho hook và lúc xuất CSV). */
function mapProductRow(r: Record<string, unknown>): InvProductRow {
  return {
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
    days_of_stock: numOrNull(r.days_of_stock),
    last_sale_at: (r.last_sale_at as string) || null,
    total_count: num(r.total_count),
    sold_window: num(r.sold_window),
    daily_demand: num(r.daily_demand),
    days_to_stockout: numOrNull(r.days_to_stockout),
    stockout_date: (r.stockout_date as string) || null,
    excess_qty: num(r.excess_qty),
    excess_value: num(r.excess_value),
    window_days: num(r.window_days) || DEFAULT_WINDOW_DAYS,
  }
}

async function fetchProductRows(params: InvProductParams): Promise<InvProductRow[]> {
  const { data, error } = await supabase.rpc('fn_inventory_valuation_by_product', {
    p_search: params.search || null,
    p_warehouse_id: params.warehouseId || null,
    p_brand_id: params.brandId || null,
    p_category_id: params.categoryId || null,
    p_sort: params.sort ?? 'value',
    p_limit: params.limit ?? 100,
    p_offset: params.offset ?? 0,
    p_window_days: params.windowDays ?? DEFAULT_WINDOW_DAYS,
  })
  if (error) { logger.error('[fetchProductRows]', error.message); throw error }
  return (data ?? []).map(mapProductRow)
}

export function useInventoryValuationByProduct(params: InvProductParams, enabled = true) {
  return useQuery<InvProductRow[]>({
    queryKey: qk.reports.invByProduct(params as object),
    enabled,
    queryFn: () => fetchProductRows(params),
    placeholderData: keepPreviousData, // giữ trang cũ khi chuyển trang server-side → không nháy
    staleTime: 5 * 60_000,
  })
}

/**
 * Nạp TOÀN BỘ tập đang lọc (cho xuất CSV) — trước đây CSV chỉ ra 50 dòng của
 * trang đang xem, người dùng tưởng đã xuất hết để lập kế hoạch tiền.
 */
export async function fetchAllProductRows(params: InvProductParams): Promise<InvProductRow[]> {
  const PAGE = 500
  const out: InvProductRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const batch = await fetchProductRows({ ...params, limit: PAGE, offset })
    out.push(...batch)
    if (batch.length < PAGE) break
    if (out.length >= (batch[0]?.total_count ?? 0)) break
    if (offset > 20_000) break // chặn vòng lặp vô hạn nếu RPC đổi hành vi
  }
  return out
}

export function useInventoryValuationByGroup(
  groupBy: InvGroupBy,
  params: InvFilterParams,
  enabled = true,
) {
  const key = {
    warehouseId: params.warehouseId || null,
    windowDays: params.windowDays ?? DEFAULT_WINDOW_DAYS,
  }
  return useQuery<InvGroupRow[]>({
    queryKey: qk.reports.invByGroup(groupBy, key),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_inventory_valuation_by_group', {
        p_group_by: groupBy,
        p_warehouse_id: params.warehouseId || null,
        p_sort: 'value',
        p_limit: 200,
        p_offset: 0,
        p_window_days: params.windowDays ?? DEFAULT_WINDOW_DAYS,
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
        sold_window: num(r.sold_window),
        excess_value: num(r.excess_value),
        dead_value: num(r.dead_value),
        unit_uniform: !!r.unit_uniform,
        window_days: num(r.window_days) || DEFAULT_WINDOW_DAYS,
      }))
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}
