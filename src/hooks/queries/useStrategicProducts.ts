import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

// ─────────────────────────────────────────────────────────────
// SP chiến lược & Tối ưu lợi nhuận — hooks gọi 7 RPC admin-only:
//   fn_strategic_summary / _products / _suggestions / _alerts
//   / _trend / _today / _today_orders
// + CRUD trực tiếp (RLS admin): product_strategy, branch_month_targets,
//   system_settings('strategic_config').
// Mọi tỉ lệ (markup/margin/share) là PHÂN SỐ (0.5 = 50%) — FE nhân 100.
// ─────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v))

export type StrategyClass = 'strategic' | 'baseline'

export interface StratSummaryRow {
  branch_id: string | null
  branch_name: string
  revenue_total: number
  revenue_strategic: number
  revenue_baseline: number
  revenue_other: number
  strategic_share: number | null
  profit_strategic: number
  profit_baseline: number
  profit_other: number
  cross_subsidy: number
  strategic_violation_count: number
  baseline_deep_loss_count: number
  revenue_target: number | null
  strategic_share_target: number
  month_elapsed_ratio: number
  gmroi_strategic: number | null
  gmroi_baseline: number | null
}

export interface StratProductRow {
  product_id: string
  sku: string
  product_name: string
  unit: string
  brand_name: string
  class: string
  note: string | null
  qty: number
  revenue: number
  cogs: number
  profit: number
  markup_actual: number | null
  margin: number | null
  order_count: number
  sold_30d: number
  stock_on_hand: number
  stock_value: number
  days_to_oos: number | null
  gmroi: number | null
  is_violation: boolean
  missing_cost: boolean
  total_count: number
}

export interface StratSuggestionRow {
  product_id: string
  sku: string
  product_name: string
  unit: string
  suggested_class: StrategyClass
  revenue_90d: number
  qty_90d: number
  profit_90d: number
  markup_90d: number | null
  order_count_90d: number
  total_count: number
}

export interface StratAlertRow {
  alert_type: string
  severity: 'warning' | 'critical'
  branch_id: string | null
  branch_name: string
  metric: number | null
  threshold: number | null
  item_count: number | null
}

export interface StratTrendRow {
  ym: string
  revenue_total: number
  revenue_strategic: number
  revenue_baseline: number
  strategic_share: number | null
  profit_strategic: number
  profit_baseline: number
  cross_subsidy: number
}

export interface StratTodayRow {
  branch_id: string | null
  branch_name: string
  revenue_total: number
  revenue_strategic: number
  revenue_baseline: number
  revenue_other: number
  strategic_share: number | null
  profit_strategic: number
  profit_baseline: number
  order_count: number
  last_order_at: string | null
}

export interface StratTodayOrderRow {
  order_id: string
  order_code: string
  created_at: string
  branch_name: string
  customer_name: string
  grand_total: number
  revenue_strategic: number
  revenue_baseline: number
  status: string
}

export interface BranchMonthTarget {
  id: string
  branch_id: string
  year: number
  month: number
  revenue_target: number
  strategic_share_target: number
  note: string | null
}

export interface StrategicConfig {
  markup_min: number
  baseline_loss_floor: number
  suggest_min_revenue_90d: number
  suggest_min_qty_90d: number
  oos_warn_days: number
}

export const DEFAULT_STRATEGIC_CONFIG: StrategicConfig = {
  markup_min: 0.5,
  baseline_loss_floor: -0.05,
  suggest_min_revenue_90d: 5_000_000,
  suggest_min_qty_90d: 30,
  oos_warn_days: 7,
}

export type StratProductSort =
  | 'revenue' | 'profit' | 'markup' | 'qty' | 'sold_30d' | 'days_to_oos' | 'gmroi'

export interface StratPeriod {
  year: number
  month: number
  branchId?: string | null
}

// ── Queries ──────────────────────────────────────────────────

export function useStrategicSummary({ year, month, branchId }: StratPeriod) {
  return useQuery<StratSummaryRow[]>({
    queryKey: qk.reports.stratSummary({ year, month, branchId: branchId || null }),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_strategic_summary', {
        p_year: year, p_month: month, p_branch_id: branchId || null,
      })
      if (error) { logger.error('[useStrategicSummary]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        branch_id: (r.branch_id as string) || null,
        branch_name: (r.branch_name as string) || '—',
        revenue_total: num(r.revenue_total),
        revenue_strategic: num(r.revenue_strategic),
        revenue_baseline: num(r.revenue_baseline),
        revenue_other: num(r.revenue_other),
        strategic_share: numOrNull(r.strategic_share),
        profit_strategic: num(r.profit_strategic),
        profit_baseline: num(r.profit_baseline),
        profit_other: num(r.profit_other),
        cross_subsidy: num(r.cross_subsidy),
        strategic_violation_count: num(r.strategic_violation_count),
        baseline_deep_loss_count: num(r.baseline_deep_loss_count),
        revenue_target: numOrNull(r.revenue_target),
        strategic_share_target: num(r.strategic_share_target),
        month_elapsed_ratio: num(r.month_elapsed_ratio),
        gmroi_strategic: numOrNull(r.gmroi_strategic),
        gmroi_baseline: numOrNull(r.gmroi_baseline),
      }))
    },
    staleTime: 5 * 60_000,
  })
}

