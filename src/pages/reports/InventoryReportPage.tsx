import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts'
import {
  ChevronLeft, ChevronRight as ChevronRightIcon,
  Package, AlertTriangle, BarChart2, RefreshCw,
  Download, Calendar
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface InventoryRow {
  product_id: string
  product_name: string
  product_code: string
  category_name: string
  qty_remaining: number
  stock_value: number
  cost_price: number
  earliest_expiry: string | null
  lot_count: number
  status: 'normal' | 'expiring_soon' | 'expired'
}

interface CategoryBucket {
  name: string
  value: number
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)

const formatShort = (val: number) => {
  if (val >= 1_000_000_000) return (val / 1_000_000_000).toFixed(1) + ' tỷ'
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(0) + ' tr'
  if (val >= 1_000) return (val / 1_000).toFixed(0) + 'k'
  return String(val)
}


export default function InventoryReportPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [categoryBuckets, setCategoryBuckets] = useState<CategoryBucket[]>([])
  const [kpi, setKpi] = useState({ totalValue: 0, totalSKU: 0, expiringSoon: 0, expired: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState<'all' | 'expiring_soon' | 'expired'>('all')
  const PAGE_SIZE = 10

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: lots } = await supabase
        .from('stock_lots')
        .select(`
          id,
          product_id,
          quantity_remaining,
          cost_price,
          expiry_date,
          status,
          products!inner(name, code,
            product_categories(name)
          )
        `)
        .in('status', ['active'])
        .gt('quantity_remaining', 0)

      const list = lots ?? []
      const now = new Date()
      const thirtyDaysFromNow = new Date(); thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

      // Group by product
      const byProduct: Record<string, InventoryRow> = {}
      const byCat: Record<string, number> = {}

      for (const lot of list) {
        const prod = lot.products as unknown as { name: string; code: string; product_categories?: { name: string } | null }
        const pid = String(lot.product_id)
        const catName = prod?.product_categories?.name ?? 'Chưa phân loại'
        const qty = Number(lot.quantity_remaining)
        const cost = Number(lot.cost_price)
        const value = qty * cost

        if (!byProduct[pid]) {
          byProduct[pid] = {
            product_id: pid,
            product_name: prod?.name ?? '—',
            product_code: prod?.code ?? '—',
            category_name: catName,
            qty_remaining: 0,
            stock_value: 0,
            cost_price: cost,
            earliest_expiry: lot.expiry_date,
            lot_count: 0,
            status: 'normal'
          }
        }
        const row = byProduct[pid]
        row.qty_remaining += qty
        row.stock_value += value
        row.lot_count += 1

        if (lot.expiry_date) {
          if (!row.earliest_expiry || lot.expiry_date < row.earliest_expiry) {
            row.earliest_expiry = lot.expiry_date
          }
        }

        // Category
        byCat[catName] = (byCat[catName] ?? 0) + value
      }

      // Determine status per product
      const rowList = Object.values(byProduct).map(row => {
        if (row.earliest_expiry) {
          const exp = new Date(row.earliest_expiry)
          if (exp < now) row.status = 'expired'
          else if (exp <= thirtyDaysFromNow) row.status = 'expiring_soon'
        }
        return row
      }).sort((a, b) => b.stock_value - a.stock_value)

      setRows(rowList)

      const totalValue = rowList.reduce((s, r) => s + r.stock_value, 0)
      const totalSKU = rowList.length
      const expiringSoon = rowList.filter(r => r.status === 'expiring_soon').length
      const expired = rowList.filter(r => r.status === 'expired').length
      setKpi({ totalValue, totalSKU, expiringSoon, expired })

      setCategoryBuckets(
        Object.entries(byCat)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 7)
      )

      setPage(1)
    } catch (err) {
      console.error('Error loading inventory report:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filteredRows = filterStatus === 'all' ? rows : rows.filter(r => r.status === filterStatus)
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const paginatedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const statusBadge = (status: InventoryRow['status'], expiry: string | null) => {
    if (status === 'expired') return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-tiny font-bold bg-red-50 text-red-600 border border-red-100">
        <AlertTriangle size={10} />
        Hết hạn
      </span>
    )
    if (status === 'expiring_soon') return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-tiny font-bold bg-amber-50 text-amber-700 border border-amber-100">
        <AlertTriangle size={10} />
        Sắp hết hạn
      </span>
    )
    if (expiry) {
      const d = new Date(expiry)
      const diffDays = Math.floor((d.getTime() - Date.now()) / 86_400_000)
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-tiny font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
          còn {diffDays} ngày
        </span>
      )
    }
    return <span className="text-gray-300 text-tiny">—</span>
  }

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-150 rounded-lg px-3 py-2 shadow-lg text-tiny">
          <p className="font-bold text-gray-700 mb-1 max-w-[160px] break-words">{label}</p>
          <p className="text-gray-600">Giá trị: <span className="font-bold text-gray-800">{formatShort(payload[0].value)}</span></p>
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
          <span className="text-blue-600 font-semibold">Nhập xuất tồn kho</span>
        </div>

        {/* Title */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-gray-800">Báo cáo Tồn kho</h1>
            <p className="text-gray-500 text-body-md mt-1">Giá trị tồn kho hiện tại, cảnh báo hết hạn và phân bổ theo danh mục.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadData} className="h-10 w-10 flex items-center justify-center border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors">
              <RefreshCw size={16} />
            </button>
            <button className="h-10 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-[#143C69] active:scale-95 transition-all shadow-sm">
              <Download size={16} />
              Xuất Excel
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600 w-fit mb-3"><BarChart2 size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Tổng giá trị tồn kho</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums">{formatShort(kpi.totalValue)}</p>
            <p className="text-tiny text-gray-400 mt-1 tabular-nums">{formatCurrency(kpi.totalValue)}</p>
          </div>
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600 w-fit mb-3"><Package size={20} /></div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Tổng số mặt hàng (SKU)</p>
            <p className="text-2xl font-bold text-gray-800 tabular-nums">{kpi.totalSKU.toLocaleString('vi-VN')}</p>
            <p className="text-tiny text-gray-400 mt-1">sản phẩm đang có tồn</p>
          </div>
          <div className={`bg-white rounded-xl p-5 shadow-sm border ${kpi.expiringSoon > 0 ? 'border-amber-200' : 'border-gray-150'}`}>
            <div className={`p-2 rounded-lg w-fit mb-3 ${kpi.expiringSoon > 0 ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-600'}`}>
              <AlertTriangle size={20} />
            </div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Hàng sắp hết hạn (≤30 ngày)</p>
            <p className={`text-2xl font-bold tabular-nums ${kpi.expiringSoon > 0 ? 'text-amber-600' : 'text-gray-800'}`}>
              {kpi.expiringSoon.toLocaleString('vi-VN')}
            </p>
            <p className="text-tiny text-gray-400 mt-1">mặt hàng cần chú ý</p>
          </div>
          <div className={`bg-white rounded-xl p-5 shadow-sm border ${kpi.expired > 0 ? 'border-red-200' : 'border-gray-150'}`}>
            <div className={`p-2 rounded-lg w-fit mb-3 ${kpi.expired > 0 ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600'}`}>
              <Calendar size={20} />
            </div>
            <p className="text-tiny text-gray-400 font-medium mb-1">Hàng đã hết hạn</p>
            <p className={`text-2xl font-bold tabular-nums ${kpi.expired > 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {kpi.expired.toLocaleString('vi-VN')}
            </p>
            <p className="text-tiny text-gray-400 mt-1">mặt hàng quá hạn</p>
          </div>
        </div>

        {/* Category Bar Chart */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm p-6">
          <h3 className="text-body-lg font-bold text-gray-800 mb-5">Giá trị tồn kho theo Danh mục</h3>
          {loading ? (
            <div className="h-52 flex items-center justify-center">
              <div className="flex items-center gap-2 text-gray-400 text-tiny">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                Đang tải...
              </div>
            </div>
          ) : categoryBuckets.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-gray-400 text-body-md">Không có dữ liệu</div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryBuckets} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={formatShort} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="#1E5A9C" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Inventory Table */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-body-lg font-bold text-gray-800">Chi tiết Tồn kho theo Sản phẩm</h3>
            <div className="flex gap-2">
              {(['all', 'expiring_soon', 'expired'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { setFilterStatus(s); setPage(1) }}
                  className={`px-3 py-1.5 rounded-lg text-tiny font-semibold transition-all ${
                    filterStatus === s
                      ? s === 'expired' ? 'bg-red-500 text-white'
                        : s === 'expiring_soon' ? 'bg-amber-500 text-white'
                        : 'bg-[#1E5A9C] text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {s === 'all' ? 'Tất cả' : s === 'expiring_soon' ? '⚠ Sắp hết hạn' : '🔴 Đã hết hạn'}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[780px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase">Sản phẩm</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase">Danh mục</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-right">Tồn kho</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-right">Giá trị</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-center">Hạn sớm nhất</th>
                  <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400 text-tiny">Đang tải...</td></tr>
                ) : paginatedRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400 text-body-md">
                    <Package size={32} className="mx-auto mb-2 text-gray-200" />
                    Không có dữ liệu tồn kho
                  </td></tr>
                ) : paginatedRows.map((row) => (
                  <tr
                    key={row.product_id}
                    className={`hover:bg-gray-25 transition-colors ${
                      row.status === 'expired' ? 'bg-red-25' : row.status === 'expiring_soon' ? 'bg-amber-25' : ''
                    }`}
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-body-md font-semibold text-gray-800">{row.product_name}</p>
                      <p className="text-tiny text-gray-400">{row.product_code}</p>
                    </td>
                    <td className="px-5 py-3.5 text-body-md text-gray-600">{row.category_name}</td>
                    <td className="px-5 py-3.5 text-right text-body-md font-semibold tabular-nums text-gray-800">
                      {row.qty_remaining.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-5 py-3.5 text-right text-body-md font-bold tabular-nums text-[#143C69]">
                      {formatCurrency(row.stock_value)}
                    </td>
                    <td className="px-5 py-3.5 text-center text-tiny tabular-nums text-gray-600">
                      {row.earliest_expiry
                        ? new Date(row.earliest_expiry).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '—'
                      }
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {statusBadge(row.status, row.earliest_expiry)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-3 flex items-center justify-between border-t border-gray-100 bg-gray-25">
            <p className="text-tiny text-gray-400">Hiển thị {Math.min(PAGE_SIZE, paginatedRows.length)} trên {filteredRows.length} sản phẩm</p>
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
