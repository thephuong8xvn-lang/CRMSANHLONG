import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts'
import {
  ChevronLeft, ChevronRight as ChevronRightIcon,
  CreditCard, AlertTriangle, Clock, Users,
  Download, ExternalLink
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface DebtRow {
  customer_id: string
  customer_name: string
  customer_code: string
  primary_sales: string
  debt_0_30: number
  debt_31_60: number
  debt_61_90: number
  debt_90plus: number
  total: number
}

interface AgingBucket {
  label: string
  amount: number
  color: string
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)

const formatShort = (val: number) => {
  if (val >= 1_000_000_000) return (val / 1_000_000_000).toFixed(1) + ' tỷ'
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(0) + ' tr'
  if (val >= 1_000) return (val / 1_000).toFixed(0) + 'k'
  return String(val)
}

const AGING_COLORS = ['#22c55e', '#f59e0b', '#f97316', '#ef4444']

export default function DebtReportPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<DebtRow[]>([])
  const [agingBuckets, setAgingBuckets] = useState<AgingBucket[]>([])
  const [kpi, setKpi] = useState({ totalDebt: 0, overdueDebt: 0, dueSoonDebt: 0, debtorCount: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch all open debts with customer info
      const { data: debts } = await supabase
        .from('customer_debts')
        .select(`
          id,
          remaining_amount,
          due_date,
          customer_id,
          customers!inner(name, code, primary_sales_id,
            profiles:primary_sales_id(full_name)
          )
        `)
        .gt('remaining_amount', 0)

      const list = debts ?? []
      const now = new Date()

      // Group by customer and age
      const byCustomer: Record<string, DebtRow> = {}
      for (const d of list) {
        const cust = d.customers as unknown as { name: string; code: string; primary_sales_id: string; profiles?: { full_name: string } | null }
        const cid = String(d.customer_id)
        if (!byCustomer[cid]) {
          byCustomer[cid] = {
            customer_id: cid,
            customer_name: cust?.name ?? '—',
            customer_code: cust?.code ?? '—',
            primary_sales: cust?.profiles?.full_name ?? '—',
            debt_0_30: 0, debt_31_60: 0, debt_61_90: 0, debt_90plus: 0, total: 0
          }
        }
        const row = byCustomer[cid]
        const amt = Number(d.remaining_amount)
        row.total += amt

        if (d.due_date) {
          const dueDate = new Date(d.due_date)
          const daysDiff = Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000)
          if (daysDiff <= 0) row.debt_0_30 += amt          // not yet due or due within range
          else if (daysDiff <= 30) row.debt_0_30 += amt
          else if (daysDiff <= 60) row.debt_31_60 += amt
          else if (daysDiff <= 90) row.debt_61_90 += amt
          else row.debt_90plus += amt
        } else {
          row.debt_0_30 += amt // no due date → treat as current
        }
      }

      const rowList = Object.values(byCustomer).sort((a, b) => b.total - a.total)
      setRows(rowList)

      const totalDebt = rowList.reduce((s, r) => s + r.total, 0)
      const overdueDebt = rowList.reduce((s, r) => s + r.debt_61_90 + r.debt_90plus, 0)
      const dueSoonDebt = rowList.reduce((s, r) => s + r.debt_31_60, 0)
      const debtorCount = rowList.length

      setKpi({ totalDebt, overdueDebt, dueSoonDebt, debtorCount })

      const b0_30 = rowList.reduce((s, r) => s + r.debt_0_30, 0)
      const b31_60 = rowList.reduce((s, r) => s + r.debt_31_60, 0)
      const b61_90 = rowList.reduce((s, r) => s + r.debt_61_90, 0)
      const b90plus = rowList.reduce((s, r) => s + r.debt_90plus, 0)

      setAgingBuckets([
        { label: '0–30 ngày', amount: b0_30, color: AGING_COLORS[0] },
        { label: '31–60 ngày', amount: b31_60, color: AGING_COLORS[1] },
        { label: '61–90 ngày', amount: b61_90, color: AGING_COLORS[2] },
        { label: '>90 ngày', amount: b90plus, color: AGING_COLORS[3] },
      ])
      setPage(1)
    } catch (err) {
      console.error('Error loading debt report:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const paginatedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; fill: string }[]; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-150 rounded-lg px-3 py-2 shadow-lg text-tiny">
          <p className="font-bold text-gray-700 mb-1">{label}</p>
          <p className="text-gray-600">Công nợ: <span className="font-bold text-gray-800">{formatShort(payload[0].value)}</span></p>
        </div>
      )
    }
    return null
  }

  return (
    <Layout activeMenu="Báo cáo">
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto flex flex-col space-y-6">

        {/* Header */}
        <div className="flex items-center gap-2 text-gray-400 text-tiny">
          <button onClick={() => navigate('/reports')} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
            <ChevronLeft size={14} />
            Trung tâm Báo cáo
          </button>
          <ChevronRightIcon size={12} />
          <span className="text-blue-600 font-semibold">Công nợ phải thu</span>
        </div>

        {/* Title + Export */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-gray-800">Báo cáo Công nợ Phải thu</h1>
            <p className="text-gray-500 text-body-md mt-1">Phân tích tuổi nợ và theo dõi khách hàng nợ quá hạn.</p>
          </div>
          <button className="h-10 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-[#143C69] active:scale-95 transition-all shadow-sm">
            <Download size={16} />
            Xuất báo cáo
          </button>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600 w-fit mb-3"><CreditCard size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Tổng công nợ</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums">{formatShort(kpi.totalDebt)}</p>
            <p className="text-tiny text-gray-400 mt-1 tabular-nums">{formatCurrency(kpi.totalDebt)}</p>
          </div>
          <div className="bg-white border border-red-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-red-50 rounded-lg text-red-500 w-fit mb-3"><AlertTriangle size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Nợ quá hạn (&gt;60 ngày)</p>
            <p className="text-2xl font-bold text-red-600 tabular-nums">{formatShort(kpi.overdueDebt)}</p>
            <p className="text-tiny text-gray-400 mt-1 tabular-nums">{formatCurrency(kpi.overdueDebt)}</p>
          </div>
          <div className="bg-white border border-amber-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-amber-50 rounded-lg text-amber-500 w-fit mb-3"><Clock size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Sắp đến hạn (31–60 ngày)</p>
            <p className="text-2xl font-bold text-amber-600 tabular-nums">{formatShort(kpi.dueSoonDebt)}</p>
            <p className="text-tiny text-gray-400 mt-1 tabular-nums">{formatCurrency(kpi.dueSoonDebt)}</p>
          </div>
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600 w-fit mb-3"><Users size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Số khách hàng nợ</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums">{kpi.debtorCount.toLocaleString('vi-VN')}</p>
            <p className="text-tiny text-gray-400 mt-1">khách hàng</p>
          </div>
        </div>

        {/* Aging Bar Chart */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm p-6">
          <h3 className="text-body-lg font-bold text-gray-800 mb-5">Phân tích Tuổi nợ (Aging Analysis)</h3>
          {loading ? (
            <div className="h-52 flex items-center justify-center">
              <div className="flex items-center gap-2 text-gray-400 text-tiny">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                Đang tải...
              </div>
            </div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingBuckets} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={formatShort} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                    {agingBuckets.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4">
            {agingBuckets.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ background: b.color }} />
                <span className="text-tiny text-gray-500">{b.label}: <span className="font-bold text-gray-700">{formatShort(b.amount)}</span></span>
              </div>
            ))}
          </div>
        </div>

        {/* Aging table by customer */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-body-lg font-bold text-gray-800">Chi tiết Công nợ theo Khách hàng</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[800px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase">Khách hàng</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase">Nhân viên phụ trách</th>
                  <th className="px-5 py-3 text-tiny text-emerald-600 font-bold uppercase text-right">0–30 ngày</th>
                  <th className="px-5 py-3 text-tiny text-amber-600 font-bold uppercase text-right">31–60 ngày</th>
                  <th className="px-5 py-3 text-tiny text-orange-600 font-bold uppercase text-right">61–90 ngày</th>
                  <th className="px-5 py-3 text-tiny text-red-600 font-bold uppercase text-right">&gt;90 ngày</th>
                  <th className="px-5 py-3 text-tiny text-blue-600 font-bold uppercase text-right">Tổng</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={8} className="px-5 py-8 text-center text-gray-400 text-tiny">Đang tải dữ liệu...</td></tr>
                ) : paginatedRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-400 text-body-md">
                    <CreditCard size={32} className="mx-auto mb-2 text-gray-200" />
                    Không có công nợ tồn đọng
                  </td></tr>
                ) : paginatedRows.map((row) => (
                  <tr key={row.customer_id} className={`hover:bg-gray-25 transition-colors ${row.debt_90plus > 0 ? 'bg-red-25' : row.debt_61_90 > 0 ? 'bg-amber-25' : ''}`}>
                    <td className="px-5 py-3.5">
                      <p className="text-body-md font-semibold text-gray-800">{row.customer_name}</p>
                      <p className="text-tiny text-gray-400">{row.customer_code}</p>
                    </td>
                    <td className="px-5 py-3.5 text-body-md text-gray-600">{row.primary_sales}</td>
                    <td className="px-5 py-3.5 text-right text-tiny font-semibold tabular-nums text-emerald-700">
                      {row.debt_0_30 > 0 ? formatCurrency(row.debt_0_30) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-tiny font-semibold tabular-nums text-amber-700">
                      {row.debt_31_60 > 0 ? formatCurrency(row.debt_31_60) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-tiny font-semibold tabular-nums text-orange-600">
                      {row.debt_61_90 > 0 ? formatCurrency(row.debt_61_90) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-tiny font-bold tabular-nums text-red-600">
                      {row.debt_90plus > 0 ? formatCurrency(row.debt_90plus) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-tiny font-bold tabular-nums text-[#143C69]">
                      {formatCurrency(row.total)}
                    </td>
                    <td className="px-5 py-3.5">
                      <button
                        onClick={() => navigate(`/customers/${row.customer_id}`)}
                        className="text-blue-400 hover:text-blue-600 transition-colors"
                        title="Xem chi tiết khách hàng"
                      >
                        <ExternalLink size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-3 flex items-center justify-between border-t border-gray-100 bg-gray-25">
            <p className="text-tiny text-gray-400">Hiển thị {Math.min(PAGE_SIZE, paginatedRows.length)} trên {rows.length} khách hàng</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 text-tiny font-semibold rounded transition-colors ${
                    page === p ? 'bg-[#1E5A9C] text-white' : 'border border-gray-200 hover:bg-gray-100 text-gray-600'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronRightIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
