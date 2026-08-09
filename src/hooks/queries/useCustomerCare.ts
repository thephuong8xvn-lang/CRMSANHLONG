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
  branch_name: string | null
  lifecycle: 'at_risk' | 'churned'
  churn_score: number
  /** Điểm ưu tiên gọi 0–100: tiền × độ trễ − đã gọi bao nhiêu lần. */
  priority: number
  last_order_at: string | null
  days_since: number | null
  avg_interval_days: number | null
  n_orders: number
  revenue_90d: number
  total_debt: number
  phone: string | null
  call_count: number
  last_call_at: string | null
  last_outcome: string | null
  next_followup: string | null
  /** Đang "tạm lặng" sau cuộc gọi trước — chưa tới lúc réo lại. */
  snooze_until: string | null
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
        branch_name: r.branch_name,
        lifecycle: r.lifecycle,
        churn_score: Number(r.churn_score) || 0,
        priority: Number(r.priority) || 0,
        last_order_at: r.last_order_at,
        days_since: r.days_since != null ? Number(r.days_since) : null,
        avg_interval_days: r.avg_interval_days != null ? Number(r.avg_interval_days) : null,
        n_orders: Number(r.n_orders) || 0,
        revenue_90d: Number(r.revenue_90d) || 0,
        total_debt: Number(r.total_debt) || 0,
        phone: r.phone,
        call_count: Number(r.call_count) || 0,
        last_call_at: r.last_call_at,
        last_outcome: r.last_outcome,
        next_followup: r.next_followup,
        snooze_until: r.snooze_until,
      }))
    },
    staleTime: 2 * 60_000,
  })
}

// ── Danh sách "Nhắc mua lại" theo (Khách × Sản phẩm) ──
export interface ReorderReminderRow {
  customer_id: string
  code: string | null
  farm_name: string
  owner_user_id: string | null
  owner_name: string | null
  branch_id: string | null
  phone: string | null
  product_id: string
  product_name: string
  unit: string | null
  n_buys: number
  avg_interval_days: number | null
  last_bought_at: string | null
  last_qty: number | null
  days_since: number | null
  predicted_next: string | null
  overdue_ratio: number | null
}

