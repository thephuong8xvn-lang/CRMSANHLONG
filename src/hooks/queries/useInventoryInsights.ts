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
      return (data ?? []).map((l: any) => ({
        lot_id: l.id,
        product_id: l.product_id,
        product_name: l.product?.name || '—',
        sku: l.product?.sku || '',
        unit: l.product?.unit || '',
        warehouse_name: l.warehouse?.name || '—',
        lot_number: l.lot_number,
        qty: l.quantity_on_hand,
        expiry_date: l.expiry_date,
        daysLeft: Math.round((new Date(l.expiry_date).getTime() - todayMs) / 86400000),
        value: (l.quantity_on_hand || 0) * (Number(l.cost_price) || 0),
      }))
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
          suggestedQty: Math.max(0, need),
        }
      })
    },
    staleTime: 5 * 60_000,
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