export interface StratProductParams extends StratPeriod {
  cls: StrategyClass | 'other'
  search?: string
  sort?: StratProductSort
  limit?: number
  offset?: number
}

export function useStrategicProductList(params: StratProductParams) {
  return useQuery<StratProductRow[]>({
    queryKey: qk.reports.stratProducts(params as object),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_strategic_products', {
        p_year: params.year,
        p_month: params.month,
        p_branch_id: params.branchId || null,
        p_class: params.cls,
        p_search: params.search || null,
        p_sort: params.sort ?? 'revenue',
        p_limit: params.limit ?? 50,
        p_offset: params.offset ?? 0,
      })
      if (error) { logger.error('[useStrategicProductList]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        product_id: r.product_id as string,
        sku: (r.sku as string) || '',
        product_name: (r.product_name as string) || '—',
        unit: (r.unit as string) || '',
        brand_name: (r.brand_name as string) || '',
        class: (r.class as string) || 'other',
        note: (r.note as string) || null,
        qty: num(r.qty),
        revenue: num(r.revenue),
        cogs: num(r.cogs),
        profit: num(r.profit),
        markup_actual: numOrNull(r.markup_actual),
        margin: numOrNull(r.margin),
        order_count: num(r.order_count),
        sold_30d: num(r.sold_30d),
        stock_on_hand: num(r.stock_on_hand),
        stock_value: num(r.stock_value),
        days_to_oos: numOrNull(r.days_to_oos),
        gmroi: numOrNull(r.gmroi),
        is_violation: !!r.is_violation,
        missing_cost: !!r.missing_cost,
        total_count: num(r.total_count),
      }))
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

export function useStrategicSuggestions(params: { branchId?: string | null; limit?: number; offset?: number }) {
  return useQuery<StratSuggestionRow[]>({
    queryKey: qk.reports.stratSuggestions(params as object),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_strategic_suggestions', {
        p_branch_id: params.branchId || null,
        p_limit: params.limit ?? 50,
        p_offset: params.offset ?? 0,
      })
      if (error) { logger.error('[useStrategicSuggestions]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        product_id: r.product_id as string,
        sku: (r.sku as string) || '',
        product_name: (r.product_name as string) || '—',
        unit: (r.unit as string) || '',
        suggested_class: r.suggested_class as StrategyClass,
        revenue_90d: num(r.revenue_90d),
        qty_90d: num(r.qty_90d),
        profit_90d: num(r.profit_90d),
        markup_90d: numOrNull(r.markup_90d),
        order_count_90d: num(r.order_count_90d),
        total_count: num(r.total_count),
      }))
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

export function useStrategicAlerts({ year, month, branchId }: StratPeriod) {
  return useQuery<StratAlertRow[]>({
    queryKey: qk.reports.stratAlerts({ year, month, branchId: branchId || null }),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_strategic_alerts', {
        p_year: year, p_month: month, p_branch_id: branchId || null,
      })
      if (error) { logger.error('[useStrategicAlerts]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        alert_type: (r.alert_type as string) || '',
        severity: (r.severity as 'warning' | 'critical') || 'warning',
        branch_id: (r.branch_id as string) || null,
        branch_name: (r.branch_name as string) || '—',
        metric: numOrNull(r.metric),
        threshold: numOrNull(r.threshold),
        item_count: numOrNull(r.item_count),
      }))
    },
    staleTime: 5 * 60_000,
  })
}

export function useStrategicTrend(branchId?: string | null, months = 12) {
  return useQuery<StratTrendRow[]>({
    queryKey: qk.reports.stratTrend({ branchId: branchId || null, months }),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_strategic_trend', {
        p_branch_id: branchId || null,
        p_months: months,
      })
      if (error) { logger.error('[useStrategicTrend]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ym: (r.ym as string) || '',
        revenue_total: num(r.revenue_total),
        revenue_strategic: num(r.revenue_strategic),
        revenue_baseline: num(r.revenue_baseline),
        strategic_share: numOrNull(r.strategic_share),
        profit_strategic: num(r.profit_strategic),
        profit_baseline: num(r.profit_baseline),
        cross_subsidy: num(r.cross_subsidy),
      }))
    },
    staleTime: 5 * 60_000,
  })
}

