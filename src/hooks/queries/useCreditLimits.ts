import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

// ── Đề xuất hạn mức tín dụng (admin) ──
export interface CreditSuggestionRow {
  customer_id: string
  code: string | null
  farm_name: string
  owner_user_id: string | null
  owner_name: string | null
  branch_id: string | null
  current_limit: number
  revenue_90d: number
  avg_monthly: number
  outstanding: number
  n_orders_90d: number
  suggested_limit: number
  is_zero_limit: boolean
}

export function useCreditSuggestions(enabled: boolean = true) {
  return useQuery<CreditSuggestionRow[]>({
    queryKey: qk.customers.creditLimits,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_suggest_credit_limits')
      if (error) { logger.error('[useCreditSuggestions]', error.message); throw error }
      return (data ?? []).map((r: any) => ({
        customer_id: r.customer_id,
        code: r.code,
        farm_name: r.farm_name || '—',
        owner_user_id: r.owner_user_id,
        owner_name: r.owner_name,
        branch_id: r.branch_id,
        current_limit: Number(r.current_limit) || 0,
        revenue_90d: Number(r.revenue_90d) || 0,
        avg_monthly: Number(r.avg_monthly) || 0,
        outstanding: Number(r.outstanding) || 0,
        n_orders_90d: Number(r.n_orders_90d) || 0,
        suggested_limit: Number(r.suggested_limit) || 0,
        is_zero_limit: !!r.is_zero_limit,
      }))
    },
    staleTime: 60_000,
  })
}

// ── Cấu hình công thức đề xuất (system_settings.credit_config) ──
export interface CreditConfig {
  months_factor: number
  round_to: number
  min_limit: number
  max_limit: number
}
export const CREDIT_CONFIG_DEFAULTS: CreditConfig = {
  months_factor: 1.5, round_to: 500000, min_limit: 0, max_limit: 500000000,
}

export function useCreditConfig() {
  return useQuery<CreditConfig>({
    queryKey: qk.customers.creditConfig,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings').select('value').eq('key', 'credit_config').maybeSingle()
      if (error) { logger.error('[useCreditConfig]', error.message); throw error }
      return { ...CREDIT_CONFIG_DEFAULTS, ...((data?.value as Partial<CreditConfig>) ?? {}) }
    },
    staleTime: 5 * 60_000,
  })
}

export function useSaveCreditConfig() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, CreditConfig>({
    mutationFn: async (cfg) => {
      const { error } = await supabase.from('system_settings')
        .upsert({ key: 'credit_config', value: cfg, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.customers.creditConfig })
      queryClient.invalidateQueries({ queryKey: qk.customers.creditLimits })
    },
  })
}

// ── Áp hạn mức hàng loạt ──
export interface CreditPair { customer_id: string; credit_limit: number }

export function useBulkSetCreditLimits() {
  const queryClient = useQueryClient()
  return useMutation<number, Error, CreditPair[]>({
    mutationFn: async (pairs) => {
      const { data, error } = await supabase.rpc('fn_bulk_set_credit_limits', { p_pairs: pairs })
      if (error) throw error
      return Number(data) || 0
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.customers.creditLimits })
      queryClient.invalidateQueries({ queryKey: qk.customers.all })
    },
  })
}
