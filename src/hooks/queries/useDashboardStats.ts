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
  branch_id?: string | null
  monthly_revenue: number
  last_month_revenue: number
  monthly_revenue_delta: number        // % (positive/negative)
  overdue_debt: number
  overdue_debt_count: number
  expiring_lots_count: number
  cashflow_6m: CashflowMonth[]
}

// Build cashflow array fallback từ cashbook_transactions.
// branchId set → lọc theo chi nhánh qua quỹ tiền / tài khoản ngân hàng.
async function fallbackCashflow6m(branchId: string | null): Promise<CashflowMonth[]> {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
  sixMonthsAgo.setDate(1)
  sixMonthsAgo.setHours(0, 0, 0, 0)

  const { data } = await supabase
    .from('cashbook_transactions')
    .select('amount, flow_type, transaction_date, cash_funds(branch_id), bank_accounts(branch_id)')
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
    // Lọc chi nhánh: branch suy từ quỹ tiền hoặc tài khoản ngân hàng
    if (branchId) {
      const txBranch = tx.cash_funds?.branch_id ?? tx.bank_accounts?.branch_id ?? null
      if (txBranch !== branchId) return
    }
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

async function fallbackDashboard(branchId: string | null): Promise<DashboardStats> {
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)
  const startOfLast  = new Date(); startOfLast.setMonth(startOfLast.getMonth() - 1); startOfLast.setDate(1); startOfLast.setHours(0, 0, 0, 0)
  const endOfLast    = new Date(); endOfLast.setDate(1); endOfLast.setHours(0, 0, 0, 0); endOfLast.setMilliseconds(-1)
  const todayStr = new Date().toISOString().split('T')[0]
  const thirtyDays = new Date(); thirtyDays.setDate(thirtyDays.getDate() + 30)
  const thirtyStr = thirtyDays.toISOString().split('T')[0]

  // Query đơn hàng có thể lọc branch trực tiếp (orders.branch_id)
  const thisMonthQ = supabase.from('orders').select('grand_total').neq('status', 'cancelled').gte('created_at', startOfMonth.toISOString())
  const lastMonthQ = supabase.from('orders').select('grand_total').neq('status', 'cancelled').gte('created_at', startOfLast.toISOString()).lte('created_at', endOfLast.toISOString())
  if (branchId) {
    thisMonthQ.eq('branch_id', branchId)
    lastMonthQ.eq('branch_id', branchId)
  }

  // Chạy song song để giảm round-trip
  const [thisMonth, lastMonth, overdueDebts, expiringLots, cashflow] = await Promise.all([
    thisMonthQ,
    lastMonthQ,
    supabase.from('customer_debts').select('amount, orders(branch_id), customers(branch_id)').eq('is_settled', false).lt('due_date', todayStr),
    supabase.from('stock_lots').select('id, warehouses(branch_id)').gt('quantity_on_hand', 0).gte('expiry_date', todayStr).lte('expiry_date', thirtyStr),
    fallbackCashflow6m(branchId),
  ])

  const sumGT = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((s, r) => s + Number(r.grand_total || 0), 0)

  const monthly  = sumGT(thisMonth.data)
  const last     = sumGT(lastMonth.data)

  // Nợ quá hạn: branch suy từ order → customer fallback, lọc client-side
  const overdueRows = (overdueDebts.data ?? []).filter((r: any) => {
    if (!branchId) return true
    const b = r.orders?.branch_id ?? r.customers?.branch_id ?? null
    return b === branchId
  })
  const overdue = overdueRows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0)

  // Lô sắp hết hạn: branch qua warehouse, lọc client-side
  const expiringRows = (expiringLots.data ?? []).filter((r: any) =>
    !branchId || r.warehouses?.branch_id === branchId)

  const delta = last > 0
    ? Math.round(((monthly - last) / last) * 1000) / 10
    : (monthly > 0 ? 100 : 0)

  return {
    monthly_revenue: monthly,
    last_month_revenue: last,
    monthly_revenue_delta: delta,
    overdue_debt: overdue,
    overdue_debt_count: overdueRows.length,
    expiring_lots_count: expiringRows.length,
    cashflow_6m: cashflow,
  }
}

// useDashboardStats – 1 RPC duy nhất (đã lọc theo chi nhánh); fallback query
// song song nếu RPC chưa được apply trên Supabase remote.
// branchId: null = toàn hệ thống (admin/ceo); UUID = 1 chi nhánh cụ thể.
export function useDashboardStats(enabled: boolean = true, branchId: string | null = null) {
  return useQuery<DashboardStats>({
    queryKey: qk.dashboard.stats(branchId),
    enabled,
    queryFn: async (): Promise<DashboardStats> => {
      const { data, error } = await supabase.rpc('get_dashboard_stats', { p_branch_id: branchId })

      if (!error && data) {
        return data as DashboardStats
      }

      logger.warn('[useDashboardStats] RPC unavailable, fallback to direct queries:', error?.message)
      return await fallbackDashboard(branchId)
    },
    staleTime: 30_000,
  })
}
