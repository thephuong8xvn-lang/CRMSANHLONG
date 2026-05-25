import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

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

export function usePendingDisbursements(limit: number = 3) {
  return useQuery<DisbursementItem[]>({
    queryKey: ['dashboard', 'pending-disbursements', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cashbook_transactions')
        .select('id, amount, description, transaction_date, employee:profiles(full_name, avatar_url)')
        .eq('flow_type', 'outflow')
        .eq('status', 'pending_approval')
        .limit(limit)
      if (error) throw error
      return (data ?? []).map((t: any) => {
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

export function useTodayAppointments(limit: number = 3) {
  return useQuery<AppointmentItem[]>({
    queryKey: ['dashboard', 'today-appointments', limit],
    queryFn: async () => {
      const todayStr = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('activities')
        .select('id, title, description, due_date')
        .eq('status', 'planned')
        .gte('due_date', todayStr)
        .order('due_date', { ascending: true })
        .limit(limit)
      if (error) throw error
      return (data ?? []).map((a: any) => ({
        id: a.id,
        time: new Date(a.due_date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        title: a.title,
        description: a.description || '',
      }))
    },
    staleTime: 60_000,
  })
}
