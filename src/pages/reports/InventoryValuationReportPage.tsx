import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import {
  ChevronRight, ChevronLeft, Download, Package, Boxes, Coins,
  Warehouse, Tag, FolderTree, Award, RefreshCcw, Hourglass,
  AlertTriangle, CalendarClock
} from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts'
import Layout from '../../components/Layout'
import DataTable, { DataTableColumn } from '../../components/DataTable'
import SmartSearchSelect, { SmartSearchOption } from '../../components/SmartSearchSelect'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import {
  useInventoryValuationSummary,
  useInventoryValuationByProduct,
  useInventoryValuationByGroup,
  InvProductRow, InvGroupRow, InvProductSort, InvGroupBy,
} from '../../hooks/queries/useInventoryValuation'
import { bucketForDays, DEFAULT_EXPIRY_COLORS } from '../../hooks/queries/useInventoryInsights'

// ─────────────────────────────────────────────────────────────
// Báo cáo Kho hàng theo Giá vốn (admin-only)
// Giá vốn TB mỗi SP = bình quân gia quyền theo lô active còn hàng.
// ─────────────────────────────────────────────────────────────

type TabId = 'product' | 'brand' | 'category' | 'warehouse' | 'top_stock' | 'turnover' | 'slow'

const TABS: { id: TabId; label: string; icon: typeof Package }[] = [
  { id: 'product', label: 'Theo sản phẩm', icon: Package },
  { id: 'brand', label: 'Theo thương hiệu', icon: Tag },
  { id: 'category', label: 'Theo nhóm hàng', icon: FolderTree },
  { id: 'warehouse', label: 'Theo kho', icon: Warehouse },
  { id: 'top_stock', label: 'Top 50 tồn nhiều', icon: Award },
  { id: 'turnover', label: 'Vòng quay nhanh', icon: RefreshCcw },
  { id: 'slow', label: 'Tồn lâu / chậm bán', icon: Hourglass },
]

const GROUP_TABS: Record<string, InvGroupBy> = { brand: 'brand', category: 'category', warehouse: 'warehouse' }
const PAGE_SIZE = 50
const PIE_COLORS = ['#1E5A9C', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#64748b']

const fmtQty = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')

// HSD gần nhất: tô màu theo mốc hạn dùng chung của module kho
function ExpiryCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-300">—</span>
  const daysLeft = Math.round((new Date(date).getTime() - Date.now()) / 86400000)
  const color = daysLeft < 0 ? '#dc2626' : DEFAULT_EXPIRY_COLORS[bucketForDays(daysLeft).key]
  return (
    <span className="tabular-nums font-semibold" style={{ color }}>
      {fmtDate(date)}
      {daysLeft < 0 && <span className="ml-1 text-tiny">(quá hạn)</span>}
    </span>
  )
}

function MissingCostBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold bg-amber-50 text-amber-700"
      title="Sản phẩm có lô đang bán nhưng giá vốn = 0 → giá trị tồn đang bị tính thiếu. Hãy cập nhật giá vốn lô (Kho → sửa lô) hoặc nhập kho có giá."
    >
      <AlertTriangle size={11} />
      Thiếu giá vốn
    </span>
  )
}