export function useReorderReminders(ownerId: string | null = null, enabled: boolean = true) {
  return useQuery<ReorderReminderRow[]>({
    queryKey: qk.customers.reorderReminders(ownerId),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_reorder_reminders', { p_owner_id: ownerId })
      if (error) { logger.error('[useReorderReminders]', error.message); throw error }
      return (data ?? []).map((r: any) => ({
        customer_id: r.customer_id,
        code: r.code,
        farm_name: r.farm_name || '—',
        owner_user_id: r.owner_user_id,
        owner_name: r.owner_name,
        branch_id: r.branch_id,
        phone: r.phone,
        product_id: r.product_id,
        product_name: r.product_name || '—',
        unit: r.unit,
        n_buys: Number(r.n_buys) || 0,
        avg_interval_days: r.avg_interval_days != null ? Number(r.avg_interval_days) : null,
        last_bought_at: r.last_bought_at,
        last_qty: r.last_qty != null ? Number(r.last_qty) : null,
        days_since: r.days_since != null ? Number(r.days_since) : null,
        predicted_next: r.predicted_next,
        overdue_ratio: r.overdue_ratio != null ? Number(r.overdue_ratio) : null,
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

// ── Ghi nhận cuộc gọi chăm sóc ──────────────────────────────────────────
// Kết quả gọi quyết định luôn "tạm lặng" bao lâu — đây là thứ làm danh sách
// (và tin Telegram 07:30/13:30) mỗi hôm một khác thay vì lặp lại y hệt.
export const CARE_OUTCOMES = [
  { code: 'hen_mua',      label: 'Hẹn sẽ mua lại',    days: 7,   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { code: 'can_nhac',     label: 'Đang cân nhắc',     days: 3,   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { code: 'khong_nghe',   label: 'Không nghe máy',    days: 1,   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { code: 'mua_noi_khac', label: 'Đã mua nơi khác',   days: 30,  cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  { code: 'ngung_nuoi',   label: 'Ngừng chăn nuôi',   days: 365, cls: 'bg-rose-50 text-rose-600 border-rose-200' },
  { code: 'khac',         label: 'Khác',              days: 3,   cls: 'bg-gray-100 text-gray-600 border-gray-200' },
] as const

export function careOutcomeLabel(code: string | null): string | null {
  if (!code) return null
  return CARE_OUTCOMES.find(o => o.code === code)?.label ?? code
}

export interface LogCareCallParams {
  customerId: string
  content: string
  outcome: string
  nextFollowup?: string | null
  kind?: 'churn' | 'reorder'
}

export interface LogCareCallResult {
  call_count: number
  snooze_until: string
  outcome: string
}

export function useLogCareCall() {
  const queryClient = useQueryClient()
  return useMutation<LogCareCallResult, Error, LogCareCallParams>({
    mutationFn: async ({ customerId, content, outcome, nextFollowup, kind = 'churn' }) => {
      const { data, error } = await supabase.rpc('fn_log_care_call', {
        p_customer_id: customerId,
        p_content: content || null,
        p_outcome: outcome,
        p_next_followup: nextFollowup || null,
        p_kind: kind,
      })
      if (error) { logger.error('[useLogCareCall]', error.message); throw error }
      return data as LogCareCallResult
    },
    onSuccess: (_res, vars) => {
      // Danh sách phải đổi ngay sau khi bấm — bản cũ ghi xong không đổi gì
      // trên màn hình nên không ai buồn dùng.
      queryClient.invalidateQueries({ queryKey: ['customers', 'churn-worklist'] })
      queryClient.invalidateQueries({ queryKey: ['customers', 'reorder-reminders'] })
      queryClient.invalidateQueries({ queryKey: qk.customers.careHistory(vars.customerId) })
    },
  })
}

// ── Lịch sử gọi của 1 khách (hiện ngay trong hộp thoại ghi nhận) ─────────
export interface CareCallRow {
  id: string
  called_at: string
  by_name: string | null
  outcome: string | null
  content: string | null
  next_at: string | null
}

export function useCareCallHistory(customerId: string | null) {
  return useQuery<CareCallRow[]>({
    queryKey: qk.customers.careHistory(customerId ?? '-'),
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_care_call_history', { p_customer_id: customerId })
      if (error) { logger.error('[useCareCallHistory]', error.message); throw error }
      return (data ?? []) as CareCallRow[]
    },
    staleTime: 30_000,
  })
}

// ── Cấu hình nhắc việc Telegram (chỉ quản trị hệ thống) ─────────────────
export interface CareConfig {
  chat_id: string
  enabled: boolean
  limit: number
  am_time: string
  pm_time: string
  at_risk_min_days: number
  churned_min_days: number
  min_interval_days: number
  cron?: Record<string, string> | null
  cron_result?: string
}

export function useCareConfig(enabled: boolean) {
  return useQuery<CareConfig>({
    queryKey: qk.customers.careConfig,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_care_config_get')
      if (error) { logger.error('[useCareConfig]', error.message); throw error }
      return data as CareConfig
    },
    staleTime: 60_000,
  })
}

export function useSaveCareConfig() {
  const queryClient = useQueryClient()
  return useMutation<CareConfig, Error, Partial<CareConfig>>({
    mutationFn: async (cfg) => {
      const { data, error } = await supabase.rpc('fn_care_config_set', { p_cfg: cfg })
      if (error) { logger.error('[useSaveCareConfig]', error.message); throw error }
      return data as CareConfig
    },
    onSuccess: (data) => {
      queryClient.setQueryData(qk.customers.careConfig, data)
      // Ngưỡng phân loại đổi ⇒ danh sách phải tính lại.
      queryClient.invalidateQueries({ queryKey: ['customers', 'churn-worklist'] })
    },
  })
}

export function useCareDigestPreview(session: 'sang' | 'chieu', enabled: boolean) {
  return useQuery<string>({
    queryKey: ['customers', 'care-digest-preview', session],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_care_digest_preview', { p_session: session })
      if (error) { logger.error('[useCareDigestPreview]', error.message); throw error }
      return (data as string) ?? ''
    },
    staleTime: 30_000,
  })
}

export function useSendCareDigestNow() {
  return useMutation<{ sent: boolean; message: string }, Error, 'sang' | 'chieu'>({
    mutationFn: async (session) => {
      const { data, error } = await supabase.rpc('fn_care_digest_send_now', { p_session: session })
      if (error) { logger.error('[useSendCareDigestNow]', error.message); throw error }
      return data as { sent: boolean; message: string }
    },
  })
}
