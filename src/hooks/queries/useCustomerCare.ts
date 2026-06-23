import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

// ── Danh sách "Khách cần chăm sóc" (at_risk / churned theo nhịp mua) ──
export interface ChurnWorklistRow {
  customer_id: string
  code: string | null
  farm_name: string
  owner_user_id: string | null
  owner_name: string | null
  branch_id: string | null
  lifecycle: 'at_risk' | 'churned'
  churn_score: number
  last_order_at: string | null
  days_since: number | null
  avg_interval_days: number | null
  n_orders: number
  total_debt: number
  phone: string | null
}

export function useChurnWorklist(ownerId: string | null = null, enabled: boolean = true) {
  return useQuery<ChurnWorklistRow[]>({
    queryKey: qk.customers.churnWorklist(ownerId),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_churn_worklist', { p_owner_id: ownerId })
      if (error) { logger.error('[useChurnWorklist]', error.message); throw error }
      return (data ?? []).map((r: any) => ({
        customer_id: r.customer_id,
        code: r.code,
        farm_name: r.farm_name || '—',
        owner_user_id: r.owner_user_id,
        owner_name: r.owner_name,
        branch_id: r.branch_id,
        lifecycle: r.lifecycle,
        churn_score: Number(r.churn_score) || 0,
        last_order_at: r.last_order_at,
        days_since: r.days_since != null ? Number(r.days_since) : null,
        avg_interval_days: r.avg_interval_days != null ? Number(r.avg_interval_days) : null,
        n_orders: Number(r.n_orders) || 0,
        total_debt: Number(r.total_debt) || 0,
        phone: r.phone,
      }))
    },
    staleTime: 2 * 60_000,
  })
}

// ── Tính lại phân loại vòng đời (admin) ──
export interface RecomputeResult {
  computed_at: string
  active: number
  at_risk: number
  churned: number
  new: number
}

export function useRecomputeLifecycle() {
  const queryClient = useQueryClient()
  return useMutation<RecomputeResult, Error>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('fn_recompute_customer_lifecycle')
      if (error) throw error
      return data as RecomputeResult
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', 'churn-worklist'] })
    },
  })
}

// ── Ghi nhận cuộc gọi chăm sóc → tạo activities (type call, done) ──
export interface LogCareCallParams {
  customerId: string
  ownerUserId: string
  farmName: string
  content: string
}

export function useLogCareCall() {
  return useMutation<void, Error, LogCareCallParams>({
    mutationFn: async ({ customerId, ownerUserId, farmName, content }) => {
      // Lấy activity_type 'call' (seed cố định nhưng tra theo code cho chắc).
      const { data: type, error: typeErr } = await supabase
        .from('activity_types').select('id').eq('code', 'call').maybeSingle()
      if (typeErr) throw typeErr
      if (!type?.id) throw new Error('Thiếu loại hoạt động "call" trong cấu hình.')

      const { error } = await supabase.from('activities').insert({
        activity_type_id: type.id,
        customer_id: customerId,
        owner_user_id: ownerUserId,
        title: `Gọi chăm sóc — ${farmName}`,
        content: content || null,
        status: 'done',
        completed_at: new Date().toISOString(),
      })
      if (error) throw error
    },
  })
}