// Tab "Hôm nay" — live, staleTime 0 để realtime invalidate là refetch ngay
export function useStrategicToday(branchId?: string | null) {
  return useQuery<StratTodayRow[]>({
    queryKey: qk.reports.stratToday({ branchId: branchId || null }),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_strategic_today', {
        p_branch_id: branchId || null,
      })
      if (error) { logger.error('[useStrategicToday]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        branch_id: (r.branch_id as string) || null,
        branch_name: (r.branch_name as string) || '—',
        revenue_total: num(r.revenue_total),
        revenue_strategic: num(r.revenue_strategic),
        revenue_baseline: num(r.revenue_baseline),
        revenue_other: num(r.revenue_other),
        strategic_share: numOrNull(r.strategic_share),
        profit_strategic: num(r.profit_strategic),
        profit_baseline: num(r.profit_baseline),
        order_count: num(r.order_count),
        last_order_at: (r.last_order_at as string) || null,
      }))
    },
    staleTime: 0,
  })
}

export function useStrategicTodayOrders(branchId?: string | null, limit = 20) {
  return useQuery<StratTodayOrderRow[]>({
    queryKey: qk.reports.stratTodayOrders({ branchId: branchId || null, limit }),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_strategic_today_orders', {
        p_branch_id: branchId || null,
        p_limit: limit,
      })
      if (error) { logger.error('[useStrategicTodayOrders]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        order_id: r.order_id as string,
        order_code: (r.order_code as string) || '',
        created_at: (r.created_at as string) || '',
        branch_name: (r.branch_name as string) || '—',
        customer_name: (r.customer_name as string) || 'Khách lẻ',
        grand_total: num(r.grand_total),
        revenue_strategic: num(r.revenue_strategic),
        revenue_baseline: num(r.revenue_baseline),
        status: (r.status as string) || '',
      }))
    },
    staleTime: 0,
  })
}

// Bảng targets (RLS admin-only — non-admin nhận [] nên trang đã gate adminOnly)
export function useBranchMonthTargets(year: number, month: number) {
  return useQuery<BranchMonthTarget[]>({
    queryKey: qk.reports.stratTargets({ year, month }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_month_targets')
        .select('id, branch_id, year, month, revenue_target, strategic_share_target, note')
        .eq('year', year)
        .eq('month', month)
      if (error) { logger.error('[useBranchMonthTargets]', error.message); throw error }
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        branch_id: r.branch_id as string,
        year: num(r.year),
        month: num(r.month),
        revenue_target: num(r.revenue_target),
        strategic_share_target: num(r.strategic_share_target),
        note: (r.note as string) || null,
      }))
    },
    staleTime: 60_000,
  })
}

export function useStrategicConfig() {
  return useQuery<StrategicConfig>({
    queryKey: qk.reports.stratConfig,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'strategic_config')
        .maybeSingle()
      if (error) { logger.error('[useStrategicConfig]', error.message); throw error }
      const v = (data?.value ?? {}) as Partial<Record<keyof StrategicConfig, unknown>>
      return {
        markup_min: v.markup_min != null ? num(v.markup_min) : DEFAULT_STRATEGIC_CONFIG.markup_min,
        baseline_loss_floor: v.baseline_loss_floor != null ? num(v.baseline_loss_floor) : DEFAULT_STRATEGIC_CONFIG.baseline_loss_floor,
        suggest_min_revenue_90d: v.suggest_min_revenue_90d != null ? num(v.suggest_min_revenue_90d) : DEFAULT_STRATEGIC_CONFIG.suggest_min_revenue_90d,
        suggest_min_qty_90d: v.suggest_min_qty_90d != null ? num(v.suggest_min_qty_90d) : DEFAULT_STRATEGIC_CONFIG.suggest_min_qty_90d,
        oos_warn_days: v.oos_warn_days != null ? num(v.oos_warn_days) : DEFAULT_STRATEGIC_CONFIG.oos_warn_days,
      }
    },
    staleTime: 5 * 60_000,
  })
}

// ── Mutations ────────────────────────────────────────────────

/** Gán / chuyển nhóm SP (class=null → gỡ khỏi nhóm). */
export function useAssignStrategy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { productId: string; cls: StrategyClass | null; note?: string }) => {
      if (input.cls === null) {
        const { error } = await supabase
          .from('product_strategy')
          .delete()
          .eq('product_id', input.productId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('product_strategy')
          .upsert(
            { product_id: input.productId, class: input.cls, note: input.note || null, assigned_at: new Date().toISOString() },
            { onConflict: 'product_id' },
          )
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.reports.strategicAll })
    },
  })
}

export function useUpsertBranchTarget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      branchId: string; year: number; month: number
      revenueTarget: number; shareTarget: number; note?: string
    }) => {
      const { error } = await supabase
        .from('branch_month_targets')
        .upsert(
          {
            branch_id: input.branchId,
            year: input.year,
            month: input.month,
            revenue_target: input.revenueTarget,
            strategic_share_target: input.shareTarget,
            note: input.note || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'branch_id,year,month' },
        )
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.reports.strategicAll })
    },
  })
}

export function useSaveStrategicConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (cfg: StrategicConfig) => {
      const { error } = await supabase
        .from('system_settings')
        .upsert(
          { key: 'strategic_config', value: cfg, updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        )
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.reports.strategicAll })
    },
  })
}