export default function InventoryValuationReportPage() {
  const navigate = useNavigate()
  const { formatCurrency } = useDisplaySettings()

  const [activeTab, setActiveTab] = useState<TabId>('product')
  const [page, setPage] = useState(1)
  const [topStockBy, setTopStockBy] = useState<'qty' | 'value'>('qty')

  // Bộ lọc
  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const [productOptions, setProductOptions] = useState<SmartSearchOption[]>([])
  const [warehouseOptions, setWarehouseOptions] = useState<SmartSearchOption[]>([])
  const [brandOptions, setBrandOptions] = useState<SmartSearchOption[]>([])
  const [categoryOptions, setCategoryOptions] = useState<SmartSearchOption[]>([])

  // ── Tham số RPC theo tab (4 tab dạng sản phẩm dùng chung 1 RPC) ──
  const productParams = useMemo(() => {
    const base = { warehouseId: warehouseFilter || undefined }
    if (activeTab === 'top_stock') return { ...base, sort: topStockBy as InvProductSort, limit: 50, offset: 0 }
    if (activeTab === 'turnover') return { ...base, sort: 'turnover' as InvProductSort, limit: 50, offset: 0 }
    if (activeTab === 'slow') return { ...base, sort: 'idle' as InvProductSort, limit: 50, offset: 0 }
    return {
      ...base,
      search: search || undefined,
      brandId: brandFilter || undefined,
      categoryId: categoryFilter || undefined,
      sort: 'value' as InvProductSort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }
  }, [activeTab, warehouseFilter, search, brandFilter, categoryFilter, page, topStockBy])

  const summaryQ = useInventoryValuationSummary(warehouseFilter || undefined)
  const productQ = useInventoryValuationByProduct(productParams)
  const top10Q = useInventoryValuationByProduct({ warehouseId: warehouseFilter || undefined, sort: 'value', limit: 10, offset: 0 })
  const brandQ = useInventoryValuationByGroup('brand', warehouseFilter || undefined)
  const categoryQ = useInventoryValuationByGroup('category', warehouseFilter || undefined)
  const warehouseQ = useInventoryValuationByGroup('warehouse', warehouseFilter || undefined)

  const summary = summaryQ.data
  const errorMsg = summaryQ.error?.message || productQ.error?.message
    || brandQ.error?.message || categoryQ.error?.message || warehouseQ.error?.message

  const groupRows: InvGroupRow[] =
    activeTab === 'brand' ? (brandQ.data ?? [])
    : activeTab === 'category' ? (categoryQ.data ?? [])
    : activeTab === 'warehouse' ? (warehouseQ.data ?? [])
    : []
  const groupLoading = activeTab === 'brand' ? brandQ.isLoading
    : activeTab === 'category' ? categoryQ.isLoading
    : warehouseQ.isLoading

  const productRows = productQ.data ?? []
  const totalProducts = productRows[0]?.total_count ?? 0

  // Đổi bộ lọc/tab → về trang 1
  useEffect(() => { setPage(1) }, [search, warehouseFilter, brandFilter, categoryFilter, activeTab])

  // ── Nạp option bộ lọc (1 lần) ──
  useEffect(() => {
    fetchAllRows<{ id: string; sku: string; name: string }>((f, t) =>
      supabase.from('products').select('id, sku, name')
        .eq('is_active', true)
        .order('name', { ascending: true }).order('id')
        .range(f, t)
    ).then(list => {
      setProductOptions([
        { value: '', label: 'Tất cả sản phẩm' },
        ...list.map(p => ({ value: p.sku, label: p.name, desc: p.sku })),
      ])
    }).catch(() => {})

    type NamedRow = { id: string; name: string; code?: string | null }
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name').then(({ data }: { data: NamedRow[] | null }) => {
      setWarehouseOptions([
        { value: '', label: 'Tất cả kho' },
        ...(data ?? []).map(w => ({ value: w.id, label: w.name })),
      ])
    })
    supabase.from('brands').select('id, name').eq('is_active', true).order('name').then(({ data }: { data: NamedRow[] | null }) => {
      setBrandOptions([
        { value: '', label: 'Tất cả thương hiệu' },
        ...(data ?? []).map(b => ({ value: b.id, label: b.name })),
      ])
    })
    supabase.from('product_categories').select('id, name, code').eq('is_active', true).order('name').then(({ data }: { data: NamedRow[] | null }) => {
      setCategoryOptions([
        { value: '', label: 'Tất cả nhóm hàng' },
        ...(data ?? []).map(c => ({ value: c.id, label: c.name, desc: c.code || undefined })),
      ])
    })
  }, [])

  // ── Dữ liệu biểu đồ ──
  const barData = useMemo(() =>
    (top10Q.data ?? []).map(r => ({
      name: r.product_name.length > 28 ? r.product_name.slice(0, 27) + '…' : r.product_name,
      value: r.total_value,
    })), [top10Q.data])

  const pieData = useMemo(() => {
    const rows = categoryQ.data ?? []
    const top = rows.slice(0, 7)
    const restValue = rows.slice(7).reduce((s, r) => s + r.total_value, 0)
    return [
      ...top.map(r => ({ name: r.group_name, value: r.total_value })),
      ...(restValue > 0 ? [{ name: 'Khác', value: restValue }] : []),
    ]
  }, [categoryQ.data])

  // ── Cột DataTable ──
  const isProductShaped = activeTab === 'product' || activeTab === 'top_stock' || activeTab === 'turnover' || activeTab === 'slow'

  const productColumns = useMemo<DataTableColumn<InvProductRow>[]>(() => {
    const cols: DataTableColumn<InvProductRow>[] = [
      { key: 'sku', header: 'SKU', width: 110, render: r => <span className="text-gray-400 font-medium">{r.sku}</span> },
      {
        key: 'name', header: 'Sản phẩm', flex: true, minWidth: 220,
        render: r => (
          <div className="min-w-0">
            <div className="font-semibold text-gray-800 truncate">{r.product_name}</div>
            <div className="text-tiny text-gray-400 truncate">{r.brand_name} · {r.category_name}</div>
          </div>
        ),
      },
      {
        key: 'qty', header: 'Tồn', width: 100, align: 'right',
        render: r => <span className="tabular-nums font-semibold">{fmtQty(r.total_qty)}<span className="text-gray-400 font-normal text-tiny"> {r.unit}</span></span>,
      },
      {
        key: 'avg_cost', header: 'Giá vốn TB', width: 130, align: 'right', noTruncate: true,
        render: r => r.missing_cost
          ? <MissingCostBadge />
          : <span className="tabular-nums text-gray-600">{formatCurrency(r.avg_cost)}</span>,
      },
      {
        key: 'value', header: 'Giá trị vốn', width: 140, align: 'right', mobileHeaderRight: true,
        render: r => <span className="tabular-nums font-bold text-[#143C69]">{formatCurrency(r.total_value)}</span>,
      },
    ]
    if (activeTab === 'product' || activeTab === 'top_stock') {
      cols.push(
        { key: 'lots', header: 'Số lô', width: 70, align: 'right', hideOnMobile: true, render: r => <span className="tabular-nums text-gray-500">{r.lot_count}</span> },
        { key: 'expiry', header: 'HSD gần nhất', width: 130, align: 'right', noTruncate: true, render: r => <ExpiryCell date={r.nearest_expiry} /> },
      )
    }
    if (activeTab === 'turnover') {
      cols.push(
        { key: 'sold90', header: 'Bán 90 ngày', width: 110, align: 'right', render: r => <span className="tabular-nums">{fmtQty(r.sold_90d)}</span> },
        { key: 'turnover', header: 'Vòng quay', width: 100, align: 'right', render: r => <span className="tabular-nums font-bold text-emerald-700">{r.turnover_90d.toLocaleString('vi-VN')}×</span> },
        { key: 'days', header: 'Ngày tồn', width: 90, align: 'right', render: r => <span className="tabular-nums text-gray-600">{r.days_of_stock == null ? '—' : fmtQty(r.days_of_stock)}</span> },
      )
    }
    if (activeTab === 'slow') {
      cols.push(
        {
          key: 'sold90', header: 'Bán 90 ngày', width: 120, align: 'right', noTruncate: true,
          render: r => r.sold_90d === 0
            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold bg-red-50 text-red-600">Dead stock</span>
            : <span className="tabular-nums">{fmtQty(r.sold_90d)}</span>,
        },
        { key: 'last_sale', header: 'Lần bán cuối', width: 120, align: 'right', render: r => <span className="tabular-nums text-gray-500">{r.last_sale_at ? fmtDate(r.last_sale_at) : 'Chưa bán'}</span> },
      )
    }
    return cols
  }, [activeTab, formatCurrency])

  const groupColumns = useMemo<DataTableColumn<InvGroupRow>[]>(() => [
    {
      key: 'name',
      header: activeTab === 'brand' ? 'Thương hiệu' : activeTab === 'category' ? 'Nhóm hàng' : 'Kho',
      flex: true, minWidth: 220,
      render: r => <span className="font-semibold text-gray-800">{r.group_name}</span>,
    },
    { key: 'products', header: 'Số SP', width: 80, align: 'right', render: r => <span className="tabular-nums text-gray-600">{r.product_count}</span> },
    { key: 'lots', header: 'Số lô', width: 80, align: 'right', hideOnMobile: true, render: r => <span className="tabular-nums text-gray-500">{r.lot_count}</span> },
    { key: 'qty', header: 'Tồn', width: 110, align: 'right', render: r => <span className="tabular-nums font-semibold">{fmtQty(r.total_qty)}</span> },
    {
      key: 'value', header: 'Giá trị vốn', width: 150, align: 'right', mobileHeaderRight: true,
      render: r => <span className="tabular-nums font-bold text-[#143C69]">{formatCurrency(r.total_value)}</span>,
    },
    {
      key: 'share', header: 'Tỉ trọng', width: 130, align: 'right', noTruncate: true,
      render: r => (
        <div className="flex items-center justify-end gap-2">
          <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden hidden lg:block">
            <div className="h-full bg-[#1E5A9C] rounded-full" style={{ width: `${Math.min(100, r.value_share)}%` }} />
          </div>
          <span className="tabular-nums text-gray-600 font-semibold">{r.value_share.toLocaleString('vi-VN')}%</span>
        </div>
      ),
    },
    {
      key: 'missing', header: 'Thiếu giá vốn', width: 110, align: 'right', noTruncate: true,
      render: r => r.missing_cost_products > 0
        ? <span className="inline-flex items-center gap-1 text-tiny font-bold text-amber-600"><AlertTriangle size={11} />{r.missing_cost_products} SP</span>
        : <span className="text-gray-300">—</span>,
    },
  ], [activeTab, formatCurrency])

  // ── Xuất CSV theo tab đang xem ──
  const handleExport = () => {
    const today = new Date().toISOString().slice(0, 10)
    let csvRows: Record<string, string | number>[] = []
    if (isProductShaped) {
      csvRows = productRows.map(r => ({
        'SKU': r.sku, 'Sản phẩm': r.product_name, 'ĐVT': r.unit,
        'Thương hiệu': r.brand_name, 'Nhóm hàng': r.category_name,
        'Tồn': r.total_qty, 'Giá vốn TB': r.avg_cost, 'Giá trị vốn': r.total_value,
        'Số lô': r.lot_count, 'HSD gần nhất': r.nearest_expiry ?? '',
        'Bán 30 ngày': r.sold_30d, 'Bán 90 ngày': r.sold_90d,
        'Vòng quay 90 ngày': r.turnover_90d, 'Ngày tồn': r.days_of_stock ?? '',
        'Lần bán cuối': r.last_sale_at ? fmtDate(r.last_sale_at) : '',
        'Thiếu giá vốn': r.missing_cost ? 'X' : '',
      }))
    } else {
      const groupLabel = activeTab === 'brand' ? 'Thương hiệu' : activeTab === 'category' ? 'Nhóm hàng' : 'Kho'
      csvRows = groupRows.map(r => ({
        [groupLabel]: r.group_name, 'Số SP': r.product_count, 'Số lô': r.lot_count,
        'Tồn': r.total_qty, 'Giá trị vốn': r.total_value, 'Tỉ trọng (%)': r.value_share,
        'SP thiếu giá vốn': r.missing_cost_products,
      }))
    }
    const csv = '﻿' + Papa.unparse(csvRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `ton-kho-gia-von_${activeTab}_${today}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportDisabled = isProductShaped ? productRows.length === 0 : groupRows.length === 0

  return (
    <Layout activeMenu="Báo cáo">
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto flex flex-col space-y-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-gray-400 text-tiny">
          <button onClick={() => navigate('/reports')} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
            <ChevronLeft size={14} />
            Trung tâm Báo cáo
          </button>
          <ChevronRight size={12} />
          <span className="text-blue-600 font-semibold">Báo cáo Kho hàng theo Giá vốn</span>
        </div>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-gray-800 leading-tight">Báo cáo Kho hàng theo Giá vốn</h1>
            <p className="text-gray-500 text-body-md mt-1">Giá trị vốn tồn kho theo sản phẩm, thương hiệu, nhóm hàng, kho · vòng quay & hàng tồn lâu.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start">
            <div className="w-56">
              <SmartSearchSelect
                options={warehouseOptions}
                value={warehouseFilter}
                onChange={setWarehouseFilter}
                placeholder="Tất cả kho"
                searchPlaceholder="Tìm kho…"
                icon={<Warehouse size={16} />}
              />
            </div>
            <button
              onClick={handleExport}
              disabled={exportDisabled}
              className="h-10 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-[#143C69] active:scale-95 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              Xuất CSV
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <KpiCard icon={<Boxes size={20} />} label="Tổng tồn kho"
            value={summaryQ.isLoading ? '…' : fmtQty(summary?.total_qty ?? 0)}
            sub={summary ? `${summary.lot_count.toLocaleString('vi-VN')} lô đang bán · ${summary.warehouse_count} kho` : ''} />
          <KpiCard icon={<Coins size={20} />} label="Tổng giá trị vốn tồn" highlight
            value={summaryQ.isLoading ? '…' : formatCurrency(summary?.total_value ?? 0)}
            sub="Σ (tồn lô × giá vốn lô) — lô đang bán" />
          <KpiCard icon={<Package size={20} />} label="Sản phẩm có tồn"
            value={summaryQ.isLoading ? '…' : (summary?.product_count ?? 0).toLocaleString('vi-VN')}
            sub={summary && summary.non_active_value > 0 ? `Ngoài ra ${formatCurrency(summary.non_active_value)} ở lô cách ly/hỏng` : 'Chỉ tính lô trạng thái Đang bán'} />
          <KpiCard icon={<CalendarClock size={20} />} label="Giá trị sắp hết hạn ≤ 90 ngày"
            value={summaryQ.isLoading ? '…' : formatCurrency(summary?.expiring_90d_value ?? 0)}
            sub={summary && summary.total_value > 0 ? `${Math.round((summary.expiring_90d_value / summary.total_value) * 100)}% tổng giá trị vốn` : ''} />
        </div>

        {/* Cảnh báo toàn vẹn dữ liệu */}
        {summary && (summary.missing_cost_products > 0 || summary.expired_active_lots > 0) && (
          <div className="flex flex-col gap-2">
            {summary.missing_cost_products > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3.5 flex items-start gap-2.5 text-body-md text-amber-800">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span><b>{summary.missing_cost_products} sản phẩm</b> có lô đang bán nhưng <b>thiếu giá vốn</b> (giá vốn = 0) → tổng giá trị vốn đang bị tính thiếu. Cập nhật giá vốn lô tại trang Kho hàng.</span>
              </div>
            )}
            {summary.expired_active_lots > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-lg p-3.5 flex items-start gap-2.5 text-body-md text-red-700">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span><b>{summary.expired_active_lots} lô đã quá hạn sử dụng</b> nhưng vẫn ở trạng thái Đang bán → cần chuyển trạng thái Hết hạn/Hủy tại trang Kho hàng.</span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-4 text-body-md text-red-700">{errorMsg}</div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <h3 className="text-body-md font-bold text-gray-700 mb-4">Top 10 sản phẩm theo giá trị vốn</h3>
            <div className="h-72">
              {top10Q.isLoading ? (
                <div className="h-full flex items-center justify-center text-gray-300 text-tiny">Đang tải…</div>
              ) : barData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-300 text-tiny">Không có dữ liệu</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v >= 1e9 ? `${(v / 1e9).toLocaleString('vi-VN')}tỷ` : `${Math.round(v / 1e6)}tr`} />
                    <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                    <Bar dataKey="value" fill="#1E5A9C" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
            <h3 className="text-body-md font-bold text-gray-700 mb-4">Cơ cấu giá trị vốn theo nhóm hàng</h3>
            <div className="h-72">
              {categoryQ.isLoading ? (
                <div className="h-full flex items-center justify-center text-gray-300 text-tiny">Đang tải…</div>
              ) : pieData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-300 text-tiny">Không có dữ liệu</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={55} outerRadius={95} paddingAngle={2}
                      label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
                      labelLine={false} fontSize={11}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-gray-150">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-3.5 py-2.5 text-tiny font-semibold flex items-center gap-1.5 border-b-2 -mb-px transition-all ${
                  activeTab === t.id ? 'border-[#1E5A9C] text-[#1E5A9C]' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Bộ lọc tab Sản phẩm */}
        {activeTab === 'product' && (
          <div className="flex flex-wrap gap-3">
            <div className="w-full sm:w-72">
              <SmartSearchSelect
                options={productOptions}
                value={search}
                onChange={setSearch}
                placeholder="Lọc theo sản phẩm (tất cả)"
                searchPlaceholder="Tìm sản phẩm không dấu…"
                icon={<Package size={16} />}
              />
            </div>
            <div className="w-full sm:w-60">
              <SmartSearchSelect
                options={brandOptions}
                value={brandFilter}
                onChange={setBrandFilter}
                placeholder="Tất cả thương hiệu"
                searchPlaceholder="Tìm thương hiệu…"
                icon={<Tag size={16} />}
              />
            </div>
            <div className="w-full sm:w-60">
              <SmartSearchSelect
                options={categoryOptions}
                value={categoryFilter}
                onChange={setCategoryFilter}
                placeholder="Tất cả nhóm hàng"
                searchPlaceholder="Tìm nhóm hàng…"
                icon={<FolderTree size={16} />}
              />
            </div>
          </div>
        )}

        {/* Toggle tab Top tồn */}
        {activeTab === 'top_stock' && (
          <div className="flex bg-gray-100 p-1 rounded-lg self-start">
            {([['qty', 'Theo số lượng'], ['value', 'Theo giá trị vốn']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTopStockBy(k)}
                className={`px-3 py-1.5 rounded-md text-tiny font-semibold transition-all ${
                  topStockBy === k ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Bảng dữ liệu (DataTable chuẩn) */}
        {activeTab === 'product' ? (
          <DataTable<InvProductRow>
            columns={productColumns}
            rows={productRows}
            getRowKey={r => r.product_id}
            loading={productQ.isLoading}
            emptyText="Không có hàng tồn kho phù hợp bộ lọc"
            emptyIcon={<Package size={32} className="mx-auto text-gray-200" />}
            itemLabel="sản phẩm"
            manualPagination
            page={page}
            onPageChange={setPage}
            pageSize={PAGE_SIZE}
            totalItems={totalProducts}
          />
        ) : isProductShaped ? (
          <DataTable<InvProductRow>
            columns={productColumns}
            rows={productRows}
            getRowKey={r => r.product_id}
            loading={productQ.isLoading}
            emptyText="Không có dữ liệu"
            emptyIcon={<Package size={32} className="mx-auto text-gray-200" />}
            itemLabel="sản phẩm"
            pageSize={PAGE_SIZE}
            resetSignal={activeTab + topStockBy + warehouseFilter}
          />
        ) : (
          <DataTable<InvGroupRow>
            columns={groupColumns}
            rows={groupRows}
            getRowKey={r => r.group_id ?? r.group_name}
            loading={groupLoading}
            emptyText="Không có dữ liệu"
            emptyIcon={<Boxes size={32} className="mx-auto text-gray-200" />}
            itemLabel={GROUP_TABS[activeTab] === 'warehouse' ? 'kho' : GROUP_TABS[activeTab] === 'brand' ? 'thương hiệu' : 'nhóm hàng'}
            pageSize={20}
            resetSignal={activeTab + warehouseFilter}
          />
        )}

        {/* Footnote */}
        <p className="text-tiny text-gray-400 leading-relaxed">
          * <b>Giá vốn TB</b> = bình quân gia quyền theo lô: Σ(tồn lô × giá vốn lô) ÷ Σ(tồn lô), chỉ tính lô trạng thái <b>Đang bán</b> còn hàng.
          {' '}<b>Vòng quay 90 ngày</b> = số lượng xuất bán 90 ngày ÷ tồn hiện tại (xấp xỉ — dùng tồn hiện tại thay cho tồn bình quân kỳ).
          {' '}<b>Ngày tồn</b> = tồn hiện tại ÷ tốc độ bán bình quân/ngày (90 ngày gần nhất); "—" nghĩa là chưa phát sinh bán.
          {' '}Dòng <span className="text-amber-700 font-semibold">Thiếu giá vốn</span> là sản phẩm có lô chưa khai giá vốn → giá trị tồn của lô đó đang tính = 0.
        </p>
      </div>
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// KPI card (đồng bộ ProfitReportPage)
// ─────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, highlight }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; highlight?: boolean
}) {
  return (
    <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <div className={`p-2 rounded-lg ${highlight ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>{icon}</div>
      </div>
      <p className="text-tiny text-gray-400 font-medium mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-800 tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-tiny text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}
