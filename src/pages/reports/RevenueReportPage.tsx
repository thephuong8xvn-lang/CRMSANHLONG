import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts'
import {
  ChevronRight, TrendingUp, ShoppingCart, BarChart2,
  Percent, Download, Printer, ChevronLeft, ChevronRight as ChevronRightIcon,
  ChevronsUpDown, TrendingDown, Calendar
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

type GranularityType = 'day' | 'week' | 'month'

interface ChartPoint {
  label: string
  revenue: number
  orders: number
}

interface TableRow {
  date: string
  order_count: number
  revenue: number
  prev_revenue: number
}

interface KpiData {
  totalRevenue: number
  prevRevenue: number
  orderCount: number
  prevOrderCount: number
  aov: number
  margin: number
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)

const formatShort = (val: number) => {
  if (val >= 1_000_000_000) return (val / 1_000_000_000).toFixed(1) + ' tỷ'
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(0) + ' tr'
  if (val >= 1_000) return (val / 1_000).toFixed(0) + 'k'
  return String(val)
}

const growthClass = (val: number) =>
  val >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'

const growthStr = (val: number) => (val >= 0 ? '+' : '') + val.toFixed(1) + '%'

function calcGrowth(curr: number, prev: number) {
  if (prev === 0) return 0
  return ((curr - prev) / prev) * 100
}

const ACTIVE_STATUSES = ['confirmed', 'shipping', 'delivered', 'paid', 'completed']


export default function RevenueReportPage() {
  const navigate = useNavigate()
  const [granularity, setGranularity] = useState<GranularityType>('day')
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [tableRows, setTableRows] = useState<TableRow[]>([])
  const [kpi, setKpi] = useState<KpiData>({ totalRevenue: 0, prevRevenue: 0, orderCount: 0, prevOrderCount: 0, aov: 0, margin: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  const prevPeriodDates = useCallback(() => {
    const from = new Date(dateFrom)
    const to = new Date(dateTo)
    const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1
    const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1)
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days + 1)
    return { prevFrom: prevFrom.toISOString().slice(0, 10), prevTo: prevTo.toISOString().slice(0, 10) }
  }, [dateFrom, dateTo])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, created_at, grand_total, subtotal')
        .in('status', ACTIVE_STATUSES)
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: true })

      const list = orders ?? []
      const totalRevenue = list.reduce((s, o) => s + Number(o.grand_total), 0)
      const orderCount = list.length
      const aov = orderCount > 0 ? totalRevenue / orderCount : 0

      // Prev period
      const { prevFrom, prevTo } = prevPeriodDates()
      const { data: prevOrders } = await supabase
        .from('orders')
        .select('grand_total')
        .in('status', ACTIVE_STATUSES)
        .gte('created_at', prevFrom + 'T00:00:00')
        .lte('created_at', prevTo + 'T23:59:59')

      const prevRevenue = (prevOrders ?? []).reduce((s, o) => s + Number(o.grand_total), 0)
      const prevOrderCount = (prevOrders ?? []).length

      setKpi({ totalRevenue, prevRevenue, orderCount, prevOrderCount, aov, margin: 32 })

      // Group by granularity for chart
      const buckets: Record<string, { revenue: number; orders: number }> = {}
      for (const o of list) {
        const d = new Date(o.created_at)
        let key: string
        if (granularity === 'day') {
          key = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
        } else if (granularity === 'week') {
          const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay())
          key = 'T' + weekStart.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
        } else {
          key = d.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' })
        }
        if (!buckets[key]) buckets[key] = { revenue: 0, orders: 0 }
        buckets[key].revenue += Number(o.grand_total)
        buckets[key].orders += 1
      }
      setChartData(Object.entries(buckets).map(([label, v]) => ({ label, ...v })))

      // Table rows by day
      const dayBuckets: Record<string, TableRow> = {}
      for (const o of list) {
        const d = new Date(o.created_at).toISOString().slice(0, 10)
        if (!dayBuckets[d]) dayBuckets[d] = { date: d, order_count: 0, revenue: 0, prev_revenue: 0 }
        dayBuckets[d].order_count += 1
        dayBuckets[d].revenue += Number(o.grand_total)
      }
      setTableRows(Object.values(dayBuckets).sort((a, b) => b.date.localeCompare(a.date)))
      setPage(1)
    } catch (err) {
      console.error('Error loading revenue report:', err)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, granularity, prevPeriodDates])

  useEffect(() => { loadData() }, [loadData])

  const kpiGrowthRevenue = calcGrowth(kpi.totalRevenue, kpi.prevRevenue)
  const kpiGrowthOrders = calcGrowth(kpi.orderCount, kpi.prevOrderCount)
  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))
  const paginatedRows = tableRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[#1E5A9C] text-white px-3 py-2 rounded-lg shadow-lg text-tiny">
          <p className="font-bold mb-1">{label}</p>
          <p>Doanh thu: {formatShort(payload[0].value)}</p>
        </div>
      )
    }
    return null
  }

  return (
    <Layout activeMenu="Báo cáo">
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto flex flex-col space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-400 text-tiny">
            <button onClick={() => navigate('/reports')} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
              <ChevronLeft size={14} />
              Trung tâm Báo cáo
            </button>
            <ChevronRight size={12} />
            <span className="text-blue-600 font-semibold">Doanh thu theo thời gian</span>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white border border-gray-150 rounded-xl p-5 flex flex-wrap items-end gap-4 shadow-sm">
          <div className="flex-1 min-w-[220px] space-y-1">
            <label className="text-tiny text-gray-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Calendar size={12} />
              Khoảng thời gian
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-9 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <span className="text-gray-400">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-9 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="h-9 px-5 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny hover:bg-[#143C69] active:scale-95 transition-all"
            >
              Áp dụng
            </button>
            <button className="h-9 w-9 flex items-center justify-center border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors">
              <Download size={16} />
            </button>
            <button className="h-9 w-9 flex items-center justify-center border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors">
              <Printer size={16} />
            </button>
          </div>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Total Revenue */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><TrendingUp size={20} /></div>
              <span className={`flex items-center gap-1 text-tiny font-bold px-2 py-1 rounded-full ${growthClass(kpiGrowthRevenue)}`}>
                {kpiGrowthRevenue >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {growthStr(kpiGrowthRevenue)}
              </span>
            </div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Tổng doanh thu</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums leading-tight">{formatShort(kpi.totalRevenue)}</p>
            <p className="text-tiny text-gray-400 mt-1 tabular-nums">{formatCurrency(kpi.totalRevenue)}</p>
          </div>

          {/* Order count */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><ShoppingCart size={20} /></div>
              <span className={`flex items-center gap-1 text-tiny font-bold px-2 py-1 rounded-full ${growthClass(kpiGrowthOrders)}`}>
                {kpiGrowthOrders >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {growthStr(kpiGrowthOrders)}
              </span>
            </div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Số lượng hóa đơn</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums leading-tight">
              {kpi.orderCount.toLocaleString('vi-VN')} <span className="text-base font-normal text-gray-400">đơn</span>
            </p>
          </div>

          {/* AOV */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><BarChart2 size={20} /></div>
            </div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Giá trị đơn trung bình (AOV)</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums leading-tight">{formatShort(kpi.aov)}</p>
            <p className="text-tiny text-gray-400 mt-1 tabular-nums">{formatCurrency(kpi.aov)}</p>
          </div>

          {/* Margin */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Percent size={20} /></div>
              <span className="text-[10px] font-bold px-2 py-1 bg-blue-50 text-blue-600 rounded uppercase">Mục tiêu: 35%</span>
            </div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Biên lợi nhuận gộp</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums leading-tight">{kpi.margin}%</p>
          </div>
        </div>

        {/* Chart + Table panel */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
          {/* Chart Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-body-lg font-bold text-gray-800">Biểu đồ xu hướng doanh thu</h3>
            <div className="flex gap-1">
              {(['day', 'week', 'month'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1.5 text-tiny font-semibold rounded-lg transition-all ${
                    granularity === g ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {g === 'day' ? 'Ngày' : g === 'week' ? 'Tuần' : 'Tháng'}
                </button>
              ))}
            </div>
          </div>

          {/* Area Chart */}
          <div className="p-6">
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="flex items-center gap-2 text-gray-400 text-tiny">
                  <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                  Đang tải biểu đồ...
                </div>
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-body-md">
                Không có dữ liệu trong khoảng thời gian này
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1E5A9C" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#1E5A9C" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={formatShort} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#1E5A9C"
                      strokeWidth={2.5}
                      fill="url(#revenueGrad)"
                      dot={{ r: 3, fill: '#1E5A9C', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#1E5A9C', strokeWidth: 2, stroke: '#fff' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Drill-down Table */}
          <div className="border-t border-gray-100 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3 text-tiny text-blue-600 font-bold cursor-pointer hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-1">Ngày <ChevronsUpDown size={12} /></div>
                  </th>
                  <th className="px-6 py-3 text-tiny text-blue-600 font-bold cursor-pointer hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-1">Số hóa đơn <ChevronsUpDown size={12} /></div>
                  </th>
                  <th className="px-6 py-3 text-tiny text-blue-600 font-bold text-right cursor-pointer hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-1 justify-end">Doanh thu <ChevronsUpDown size={12} /></div>
                  </th>
                  <th className="px-6 py-3 text-tiny text-gray-400 font-bold text-center">Tăng trưởng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-400 text-tiny">Đang tải...</td></tr>
                ) : paginatedRows.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-400 text-body-md">Không có dữ liệu</td></tr>
                ) : paginatedRows.map((row, i) => {
                  // compute growth vs prev row
                  const prevRow = tableRows[tableRows.indexOf(row) + 1]
                  const growth = prevRow ? calcGrowth(row.revenue, prevRow.revenue) : 0
                  const hasPrev = !!prevRow

                  return (
                    <tr key={i} className="hover:bg-gray-25 transition-colors">
                      <td className="px-6 py-3.5 text-body-md text-gray-800">
                        {new Date(row.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td className="px-6 py-3.5 text-body-md text-gray-700">{row.order_count} đơn</td>
                      <td className="px-6 py-3.5 text-body-md text-right font-bold tabular-nums text-gray-800">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="px-6 py-3.5 text-center">
                        {hasPrev ? (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-tiny font-bold ${growthClass(growth)}`}>
                            {growth >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                            {growthStr(growth)}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-tiny">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="px-6 py-3 flex items-center justify-between border-t border-gray-100 bg-gray-25">
              <p className="text-tiny text-gray-400">Hiển thị {Math.min(PAGE_SIZE, paginatedRows.length)} trên {tableRows.length} ngày</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 flex items-center justify-center rounded text-tiny font-semibold transition-colors ${
                      page === p ? 'bg-[#1E5A9C] text-white' : 'border border-gray-200 hover:bg-gray-100 text-gray-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                >
                  <ChevronRightIcon size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

