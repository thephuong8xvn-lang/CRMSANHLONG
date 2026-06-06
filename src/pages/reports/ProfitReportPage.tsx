import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import {
  ChevronRight, ChevronLeft, TrendingUp, TrendingDown, Wallet,
  Coins, Percent, Download, Calendar, Users, Package, Tag,
  Award, BarChart3, UserCheck, AlertTriangle
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import SmartSearchSelect, { SmartSearchOption } from '../../components/SmartSearchSelect'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TimePreset = 'today' | 'month' | 'year' | 'custom'
type TabId = 'customer' | 'product' | 'brand' | 'top_ratio' | 'top_revenue' | 'top_customers'

interface Summary {
  total_revenue: number
  total_cogs: number
  total_profit: number
  profit_margin: number
  order_count: number
  customer_count: number
  product_count: number
}

interface CustomerRow {
  customer_id: string
  customer_name: string
  customer_code: string | null
  revenue: number
  cogs: number
  profit: number
  margin: number
  order_count: number
}

interface ProductRow {
  product_id: string
  sku: string
  product_name: string
  brand_name: string | null
  qty_sold: number
  revenue: number
  cogs: number
  profit: number
  margin: number
  customer_count: number
}

interface BrandRow {
  brand_id: string | null
  brand_name: string
  qty_sold: number
  revenue: number
  cogs: number
  profit: number
  margin: number
  product_count: number
}

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'customer', label: 'Theo khách hàng', icon: Users },
  { id: 'product', label: 'Theo sản phẩm', icon: Package },
  { id: 'brand', label: 'Theo thương hiệu', icon: Tag },
  { id: 'top_ratio', label: 'Top 100 tỉ lệ lợi nhuận', icon: Award },
  { id: 'top_revenue', label: 'Top 100 doanh số', icon: BarChart3 },
  { id: 'top_customers', label: 'Top 100 nhiều khách mua', icon: UserCheck },
]

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function presetRange(preset: TimePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (preset === 'today') {
    const t = ymd(now)
    return { from: t, to: t }
  }
  if (preset === 'month') {
    return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) }
  }
  if (preset === 'year') {
    return { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(now) }
  }
  return { from: customFrom, to: customTo }
}

// Supabase trả NUMERIC/BIGINT dưới dạng string → ép về number trước khi format
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const marginClass = (m: number) =>
  m >= 30 ? 'bg-emerald-50 text-emerald-700'
  : m >= 0 ? 'bg-amber-50 text-amber-700'
  : 'bg-red-50 text-red-600'

