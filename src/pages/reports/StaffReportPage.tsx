import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts'
import {
  ChevronLeft, ChevronRight as ChevronRightIcon,
  UserCheck, TrendingUp, ShoppingCart, Users,
  Download, Calendar, Medal, TrendingDown
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface StaffRow {
  user_id: string
  full_name: string
  rank: number
  order_count: number
  revenue: number
  customer_count: number
  aov: number
  prev_revenue: number
  growth: number
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

const MEDAL_COLORS = ['#f59e0b', '#9ca3af', '#cd7c2f']

const ACTIVE_STATUSES = ['confirmed', 'shipping', 'delivered', 'paid', 'completed']

export default function StaffReportPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<StaffRow[]>([])
  const [kpi, setKpi] = useState({ totalRevenue: 0, avgRevenue: 0, topStaff: '', avgOrders: 0 })
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Current period
      const { data: orders } = await supabase
        .from('orders')
        .select('id, created_by, grand_total, customer_id')
        .in('status', ACTIVE_STATUSES)
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59')

      const list = orders ?? []

      // Previous period
      const from = new Date(dateFrom)
      const to = new Date(dateTo)
      const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1
      const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1)
      const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days + 1)

      const { data: prevOrders } = await supabase
        .from('orders')
        .select('created_by, grand_total')
        .in('status', ACTIVE_STATUSES)
        .gte('created_at', prevFrom.toISOString().slice(0, 10) + 'T00:00:00')
        .lte('created_at', prevTo.toISOString().slice(0, 10) + 'T23:59:59')

      // Collect unique user_ids
      const userIds = [...new Set([
        ...list.map(o => o.created_by).filter(Boolean),
        ...(prevOrders ?? []).map(o => o.created_by).filter(Boolean),
      ])]

      // Fetch profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)

      const profileMap: Record<string, string> = {}
      for (const p of profiles ?? []) {
        profileMap[p.id] = p.full_name
      }

      // Group current by user
      const byUser: Record<string, { order_count: number; revenue: number; customers: Set<string> }> = {}
      for (const o of list) {
        if (!o.created_by) continue
        if (!byUser[o.created_by]) byUser[o.created_by] = { order_count: 0, revenue: 0, customers: new Set() }
        byUser[o.created_by].order_count += 1
        byUser[o.created_by].revenue += Number(o.grand_total)
        if (o.customer_id) byUser[o.created_by].customers.add(String(o.customer_id))
      }

      // Group prev by user
      const prevByUser: Record<string, number> = {}
      for (const o of prevOrders ?? []) {
        if (!o.created_by) continue
        prevByUser[o.created_by] = (prevByUser[o.created_by] ?? 0) + Number(o.grand_total)
      }

      // Build rows
      const rowList: StaffRow[] = Object.entries(byUser)
        .map(([uid, stats], _) => {
          const revenue = stats.revenue
          const prev = prevByUser[uid] ?? 0
          return {
            user_id: uid,
            full_name: profileMap[uid] ?? 'Không xác định',
            rank: 0,
            order_count: stats.order_count,
            revenue,
            customer_count: stats.customers.size,
            aov: stats.order_count > 0 ? revenue / stats.order_count : 0,
            prev_revenue: prev,
            growth: calcGrowth(revenue, prev),
          }
        })
        .sort((a, b) => b.revenue - a.revenue)
        .map((r, i) => ({ ...r, rank: i + 1 }))

      setRows(rowList)

      const totalRevenue = rowList.reduce((s, r) => s + r.revenue, 0)
      const avgRevenue = rowList.length > 0 ? totalRevenue / rowList.length : 0
      const topStaff = rowList.length > 0 ? rowList[0].full_name : '—'
      const avgOrders = rowList.length > 0 ? rowList.reduce((s, r) => s + r.order_count, 0) / rowList.length : 0

      setKpi({ totalRevenue, avgRevenue, topStaff, avgOrders })
      setPage(1)
    } catch (err) {
      console.error('Error loading staff report:', err)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const paginatedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Top 10 for chart
  const chartData = rows.slice(0, 10).map(r => ({
    name: r.full_name.length > 12 ? r.full_name.slice(0, 12) + '…' : r.full_name,
    revenue: r.revenue
  }))

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-150 rounded-lg px-3 py-2 shadow-lg text-tiny">
          <p className="font-bold text-gray-700 mb-1">{label}</p>
          <p className="text-gray-600">Doanh số: <span className="font-bold text-gray-800">{formatShort(payload[0].value)}</span></p>
        </div>
      )
    }
    return null
  }

  return (
    <Layout activeMenu="Báo cáo">
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto flex flex-col space-y-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-gray-400 text-tiny">
          <button onClick={() => navigate('/reports')} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
            <ChevronLeft size={14} />
            Trung tâm Báo cáo
          </button>
          <ChevronRightIcon size={12} />
          <span className="text-blue-600 font-semibold">Hiệu suất nhân viên</span>
        </div>

        {/* Title + Filter */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-gray-800">Báo cáo Hiệu suất Nhân viên</h1>
            <p className="text-gray-500 text-body-md mt-1">Doanh số và xếp hạng nhân viên theo khoảng thời gian.</p>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <label className="text-tiny text-gray-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                <Calendar size={12} />
                Khoảng thời gian
              </label>
              <div className="flex items-center gap-2">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="h-9 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-200" />
                <span className="text-gray-400">—</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="h-9 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
            </div>
            <button onClick={loadData}
              className="h-9 px-5 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny hover:bg-[#143C69] transition-all">
              Áp dụng
            </button>
            <button className="h-9 px-4 border border-gray-200 rounded-lg text-gray-500 text-tiny font-semibold flex items-center gap-1.5 hover:bg-gray-50">
              <Download size={15} />
              Xuất
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600 w-fit mb-3"><TrendingUp size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Tổng doanh số đội</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums">{formatShort(kpi.totalRevenue)}</p>
            <p className="text-tiny text-gray-400 mt-1 tabular-nums">{formatCurrency(kpi.totalRevenue)}</p>
          </div>
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600 w-fit mb-3"><Users size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Trung bình / nhân viên</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums">{formatShort(kpi.avgRevenue)}</p>
            <p className="text-tiny text-gray-400 mt-1 tabular-nums">{formatCurrency(kpi.avgRevenue)}</p>
          </div>
          <div className="bg-white border border-amber-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-amber-50 rounded-lg text-amber-500 w-fit mb-3"><Medal size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Top nhân viên</p>
            <p className="text-xl font-bold text-amber-600 leading-tight truncate">{kpi.topStaff}</p>
            <p className="text-tiny text-gray-400 mt-1">doanh số cao nhất</p>
          </div>
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600 w-fit mb-3"><ShoppingCart size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Số đơn TB / nhân viên</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums">{kpi.avgOrders.toFixed(0)}</p>
            <p className="text-tiny text-gray-400 mt-1">đơn hàng</p>
          </div>
        </div>

        {/* Bar Chart - Top 10 */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm p-6">
          <h3 className="text-body-lg font-bold text-gray-800 mb-5">Doanh số theo Nhân viên (Top 10)</h3>
          {loading ? (
            <div className="h-60 flex items-center justify-center">
              <div className="flex items-center gap-2 text-gray-400 text-tiny">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                Đang tải...
              </div>
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-gray-400 text-body-md">Không có dữ liệu</div>
          ) : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={formatShort} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="revenue" fill="#1E5A9C" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Leaderboard Table */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-body-lg font-bold text-gray-800">Bảng xếp hạng Nhân viên</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[680px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-center w-16">Xếp hạng</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase">Nhân viên</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-right">Số đơn</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-right">Doanh số</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-right">Số KH</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-right">AOV</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-center">Tăng trưởng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400 text-tiny">Đang tải dữ liệu...</td></tr>
                ) : paginatedRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-400 text-body-md">
                    <UserCheck size={32} className="mx-auto mb-2 text-gray-200" />
                    Không có dữ liệu nhân viên
                  </td></tr>
                ) : paginatedRows.map((row) => (
                  <tr key={row.user_id} className="hover:bg-gray-25 transition-colors">
                    {/* Rank */}
                    <td className="px-5 py-3.5 text-center">
                      {row.rank <= 3 ? (
                        <div className="flex items-center justify-center">
                          <Medal size={20} style={{ color: MEDAL_COLORS[row.rank - 1] }} />
                        </div>
                      ) : (
                        <span className="text-body-md font-bold text-gray-400">#{row.rank}</span>
                      )}
                    </td>
                    {/* Name */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-tiny shrink-0">
                          {row.full_name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-body-md font-semibold text-gray-800">{row.full_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right text-body-md tabular-nums text-gray-700">
                      {row.order_count.toLocaleString('vi-VN')} đơn
                    </td>
                    <td className="px-5 py-3.5 text-right text-body-md font-bold tabular-nums text-[#143C69]">
                      {formatCurrency(row.revenue)}
                    </td>
                    <td className="px-5 py-3.5 text-right text-body-md tabular-nums text-gray-700">
                      {row.customer_count.toLocaleString('vi-VN')} KH
                    </td>
                    <td className="px-5 py-3.5 text-right text-tiny tabular-nums text-gray-600">
                      {formatShort(row.aov)}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {row.prev_revenue > 0 ? (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-tiny font-bold ${growthClass(row.growth)}`}>
                          {row.growth >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {growthStr(row.growth)}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-tiny">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-3 flex items-center justify-between border-t border-gray-100 bg-gray-25">
            <p className="text-tiny text-gray-400">Hiển thị {Math.min(PAGE_SIZE, paginatedRows.length)} trên {rows.length} nhân viên</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 text-tiny font-semibold rounded transition-colors ${
                    page === p ? 'bg-[#1E5A9C] text-white' : 'border border-gray-200 hover:bg-gray-100 text-gray-600'
                  }`}>
                  {p}
                </button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-30">
                <ChevronRightIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
