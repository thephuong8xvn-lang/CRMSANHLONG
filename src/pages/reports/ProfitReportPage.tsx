import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  ChevronRight, ChevronLeft, TrendingUp, TrendingDown, Wallet,
  Coins, Percent, Download, Calendar, Users, Package, Tag,
  Award, BarChart3, UserCheck, AlertTriangle, Building2, Scissors,
  Undo2, Minus, Layers, UserCog,
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import SmartSearchSelect, { SmartSearchOption } from '../../components/SmartSearchSelect'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useBranches } from '../../hooks/queries/useBranches'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TimePreset = 'today' | 'month' | 'year' | 'custom'
type TabId = 'branch' | 'customer' | 'product' | 'brand' | 'top_ratio' | 'top_revenue' | 'top_customers'
type Compare = 'none' | 'prev' | 'yoy'
type Bucket = 'day' | 'week' | 'month'
type BreakDim = 'product' | 'customer' | 'brand' | 'category' | 'salesperson'

interface Summary {
  total_revenue: number
  total_invoice_discount: number
  total_returns: number
  total_revenue_net: number
  total_cogs: number
  total_cogs_net: number
  total_profit: number
  profit_margin: number
  total_profit_net: number
  profit_margin_net: number
  order_count: number
  customer_count: number
  product_count: number
  branch_count: number
}

/** Các cột tiền/biên dùng chung cho mọi dòng báo cáo. */
interface NetFields {
  revenue: number
  invoice_discount: number
  return_amount: number
  revenue_net: number
  cogs: number
  cogs_net: number
  profit: number
  margin: number
  profit_net: number
  margin_net: number
}

interface CustomerRow extends NetFields {
  customer_id: string
  customer_name: string
  customer_code: string | null
  order_count: number
}

interface ProductRow extends NetFields {
  product_id: string
  sku: string
  product_name: string
  brand_name: string | null
  qty_sold: number
  qty_returned: number
  customer_count: number
}

interface BrandRow extends NetFields {
  brand_id: string | null
  brand_name: string
  qty_sold: number
  product_count: number
}

interface BranchRow extends NetFields {
  branch_id: string | null
  branch_code: string | null
  branch_name: string
  qty_sold: number
  order_count: number
  customer_count: number
  product_count: number
  line_count: number
  aov: number
  profit_per_order: number
  revenue_share: number
  profit_share: number
  prev_revenue_net: number
  prev_profit_net: number
  prev_order_count: number
  revenue_growth: number | null
  profit_growth: number | null
}

interface TrendRow {
  bucket_start: string
  revenue: number
  revenue_net: number
  cogs_net: number
  profit_net: number
  margin_net: number
  qty_sold: number
  order_count: number
}

interface BreakdownRow {
  dim_key: string
  dim_label: string
  dim_sub: string | null
  revenue: number
  revenue_net: number
  cogs_net: number
  profit_net: number
  margin_net: number
  qty_sold: number
  order_count: number
  customer_count: number
  revenue_share: number
}

type ProfitRow = CustomerRow | ProductRow | BrandRow | BranchRow

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'branch', label: 'Theo chi nhánh', icon: Building2 },
  { id: 'customer', label: 'Theo khách hàng', icon: Users },
  { id: 'product', label: 'Theo sản phẩm', icon: Package },
  { id: 'brand', label: 'Theo thương hiệu', icon: Tag },
  { id: 'top_ratio', label: 'Top 100 tỉ lệ lợi nhuận', icon: Award },
  { id: 'top_revenue', label: 'Top 100 doanh số', icon: BarChart3 },
  { id: 'top_customers', label: 'Top 100 nhiều khách mua', icon: UserCheck },
]

const BREAK_DIMS: { id: BreakDim; label: string; icon: typeof Users }[] = [
  { id: 'product', label: 'Sản phẩm', icon: Package },
  { id: 'customer', label: 'Khách hàng', icon: Users },
  { id: 'brand', label: 'Thương hiệu', icon: Tag },
  { id: 'category', label: 'Nhóm hàng', icon: Layers },
  { id: 'salesperson', label: 'Nhân viên', icon: UserCog },
]

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function presetRange(preset: TimePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date()
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
/** Giữ nguyên null (vd tăng trưởng khi kỳ trước = 0) thay vì biến thành 0 gây hiểu nhầm. */
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v))