export default function ProfitReportPage() {
  const navigate = useNavigate()
  const { formatCurrency } = useDisplaySettings()

  const [preset, setPreset] = useState<TimePreset>('today')
  const todayStr = new Date().toISOString().slice(0, 10)
  const [customFrom, setCustomFrom] = useState(todayStr)
  const [customTo, setCustomTo] = useState(todayStr)
  const [activeTab, setActiveTab] = useState<TabId>('customer')

  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [rows, setRows] = useState<(CustomerRow | ProductRow | BrandRow)[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Smart-search filters (value passed to RPC as p_search)
  const [customerFilter, setCustomerFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [customerOptions, setCustomerOptions] = useState<SmartSearchOption[]>([])
  const [productOptions, setProductOptions] = useState<SmartSearchOption[]>([])

  const { from, to } = useMemo(() => presetRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  const fromTs = from + 'T00:00:00'
  const toTs = to + 'T23:59:59'

  // ── Load summary KPIs ──
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setErrorMsg(null)
    const { data, error } = await supabase.rpc('fn_profit_summary', { p_from: fromTs, p_to: toTs })
    if (error) {
      setErrorMsg(error.message)
      setSummary(null)
    } else {
      const r = data?.[0]
      setSummary(r ? {
        total_revenue: num(r.total_revenue),
        total_cogs: num(r.total_cogs),
        total_profit: num(r.total_profit),
        profit_margin: num(r.profit_margin),
        order_count: num(r.order_count),
        customer_count: num(r.customer_count),
        product_count: num(r.product_count),
      } : null)
    }
    setSummaryLoading(false)
  }, [fromTs, toTs])

  // ── Load active tab rows ──
  const loadRows = useCallback(async () => {
    setRowsLoading(true)
    setErrorMsg(null)
    let res
    if (activeTab === 'customer') {
      res = await supabase.rpc('fn_profit_by_customer', {
        p_from: fromTs, p_to: toTs, p_search: customerFilter || null, p_sort: 'revenue', p_limit: 200, p_offset: 0,
      })
    } else if (activeTab === 'product') {
      res = await supabase.rpc('fn_profit_by_product', {
        p_from: fromTs, p_to: toTs, p_search: productFilter || null, p_sort: 'revenue', p_limit: 200, p_offset: 0,
      })
    } else if (activeTab === 'brand') {
      res = await supabase.rpc('fn_profit_by_brand', {
        p_from: fromTs, p_to: toTs, p_sort: 'revenue', p_limit: 200, p_offset: 0,
      })
    } else {
      // Top-100 product rankings
      const sort = activeTab === 'top_ratio' ? 'profit_ratio'
        : activeTab === 'top_revenue' ? 'revenue'
        : 'customer_count'
      res = await supabase.rpc('fn_profit_by_product', {
        p_from: fromTs, p_to: toTs, p_search: null, p_sort: sort, p_limit: 100, p_offset: 0,
      })
    }
    if (res.error) {
      setErrorMsg(res.error.message)
      setRows([])
    } else {
      const coerced = (res.data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        revenue: num(r.revenue),
        cogs: num(r.cogs),
        profit: num(r.profit),
        margin: num(r.margin),
        ...(r.qty_sold !== undefined ? { qty_sold: num(r.qty_sold) } : {}),
        ...(r.order_count !== undefined ? { order_count: num(r.order_count) } : {}),
        ...(r.customer_count !== undefined ? { customer_count: num(r.customer_count) } : {}),
        ...(r.product_count !== undefined ? { product_count: num(r.product_count) } : {}),
      }))
      setRows(coerced as (CustomerRow | ProductRow | BrandRow)[])
    }
    setRowsLoading(false)
  }, [activeTab, fromTs, toTs, customerFilter, productFilter])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadRows() }, [loadRows])

  // ── Lazy-load smart-search options (fetchAllRows → không rớt SP/KH 1001+) ──
  useEffect(() => {
    if (activeTab === 'customer' && customerOptions.length === 0) {
      fetchAllRows<{ id: string; code: string | null; farm_name: string }>((f, t) =>
        supabase.from('customers').select('id, code, farm_name')
          .eq('is_active', true)
          .order('farm_name', { ascending: true }).order('id')
          .range(f, t)
      ).then(list => {
        setCustomerOptions([
          { value: '', label: 'Tất cả khách hàng' },
          ...list.map(c => ({ value: c.code || c.farm_name, label: c.farm_name, desc: c.code || undefined })),
        ])
      }).catch(() => {})
    }
    if (activeTab === 'product' && productOptions.length === 0) {
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
    }
  }, [activeTab, customerOptions.length, productOptions.length])

  // ── CSV export ──
  const handleExport = () => {
    let csvRows: Record<string, string | number>[] = []
    let filename = 'bao-cao-loi-nhuan'
    if (activeTab === 'customer') {
      filename = `loi-nhuan-khach-hang_${from}_${to}`
      csvRows = (rows as CustomerRow[]).map(r => ({
        'Mã KH': r.customer_code ?? '', 'Khách hàng': r.customer_name,
        'Số đơn': r.order_count, 'Doanh thu': r.revenue, 'Giá vốn': r.cogs,
        'Lợi nhuận': r.profit, 'Biên LN (%)': r.margin,
      }))
    } else if (activeTab === 'brand') {
      filename = `loi-nhuan-thuong-hieu_${from}_${to}`
      csvRows = (rows as BrandRow[]).map(r => ({
        'Thương hiệu': r.brand_name, 'Số SP': r.product_count, 'SL bán': r.qty_sold,
        'Doanh thu': r.revenue, 'Giá vốn': r.cogs, 'Lợi nhuận': r.profit, 'Biên LN (%)': r.margin,
      }))
    } else {
      filename = `loi-nhuan-san-pham_${activeTab}_${from}_${to}`
      csvRows = (rows as ProductRow[]).map(r => ({
        'SKU': r.sku, 'Sản phẩm': r.product_name, 'Thương hiệu': r.brand_name ?? '',
        'SL bán': r.qty_sold, 'Số khách mua': r.customer_count, 'Doanh thu': r.revenue,
        'Giá vốn': r.cogs, 'Lợi nhuận': r.profit, 'Biên LN (%)': r.margin,
      }))
    }
    const csv = '﻿' + Papa.unparse(csvRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${filename}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const isProductTab = activeTab === 'product' || activeTab === 'top_ratio' || activeTab === 'top_revenue' || activeTab === 'top_customers'

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
          <span className="text-blue-600 font-semibold">Báo cáo lợi nhuận</span>
        </div>

        {/* Header + time presets */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-gray-800 leading-tight">Báo cáo lợi nhuận</h1>
            <p className="text-gray-500 text-body-md mt-1">Lợi nhuận theo khách hàng, sản phẩm, thương hiệu và bảng xếp hạng.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start">
            <div className="flex bg-gray-100 p-1 rounded-lg">
              {([['today', 'Hôm nay'], ['month', 'Tháng này'], ['year', 'Năm nay'], ['custom', 'Tùy chọn']] as const).map(([p, label]) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`px-3 py-1.5 rounded-md text-tiny font-semibold transition-all ${
                    preset === p ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleExport}
              disabled={rowsLoading || rows.length === 0}
              className="h-10 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-[#143C69] active:scale-95 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              Xuất CSV
            </button>
          </div>
        </div>

        {/* Custom date range */}
        {preset === 'custom' && (
          <div className="bg-white border border-gray-150 rounded-xl p-4 flex flex-wrap items-center gap-3 shadow-sm">
            <span className="text-tiny text-gray-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Calendar size={12} /> Khoảng thời gian
            </span>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="h-9 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <span className="text-gray-400">—</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="h-9 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <KpiCard icon={<Wallet size={20} />} label="Tổng doanh thu"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_revenue ?? 0)}
            sub={summary ? `${summary.order_count.toLocaleString('vi-VN')} đơn` : ''} />
          <KpiCard icon={<Coins size={20} />} label="Tổng giá vốn"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_cogs ?? 0)}
            sub={summary ? `${summary.product_count.toLocaleString('vi-VN')} sản phẩm` : ''} />
          <KpiCard icon={<TrendingUp size={20} />} label="Tổng lợi nhuận gộp"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_profit ?? 0)}
            sub={summary ? `${summary.customer_count.toLocaleString('vi-VN')} khách hàng` : ''}
            highlight={(summary?.total_profit ?? 0) >= 0} />
          <KpiCard icon={<Percent size={20} />} label="Biên lợi nhuận gộp"
            value={summaryLoading ? '…' : `${(summary?.profit_margin ?? 0).toLocaleString('vi-VN')}%`}
            sub="(doanh thu − giá vốn) / doanh thu" />
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-gray-150">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => { setActiveTab(t.id); setRows([]); setRowsLoading(true) }}
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

        {/* Smart search filters */}
        {activeTab === 'customer' && (
          <div className="max-w-md">
            <SmartSearchSelect
              options={customerOptions}
              value={customerFilter}
              onChange={setCustomerFilter}
              placeholder="Lọc theo khách hàng (tất cả)"
              searchPlaceholder="Tìm khách hàng không dấu…"
              icon={<Users size={16} />}
            />
          </div>
        )}
        {activeTab === 'product' && (
          <div className="max-w-md">
            <SmartSearchSelect
              options={productOptions}
              value={productFilter}
              onChange={setProductFilter}
              placeholder="Lọc theo sản phẩm (tất cả)"
              searchPlaceholder="Tìm sản phẩm không dấu…"
              icon={<Package size={16} />}
            />
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-4 text-body-md text-red-700">
            {errorMsg}
          </div>
        )}

        {/* Data table */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-tiny text-gray-400 font-bold uppercase tracking-wider">
                <th className="px-5 py-3 w-10">#</th>
                {activeTab === 'customer' && <th className="px-5 py-3">Khách hàng</th>}
                {activeTab === 'brand' && <th className="px-5 py-3">Thương hiệu</th>}
                {isProductTab && <th className="px-5 py-3">Sản phẩm</th>}
                {activeTab === 'customer' && <th className="px-5 py-3 text-right">Số đơn</th>}
                {(isProductTab || activeTab === 'brand') && <th className="px-5 py-3 text-right">SL bán</th>}
                {isProductTab && <th className="px-5 py-3 text-right">Số khách</th>}
                {activeTab === 'brand' && <th className="px-5 py-3 text-right">Số SP</th>}
                <th className="px-5 py-3 text-right">Doanh thu</th>
                <th className="px-5 py-3 text-right">Giá vốn</th>
                <th className="px-5 py-3 text-right">Lợi nhuận</th>
                <th className="px-5 py-3 text-right">Biên LN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rowsLoading ? (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-gray-400 text-tiny">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                    Đang tải dữ liệu…
                  </div>
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-5 py-12 text-center text-gray-400 text-body-md">
                  Không có dữ liệu trong khoảng thời gian này
                </td></tr>
              ) : rows.map((r, i) => {
                const margin = (r as CustomerRow).margin
                // Có doanh thu nhưng giá vốn = 0 → SP chưa có nguồn giá vốn (chưa nhập kho/chưa set giá vốn ở bảng giá).
                // Biên LN 100% ở đây KHÔNG phải lãi thật → cảnh báo để khỏi hiểu nhầm.
                const noCost = num(r.cogs) === 0 && num(r.revenue) > 0
                return (
                  <tr key={i} className="hover:bg-gray-25 transition-colors text-body-md">
                    <td className="px-5 py-3 text-gray-400 tabular-nums">{i + 1}</td>

                    {activeTab === 'customer' && (
                      <td className="px-5 py-3">
                        <div className="font-semibold text-gray-800">{(r as CustomerRow).customer_name}</div>
                        {(r as CustomerRow).customer_code && (
                          <div className="text-tiny text-gray-400">{(r as CustomerRow).customer_code}</div>
                        )}
                      </td>
                    )}
                    {activeTab === 'brand' && (
                      <td className="px-5 py-3 font-semibold text-gray-800">{(r as BrandRow).brand_name}</td>
                    )}
                    {isProductTab && (
                      <td className="px-5 py-3">
                        <div className="font-semibold text-gray-800">{(r as ProductRow).product_name}</div>
                        <div className="text-tiny text-gray-400">
                          {(r as ProductRow).sku}{(r as ProductRow).brand_name ? ` · ${(r as ProductRow).brand_name}` : ''}
                        </div>
                      </td>
                    )}

                    {activeTab === 'customer' && (
                      <td className="px-5 py-3 text-right tabular-nums text-gray-600">{num((r as CustomerRow).order_count).toLocaleString('vi-VN')}</td>
                    )}
                    {(isProductTab || activeTab === 'brand') && (
                      <td className="px-5 py-3 text-right tabular-nums text-gray-600">{num((r as ProductRow).qty_sold).toLocaleString('vi-VN')}</td>
                    )}
                    {isProductTab && (
                      <td className="px-5 py-3 text-right tabular-nums text-gray-600">{num((r as ProductRow).customer_count).toLocaleString('vi-VN')}</td>
                    )}
                    {activeTab === 'brand' && (
                      <td className="px-5 py-3 text-right tabular-nums text-gray-600">{num((r as BrandRow).product_count).toLocaleString('vi-VN')}</td>
                    )}

                    <td className="px-5 py-3 text-right tabular-nums text-gray-700">{formatCurrency(r.revenue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {noCost
                        ? <span className="text-amber-600 font-semibold text-tiny">Chưa có giá vốn</span>
                        : <span className="text-gray-500">{formatCurrency(r.cogs)}</span>}
                    </td>
                    <td className={`px-5 py-3 text-right tabular-nums font-bold ${noCost ? 'text-amber-600' : r.profit >= 0 ? 'text-[#143C69]' : 'text-red-600'}`}>
                      {formatCurrency(r.profit)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {noCost ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold bg-amber-50 text-amber-700" title="Sản phẩm chưa có giá vốn (chưa nhập kho hoặc chưa khai giá vốn ở bảng giá) — biên lợi nhuận chưa phản ánh đúng">
                          <AlertTriangle size={11} />
                          Thiếu giá vốn
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold tabular-nums ${marginClass(margin)}`}>
                          {margin >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {Number(margin).toLocaleString('vi-VN')}%
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footnote */}
        <p className="text-tiny text-gray-400 leading-relaxed">
          * Doanh thu tính ở cấp dòng đơn (đơn giá − chiết khấu)×số lượng, chưa gồm chiết khấu cấp hóa đơn & phí vận chuyển.
          Giá vốn lấy theo lô hàng đã phân bổ (FEFO); sản phẩm/không quản lô lấy giá vốn tham chiếu. Chỉ tính đơn đã xác nhận trở lên.
          {' '}Dòng <span className="text-amber-700 font-semibold">Thiếu giá vốn</span> là sản phẩm đã bán nhưng chưa từng nhập kho (không có lô) và chưa khai giá vốn ở bảng giá → biên 100% là do thiếu dữ liệu, không phải lãi thật. Hãy nhập kho có giá hoặc khai giá vốn cho các sản phẩm này.
        </p>
      </div>
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// KPI card
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
