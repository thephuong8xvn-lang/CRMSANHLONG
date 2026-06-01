import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'

export interface DisbursementItem {
  id: string
  name: string
  time: string
  category: string
  amount: number
  avatar_url?: string
}

export interface AppointmentItem {
  id: string
  time: string
  title: string
  description: string
}

// Phiếu chi chờ duyệt. branchId set → lọc theo chi nhánh qua quỹ tiền/tài khoản
// ngân hàng (cashbook_transactions không có cột branch_id). Over-fetch rồi lọc
// + cắt client-side để vẫn đủ `limit` dòng sau khi lọc.
export function usePendingDisbursements(limit: number = 3, branchId: string | null = null) {
  return useQuery<DisbursementItem[]>({
    queryKey: qk.dashboard.disbursements(branchId, limit),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cashbook_transactions')
        .select('id, amount, description, transaction_date, cash_funds(branch_id), bank_accounts(branch_id), employee:profiles(full_name, avatar_url)')
        .eq('flow_type', 'outflow')
        .eq('status', 'pending_approval')
        .order('transaction_date', { ascending: false })
        .limit(branchId ? 30 : limit)
      if (error) throw error
      return (data ?? [])
        .filter((t: any) => {
          if (!branchId) return true
          const b = t.cash_funds?.branch_id ?? t.bank_accounts?.branch_id ?? null
          return b === branchId
        })
        .slice(0, limit)
        .map((t: any) => {
          const emp = t.employee as { full_name?: string; avatar_url?: string } | null
          return {
            id: t.id,
            name: emp?.full_name || 'Nhân viên ẩn',
            time: new Date(t.transaction_date).toLocaleDateString('vi-VN'),
            category: t.description || 'Chi phí nghiệp vụ',
            amount: Number(t.amount),
            avatar_url: emp?.avatar_url,
          }
        })
    },
    staleTime: 60_000,
  })
}

// ── Khách quen nhưng chưa mua lại (cảnh báo rời bỏ) ──
// Khách quen = orders_count >= REGULAR_MIN_ORDERS; chưa mua lại = last_order_at < today-INACTIVE_DAYS.
// customer_summary_view là security_invoker → RLS tự lọc theo phạm vi (branch/owner) của user.
const REGULAR_MIN_ORDERS = 3
const INACTIVE_DAYS = 30

export interface AtRiskRegularItem {
  id: string
  code: string | null
  farm_name: string
  last_order_at: string | null
  total_debt: number
  orders_count: number
  daysSince: number
}

export function useAtRiskRegulars(limit: number = 10, enabled: boolean = true) {
  return useQuery<AtRiskRegularItem[]>({
    queryKey: qk.dashboard.atRiskRegulars(limit),
    enabled,
    queryFn: async () => {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - INACTIVE_DAYS)
      const cutoffIso = cutoff.toISOString()
      const { data, error } = await supabase
        .from('customer_summary_view')
        .select('id, code, farm_name, last_order_at, total_debt, orders_count')
        .gte('orders_count', REGULAR_MIN_ORDERS)
        .not('last_order_at', 'is', null)
        .lt('last_order_at', cutoffIso)
        .order('last_order_at', { ascending: true })
        .limit(limit)
      if (error) throw error
      const now = Date.now()
      return (data ?? []).map((c: any) => ({
        id: c.id,
        code: c.code,
        farm_name: c.farm_name,
        last_order_at: c.last_order_at,
        total_debt: Number(c.total_debt) || 0,
        orders_count: Number(c.orders_count) || 0,
        daysSince: c.last_order_at ? Math.floor((now - new Date(c.last_order_at).getTime()) / 86400000) : 0,
      }))
    },
    staleTime: 5 * 60_000,
  })
}

// ── Công nợ sắp đến hạn trong N ngày (gồm cả quá hạn) ──
// customer_debts có RLS theo branch/owner → tự lọc phạm vi user.
export interface UpcomingDebtItem {
  id: string
  customer_id: string
  farm_name: string
  code: string | null
  amount: number
  due_date: string
  daysLeft: number
}

export function useUpcomingDebts(days: number = 10, limit: number = 10, enabled: boolean = true) {
  return useQuery<UpcomingDebtItem[]>({
    queryKey: qk.dashboard.upcomingDebts(days, limit),
    enabled,
    queryFn: async () => {
      const end = new Date()
      end.setDate(end.getDate() + days)
      const endIso = end.toISOString().split('T')[0]
      const todayMs = new Date(new Date().toISOString().split('T')[0]).getTime()
      const { data, error } = await supabase
        .from('customer_debts')
        .select('id, customer_id, amount, due_date, customer:customers(farm_name, code)')
        .eq('is_settled', false)
        .not('due_date', 'is', null)
        .lte('due_date', endIso)
        .order('due_date', { ascending: true })
        .limit(limit)
      if (error) throw error
      return (data ?? []).map((d: any) => ({
        id: d.id,
        customer_id: d.customer_id,
        farm_name: d.customer?.farm_name || 'Khách lẻ',
        code: d.customer?.code ?? null,
        amount: Number(d.amount) || 0,
        due_date: d.due_date,
        daysLeft: Math.round((new Date(d.due_date).getTime() - todayMs) / 86400000),
      }))
    },
    staleTime: 5 * 60_000,
  })
}

// Lịch hẹn hôm nay trở đi. branchId set → lọc qua khách hàng của hoạt động.
export function useTodayAppointments(limit: number = 3, branchId: string | null = null) {
  return useQuery<AppointmentItem[]>({
    queryKey: qk.dashboard.appointments(branchId, limit),
    queryFn: async () => {
      const todayStr = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('activities')
        .select('id, title, description, due_date, customers(branch_id)')
        .eq('status', 'planned')
        .gte('due_date', todayStr)
        .order('due_date', { ascending: true })
        .limit(branchId ? 30 : limit)
      if (error) throw error
      return (data ?? [])
        .filter((a: any) => !branchId || a.customers?.branch_id === branchId)
        .slice(0, limit)
        .map((a: any) => ({
          id: a.id,
          time: new Date(a.due_date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          title: a.title,
          description: a.description || '',
        }))
    },
    staleTime: 60_000,
  })
}
