import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

// ── Mốc hạn dùng dùng chung (trang Hạn sử dụng + widget Dashboard) ──
export interface ExpiryBucket { key: string; label: string; days: number }
export const EXPIRY_BUCKETS: ExpiryBucket[] = [
  { key: 'd10', label: '10 ngày', days: 10 },
  { key: 'm1', label: '1 tháng', days: 30 },
  { key: 'm3', label: '3 tháng', days: 90 },
  { key: 'm6', label: '6 tháng', days: 180 },
  { key: 'y1', label: '1 năm', days: 365 },
]
export type ExpiryColors = Record<string, string>
export const DEFAULT_EXPIRY_COLORS: ExpiryColors = {
  d10: '#dc2626', m1: '#f97316', m3: '#eab308', m6: '#3b82f6', y1: '#10b981',
}

// Mốc gần nhất mà số ngày còn lại rơi vào (để chọn màu hiển thị)
export function bucketForDays(daysLeft: number): ExpiryBucket {
  for (const b of EXPIRY_BUCKETS) {
    if (daysLeft <= b.days) return b
  }
  return EXPIRY_BUCKETS[EXPIRY_BUCKETS.length - 1]
}

// ── Lô hàng sắp hết hạn (≤ maxDays) ──
export interface ExpiringLotItem {
  lot_id: string
  product_id: string
  product_name: string
  sku: string
  unit: string
  warehouse_name: string
  lot_number: string
  qty: number
  expiry_date: string
  daysLeft: number
  value: number
  /** Tốc độ bán trung bình mỗi tuần (toàn hệ, từ product_reorder_view). null = chưa có lịch sử bán. */
  avgWeekly: number | null
  /** Ước số ngày bán hết SL lô này theo tốc độ bán hiện tại. null nếu không bán được. */
  daysToSell: number | null
  /** true = bán không kịp trước khi hết hạn (daysToSell > daysLeft) → rủi ro tồn đọng. */
  sellRisk: boolean
}

export function useExpiringLots(maxDays: number, enabled: boolean = true) {
  return useQuery<ExpiringLotItem[]>({
    queryKey: qk.inventory.expiringLots(maxDays),
    enabled,
    queryFn: async () => {
      const end = new Date()
      end.setDate(end.getDate() + maxDays)
      const endIso = end.toISOString().split('T')[0]
      const todayMs = new Date(new Date().toISOString().split('T')[0]).getTime()
      const { data, error } = await supabase
        .from('stock_lots')
        .select('id, product_id, lot_number, expiry_date, quantity_on_hand, cost_price, product:products(name, sku, unit), warehouse:warehouses(name)')
        .eq('status', 'active')
        .gt('quantity_on_hand', 0)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', endIso)
        .order('expiry_date', { ascending: true })
      if (error) { logger.error('[useExpiringLots]', error.message); throw error }
      const rows = data ?? []

      // Tốc độ bán theo SP (toàn hệ) — để ước "bán hết kịp trước HSD không".
      // Dùng lại product_reorder_view (security_invoker) thay vì tính lại.
      const productIds = [...new Set(rows.map((l: any) => l.product_id))]
      const velocity = new Map<string, number>()
      if (productIds.length > 0) {
        const { data: vData, error: vErr } = await supabase
          .from('product_reorder_view')
          .select('product_id, avg_weekly')
          .in('product_id', productIds)
        if (vErr) logger.error('[useExpiringLots.velocity]', vErr.message)
        else for (const v of vData ?? []) velocity.set(v.product_id, Number(v.avg_weekly) || 0)
      }

      return rows.map((l: any) => {
        const qty = l.quantity_on_hand || 0
        const daysLeft = Math.round((new Date(l.expiry_date).getTime() - todayMs) / 86400000)
        const avgWeekly = velocity.has(l.product_id) ? velocity.get(l.product_id)! : null
        const dailyRate = avgWeekly != null && avgWeekly > 0 ? avgWeekly / 7 : 0
        const daysToSell = dailyRate > 0 ? Math.ceil(qty / dailyRate) : null
        return {
          lot_id: l.id,
          product_id: l.product_id,
          product_name: l.product?.name || '—',
          sku: l.product?.sku || '',
          unit: l.product?.unit || '',
          warehouse_name: l.warehouse?.name || '—',
          lot_number: l.lot_number,
          qty,
          expiry_date: l.expiry_date,
          daysLeft,
          value: qty * (Number(l.cost_price) || 0),
          avgWeekly,
          daysToSell,
          sellRisk: daysToSell != null && daysToSell > daysLeft,
        }
      })
    },
    staleTime: 5 * 60_000,
  })
}

