import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  ChevronRight, ChevronLeft, TrendingUp, TrendingDown, Truck, Coins, Percent,
  Download, Calendar, Package, Tag, Layers, Building2, ArrowRightLeft, FileText,
  AlertTriangle, Search, UserCog, ArrowDownLeft, ArrowUpRight, Clock,
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import SmartSearchSelect, { SmartSearchOption } from '../../components/SmartSearchSelect'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useBranches } from '../../hooks/queries/useBranches'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TimePreset = 'today' | 'month' | 'year' | 'custom'
type TabId = 'branch' | 'matrix' | 'breakdown' | 'docs'
type Compare = 'none' | 'prev' | 'yoy'
type Bucket = 'day' | 'week' | 'month'
type BreakDim = 'product' | 'brand' | 'category' | 'to_branch' | 'from_branch' | 'creator'

interface Summary {
  total_amount: number
  total_cost: number
  total_margin: number
  margin_pct: number
  total_qty: number
  transfer_count: number
  line_count: number
  product_count: number
  from_branch_count: number
  to_branch_count: number
  pair_count: number
  avg_per_transfer: number
  edited_line_count: number
  zero_price_lines: number
  no_cost_lines: number
  intra_amount: number
  intra_transfers: number
  pending_count: number
  pending_cost: number
}

interface BranchRow {
  branch_id: string
  branch_code: string | null
  branch_name: string
  out_amount: number
  out_cost: number
  out_margin: number
  out_margin_pct: number
  out_qty: number
  out_transfers: number
  out_lines: number
  out_products: number
  out_partners: number
  in_amount: number
  in_source_cost: number
  in_markup: number
  in_markup_pct: number
  in_qty: number
  in_transfers: number
  in_products: number
  in_partners: number
  net_amount: number
  out_share: number
  margin_share: number
  prev_out_amount: number
  prev_out_margin: number
  prev_out_transfers: number
  out_growth: number | null
  margin_growth: number | null
}

interface MatrixRow {
  from_branch_id: string
  from_branch_code: string | null
  from_branch_name: string
  to_branch_id: string
  to_branch_code: string | null
  to_branch_name: string
  amount: number
  cost: number
  margin: number
  margin_pct: number
  qty: number
  transfers: number
  lines: number
  products: number
  amount_share: number
  last_at: string | null
}

interface BreakdownRow {
  dim_key: string
  dim_label: string
  dim_sub: string | null
  amount: number
  cost: number
  margin: number
  margin_pct: number
  qty: number
  transfers: number
  amount_share: number
}

interface DocRow {
  transfer_id: string
  transfer_code: string
  recognized_at: string
  transfer_date: string
  from_branch: string
  to_branch: string
  from_warehouse: string
  to_warehouse: string
  created_by: string
  approved_by: string
  lines: number
  qty: number
  amount: number
  cost: number
  margin: number
  margin_pct: number
  edited_lines: number
  total_count: number
  all_qty: number
  all_amount: number
  all_cost: number
  all_margin: number
}

interface TrendRow {
  bucket_start: string
  amount: number
  cost: number
  margin: number
  margin_pct: number
  qty: number
  transfers: number
}

const TABS: { id: TabId; label: string; icon: typeof Building2 }[] = [
  { id: 'branch', label: 'Theo chi nhánh', icon: Building2 },
  { id: 'matrix', label: 'Luồng chuyển kho', icon: ArrowRightLeft },
  { id: 'breakdown', label: 'Theo sản phẩm', icon: Package },
  { id: 'docs', label: 'Chứng từ', icon: FileText },
]

const BREAK_DIMS: { id: BreakDim; label: string; icon: typeof Package }[] = [
  { id: 'product', label: 'Sản phẩm', icon: Package },
  { id: 'brand', label: 'Thương hiệu', icon: Tag },
  { id: 'category', label: 'Nhóm hàng', icon: Layers },
  { id: 'to_branch', label: 'Chi nhánh nhận', icon: ArrowDownLeft },
  { id: 'from_branch', label: 'Chi nhánh xuất', icon: ArrowUpRight },
  { id: 'creator', label: 'Người lập phiếu', icon: UserCog },
]

const PANEL_DIMS: BreakDim[] = ['to_branch', 'product', 'brand', 'category']

const DOCS_PAGE_SIZE = 50

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
  if (preset === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) }
  if (preset === 'year') return { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(now) }
  return { from: customFrom, to: customTo }
}

// Supabase trả NUMERIC/BIGINT dưới dạng string → ép về number trước khi format
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v))

const NUMERIC_KEYS = [
  'total_amount', 'total_cost', 'total_margin', 'margin_pct', 'total_qty',
  'transfer_count', 'line_count', 'product_count', 'from_branch_count', 'to_branch_count',
  'pair_count', 'avg_per_transfer', 'edited_line_count', 'zero_price_lines', 'no_cost_lines',
  'intra_amount', 'intra_transfers', 'pending_count', 'pending_cost',
  'out_amount', 'out_cost', 'out_margin', 'out_margin_pct', 'out_qty', 'out_transfers',
  'out_lines', 'out_products', 'out_partners',
  'in_amount', 'in_source_cost', 'in_markup', 'in_markup_pct', 'in_qty', 'in_transfers',
  'in_products', 'in_partners',
  'net_amount', 'out_share', 'margin_share',
  'prev_out_amount', 'prev_out_margin', 'prev_out_transfers',
  'amount', 'cost', 'margin', 'qty', 'transfers', 'lines', 'products', 'amount_share',
  'edited_lines', 'total_count', 'all_qty', 'all_amount', 'all_cost', 'all_margin',
] as const
const NULLABLE_KEYS = ['out_growth', 'margin_growth'] as const

function coerceRow(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r }
  for (const k of NUMERIC_KEYS) if (k in r) out[k] = num(r[k])
  for (const k of NULLABLE_KEYS) if (k in r) out[k] = numOrNull(r[k])
  return out
}