/** Mọi cột số trả về từ RPC — ép kiểu tập trung một chỗ. */
const NUMERIC_KEYS = [
  'revenue', 'invoice_discount', 'return_amount', 'revenue_net', 'cogs', 'cogs_net',
  'profit', 'margin', 'profit_net', 'margin_net', 'qty_sold', 'qty_returned',
  'order_count', 'customer_count', 'product_count', 'line_count',
  'aov', 'profit_per_order', 'revenue_share', 'profit_share',
  'prev_revenue_net', 'prev_profit_net', 'prev_order_count',
] as const
const NULLABLE_KEYS = ['revenue_growth', 'profit_growth'] as const

function coerceRow(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r }
  for (const k of NUMERIC_KEYS) if (k in r) out[k] = num(r[k])
  for (const k of NULLABLE_KEYS) if (k in r) out[k] = numOrNull(r[k])
  return out
}

const marginClass = (m: number) =>
  m >= 30 ? 'bg-emerald-50 text-emerald-700'
  : m >= 0 ? 'bg-amber-50 text-amber-700'
  : 'bg-red-50 text-red-600'

const fmtPct = (v: number | null, digits = 1) =>
  v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toLocaleString('vi-VN', { maximumFractionDigits: digits })}%`

const fmtQty = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 3 })

/** Bước thời gian mặc định cho biểu đồ xu hướng theo độ dài kỳ. */
function defaultBucket(from: string, to: string): Bucket {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000
  if (days <= 62) return 'day'
  if (days <= 400) return 'week'
  return 'month'
}

export default function ProfitReportPage() {
  const navigate = useNavigate()
  const { formatCurrency } = useDisplaySettings()

  const [preset, setPreset] = useState<TimePreset>('today')
  const todayStr = ymd(new Date())
  const [customFrom, setCustomFrom] = useState(todayStr)
  const [customTo, setCustomTo] = useState(todayStr)
  const [activeTab, setActiveTab] = useState<TabId>('branch')
  const [compare, setCompare] = useState<Compare>('prev')

  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [rows, setRows] = useState<ProfitRow[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Smart-search filters (value passed to RPC as p_search)
  const [customerFilter, setCustomerFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')   // uuid chi nhánh (rỗng = tất cả)
  const [customerOptions, setCustomerOptions] = useState<SmartSearchOption[]>([])
  const [productOptions, setProductOptions] = useState<SmartSearchOption[]>([])

  const branchesQ = useBranches()
  const branchOptions: SmartSearchOption[] = useMemo(() => [
    { value: '', label: 'Tất cả chi nhánh' },
    ...(branchesQ.data ?? []).map(b => ({ value: b.id, label: b.name, desc: b.code })),
  ], [branchesQ.data])

  const { from, to } = useMemo(() => presetRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  // Mốc giờ gắn offset VN (+07:00) — nếu gửi chuỗi trần, Postgres hiểu là UTC
  // và "Hôm nay" sẽ rụng toàn bộ đơn bán từ 00:00–07:00 giờ Việt Nam.
  const fromTs = from + 'T00:00:00+07:00'
  const toTs = to + 'T23:59:59+07:00'

  // Chi nhánh áp cho các tab KH/SP/thương hiệu/Top (tab "Theo chi nhánh" luôn liệt kê hết)
  const branchParam = activeTab === 'branch' ? null : (branchFilter || null)

  // ── Load summary KPIs ──
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setErrorMsg(null)
    const { data, error } = await supabase.rpc('fn_profit_summary', {
      p_from: fromTs, p_to: toTs, p_branch_id: branchParam,
    })
    if (error) {
      setErrorMsg(error.message)
      setSummary(null)
    } else {
      const r = data?.[0]
      setSummary(r ? {
        total_revenue: num(r.total_revenue),
        total_invoice_discount: num(r.total_invoice_discount),
        total_returns: num(r.total_returns),
        total_revenue_net: num(r.total_revenue_net),
        total_cogs: num(r.total_cogs),
        total_cogs_net: num(r.total_cogs_net),
        total_profit: num(r.total_profit),
        profit_margin: num(r.profit_margin),
        total_profit_net: num(r.total_profit_net),
        profit_margin_net: num(r.profit_margin_net),
        order_count: num(r.order_count),
        customer_count: num(r.customer_count),
        product_count: num(r.product_count),
        branch_count: num(r.branch_count),
      } : null)
    }
    setSummaryLoading(false)
  }, [fromTs, toTs, branchParam])

  // ── Load active tab rows ──
  const loadRows = useCallback(async () => {
    setRowsLoading(true)
    setErrorMsg(null)
    let res
    if (activeTab === 'branch') {
      res = await supabase.rpc('fn_profit_branch_summary', {
        p_from: fromTs, p_to: toTs, p_compare: compare, p_sort: 'revenue',
      })
    } else if (activeTab === 'customer') {
      res = await supabase.rpc('fn_profit_by_customer', {
        p_from: fromTs, p_to: toTs, p_search: customerFilter || null, p_sort: 'revenue',
        p_limit: 200, p_offset: 0, p_branch_id: branchParam,
      })
    } else if (activeTab === 'product') {
      res = await supabase.rpc('fn_profit_by_product', {
        p_from: fromTs, p_to: toTs, p_search: productFilter || null, p_sort: 'revenue',
        p_limit: 200, p_offset: 0, p_branch_id: branchParam,
      })
    } else if (activeTab === 'brand') {
      res = await supabase.rpc('fn_profit_by_brand', {
        p_from: fromTs, p_to: toTs, p_sort: 'revenue', p_limit: 200, p_offset: 0,
        p_branch_id: branchParam,
      })
    } else {
      // Top-100 product rankings
      const sort = activeTab === 'top_ratio' ? 'profit_ratio'
        : activeTab === 'top_revenue' ? 'revenue'
        : 'customer_count'
      res = await supabase.rpc('fn_profit_by_product', {
        p_from: fromTs, p_to: toTs, p_search: null, p_sort: sort,
        p_limit: 100, p_offset: 0, p_branch_id: branchParam,
      })
    }
    if (res.error) {
      setErrorMsg(res.error.message)
      setRows([])
    } else {
      setRows((res.data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as ProfitRow[])
    }
    setRowsLoading(false)
  }, [activeTab, fromTs, toTs, customerFilter, productFilter, branchParam, compare])

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
    if (activeTab === 'branch') {
      filename = `loi-nhuan-chi-nhanh_${from}_${to}`
      csvRows = (rows as BranchRow[]).map(r => ({
        'Mã CN': r.branch_code ?? '', 'Chi nhánh': r.branch_name,
        'Số đơn': r.order_count, 'Số khách': r.customer_count, 'Số SP': r.product_count,
        'SL bán': r.qty_sold,
        'Doanh thu gộp': r.revenue, 'CK hóa đơn': r.invoice_discount, 'Hàng trả': r.return_amount,
        'Doanh thu thuần': r.revenue_net, 'Giá vốn thuần': r.cogs_net,
        'Lợi nhuận thuần': r.profit_net, 'Biên thuần (%)': r.margin_net,
        'Lợi nhuận gộp (chưa trừ)': r.profit, 'Biên gộp (%)': r.margin,
        'Giá trị TB/đơn': r.aov, 'Lợi nhuận/đơn': r.profit_per_order,
        '% đóng góp DT': r.revenue_share, '% đóng góp LN': r.profit_share,
        'DT thuần kỳ so sánh': r.prev_revenue_net, 'LN thuần kỳ so sánh': r.prev_profit_net,
        'Tăng trưởng DT (%)': r.revenue_growth ?? '', 'Tăng trưởng LN (%)': r.profit_growth ?? '',
      }))
    } else if (activeTab === 'customer') {
      filename = `loi-nhuan-khach-hang_${from}_${to}`
      csvRows = (rows as CustomerRow[]).map(r => ({
        'Mã KH': r.customer_code ?? '', 'Khách hàng': r.customer_name,
        'Số đơn': r.order_count,
        'Doanh thu gộp': r.revenue, 'CK hóa đơn': r.invoice_discount, 'Hàng trả': r.return_amount,
        'Doanh thu thuần': r.revenue_net, 'Giá vốn thuần': r.cogs_net,
        'Lợi nhuận thuần': r.profit_net, 'Biên thuần (%)': r.margin_net,
      }))
    } else if (activeTab === 'brand') {
      filename = `loi-nhuan-thuong-hieu_${from}_${to}`
      csvRows = (rows as BrandRow[]).map(r => ({
        'Thương hiệu': r.brand_name, 'Số SP': r.product_count, 'SL bán': r.qty_sold,
        'Doanh thu gộp': r.revenue, 'CK hóa đơn': r.invoice_discount, 'Hàng trả': r.return_amount,
        'Doanh thu thuần': r.revenue_net, 'Giá vốn thuần': r.cogs_net,
        'Lợi nhuận thuần': r.profit_net, 'Biên thuần (%)': r.margin_net,
      }))
    } else {
      filename = `loi-nhuan-san-pham_${activeTab}_${from}_${to}`
      csvRows = (rows as ProductRow[]).map(r => ({
        'SKU': r.sku, 'Sản phẩm': r.product_name, 'Thương hiệu': r.brand_name ?? '',
        'SL bán': r.qty_sold, 'SL trả': r.qty_returned, 'Số khách mua': r.customer_count,
        'Doanh thu gộp': r.revenue, 'CK hóa đơn': r.invoice_discount, 'Hàng trả': r.return_amount,
        'Doanh thu thuần': r.revenue_net, 'Giá vốn thuần': r.cogs_net,
        'Lợi nhuận thuần': r.profit_net, 'Biên thuần (%)': r.margin_net,
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
  const isBranchTab = activeTab === 'branch'

  // ── Cột báo cáo (động theo tab) ──
  const profitColumns: DataTableColumn<ProfitRow>[] = []
  profitColumns.push({
    key: 'name', flex: true, minWidth: 170, noTruncate: true,
    header: isBranchTab ? 'Chi nhánh' : activeTab === 'customer' ? 'Khách hàng' : activeTab === 'brand' ? 'Thương hiệu' : 'Sản phẩm',
    render: (r) => {
      if (isBranchTab) {
        const b = r as BranchRow
        return (
          <div className="min-w-0">
            <div className="font-semibold text-gray-800 truncate">{b.branch_name}</div>
            <div className="text-tiny text-gray-400">
              {b.branch_code ? `${b.branch_code} · ` : ''}{b.customer_count.toLocaleString('vi-VN')} khách · {b.product_count.toLocaleString('vi-VN')} SP
            </div>
          </div>
        )
      }
      if (activeTab === 'customer') return (
        <div className="min-w-0">
          <div className="font-semibold text-gray-800 truncate">{(r as CustomerRow).customer_name}</div>
          {(r as CustomerRow).customer_code && <div className="text-tiny text-gray-400">{(r as CustomerRow).customer_code}</div>}
        </div>
      )
      if (activeTab === 'brand') return <span className="font-semibold text-gray-800">{(r as BrandRow).brand_name}</span>
      return (
        <div className="min-w-0">
          <div className="font-semibold text-gray-800 truncate">{(r as ProductRow).product_name}</div>
          <div className="text-tiny text-gray-400 truncate">{(r as ProductRow).sku}{(r as ProductRow).brand_name ? ` · ${(r as ProductRow).brand_name}` : ''}</div>
        </div>
      )
    },
  })
  if (activeTab === 'customer' || isBranchTab) profitColumns.push({
    key: 'orders', header: 'Số đơn', width: 80, align: 'right',
    render: (r) => <span className="tabular-nums text-gray-600">{num((r as CustomerRow).order_count).toLocaleString('vi-VN')}</span>,
  })
  if (isProductTab || activeTab === 'brand') profitColumns.push({
    key: 'qty', header: 'SL bán', width: 90, align: 'right',
    render: (r) => <span className="tabular-nums text-gray-600">{fmtQty(num((r as ProductRow).qty_sold))}</span>,
  })
  if (isProductTab) profitColumns.push({
    key: 'custcount', header: 'Số khách', width: 85, align: 'right',
    render: (r) => <span className="tabular-nums text-gray-600">{num((r as ProductRow).customer_count).toLocaleString('vi-VN')}</span>,
  })
  if (activeTab === 'brand') profitColumns.push({
    key: 'prodcount', header: 'Số SP', width: 80, align: 'right',
    render: (r) => <span className="tabular-nums text-gray-600">{num((r as BrandRow).product_count).toLocaleString('vi-VN')}</span>,
  })
  profitColumns.push({
    key: 'revenue_net', header: 'DT thuần', width: 125, align: 'right',
    render: (r) => (
      <div className="leading-tight">
        <div className="tabular-nums text-gray-700 font-semibold">{formatCurrency(r.revenue_net)}</div>
        {(r.invoice_discount > 0 || r.return_amount > 0) && (
          <div className="text-tiny text-gray-400 tabular-nums">gộp {formatCurrency(r.revenue)}</div>
        )}
      </div>
    ),
  })
  profitColumns.push({
    key: 'cogs', header: 'Giá vốn', width: 120, align: 'right',
    render: (r) => (num(r.cogs_net) === 0 && num(r.revenue_net) > 0)
      ? <span className="text-amber-600 font-semibold text-tiny">Chưa có giá vốn</span>
      : <span className="text-gray-500 tabular-nums">{formatCurrency(r.cogs_net)}</span>,
  })
  profitColumns.push({
    key: 'profit', header: 'Lợi nhuận', width: 125, align: 'right',
    render: (r) => {
      const noCost = num(r.cogs_net) === 0 && num(r.revenue_net) > 0
      return <span className={`tabular-nums font-bold ${noCost ? 'text-amber-600' : r.profit_net >= 0 ? 'text-[#143C69]' : 'text-red-600'}`}>{formatCurrency(r.profit_net)}</span>
    },
  })
  profitColumns.push({
    key: 'margin', header: 'Biên LN', width: 115, align: 'right', noTruncate: true, mobileHeaderRight: true,
    render: (r) => {
      const noCost = num(r.cogs_net) === 0 && num(r.revenue_net) > 0
      return noCost
        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold bg-amber-50 text-amber-700"><AlertTriangle size={11} />Thiếu giá vốn</span>
        : <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold tabular-nums ${marginClass(r.margin_net)}`}>{r.margin_net >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{r.margin_net.toLocaleString('vi-VN')}%</span>
    },
  })
  if (isBranchTab) {
    profitColumns.push({
      key: 'share', header: 'Đóng góp', width: 95, align: 'right', noTruncate: true,
      render: (r) => {
        const b = r as BranchRow
        return (
          <div className="leading-tight">
            <div className="tabular-nums text-gray-700 font-semibold">{b.revenue_share.toLocaleString('vi-VN')}%</div>
            <div className="text-tiny text-gray-400 tabular-nums">LN {b.profit_share.toLocaleString('vi-VN')}%</div>
          </div>
        )
      },
    })
    if (compare !== 'none') profitColumns.push({
      key: 'growth', header: compare === 'yoy' ? 'So cùng kỳ' : 'So kỳ trước', width: 110, align: 'right', noTruncate: true,
      render: (r) => {
        const b = r as BranchRow
        const g = b.revenue_growth
        const cls = g === null ? 'text-gray-400' : g >= 0 ? 'text-emerald-600' : 'text-red-600'
        return (
          <div className="leading-tight">
            <div className={`tabular-nums font-semibold ${cls}`}>{fmtPct(g)}</div>
            <div className="text-tiny text-gray-400 tabular-nums">LN {fmtPct(b.profit_growth)}</div>
          </div>
        )
      },
    })
  }

  const profitRowKey = (r: ProfitRow) =>
    'branch_name' in r ? `br-${r.branch_id ?? 'none'}`
    : (r as ProductRow).sku || (r as CustomerRow).customer_code || (r as BrandRow).brand_name ||
      (r as CustomerRow).customer_name || (r as ProductRow).product_name || JSON.stringify(r)

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
            <p className="text-gray-500 text-body-md mt-1">Lợi nhuận theo chi nhánh, khách hàng, sản phẩm, thương hiệu và bảng xếp hạng.</p>
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
          <KpiCard icon={<Wallet size={20} />} label="Doanh thu thuần"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_revenue_net ?? 0)}
            sub={summary ? `${summary.order_count.toLocaleString('vi-VN')} đơn · gộp ${formatCurrency(summary.total_revenue)}` : ''} />
          <KpiCard icon={<Coins size={20} />} label="Giá vốn thuần"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_cogs_net ?? 0)}
            sub={summary ? `${summary.product_count.toLocaleString('vi-VN')} sản phẩm` : ''} />
          <KpiCard icon={<TrendingUp size={20} />} label="Lợi nhuận gộp"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_profit_net ?? 0)}
            sub={summary ? `${summary.customer_count.toLocaleString('vi-VN')} khách · ${summary.branch_count.toLocaleString('vi-VN')} chi nhánh` : ''}
            highlight={(summary?.total_profit_net ?? 0) >= 0} />
          <KpiCard icon={<Percent size={20} />} label="Biên lợi nhuận gộp"
            value={summaryLoading ? '…' : `${(summary?.profit_margin_net ?? 0).toLocaleString('vi-VN')}%`}
            sub="(DT thuần − giá vốn thuần) / DT thuần" />
        </div>

        {/* Đối chiếu DT gộp → DT thuần */}
        {summary && !summaryLoading && (
          <div className="bg-white border border-gray-150 rounded-xl px-5 py-4 shadow-sm flex flex-wrap items-center gap-x-3 gap-y-2 text-body-md">
            <ReconItem icon={<Wallet size={14} />} label="Doanh thu gộp" value={formatCurrency(summary.total_revenue)} />
            <Minus size={14} className="text-gray-300" />
            <ReconItem icon={<Scissors size={14} />} label="Chiết khấu hóa đơn" value={formatCurrency(summary.total_invoice_discount)} tone="amber" />
            <Minus size={14} className="text-gray-300" />
            <ReconItem icon={<Undo2 size={14} />} label="Hàng trả lại" value={formatCurrency(summary.total_returns)} tone="amber" />
            <span className="text-gray-300 font-bold">=</span>
            <ReconItem icon={<Wallet size={14} />} label="Doanh thu thuần" value={formatCurrency(summary.total_revenue_net)} tone="blue" />
            <span className="text-tiny text-gray-400 ml-auto">
              Biên gộp trước khi trừ: {summary.profit_margin.toLocaleString('vi-VN')}%
            </span>
          </div>
        )}

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

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {!isBranchTab && (
            <div className="w-full sm:w-56">
              <SmartSearchSelect
                options={branchOptions}
                value={branchFilter}
                onChange={setBranchFilter}
                placeholder="Tất cả chi nhánh"
                searchPlaceholder="Tìm chi nhánh…"
                icon={<Building2 size={16} />}
              />
            </div>
          )}
          {activeTab === 'customer' && (
            <div className="w-full sm:w-80">
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
            <div className="w-full sm:w-80">
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
          {isBranchTab && (
            <div className="flex items-center gap-2">
              <span className="text-tiny text-gray-400 uppercase font-bold tracking-wider">So sánh</span>
              <div className="flex bg-gray-100 p-1 rounded-lg">
                {([['none', 'Không'], ['prev', 'Kỳ trước'], ['yoy', 'Cùng kỳ năm ngoái']] as const).map(([c, label]) => (
                  <button
                    key={c}
                    onClick={() => setCompare(c)}
                    className={`px-3 py-1.5 rounded-md text-tiny font-semibold transition-all ${
                      compare === c ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-4 text-body-md text-red-700">
            {errorMsg}
          </div>
        )}

        {/* Data table */}
        <DataTable
          rows={rows}
          columns={profitColumns}
          getRowKey={profitRowKey}
          loading={rowsLoading}
          pageSize={0}
          emptyText="Không có dữ liệu trong khoảng thời gian này"
          resetSignal={`${activeTab}|${fromTs}|${toTs}|${branchFilter}`}
          expandedRowRender={isBranchTab
            ? (row) => <BranchDetailPanel row={row as BranchRow} fromTs={fromTs} toTs={toTs} formatCurrency={formatCurrency} from={from} to={to} />
            : undefined}
        />

        {/* Footnote */}
        <p className="text-tiny text-gray-400 leading-relaxed">
          * <b>Doanh thu gộp</b> tính ở cấp dòng đơn (đơn giá − chiết khấu dòng)×số lượng.
          {' '}<b>Doanh thu thuần</b> = gộp − chiết khấu cấp hóa đơn (phân bổ về từng dòng theo tỉ trọng doanh thu) − giá trị hàng trả lại (phiếu trả đã hoàn tất).
          Phí vận chuyển không tính vào doanh thu. Hàng trả được quy về ngày của đơn gốc, nên một phiếu trả hoàn tất hôm nay sẽ làm giảm doanh thu của kỳ đã bán.
          {' '}Giá vốn lấy theo lô hàng đã phân bổ (FEFO); sản phẩm/không quản lô lấy giá vốn tham chiếu. Chỉ tính đơn đã xác nhận trở lên. Ranh giới ngày theo giờ Việt Nam.
          {' '}Dòng <span className="text-amber-700 font-semibold">Thiếu giá vốn</span> là sản phẩm đã bán nhưng chưa từng nhập kho (không có lô) và chưa khai giá vốn ở bảng giá → biên 100% là do thiếu dữ liệu, không phải lãi thật.
          {' '}Đơn không gắn chi nhánh gom vào dòng <b>(Không chi nhánh)</b> — cần rà lại khâu nhập liệu, không phải doanh thu bị mất.
        </p>
      </div>
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// Panel chi tiết 1 chi nhánh (mở khi bấm vào dòng)
// ─────────────────────────────────────────────────────────────
function BranchDetailPanel({ row, fromTs, toTs, from, to, formatCurrency }: {
  row: BranchRow
  fromTs: string
  toTs: string
  from: string
  to: string
  formatCurrency: (n: number) => string
}) {
  const [bucket, setBucket] = useState<Bucket>(() => defaultBucket(from, to))
  const [dim, setDim] = useState<BreakDim>('product')
  const [trend, setTrend] = useState<TrendRow[]>([])
  const [trendLoading, setTrendLoading] = useState(true)
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([])
  const [breakdownLoading, setBreakdownLoading] = useState(true)
  const [detailError, setDetailError] = useState<string | null>(null)

  const unassigned = row.branch_id === null

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setTrendLoading(true)
      const { data, error } = await supabase.rpc('fn_profit_branch_trend', {
        p_from: fromTs, p_to: toTs, p_branch_id: row.branch_id,
        p_bucket: bucket, p_unassigned: unassigned,
      })
      if (cancelled) return
      if (error) { setDetailError(error.message); setTrend([]) }
      else setTrend((data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as unknown as TrendRow[])
      setTrendLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [fromTs, toTs, row.branch_id, bucket, unassigned])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setBreakdownLoading(true)
      const { data, error } = await supabase.rpc('fn_profit_branch_breakdown', {
        p_from: fromTs, p_to: toTs, p_branch_id: row.branch_id,
        p_dim: dim, p_sort: 'revenue', p_limit: 20, p_unassigned: unassigned,
      })
      if (cancelled) return
      if (error) { setDetailError(error.message); setBreakdown([]) }
      else setBreakdown((data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as unknown as BreakdownRow[])
      setBreakdownLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [fromTs, toTs, row.branch_id, dim, unassigned])

  const chartData = useMemo(() => trend.map(t => ({
    label: bucket === 'month'
      ? t.bucket_start.slice(0, 7).split('-').reverse().join('/')
      : t.bucket_start.slice(5).split('-').reverse().join('/'),
    'Doanh thu thuần': t.revenue_net,
    'Lợi nhuận gộp': t.profit_net,
  })), [trend, bucket])

  const breakdownColumns: DataTableColumn<BreakdownRow>[] = [
    {
      key: 'label', header: BREAK_DIMS.find(d => d.id === dim)?.label ?? '', flex: true, minWidth: 160, noTruncate: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-gray-800 truncate">{r.dim_label}</div>
          {r.dim_sub && <div className="text-tiny text-gray-400 truncate">{r.dim_sub}</div>}
        </div>
      ),
    },
    { key: 'qty', header: 'SL', width: 80, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{fmtQty(r.qty_sold)}</span> },
    { key: 'orders', header: 'Số đơn', width: 75, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{r.order_count.toLocaleString('vi-VN')}</span> },
    { key: 'rev', header: 'DT thuần', width: 120, align: 'right', render: (r) => <span className="tabular-nums text-gray-700 font-semibold">{formatCurrency(r.revenue_net)}</span> },
    { key: 'profit', header: 'Lợi nhuận', width: 120, align: 'right', render: (r) => <span className={`tabular-nums font-bold ${r.profit_net >= 0 ? 'text-[#143C69]' : 'text-red-600'}`}>{formatCurrency(r.profit_net)}</span> },
    {
      key: 'margin', header: 'Biên', width: 85, align: 'right', noTruncate: true, mobileHeaderRight: true,
      render: (r) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-tiny font-bold tabular-nums ${marginClass(r.margin_net)}`}>{r.margin_net.toLocaleString('vi-VN')}%</span>,
    },
    { key: 'share', header: 'Tỉ trọng', width: 80, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{r.revenue_share.toLocaleString('vi-VN')}%</span> },
  ]

  return (
    <div className="p-4 md:p-5 bg-gray-25 space-y-5">
      {detailError && (
        <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-body-md text-red-700">{detailError}</div>
      )}

      {/* Chỉ số chi tiết của chi nhánh */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Stat label="Doanh thu gộp" value={formatCurrency(row.revenue)} />
        <Stat label="Chiết khấu hóa đơn" value={formatCurrency(row.invoice_discount)} tone={row.invoice_discount > 0 ? 'amber' : undefined} />
        <Stat label="Hàng trả lại" value={formatCurrency(row.return_amount)} tone={row.return_amount > 0 ? 'amber' : undefined} />
        <Stat label="Doanh thu thuần" value={formatCurrency(row.revenue_net)} tone="blue" />
        <Stat label="Giá vốn thuần" value={formatCurrency(row.cogs_net)} />
        <Stat label="Lợi nhuận gộp" value={formatCurrency(row.profit_net)} tone={row.profit_net >= 0 ? 'emerald' : 'red'} />
        <Stat label="Biên lợi nhuận" value={`${row.margin_net.toLocaleString('vi-VN')}%`} />
        <Stat label="Giá trị TB/đơn" value={formatCurrency(row.aov)} />
        <Stat label="Lợi nhuận/đơn" value={formatCurrency(row.profit_per_order)} />
        <Stat label="Số đơn" value={row.order_count.toLocaleString('vi-VN')} />
        <Stat label="Số khách mua" value={row.customer_count.toLocaleString('vi-VN')} />
        <Stat label="SL bán" value={fmtQty(row.qty_sold)} />
      </div>

      {/* Xu hướng */}
      <div className="bg-white border border-gray-150 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-body-md font-bold text-gray-700">Xu hướng doanh thu &amp; lợi nhuận — {row.branch_name}</h4>
          <div className="flex bg-gray-100 p-1 rounded-lg">
            {([['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']] as const).map(([b, label]) => (
              <button key={b} onClick={() => setBucket(b)}
                className={`px-3 py-1 rounded-md text-tiny font-semibold transition-all ${bucket === b ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          {trendLoading ? (
            <div className="h-full flex items-center justify-center text-tiny text-gray-400">Đang tải…</div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-tiny text-gray-400">Không có dữ liệu</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v >= 1e9 ? `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tỷ` : `${Math.round(v / 1e6)}tr`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Doanh thu thuần" fill="#1E5A9C" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="Lợi nhuận gộp" stroke="#10b981" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top theo chiều */}
      <div className="bg-white border border-gray-150 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-body-md font-bold text-gray-700">Top 20 trong chi nhánh</h4>
          <div className="flex flex-wrap gap-1">
            {BREAK_DIMS.map(d => {
              const Icon = d.icon
              return (
                <button key={d.id} onClick={() => setDim(d.id)}
                  className={`px-2.5 py-1 rounded-lg text-tiny font-semibold flex items-center gap-1.5 transition-all ${dim === d.id ? 'bg-[#1E5A9C] text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-700'}`}>
                  <Icon size={13} /> {d.label}
                </button>
              )
            })}
          </div>
        </div>
        <DataTable
          rows={breakdown}
          columns={breakdownColumns}
          getRowKey={(r) => r.dim_key}
          loading={breakdownLoading}
          pageSize={0}
          card={false}
          emptyText="Không có dữ liệu"
          resetSignal={`${dim}|${fromTs}|${toTs}`}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// UI nhỏ
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

const TONE_CLASS: Record<string, string> = {
  amber: 'text-amber-700',
  blue: 'text-[#143C69]',
  emerald: 'text-emerald-600',
  red: 'text-red-600',
}

function ReconItem({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string; tone?: keyof typeof TONE_CLASS
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-gray-300">{icon}</span>
      <span className="text-tiny text-gray-400">{label}</span>
      <span className={`font-bold tabular-nums ${tone ? TONE_CLASS[tone] : 'text-gray-700'}`}>{value}</span>
    </span>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: keyof typeof TONE_CLASS }) {
  return (
    <div className="bg-white border border-gray-150 rounded-lg px-3 py-2.5">
      <p className="text-tiny text-gray-400 truncate">{label}</p>
      <p className={`text-body-md font-bold tabular-nums ${tone ? TONE_CLASS[tone] : 'text-gray-800'}`}>{value}</p>
    </div>
  )
}