// ── Gợi ý đặt hàng theo tần suất bán ──
export interface ReorderRow {
  product_id: string
  sku: string
  name: string
  unit: string
  min_stock_level: number
  stock_on_hand: number
  sold_30d: number
  sold_90d: number
  orders_90d: number
  avg_weekly: number
  days_cover: number | null
  /** Độ lệch chuẩn nhu cầu theo tuần (12 tuần, gồm tuần bán = 0). 0 = cầu ổn định/chưa đủ dữ liệu. */
  weekly_stddev: number
  /** Số tuần CÓ bán trong 12 tuần (đánh giá mức rời rạc của cầu). */
  weeks_observed: number
  /** Gợi ý đặt theo coverDays cũ (heuristic — giữ cho widget Dashboard tương thích). */
  suggestedQty: number
}

export interface ReorderParams { coverDays?: number; minOrders?: number }

export function useReorderSuggestions(params: ReorderParams = {}, enabled: boolean = true) {
  const coverDays = params.coverDays ?? 30
  const minOrders = params.minOrders ?? 3
  return useQuery<ReorderRow[]>({
    queryKey: qk.inventory.reorder({ coverDays, minOrders }),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_reorder_view')
        .select('*')
        .gt('avg_weekly', 0)
        .gte('orders_90d', minOrders)
        .not('days_cover', 'is', null)
        .order('days_cover', { ascending: true })
        .limit(200)
      if (error) { logger.error('[useReorderSuggestions]', error.message); throw error }
      return (data ?? []).map((r: any) => {
        const avgWeekly = Number(r.avg_weekly) || 0
        const soh = Number(r.stock_on_hand) || 0
        const need = Math.ceil((avgWeekly / 7) * coverDays) - soh
        return {
          product_id: r.product_id,
          sku: r.sku,
          name: r.name,
          unit: r.unit,
          min_stock_level: Number(r.min_stock_level) || 0,
          stock_on_hand: soh,
          sold_30d: Number(r.sold_30d) || 0,
          sold_90d: Number(r.sold_90d) || 0,
          orders_90d: Number(r.orders_90d) || 0,
          avg_weekly: avgWeekly,
          days_cover: r.days_cover != null ? Number(r.days_cover) : null,
          weekly_stddev: Number(r.weekly_stddev) || 0,
          weeks_observed: Number(r.weeks_observed) || 0,
          suggestedQty: Math.max(0, need),
        }
      })
    },
    staleTime: 5 * 60_000,
  })
}

// ── Dữ liệu gợi ý đặt hàng chuẩn hóa (RPC SECURITY DEFINER — nhanh, demand toàn công ty) ──
// Tách khỏi product_reorder_view (view nhẹ, dùng cho Dashboard/Expiry) để tránh
// timeout do tính σ dưới RLS. RPC bỏ chi phí RLS + guard active & inventory.view.
export function useReorderPlanning(minOrders: number = 3, enabled: boolean = true) {
  return useQuery<ReorderRow[]>({
    queryKey: qk.inventory.reorderPlanning(minOrders),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_reorder_planning', { p_min_orders: minOrders })
      if (error) { logger.error('[useReorderPlanning]', error.message); throw error }
      return (data ?? []).map((r: any) => ({
        product_id: r.product_id,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        min_stock_level: Number(r.min_stock_level) || 0,
        stock_on_hand: Number(r.stock_on_hand) || 0,
        sold_30d: Number(r.sold_30d) || 0,
        sold_90d: Number(r.sold_90d) || 0,
        orders_90d: Number(r.orders_90d) || 0,
        avg_weekly: Number(r.avg_weekly) || 0,
        days_cover: r.days_cover != null ? Number(r.days_cover) : null,
        weekly_stddev: Number(r.weekly_stddev) || 0,
        weeks_observed: Number(r.weeks_observed) || 0,
        suggestedQty: 0, // page tính lại qua computeReorderPlan
      }))
    },
    staleTime: 5 * 60_000,
  })
}

// ── Reorder chuẩn hóa: Safety Stock + Reorder Point (tính client-side, live) ──

/** Mức phục vụ → hệ số an toàn Z (phân phối chuẩn 1 phía). */
export const SERVICE_LEVEL_Z: Record<string, number> = {
  '0.90': 1.28, '0.95': 1.65, '0.99': 2.33,
}
export function zForServiceLevel(level: number): number {
  return SERVICE_LEVEL_Z[level.toFixed(2)] ?? 1.65
}

export interface ReorderConfig {
  lead_time_days: number
  service_level: number   // 0.90 / 0.95 / 0.99
  cover_days: number
  min_orders: number
}
export const DEFAULT_REORDER_CONFIG: ReorderConfig = {
  lead_time_days: 7, service_level: 0.95, cover_days: 30, min_orders: 3,
}

