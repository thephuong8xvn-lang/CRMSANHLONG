import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

export interface CashflowMonth {
  month: string         // YYYY-MM-DD
  name: string          // "Tháng 5"
  inflow: number
  outflow: number
}

export interface DashboardStats {
  monthly_revenue: number
  last_month_revenue: number
  monthly_revenue_delta: number        // % (positive/negative)
  overdue_debt: number
  overdue_debt_count: number
  expiring_lots_count: number
  cashflow_6m: CashflowMonth[]
}

// Build cashflow array fallback từ cashbook_transactions
async function fallbackCashflow6m(): Promise<CashflowMonth[]> {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
  sixMonthsAgo.setDate(1)
  sixMonthsAgo.setHours(0, 0, 0, 0)

  const { data } = await supabase
    .from('cashbook_transactions')
    .select('amount, flow_type, transaction_date')
    .eq('status', 'approved')
    .gte('transaction_date', sixMonthsAgo.toISOString().split('T')[0])

  const months: CashflowMonth[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    d.setDate(1)
    months.push({
      month: d.toISOString().split('T')[0],
      name: `Tháng ${d.getMonth() + 1}`,
      inflow: 0,
      outflow: 0,
    })
  }

  (data ?? []).forEach((tx: any) => {
    const txDate = new Date(tx.transaction_date)
    const key = new Date(txDate.getFullYear(), txDate.getMonth(), 1).toISOString().split('T')[0]
    const match = months.find(m => m.month === key)
    if (!match) return
    const amt = Number(tx.amount || 0)
    if (tx.flow_type === 'inflow')  match.inflow  += amt
    if (tx.flow_type === 'outflow') match.outflow += amt
  })

  return months
}

async function fallbackDashboard(): Promise<DashboardStats> {
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)
  const startOfLast  = new Date(); startOfLast.setMonth(startOfLast.getMonth() - 1); startOfLast.setDate(1); startOfLast.setHours(0, 0, 0, 0)
  const endOfLast    = new Date(); endOfLast.setDate(1); endOfLast.setHours(0, 0, 0, 0); endOfLast.setMilliseconds(-1)
  const todayStr = new Date().toISOString().split('T')[0]
  const thirtyDays = new Date(); thirtyDays.setDate(thirtyDays.getDate() + 30)
  const thirtyStr = thirtyDays.toISOString().split('T')[0]

  // Chạy song song để giảm round-trip
  const [thisMonth, lastMonth, overdueDebts, expiringLots, cashflow] = await Promise.all([
    supabase.from('orders').select('grand_total').neq('status', 'cancelled').gte('created_at', startOfMonth.toISOString()),
    supabase.from('orders').select('grand_total').neq('status', 'cancelled').gte('created_at', startOfLast.toISOString()).lte('created_at', endOfLast.toISOString()),
    supabase.from('customer_debts').select('amount').eq('is_settled', false).lt('due_date', todayStr),
    supabase.from('stock_lots').select('id', { count: 'exact', head: true }).gt('quantity_on_hand', 0).gte('expiry_date', todayStr).lte('expiry_date', thirtyStr),
    fallbackCashflow6m(),
  ])

  const sumGT = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((s, r) => s + Number(r.grand_total || 0), 0)

  const monthly  = sumGT(thisMonth.data)
  const last     = sumGT(lastMonth.data)
  const overdueRows = overdueDebts.data ?? []
  const overdue = overdueRows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0)

  const delta = last > 0
    ? Math.round(((monthly - last) / last) * 1000) / 10
    : (monthly > 0 ? 100 : 0)

  return {
    monthly_revenue: monthly,
    last_month_revenue: last,
    monthly_revenue_delta: delta,
    overdue_debt: overdue,
    overdue_debt_count: overdueRows.length,
    expiring_lots_count: expiringLots.count ?? 0,
    cashflow_6m: cashflow,
  }
}

// useDashboardStats – 1 RPC duy nhất; fallback 5 query song song nếu RPC
// chưa được apply trên Supabase remote.
export function useDashboardStats(enabled: boolean = true) {
  return useQuery<DashboardStats>({
    queryKey: qk.dashboard.stats,
    enabled,
    queryFn: async (): Promise<DashboardStats> => {
      const { data, error } = await supabase.rpc('get_dashboard_stats')

      if (!error && data) {
        return data as DashboardStats
      }

      logger.warn('[useDashboardStats] RPC unavailable, fallback to direct queries:', error?.message)
      return await fallbackDashboard()
    },
    staleTime: 30_000,
  })
}
