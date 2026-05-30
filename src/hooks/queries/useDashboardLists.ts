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