const marginClass = (m: number) =>
  m >= 15 ? 'bg-emerald-50 text-emerald-700'
  : m > 0 ? 'bg-blue-50 text-blue-700'
  : m === 0 ? 'bg-gray-100 text-gray-500'
  : 'bg-red-50 text-red-600'

const fmtPct = (v: number | null, digits = 1) =>
  v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toLocaleString('vi-VN', { maximumFractionDigits: digits })}%`

const fmtQty = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 3 })

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

function defaultBucket(from: string, to: string): Bucket {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000
  if (days <= 62) return 'day'
  if (days <= 400) return 'week'
  return 'month'
}

// ─────────────────────────────────────────────────────────────
export default function BranchTransferReportPage() {
  const navigate = useNavigate()
  const { formatCurrency } = useDisplaySettings()

  const [preset, setPreset] = useState<TimePreset>('month')
  const todayStr = ymd(new Date())
  const [customFrom, setCustomFrom] = useState(todayStr)
  const [customTo, setCustomTo] = useState(todayStr)
  const [activeTab, setActiveTab] = useState<TabId>('branch')
  const [compare, setCompare] = useState<Compare>('prev')
  const [dim, setDim] = useState<BreakDim>('product')
  const [docSearch, setDocSearch] = useState('')
  const [docSearchInput, setDocSearchInput] = useState('')
  const [docPage, setDocPage] = useState(1)

  const [fromBranch, setFromBranch] = useState('')
  const [toBranch, setToBranch] = useState('')

  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [branchRows, setBranchRows] = useState<BranchRow[]>([])
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([])
  const [breakRows, setBreakRows] = useState<BreakdownRow[]>([])
  const [docRows, setDocRows] = useState<DocRow[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const branchesQ = useBranches()
  const branchOptions = (label: string): SmartSearchOption[] => [
    { value: '', label },
    ...(branchesQ.data ?? []).map(b => ({ value: b.id, label: b.name, desc: b.code })),
  ]

  const { from, to } = useMemo(() => presetRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  // Mốc giờ gắn offset VN (+07:00) — chuỗi trần bị Postgres hiểu là UTC và
  // "Hôm nay" sẽ rụng mọi phiếu duyệt trong khung 00:00–07:00 giờ Việt Nam.
  const fromTs = from + 'T00:00:00+07:00'
  const toTs = to + 'T23:59:59+07:00'

  // Tab "Theo chi nhánh" và "Luồng chuyển kho" CHÍNH LÀ chiều chi nhánh nên
  // luôn liệt kê hết; bộ lọc cặp CN chỉ áp cho 2 tab còn lại (và KPI).
  const dimensionTab = activeTab === 'branch' || activeTab === 'matrix'
  const fromParam = dimensionTab ? null : (fromBranch || null)
  const toParam = dimensionTab ? null : (toBranch || null)

  // ── KPI ──
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setErrorMsg(null)
    const { data, error } = await supabase.rpc('fn_branch_transfer_summary', {
      p_from: fromTs, p_to: toTs, p_from_branch: fromParam, p_to_branch: toParam,
    })
    if (error) {
      setErrorMsg(error.message)
      setSummary(null)
    } else {
      const r = data?.[0]
      setSummary(r ? (coerceRow(r) as unknown as Summary) : null)
    }
    setSummaryLoading(false)
  }, [fromTs, toTs, fromParam, toParam])

  // ── Bảng của tab đang mở ──
  const loadRows = useCallback(async () => {
    setRowsLoading(true)
    setErrorMsg(null)
    if (activeTab === 'branch') {
      const { data, error } = await supabase.rpc('fn_branch_transfer_by_branch', {
        p_from: fromTs, p_to: toTs, p_compare: compare, p_sort: 'out',
      })
      if (error) { setErrorMsg(error.message); setBranchRows([]) }
      else setBranchRows((data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as unknown as BranchRow[])
    } else if (activeTab === 'matrix') {
      const { data, error } = await supabase.rpc('fn_branch_transfer_matrix', {
        p_from: fromTs, p_to: toTs,
      })
      if (error) { setErrorMsg(error.message); setMatrixRows([]) }
      else setMatrixRows((data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as unknown as MatrixRow[])
    } else if (activeTab === 'breakdown') {
      const { data, error } = await supabase.rpc('fn_branch_transfer_breakdown', {
        p_from: fromTs, p_to: toTs, p_from_branch: fromParam, p_to_branch: toParam,
        p_dim: dim, p_sort: 'amount', p_limit: 200,
      })
      if (error) { setErrorMsg(error.message); setBreakRows([]) }
      else setBreakRows((data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as unknown as BreakdownRow[])
    } else {
      const { data, error } = await supabase.rpc('fn_branch_transfer_docs', {
        p_from: fromTs, p_to: toTs, p_from_branch: fromParam, p_to_branch: toParam,
        p_search: docSearch || null, p_sort: 'recent',
        p_limit: DOCS_PAGE_SIZE, p_offset: (docPage - 1) * DOCS_PAGE_SIZE,
      })
      if (error) { setErrorMsg(error.message); setDocRows([]) }
      else setDocRows((data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as unknown as DocRow[])
    }
    setRowsLoading(false)
  }, [activeTab, fromTs, toTs, compare, dim, fromParam, toParam, docSearch, docPage])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadRows() }, [loadRows])

  // Gõ mã phiếu → debounce 350ms rồi mới gọi RPC
  useEffect(() => {
    const t = setTimeout(() => { setDocSearch(docSearchInput); setDocPage(1) }, 350)
    return () => clearTimeout(t)
  }, [docSearchInput])

  // Đổi bộ lọc/kỳ → về trang 1 của danh sách chứng từ
  useEffect(() => { setDocPage(1) }, [fromTs, toTs, fromBranch, toBranch])

  const docTotal = docRows[0]?.total_count ?? 0

  // ── Xuất CSV ──
  const handleExport = () => {
    let csvRows: Record<string, string | number>[] = []
    let filename = 'bao-cao-chuyen-kho'
    if (activeTab === 'branch') {
      filename = `chuyen-kho-chi-nhanh_${from}_${to}`
      csvRows = branchRows.map(r => ({
        'Mã CN': r.branch_code ?? '', 'Chi nhánh': r.branch_name,
        'Số phiếu xuất': r.out_transfers, 'Số dòng xuất': r.out_lines,
        'Số SP xuất': r.out_products, 'Số CN nhận': r.out_partners, 'SL xuất': r.out_qty,
        'Doanh số nội bộ': r.out_amount, 'Giá vốn nguồn': r.out_cost,
        'Lãi nội bộ': r.out_margin, 'Biên nội bộ (%)': r.out_margin_pct,
        '% đóng góp doanh số': r.out_share, '% đóng góp lãi': r.margin_share,
        'Số phiếu nhận': r.in_transfers, 'SL nhận': r.in_qty,
        'Giá trị hàng nhận': r.in_amount, 'Giá vốn gốc bên bán': r.in_source_cost,
        'Chênh so giá vốn gốc': r.in_markup, 'Chênh (%)': r.in_markup_pct,
        'Luồng ròng (xuất − nhận)': r.net_amount,
        'Doanh số kỳ so sánh': r.prev_out_amount, 'Lãi kỳ so sánh': r.prev_out_margin,
        'Tăng trưởng doanh số (%)': r.out_growth ?? '', 'Tăng trưởng lãi (%)': r.margin_growth ?? '',
      }))
    } else if (activeTab === 'matrix') {
      filename = `luong-chuyen-kho_${from}_${to}`
      csvRows = matrixRows.map(r => ({
        'Từ chi nhánh': r.from_branch_name, 'Mã CN xuất': r.from_branch_code ?? '',
        'Đến chi nhánh': r.to_branch_name, 'Mã CN nhận': r.to_branch_code ?? '',
        'Số phiếu': r.transfers, 'Số dòng': r.lines, 'Số SP': r.products, 'SL': r.qty,
        'Giá trị chuyển': r.amount, 'Giá vốn nguồn': r.cost,
        'Lãi nội bộ': r.margin, 'Biên (%)': r.margin_pct, 'Tỉ trọng (%)': r.amount_share,
        'Lần gần nhất': r.last_at ? fmtDateTime(r.last_at) : '',
      }))
    } else if (activeTab === 'breakdown') {
      filename = `chuyen-kho-${dim}_${from}_${to}`
      csvRows = breakRows.map(r => ({
        [BREAK_DIMS.find(d => d.id === dim)?.label ?? 'Chiều']: r.dim_label,
        'Mã': r.dim_sub ?? '',
        'Số phiếu': r.transfers, 'SL': r.qty,
        'Giá trị chuyển': r.amount, 'Giá vốn nguồn': r.cost,
        'Lãi nội bộ': r.margin, 'Biên (%)': r.margin_pct, 'Tỉ trọng (%)': r.amount_share,
      }))
    } else {
      filename = `chung-tu-chuyen-kho_${from}_${to}`
      csvRows = docRows.map(r => ({
        'Mã phiếu': r.transfer_code, 'Ngày duyệt': fmtDateTime(r.recognized_at),
        'Ngày phiếu': r.transfer_date,
        'Từ chi nhánh': r.from_branch, 'Kho xuất': r.from_warehouse,
        'Đến chi nhánh': r.to_branch, 'Kho nhận': r.to_warehouse,
        'Người lập': r.created_by, 'Người duyệt': r.approved_by,
        'Số dòng': r.lines, 'SL': r.qty,
        'Giá trị chuyển': r.amount, 'Giá vốn nguồn': r.cost,
        'Lãi nội bộ': r.margin, 'Biên (%)': r.margin_pct,
        'Dòng sửa giá tay': r.edited_lines,
      }))
    }
    const csv = '﻿' + Papa.unparse(csvRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${filename}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Cột: tab Theo chi nhánh ──
  const branchColumns: DataTableColumn<BranchRow>[] = [
    {
      key: 'name', header: 'Chi nhánh', flex: true, minWidth: 170, noTruncate: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-gray-800 truncate">{r.branch_name}</div>
          <div className="text-tiny text-gray-400">
            {r.branch_code ? `${r.branch_code} · ` : ''}
            {r.out_transfers.toLocaleString('vi-VN')} phiếu xuất · {r.in_transfers.toLocaleString('vi-VN')} phiếu nhận
          </div>
        </div>
      ),
    },
    {
      key: 'out_amount', header: 'Doanh số nội bộ', width: 135, align: 'right',
      render: (r) => (
        <div className="leading-tight">
          <div className="tabular-nums text-gray-700 font-semibold">{formatCurrency(r.out_amount)}</div>
          <div className="text-tiny text-gray-400 tabular-nums">{r.out_products.toLocaleString('vi-VN')} SP · {r.out_partners} CN nhận</div>
        </div>
      ),
    },
    {
      key: 'out_cost', header: 'Giá vốn nguồn', width: 125, align: 'right',
      render: (r) => <span className="text-gray-500 tabular-nums">{formatCurrency(r.out_cost)}</span>,
    },
    {
      key: 'out_margin', header: 'Lãi nội bộ', width: 125, align: 'right',
      render: (r) => (
        <span className={`tabular-nums font-bold ${r.out_margin > 0 ? 'text-[#143C69]' : r.out_margin < 0 ? 'text-red-600' : 'text-gray-400'}`}>
          {formatCurrency(r.out_margin)}
        </span>
      ),
    },
    {
      key: 'out_margin_pct', header: 'Biên', width: 100, align: 'right', noTruncate: true, mobileHeaderRight: true,
      render: (r) => r.out_amount === 0
        ? <span className="text-tiny text-gray-400">—</span>
        : (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold tabular-nums ${marginClass(r.out_margin_pct)}`}>
            {r.out_margin_pct > 0 ? <TrendingUp size={11} /> : r.out_margin_pct < 0 ? <TrendingDown size={11} /> : null}
            {r.out_margin_pct.toLocaleString('vi-VN')}%
          </span>
        ),
    },
    {
      key: 'in_amount', header: 'Nhận về', width: 130, align: 'right', noTruncate: true,
      render: (r) => r.in_amount === 0
        ? <span className="text-tiny text-gray-300">—</span>
        : (
          <div className="leading-tight">
            <div className="tabular-nums text-gray-600">{formatCurrency(r.in_amount)}</div>
            <div className="text-tiny text-amber-600 tabular-nums">+{formatCurrency(r.in_markup)} so vốn gốc</div>
          </div>
        ),
    },
    {
      key: 'out_share', header: 'Đóng góp', width: 95, align: 'right', noTruncate: true,
      render: (r) => (
        <div className="leading-tight">
          <div className="tabular-nums text-gray-700 font-semibold">{r.out_share.toLocaleString('vi-VN')}%</div>
          <div className="text-tiny text-gray-400 tabular-nums">lãi {r.margin_share.toLocaleString('vi-VN')}%</div>
        </div>
      ),
    },
  ]
  if (compare !== 'none') branchColumns.push({
    key: 'growth', header: compare === 'yoy' ? 'So cùng kỳ' : 'So kỳ trước', width: 110, align: 'right', noTruncate: true,
    render: (r) => {
      const g = r.out_growth
      const cls = g === null ? 'text-gray-400' : g >= 0 ? 'text-emerald-600' : 'text-red-600'
      return (
        <div className="leading-tight">
          <div className={`tabular-nums font-semibold ${cls}`}>{fmtPct(g)}</div>
          <div className="text-tiny text-gray-400 tabular-nums">lãi {fmtPct(r.margin_growth)}</div>
        </div>
      )
    },
  })

  // ── Cột: tab Luồng chuyển kho ──
  const matrixColumns: DataTableColumn<MatrixRow>[] = [
    {
      key: 'flow', header: 'Luồng hàng', flex: true, minWidth: 220, noTruncate: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-gray-800">
            <span className="truncate">{r.from_branch_name}</span>
            <ArrowRightLeft size={13} className="text-blue-400 shrink-0" />
            <span className="truncate">{r.to_branch_name}</span>
          </div>
          <div className="text-tiny text-gray-400">
            {r.transfers.toLocaleString('vi-VN')} phiếu · {r.products.toLocaleString('vi-VN')} SP · gần nhất {fmtDateTime(r.last_at)}
          </div>
        </div>
      ),
    },
    { key: 'qty', header: 'SL', width: 90, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{fmtQty(r.qty)}</span> },
    { key: 'amount', header: 'Giá trị chuyển', width: 135, align: 'right', render: (r) => <span className="tabular-nums text-gray-700 font-semibold">{formatCurrency(r.amount)}</span> },
    { key: 'cost', header: 'Giá vốn nguồn', width: 125, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{formatCurrency(r.cost)}</span> },
    {
      key: 'margin', header: 'Lãi nội bộ', width: 125, align: 'right',
      render: (r) => <span className={`tabular-nums font-bold ${r.margin > 0 ? 'text-[#143C69]' : r.margin < 0 ? 'text-red-600' : 'text-gray-400'}`}>{formatCurrency(r.margin)}</span>,
    },
    {
      key: 'margin_pct', header: 'Biên', width: 90, align: 'right', noTruncate: true, mobileHeaderRight: true,
      render: (r) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-tiny font-bold tabular-nums ${marginClass(r.margin_pct)}`}>{r.margin_pct.toLocaleString('vi-VN')}%</span>,
    },
    { key: 'share', header: 'Tỉ trọng', width: 85, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{r.amount_share.toLocaleString('vi-VN')}%</span> },
  ]

  // ── Cột: tab Theo sản phẩm (breakdown) ──
  const breakColumns: DataTableColumn<BreakdownRow>[] = [
    {
      key: 'label', header: BREAK_DIMS.find(d => d.id === dim)?.label ?? '', flex: true, minWidth: 180, noTruncate: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-gray-800 truncate">{r.dim_label}</div>
          {r.dim_sub && <div className="text-tiny text-gray-400 truncate">{r.dim_sub}</div>}
        </div>
      ),
    },
    { key: 'transfers', header: 'Số phiếu', width: 85, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{r.transfers.toLocaleString('vi-VN')}</span> },
    { key: 'qty', header: 'SL', width: 90, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{fmtQty(r.qty)}</span> },
    { key: 'amount', header: 'Giá trị chuyển', width: 135, align: 'right', render: (r) => <span className="tabular-nums text-gray-700 font-semibold">{formatCurrency(r.amount)}</span> },
    { key: 'cost', header: 'Giá vốn nguồn', width: 125, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{formatCurrency(r.cost)}</span> },
    {
      key: 'margin', header: 'Lãi nội bộ', width: 125, align: 'right',
      render: (r) => <span className={`tabular-nums font-bold ${r.margin > 0 ? 'text-[#143C69]' : r.margin < 0 ? 'text-red-600' : 'text-gray-400'}`}>{formatCurrency(r.margin)}</span>,
    },
    {
      key: 'margin_pct', header: 'Biên', width: 90, align: 'right', noTruncate: true, mobileHeaderRight: true,
      render: (r) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-tiny font-bold tabular-nums ${marginClass(r.margin_pct)}`}>{r.margin_pct.toLocaleString('vi-VN')}%</span>,
    },
    { key: 'share', header: 'Tỉ trọng', width: 85, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{r.amount_share.toLocaleString('vi-VN')}%</span> },
  ]

  // ── Cột: tab Chứng từ ──
  const docColumns: DataTableColumn<DocRow>[] = [
    {
      key: 'code', header: 'Phiếu', flex: true, minWidth: 200, noTruncate: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-800 truncate">{r.transfer_code}</span>
            {r.edited_lines > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 shrink-0">
                <AlertTriangle size={10} />{r.edited_lines} dòng sửa giá
              </span>
            )}
          </div>
          <div className="text-tiny text-gray-400 truncate">
            {r.from_branch} → {r.to_branch} · {r.lines} dòng · duyệt {fmtDateTime(r.recognized_at)}
          </div>
        </div>
      ),
    },
    { key: 'qty', header: 'SL', width: 85, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{fmtQty(r.qty)}</span> },
    { key: 'amount', header: 'Giá trị chuyển', width: 135, align: 'right', render: (r) => <span className="tabular-nums text-gray-700 font-semibold">{formatCurrency(r.amount)}</span> },
    { key: 'cost', header: 'Giá vốn nguồn', width: 125, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{formatCurrency(r.cost)}</span> },
    {
      key: 'margin', header: 'Lãi nội bộ', width: 125, align: 'right',
      render: (r) => <span className={`tabular-nums font-bold ${r.margin > 0 ? 'text-[#143C69]' : r.margin < 0 ? 'text-red-600' : 'text-gray-400'}`}>{formatCurrency(r.margin)}</span>,
    },
    {
      key: 'margin_pct', header: 'Biên', width: 90, align: 'right', noTruncate: true, mobileHeaderRight: true,
      render: (r) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-tiny font-bold tabular-nums ${marginClass(r.margin_pct)}`}>{r.margin_pct.toLocaleString('vi-VN')}%</span>,
    },
    {
      key: 'people', header: 'Người lập / duyệt', width: 150, align: 'right', noTruncate: true,
      render: (r) => (
        <div className="leading-tight text-tiny">
          <div className="text-gray-600 truncate">{r.created_by}</div>
          <div className="text-gray-400 truncate">duyệt: {r.approved_by}</div>
        </div>
      ),
    },
  ]

  // Dòng tổng cho từng tab (tổng của tập ĐANG hiển thị; riêng Chứng từ là tổng trang)
  const branchTotals = useMemo(() => {
    if (branchRows.length === 0) return undefined
    const amt = branchRows.reduce((s, r) => s + r.out_amount, 0)
    const cost = branchRows.reduce((s, r) => s + r.out_cost, 0)
    const mar = branchRows.reduce((s, r) => s + r.out_margin, 0)
    return {
      name: `${branchRows.length} chi nhánh`,
      out_amount: formatCurrency(amt),
      out_cost: formatCurrency(cost),
      out_margin: formatCurrency(mar),
      out_margin_pct: amt > 0 ? `${((mar / amt) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%` : '—',
      in_amount: formatCurrency(branchRows.reduce((s, r) => s + r.in_amount, 0)),
      out_share: '100%',
    }
  }, [branchRows, formatCurrency])

  const sumTotals = (
    rows: { amount: number; cost: number; margin: number; qty: number; transfers?: number }[],
    label: string,
  ) => {
    if (rows.length === 0) return undefined
    const amt = rows.reduce((s, r) => s + r.amount, 0)
    const mar = rows.reduce((s, r) => s + r.margin, 0)
    const nTransfers = rows.reduce((s, r) => s + (r.transfers ?? 0), 0)
    return {
      amount: formatCurrency(amt),
      cost: formatCurrency(rows.reduce((s, r) => s + r.cost, 0)),
      margin: formatCurrency(mar),
      margin_pct: amt > 0 ? `${((mar / amt) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%` : '—',
      qty: fmtQty(rows.reduce((s, r) => s + r.qty, 0)),
      ...(nTransfers > 0 ? { transfers: nTransfers.toLocaleString('vi-VN') } : {}),
      flow: label,
      label,
      share: '100%',
    }
  }

  // Chứng từ phân trang server-side → dòng tổng phải là tổng TOÀN BỘ tập lọc,
  // lấy từ các cột `all_*` (window SUM) chứ không cộng dồn trang đang xem.
  const docTotals = useMemo(() => {
    const r = docRows[0]
    if (!r) return undefined
    return {
      code: `${r.total_count.toLocaleString('vi-VN')} phiếu (toàn bộ bộ lọc)`,
      qty: fmtQty(r.all_qty),
      amount: formatCurrency(r.all_amount),
      cost: formatCurrency(r.all_cost),
      margin: formatCurrency(r.all_margin),
      margin_pct: r.all_amount > 0
        ? `${((r.all_margin / r.all_amount) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`
        : '—',
    }
  }, [docRows, formatCurrency])

  const hasRows = activeTab === 'branch' ? branchRows.length > 0
    : activeTab === 'matrix' ? matrixRows.length > 0
    : activeTab === 'breakdown' ? breakRows.length > 0
    : docRows.length > 0

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
          <span className="text-blue-600 font-semibold">Báo cáo chuyển kho nội bộ</span>
        </div>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-gray-800 leading-tight">Báo cáo chuyển kho nội bộ</h1>
            <p className="text-gray-500 text-body-md mt-1">
              Doanh số &amp; lợi nhuận chi nhánh phát sinh từ việc bán hàng cho chi nhánh khác. Tách riêng, không cộng với doanh thu bán khách.
            </p>
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
              disabled={rowsLoading || !hasRows}
              className="h-10 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-[#143C69] active:scale-95 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              Xuất CSV
            </button>
          </div>
        </div>

        {/* Khoảng thời gian tùy chọn */}
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

        {/* KPI */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <KpiCard icon={<Truck size={20} />} label="Doanh số nội bộ"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_amount ?? 0)}
            sub={summary ? `${summary.transfer_count.toLocaleString('vi-VN')} phiếu · TB ${formatCurrency(summary.avg_per_transfer)}/phiếu` : ''} />
          <KpiCard icon={<Coins size={20} />} label="Giá vốn nguồn"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_cost ?? 0)}
            sub={summary ? `${summary.product_count.toLocaleString('vi-VN')} sản phẩm · ${fmtQty(summary.total_qty)} đơn vị` : ''} />
          <KpiCard icon={<TrendingUp size={20} />} label="Lãi nội bộ"
            value={summaryLoading ? '…' : formatCurrency(summary?.total_margin ?? 0)}
            sub={summary ? `${summary.from_branch_count} CN xuất → ${summary.to_branch_count} CN nhận · ${summary.pair_count} luồng` : ''}
            highlight={(summary?.total_margin ?? 0) >= 0} />
          <KpiCard icon={<Percent size={20} />} label="Biên nội bộ"
            value={summaryLoading ? '…' : `${(summary?.margin_pct ?? 0).toLocaleString('vi-VN')}%`}
            sub="(giá chuyển − giá vốn nguồn) / giá chuyển" />
        </div>

        {/* Các khoản CỐ Ý nằm ngoài doanh số + cảnh báo chất lượng dữ liệu */}
        {summary && !summaryLoading && (
          <div className="bg-white border border-gray-150 rounded-xl px-5 py-4 shadow-sm flex flex-wrap items-center gap-x-4 gap-y-2 text-body-md">
            <span className="text-tiny text-gray-400 uppercase font-bold tracking-wider">Ngoài doanh số</span>
            <ReconItem icon={<ArrowRightLeft size={14} />} label="Chuyển trong cùng chi nhánh"
              value={`${formatCurrency(summary.intra_amount)} · ${summary.intra_transfers} phiếu`} />
            <ReconItem icon={<Clock size={14} />} label="Chưa vào sổ kho đích (hiện tại)"
              value={`${formatCurrency(summary.pending_cost)} · ${summary.pending_count} phiếu`}
              tone={summary.pending_count > 0 ? 'amber' : undefined} />
            <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
              {summary.edited_line_count > 0 && (
                <ReconItem icon={<AlertTriangle size={14} />} label="Dòng sửa giá tay"
                  value={summary.edited_line_count.toLocaleString('vi-VN')} tone="amber" />
              )}
              {summary.zero_price_lines > 0 && (
                <ReconItem icon={<AlertTriangle size={14} />} label="Dòng chuyển ngang giá vốn"
                  value={summary.zero_price_lines.toLocaleString('vi-VN')} tone="amber" />
              )}
              {summary.no_cost_lines > 0 && (
                <ReconItem icon={<AlertTriangle size={14} />} label="Dòng giá vốn nguồn = 0"
                  value={summary.no_cost_lines.toLocaleString('vi-VN')} tone="amber" />
              )}
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
                onClick={() => { setActiveTab(t.id); setRowsLoading(true) }}
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

        {/* Bộ lọc */}
        <div className="flex flex-wrap items-center gap-3">
          {!dimensionTab && (
            <>
              <div className="w-full sm:w-56">
                <SmartSearchSelect
                  options={branchOptions('Mọi chi nhánh xuất')}
                  value={fromBranch}
                  onChange={setFromBranch}
                  placeholder="Mọi chi nhánh xuất"
                  searchPlaceholder="Tìm chi nhánh…"
                  icon={<ArrowUpRight size={16} />}
                />
              </div>
              <div className="w-full sm:w-56">
                <SmartSearchSelect
                  options={branchOptions('Mọi chi nhánh nhận')}
                  value={toBranch}
                  onChange={setToBranch}
                  placeholder="Mọi chi nhánh nhận"
                  searchPlaceholder="Tìm chi nhánh…"
                  icon={<ArrowDownLeft size={16} />}
                />
              </div>
            </>
          )}
          {activeTab === 'branch' && (
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
          {activeTab === 'breakdown' && (
            <div className="flex flex-wrap gap-1">
              {BREAK_DIMS.map(d => {
                const Icon = d.icon
                return (
                  <button key={d.id} onClick={() => setDim(d.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-tiny font-semibold flex items-center gap-1.5 transition-all ${
                      dim === d.id ? 'bg-[#1E5A9C] text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                    }`}>
                    <Icon size={13} /> {d.label}
                  </button>
                )
              })}
            </div>
          )}
          {activeTab === 'docs' && (
            <div className="relative w-full sm:w-72">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={docSearchInput}
                onChange={e => setDocSearchInput(e.target.value)}
                placeholder="Tìm mã phiếu chuyển…"
                className="w-full h-10 pl-9 pr-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-4 text-body-md text-red-700">
            {errorMsg}
          </div>
        )}

        {/* Bảng */}
        {activeTab === 'branch' && (
          <DataTable
            rows={branchRows}
            columns={branchColumns}
            getRowKey={(r) => r.branch_id}
            loading={rowsLoading}
            pageSize={0}
            totals={branchTotals}
            emptyText="Không có phiếu chuyển kho nào được duyệt trong kỳ này"
            resetSignal={`branch|${fromTs}|${toTs}`}
            expandedRowRender={(row) => (
              <BranchPanel row={row} fromTs={fromTs} toTs={toTs} from={from} to={to} formatCurrency={formatCurrency} />
            )}
          />
        )}
        {activeTab === 'matrix' && (
          <DataTable
            rows={matrixRows}
            columns={matrixColumns}
            getRowKey={(r) => `${r.from_branch_id}>${r.to_branch_id}`}
            loading={rowsLoading}
            pageSize={0}
            totals={sumTotals(matrixRows, `${matrixRows.length} luồng`)}
            emptyText="Chưa có luồng chuyển kho giữa các chi nhánh trong kỳ này"
            resetSignal={`matrix|${fromTs}|${toTs}`}
          />
        )}
        {activeTab === 'breakdown' && (
          <DataTable
            rows={breakRows}
            columns={breakColumns}
            getRowKey={(r) => r.dim_key}
            loading={rowsLoading}
            pageSize={0}
            totals={sumTotals(breakRows, `${breakRows.length} dòng`)}
            emptyText="Không có dữ liệu trong khoảng thời gian này"
            resetSignal={`break|${dim}|${fromTs}|${toTs}|${fromBranch}|${toBranch}`}
          />
        )}
        {activeTab === 'docs' && (
          <DataTable
            rows={docRows}
            columns={docColumns}
            getRowKey={(r) => r.transfer_id}
            loading={rowsLoading}
            manualPagination
            page={docPage}
            onPageChange={setDocPage}
            totalItems={docTotal}
            pageSize={DOCS_PAGE_SIZE}
            itemLabel="phiếu chuyển"
            totals={docTotals}
            emptyText="Không tìm thấy phiếu chuyển kho nào"
            expandedRowRender={(r) => <DocLinesPanel transferId={r.transfer_id} formatCurrency={formatCurrency} />}
          />
        )}

        {/* Ghi chú */}
        <p className="text-tiny text-gray-400 leading-relaxed">
          * Báo cáo này <b>chỉ tính giá chuyển kho nội bộ</b> — hoàn toàn tách khỏi doanh thu bán cho khách hàng ở{' '}
          <button onClick={() => navigate('/reports/profit')} className="text-blue-600 hover:underline font-semibold">Báo cáo lợi nhuận</button>.
          Hai con số <b>không cộng lại với nhau</b>, vì hàng chuyển đi sẽ được ghi nhận doanh thu lần nữa khi chi nhánh nhận bán ra.
          {' '}<b>Doanh số nội bộ</b> = Σ số lượng × đơn giá chuyển; <b>giá vốn nguồn</b> lấy snapshot giá vốn lô của chi nhánh bán tại lúc xuất kho.
          {' '}Chỉ tính phiếu đã <b>Admin duyệt</b> (trạng thái Hoàn tất), mốc thời gian là <b>lúc duyệt</b> — đúng thời điểm hàng vào sổ kho đích và giá vốn được chốt.
          {' '}Chi nhánh nhận <b>không bị trừ</b> gì ở đây: hàng nhận về là tồn kho, chỉ thành giá vốn khi bán ra cho khách. Cột <b>Nhận về</b> chỉ để tham khảo.
          {' '}Phiếu chuyển giữa hai kho của <b>cùng một chi nhánh</b> không phải bán hàng nên nằm ngoài mọi con số doanh số (xem dải &quot;Ngoài doanh số&quot;).
          {' '}Dòng <span className="text-amber-700 font-semibold">chuyển ngang giá vốn</span> là phiếu để trống đơn giá → hệ thống lấy đúng giá vốn nguồn nên lãi nội bộ bằng 0; đó là lựa chọn khi lập phiếu, không phải lỗi.
          {' '}Dòng <span className="text-amber-700 font-semibold">giá vốn nguồn = 0</span> là hàng nhập kho giá 0đ (nhà cung cấp tặng) — không phải lỗi, nhưng khi chuyển đi có giá thì lãi nội bộ bằng <b>toàn bộ</b> giá chuyển, nên tách ra đếm để thấy biên đến từ đâu.
          {' '}Ô <b>Chưa vào sổ kho đích</b> là ảnh chụp <b>hiện tại</b> (hàng đang đi đường + chờ duyệt), cố ý không lọc theo kỳ.
          {' '}Ranh giới ngày theo giờ Việt Nam.
        </p>
      </div>
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// Panel chi tiết 1 phiếu chuyển — dùng lại `fn_transfer_cost_preview`
// (đã có từ 20260738, grant sẵn cho authenticated) nên không cần RPC mới.
// CHỈ hiện phần thuộc về chứng từ; hai cột "giá vốn kho đích trước/sau" của
// RPC đó đọc trạng thái HIỆN TẠI của lô nên với phiếu đã duyệt xong là số
// gây hiểu nhầm → cố ý không hiển thị.
// ─────────────────────────────────────────────────────────────
interface PreviewLine {
  line_id: string
  sku: string
  product_name: string
  quantity: number
  source_cost: number
  transfer_price: number
}