export interface ReorderPlan {
  /** Nhu cầu trung bình mỗi ngày. */
  dailyDemand: number
  /** Tồn an toàn = Z × σ_tuần × √(L/7). */
  safetyStock: number
  /** Điểm đặt lại = D × L + tồn an toàn. */
  reorderPoint: number
  /** Gợi ý đặt = ceil(D × cover + SS − tồn), min 0. */
  suggestedQty: number
  /** Tồn ≤ ROP → cần đặt ngay. */
  needsReorder: boolean
}

/** Tính kế hoạch đặt hàng chuẩn cho 1 dòng theo config (lead time / Z / cover). */
export function computeReorderPlan(
  row: Pick<ReorderRow, 'avg_weekly' | 'weekly_stddev' | 'stock_on_hand'>,
  cfg: { leadTimeDays: number; z: number; coverDays: number },
): ReorderPlan {
  const dailyDemand = (Number(row.avg_weekly) || 0) / 7
  const sigmaWeekly = Number(row.weekly_stddev) || 0
  const soh = Number(row.stock_on_hand) || 0
  // Quy σ tuần sang σ trong khoảng lead time: σ_L = σ_tuần × √(L/7).
  const safetyStock = cfg.z * sigmaWeekly * Math.sqrt(Math.max(0, cfg.leadTimeDays) / 7)
  const reorderPoint = dailyDemand * cfg.leadTimeDays + safetyStock
  const target = dailyDemand * cfg.coverDays + safetyStock
  return {
    dailyDemand,
    safetyStock: Math.round(safetyStock * 100) / 100,
    reorderPoint: Math.round(reorderPoint * 100) / 100,
    suggestedQty: Math.max(0, Math.ceil(target - soh)),
    needsReorder: soh <= reorderPoint,
  }
}

export function useReorderConfig() {
  return useQuery<ReorderConfig>({
    queryKey: qk.inventory.reorderConfig,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'reorder_config')
        .maybeSingle()
      if (error) { logger.error('[useReorderConfig]', error.message); return DEFAULT_REORDER_CONFIG }
      return { ...DEFAULT_REORDER_CONFIG, ...((data?.value as Partial<ReorderConfig>) || {}) }
    },
    staleTime: 10 * 60_000,
  })
}

export function useSaveReorderConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (cfg: ReorderConfig) => {
      const { error } = await supabase
        .from('system_settings')
        .upsert({ key: 'reorder_config', value: cfg }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.inventory.reorderConfig }),
  })
}

// ── Cấu hình màu mốc hạn (system_settings) ──
export function useExpiryBuckets() {
  return useQuery<ExpiryColors>({
    queryKey: qk.inventory.expiryBuckets,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'expiry_buckets')
        .maybeSingle()
      if (error) { logger.error('[useExpiryBuckets]', error.message); return DEFAULT_EXPIRY_COLORS }
      return { ...DEFAULT_EXPIRY_COLORS, ...((data?.value as ExpiryColors) || {}) }
    },
    staleTime: 10 * 60_000,
  })
}

export function useSaveExpiryBuckets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (colors: ExpiryColors) => {
      const { error } = await supabase
        .from('system_settings')
        .upsert({ key: 'expiry_buckets', value: colors }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.inventory.expiryBuckets }),
  })
}

// ── % giảm giá GỢI Ý theo mốc hạn (đẩy hàng cận date qua KM sản phẩm) ──
export type ExpiryDiscountTiers = Record<string, number>
export const DEFAULT_EXPIRY_DISCOUNT_TIERS: ExpiryDiscountTiers = {
  d10: 30, m1: 15, m3: 5, m6: 0, y1: 0,
}

export function useExpiryDiscountTiers() {
  return useQuery<ExpiryDiscountTiers>({
    queryKey: qk.inventory.expiryDiscountTiers,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'expiry_discount_tiers')
        .maybeSingle()
      if (error) { logger.error('[useExpiryDiscountTiers]', error.message); return DEFAULT_EXPIRY_DISCOUNT_TIERS }
      return { ...DEFAULT_EXPIRY_DISCOUNT_TIERS, ...((data?.value as ExpiryDiscountTiers) || {}) }
    },
    staleTime: 10 * 60_000,
  })
}

export function useSaveExpiryDiscountTiers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tiers: ExpiryDiscountTiers) => {
      const { error } = await supabase
        .from('system_settings')
        .upsert({ key: 'expiry_discount_tiers', value: tiers }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.inventory.expiryDiscountTiers }),
  })
}

/** % giảm gợi ý cho 1 lô theo số ngày còn lại (rơi vào mốc nào lấy % mốc đó). */
export function suggestedDiscountForDays(daysLeft: number, tiers: ExpiryDiscountTiers): number {
  return tiers[bucketForDays(daysLeft).key] ?? 0
}