function DocLinesPanel({ transferId, formatCurrency }: {
  transferId: string
  formatCurrency: (n: number) => string
}) {
  const [lines, setLines] = useState<PreviewLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const { data, error: err } = await supabase.rpc('fn_transfer_cost_preview', { p_transfer_id: transferId })
      if (cancelled) return
      if (err) { setError(err.message); setLines([]) }
      else {
        setError(null)
        setLines((data ?? []).map((r: Record<string, unknown>) => ({
          line_id: String(r.line_id),
          sku: String(r.sku ?? ''),
          product_name: String(r.product_name ?? ''),
          quantity: num(r.quantity),
          source_cost: num(r.source_cost),
          transfer_price: num(r.transfer_price),
        })))
      }
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [transferId])

  const columns: DataTableColumn<PreviewLine>[] = [
    {
      key: 'product', header: 'Sản phẩm', flex: true, minWidth: 180, noTruncate: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-gray-800 truncate">{r.product_name}</div>
          <div className="text-tiny text-gray-400 truncate">{r.sku}</div>
        </div>
      ),
    },
    { key: 'qty', header: 'SL', width: 85, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{fmtQty(r.quantity)}</span> },
    { key: 'src', header: 'Giá vốn nguồn', width: 120, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{formatCurrency(r.source_cost)}</span> },
    { key: 'price', header: 'Đơn giá chuyển', width: 125, align: 'right', render: (r) => <span className="tabular-nums text-gray-700 font-semibold">{formatCurrency(r.transfer_price)}</span> },
    { key: 'amount', header: 'Thành tiền', width: 125, align: 'right', render: (r) => <span className="tabular-nums text-gray-700">{formatCurrency(r.quantity * r.transfer_price)}</span> },
    {
      key: 'margin', header: 'Lãi nội bộ', width: 120, align: 'right', mobileHeaderRight: true,
      render: (r) => {
        const m = r.quantity * (r.transfer_price - r.source_cost)
        return <span className={`tabular-nums font-bold ${m > 0 ? 'text-[#143C69]' : m < 0 ? 'text-red-600' : 'text-gray-400'}`}>{formatCurrency(m)}</span>
      },
    },
  ]

  return (
    <div className="p-4 bg-gray-25">
      {error && <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-body-md text-red-700 mb-3">{error}</div>}
      <DataTable
        rows={lines}
        columns={columns}
        getRowKey={(r) => r.line_id}
        loading={loading}
        pageSize={0}
        card={false}
        emptyText="Phiếu không có dòng hàng"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Panel chi tiết 1 chi nhánh (mở khi bấm vào dòng)
// ─────────────────────────────────────────────────────────────
function BranchPanel({ row, fromTs, toTs, from, to, formatCurrency }: {
  row: BranchRow
  fromTs: string
  toTs: string
  from: string
  to: string
  formatCurrency: (n: number) => string
}) {
  const [bucket, setBucket] = useState<Bucket>(() => defaultBucket(from, to))
  const [dim, setDim] = useState<BreakDim>('to_branch')
  const [trend, setTrend] = useState<TrendRow[]>([])
  const [trendLoading, setTrendLoading] = useState(true)
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([])
  const [breakdownLoading, setBreakdownLoading] = useState(true)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setTrendLoading(true)
      const { data, error } = await supabase.rpc('fn_branch_transfer_trend', {
        p_from: fromTs, p_to: toTs, p_from_branch: row.branch_id, p_to_branch: null, p_bucket: bucket,
      })
      if (cancelled) return
      if (error) { setDetailError(error.message); setTrend([]) }
      else setTrend((data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as unknown as TrendRow[])
      setTrendLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [fromTs, toTs, row.branch_id, bucket])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setBreakdownLoading(true)
      const { data, error } = await supabase.rpc('fn_branch_transfer_breakdown', {
        p_from: fromTs, p_to: toTs, p_from_branch: row.branch_id, p_to_branch: null,
        p_dim: dim, p_sort: 'amount', p_limit: 20,
      })
      if (cancelled) return
      if (error) { setDetailError(error.message); setBreakdown([]) }
      else setBreakdown((data ?? []).map((r: Record<string, unknown>) => coerceRow(r)) as unknown as BreakdownRow[])
      setBreakdownLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [fromTs, toTs, row.branch_id, dim])

  const chartData = useMemo(() => trend.map(t => ({
    label: bucket === 'month'
      ? t.bucket_start.slice(0, 7).split('-').reverse().join('/')
      : t.bucket_start.slice(5).split('-').reverse().join('/'),
    'Giá trị chuyển': t.amount,
    'Lãi nội bộ': t.margin,
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
    { key: 'qty', header: 'SL', width: 80, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{fmtQty(r.qty)}</span> },
    { key: 'transfers', header: 'Phiếu', width: 70, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{r.transfers.toLocaleString('vi-VN')}</span> },
    { key: 'amount', header: 'Giá trị', width: 120, align: 'right', render: (r) => <span className="tabular-nums text-gray-700 font-semibold">{formatCurrency(r.amount)}</span> },
    { key: 'margin', header: 'Lãi nội bộ', width: 120, align: 'right', render: (r) => <span className={`tabular-nums font-bold ${r.margin > 0 ? 'text-[#143C69]' : r.margin < 0 ? 'text-red-600' : 'text-gray-400'}`}>{formatCurrency(r.margin)}</span> },
    {
      key: 'margin_pct', header: 'Biên', width: 85, align: 'right', noTruncate: true, mobileHeaderRight: true,
      render: (r) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-tiny font-bold tabular-nums ${marginClass(r.margin_pct)}`}>{r.margin_pct.toLocaleString('vi-VN')}%</span>,
    },
    { key: 'share', header: 'Tỉ trọng', width: 80, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{r.amount_share.toLocaleString('vi-VN')}%</span> },
  ]

  return (
    <div className="p-4 md:p-5 bg-gray-25 space-y-5">
      {detailError && (
        <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-body-md text-red-700">{detailError}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Stat label="Doanh số nội bộ" value={formatCurrency(row.out_amount)} tone="blue" />
        <Stat label="Giá vốn nguồn" value={formatCurrency(row.out_cost)} />
        <Stat label="Lãi nội bộ" value={formatCurrency(row.out_margin)} tone={row.out_margin >= 0 ? 'emerald' : 'red'} />
        <Stat label="Biên nội bộ" value={`${row.out_margin_pct.toLocaleString('vi-VN')}%`} />
        <Stat label="Phiếu xuất" value={row.out_transfers.toLocaleString('vi-VN')} />
        <Stat label="SL xuất" value={fmtQty(row.out_qty)} />
        <Stat label="Hàng nhận về" value={formatCurrency(row.in_amount)} />
        <Stat label="Chênh so vốn gốc" value={formatCurrency(row.in_markup)} tone={row.in_markup > 0 ? 'amber' : undefined} />
        <Stat label="Phiếu nhận" value={row.in_transfers.toLocaleString('vi-VN')} />
        <Stat label="Luồng ròng" value={formatCurrency(row.net_amount)} tone={row.net_amount >= 0 ? 'blue' : 'amber'} />
        <Stat label="Số CN đối tác" value={`${row.out_partners} nhận / ${row.in_partners} cấp`} />
        <Stat label="Số SP luân chuyển" value={row.out_products.toLocaleString('vi-VN')} />
      </div>

      {/* Xu hướng */}
      <div className="bg-white border border-gray-150 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-body-md font-bold text-gray-700">Xu hướng chuyển kho — {row.branch_name} (chiều xuất)</h4>
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
                <Bar dataKey="Giá trị chuyển" fill="#1E5A9C" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="Lãi nội bộ" stroke="#10b981" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top 20 */}
      <div className="bg-white border border-gray-150 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-body-md font-bold text-gray-700">Top 20 hàng chuyển đi</h4>
          <div className="flex flex-wrap gap-1">
            {BREAK_DIMS.filter(d => PANEL_DIMS.includes(d.id)).map(d => {
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
