import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import {
  ChevronRight, ChevronLeft, Download, Package, Boxes, Coins,
  Warehouse, Tag, FolderTree, Award, RefreshCcw, Hourglass,
  AlertTriangle, CalendarClock, Banknote, TimerReset, Building2, Truck,
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
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import {
  useInventoryValuationSummary,
  useInventoryValuationByProduct,
  useInventoryValuationByGroup,
  fetchAllProductRows,
  DEFAULT_WINDOW_DAYS,
  InvProductRow, InvGroupRow, InvProductSort,
} from '../../hooks/queries/useInventoryValuation'
import { bucketForDays, DEFAULT_EXPIRY_COLORS } from '../../hooks/queries/useInventoryInsights'

// ─────────────────────────────────────────────────────────────
// Báo cáo Kho hàng theo Giá vốn (admin-only) — hướng TỐI ƯU DÒNG VỐN.
//
// Giá vốn TB mỗi SP = bình quân gia quyền theo lô active còn hàng.
// Mọi con số bán là CẦU RÒNG (bán − hàng khách trả).
// Cửa sổ N ngày (tự điền, mặc định 20) vừa đo tốc độ bán vừa là mức tồn mục tiêu:
//   Vốn thừa      = max(0, tồn − bán ròng N ngày) × giá vốn TB
//   Ngày hết hàng = tồn × N / bán ròng N ngày
// ─────────────────────────────────────────────────────────────

type TabId =
  | 'product' | 'excess' | 'stockout'
  | 'brand' | 'category' | 'warehouse' | 'branch'
  | 'top_stock' | 'turnover' | 'slow'

const TABS: { id: TabId; label: string; icon: typeof Package }[] = [
  { id: 'product', label: 'Theo sản phẩm', icon: Package },
  { id: 'excess', label: 'Vốn thừa', icon: Banknote },
  { id: 'stockout', label: 'Sắp hết hàng', icon: TimerReset },
  { id: 'brand', label: 'Theo thương hiệu', icon: Tag },
  { id: 'category', label: 'Theo nhóm hàng', icon: FolderTree },
  { id: 'warehouse', label: 'Theo kho', icon: Warehouse },
  { id: 'branch', label: 'Theo chi nhánh', icon: Building2 },
  { id: 'top_stock', label: 'Top 50 tồn nhiều', icon: Award },
  { id: 'turnover', label: 'Vòng quay nhanh', icon: RefreshCcw },
  { id: 'slow', label: 'Tồn lâu / chậm bán', icon: Hourglass },
]

const PAGE_SIZE = 50
const TOP_LIMIT = 50
const WINDOW_KEY = 'inv_valuation_window_days'
const PIE_COLORS = ['#1E5A9C', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#64748b']

const fmtQty = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')

/** ĐVT chung của tập dòng, null nếu hỗn hợp → KHÔNG được cộng cột số lượng. */
function uniformUnit(rows: { unit: string }[]): string | null {
  if (rows.length === 0) return null
  const u = rows[0].unit
  return rows.every(r => r.unit === u) ? u : null
}

/** Ô "—" cho cột số lượng khi tập gồm nhiều ĐVT (135 kg + 107 chai là vô nghĩa). */
function MixedUnitCell() {
  return (
    <span
      className="text-gray-300 font-normal"
      title="Không cộng được: tập đang xem gồm nhiều đơn vị tính khác nhau (kg, chai, lọ…). Lọc về một nhóm cùng ĐVT để thấy tổng."
    >
      — <span className="text-tiny">nhiều ĐVT</span>
    </span>
  )
}

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

/** Ngày dự kiến hết hàng — càng gần càng đỏ. */
function StockoutCell({ days, date, windowDays }: { days: number | null; date: string | null; windowDays: number }) {
  if (days == null) {
    return (
      <span className="text-gray-300" title={`Không phát sinh bán ròng trong ${windowDays} ngày qua → không ước lượng được`}>
        Không bán
      </span>
    )
  }
  const color = days <= 7 ? 'text-red-600' : days <= windowDays ? 'text-amber-600' : 'text-gray-600'
  return (
    <span className={`tabular-nums font-semibold ${color}`} title={date ? `Dự kiến hết ngày ${fmtDate(date)}` : undefined}>
      {fmtQty(days)} <span className="font-normal text-tiny">ngày</span>
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

  // Cửa sổ N ngày — nhớ giữa các phiên; debounce để gõ số không bắn RPC mỗi phím
  const [windowInput, setWindowInput] = useState<number>(() => {
    const v = Number(localStorage.getItem(WINDOW_KEY))
    return Number.isFinite(v) && v >= 1 && v <= 365 ? v : DEFAULT_WINDOW_DAYS
  })
  const windowDays = useDebouncedValue(windowInput, 500)
  useEffect(() => { localStorage.setItem(WINDOW_KEY, String(windowInput)) }, [windowInput])

  const [productOptions, setProductOptions] = useState<SmartSearchOption[]>([])
  const [warehouseOptions, setWarehouseOptions] = useState<SmartSearchOption[]>([])
  const [brandOptions, setBrandOptions] = useState<SmartSearchOption[]>([])
  const [categoryOptions, setCategoryOptions] = useState<SmartSearchOption[]>([])
  const [exporting, setExporting] = useState(false)

  const isProductShaped =
    activeTab === 'product' || activeTab === 'excess' || activeTab === 'stockout'
    || activeTab === 'top_stock' || activeTab === 'turnover' || activeTab === 'slow'
  /** Tab chỉ lấy Top 50 → dòng tổng là tổng của 50 dòng đang xem, KHÔNG phải toàn bộ. */
  const isTopLimited = isProductShaped && activeTab !== 'product'

  // ── Tham số RPC theo tab (các tab dạng sản phẩm dùng chung 1 RPC) ──
  const filterParams = useMemo(() => ({
    search: search || undefined,
    warehouseId: warehouseFilter || undefined,
    brandId: brandFilter || undefined,
    categoryId: categoryFilter || undefined,
    windowDays,
  }), [search, warehouseFilter, brandFilter, categoryFilter, windowDays])

  const productParams = useMemo(() => {
    const sortByTab: Partial<Record<TabId, InvProductSort>> = {
      excess: 'excess', stockout: 'stockout', turnover: 'turnover', slow: 'idle',
      top_stock: topStockBy as InvProductSort,
    }
    const sort: InvProductSort = sortByTab[activeTab] ?? 'value'
    return activeTab === 'product'
      ? { ...filterParams, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
      // Tab Top 50 vẫn tôn trọng ĐẦY ĐỦ bộ lọc (trước đây chỉ nhận lọc kho →
      // không thể hỏi "hàng chết của thương hiệu X").
      : { ...filterParams, sort, limit: TOP_LIMIT, offset: 0 }
  }, [activeTab, filterParams, page, topStockBy])

  const summaryQ = useInventoryValuationSummary(filterParams)
  const productQ = useInventoryValuationByProduct(productParams, isProductShaped)
  const top10Q = useInventoryValuationByProduct(
    { ...filterParams, sort: 'value', limit: 10, offset: 0 },
  )
  // Chỉ nạp nhóm đang xem (trước đây bắn cả 3 RPC nhóm mỗi lần mở trang).
  // Nhóm hàng luôn nạp vì biểu đồ cơ cấu dùng nó.
  const categoryQ = useInventoryValuationByGroup('category', filterParams)
  const brandQ = useInventoryValuationByGroup('brand', filterParams, activeTab === 'brand')
  const warehouseQ = useInventoryValuationByGroup('warehouse', filterParams, activeTab === 'warehouse')
  const branchQ = useInventoryValuationByGroup('branch', filterParams, activeTab === 'branch')

  const summary = summaryQ.data
  const errorMsg = summaryQ.error?.message || productQ.error?.message
    || brandQ.error?.message || categoryQ.error?.message
    || warehouseQ.error?.message || branchQ.error?.message

  const groupQ = activeTab === 'brand' ? brandQ
    : activeTab === 'category' ? categoryQ
    : activeTab === 'branch' ? branchQ
    : warehouseQ
  // useMemo để tham chiếu mảng ổn định — nếu không, mọi useMemo tổng bên dưới
  // sẽ tính lại mỗi lần render.
  const groupRows = useMemo<InvGroupRow[]>(
    () => (isProductShaped ? [] : (groupQ.data ?? [])),
    [isProductShaped, groupQ.data],
  )
  const productRows = useMemo<InvProductRow[]>(() => productQ.data ?? [], [productQ.data])
  const totalProducts = productRows[0]?.total_count ?? 0

  // Đổi bộ lọc/tab → về trang 1
  useEffect(() => { setPage(1) }, [search, warehouseFilter, brandFilter, categoryFilter, activeTab, windowDays])

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
  const productColumns = useMemo<DataTableColumn<InvProductRow>[]>(() => {
    const cols: DataTableColumn<InvProductRow>[] = [
      { key: 'sku', header: 'SKU', width: 100, render: r => <span className="text-gray-400 font-medium">{r.sku}</span> },
      {
        key: 'name', header: 'Sản phẩm', flex: true, minWidth: 200,
        render: r => (
          <div className="min-w-0">
            <div className="font-semibold text-gray-800 truncate">{r.product_name}</div>
            <div className="text-tiny text-gray-400 truncate">{r.brand_name} · {r.category_name}</div>
          </div>
        ),
      },
      {
        key: 'qty', header: 'Tồn', width: 92, align: 'right',
        render: r => <span className="tabular-nums font-semibold">{fmtQty(r.total_qty)}<span className="text-gray-400 font-normal text-tiny"> {r.unit}</span></span>,
      },
      {
        key: 'avg_cost', header: 'Giá vốn TB', width: 118, align: 'right', noTruncate: true,
        render: r => r.missing_cost
          ? <MissingCostBadge />
          : <span className="tabular-nums text-gray-600">{formatCurrency(r.avg_cost)}</span>,
      },
      {
        key: 'value', header: 'Giá trị vốn', width: 130, align: 'right', mobileHeaderRight: true,
        render: r => <span className="tabular-nums font-bold text-[#143C69]">{formatCurrency(r.total_value)}</span>,
      },
    ]

    const soldWindowCol: DataTableColumn<InvProductRow> = {
      key: 'sold_window', header: `Bán ${windowDays} ngày`, width: 104, align: 'right',
      render: r => (
        <span className="tabular-nums text-gray-700" title="Bán ròng — đã trừ hàng khách trả">
          {fmtQty(r.sold_window)}
        </span>
      ),
    }
    const stockoutCol: DataTableColumn<InvProductRow> = {
      key: 'stockout', header: 'Đủ bán còn', width: 108, align: 'right', noTruncate: true,
      render: r => <StockoutCell days={r.days_to_stockout} date={r.stockout_date} windowDays={windowDays} />,
    }
    const excessCol: DataTableColumn<InvProductRow> = {
      key: 'excess', header: 'Vốn thừa', width: 130, align: 'right', noTruncate: true,
      render: r => r.excess_value > 0
        ? (
          <span
            className="tabular-nums font-bold text-rose-600"
            title={`Thừa ${fmtQty(r.excess_qty)} ${r.unit} so với lượng bán ròng ${windowDays} ngày`}
          >
            {formatCurrency(r.excess_value)}
          </span>
        )
        : <span className="text-emerald-600 text-tiny font-semibold">Vừa đủ</span>,
    }

    if (activeTab === 'product') {
      cols.push(soldWindowCol, stockoutCol, excessCol,
        { key: 'expiry', header: 'HSD gần nhất', width: 118, align: 'right', noTruncate: true, render: r => <ExpiryCell date={r.nearest_expiry} /> })
    }
    if (activeTab === 'excess') {
      cols.push(soldWindowCol, excessCol,
        { key: 'idle_days', header: 'Lần bán cuối', width: 112, align: 'right', render: r => <span className="tabular-nums text-gray-500">{r.last_sale_at ? fmtDate(r.last_sale_at) : 'Chưa bán'}</span> },
        { key: 'expiry', header: 'HSD gần nhất', width: 118, align: 'right', noTruncate: true, render: r => <ExpiryCell date={r.nearest_expiry} /> })
    }
    if (activeTab === 'stockout') {
      cols.push(soldWindowCol, stockoutCol,
        { key: 'stockout_date', header: 'Dự kiến hết', width: 112, align: 'right', render: r => <span className="tabular-nums text-gray-600">{fmtDate(r.stockout_date)}</span> },
        {
          key: 'act', header: '', width: 104, align: 'right', noTruncate: true, hideOnMobile: true,
          render: () => (
            <button
              onClick={e => { e.stopPropagation(); navigate('/inventory/reorder') }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-tiny font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
              title="Mở trang Gợi ý đặt hàng để lập phiếu đặt"
            >
              <Truck size={12} /> Đặt hàng
            </button>
          ),
        })
    }
    if (activeTab === 'top_stock') {
      cols.push(
        { key: 'lots', header: 'Số lô', width: 70, align: 'right', hideOnMobile: true, render: r => <span className="tabular-nums text-gray-500">{r.lot_count}</span> },
        stockoutCol,
        { key: 'expiry', header: 'HSD gần nhất', width: 118, align: 'right', noTruncate: true, render: r => <ExpiryCell date={r.nearest_expiry} /> },
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
          key: 'sold90', header: 'Bán 90 ngày', width: 116, align: 'right', noTruncate: true,
          render: r => r.sold_90d === 0
            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold bg-red-50 text-red-600">Dead stock</span>
            : <span className="tabular-nums">{fmtQty(r.sold_90d)}</span>,
        },
        { key: 'last_sale', header: 'Lần bán cuối', width: 112, align: 'right', render: r => <span className="tabular-nums text-gray-500">{r.last_sale_at ? fmtDate(r.last_sale_at) : 'Chưa bán'}</span> },
        excessCol,
      )
    }
    return cols
  }, [activeTab, formatCurrency, windowDays, navigate])

  const groupLabel = activeTab === 'brand' ? 'Thương hiệu'
    : activeTab === 'category' ? 'Nhóm hàng'
    : activeTab === 'branch' ? 'Chi nhánh' : 'Kho'

  const groupColumns = useMemo<DataTableColumn<InvGroupRow>[]>(() => [
    {
      key: 'name', header: groupLabel, flex: true, minWidth: 190,
      render: r => <span className="font-semibold text-gray-800">{r.group_name}</span>,
    },
    { key: 'products', header: 'Số SP', width: 76, align: 'right', render: r => <span className="tabular-nums text-gray-600">{r.product_count}</span> },
    { key: 'lots', header: 'Số lô', width: 72, align: 'right', hideOnMobile: true, render: r => <span className="tabular-nums text-gray-500">{r.lot_count}</span> },
    {
      key: 'qty', header: 'Tồn', width: 100, align: 'right', noTruncate: true,
      render: r => r.unit_uniform
        ? <span className="tabular-nums font-semibold">{fmtQty(r.total_qty)}</span>
        : <MixedUnitCell />,
    },
    {
      key: 'value', header: 'Giá trị vốn', width: 140, align: 'right', mobileHeaderRight: true,
      render: r => <span className="tabular-nums font-bold text-[#143C69]">{formatCurrency(r.total_value)}</span>,
    },
    {
      key: 'excess', header: 'Vốn thừa', width: 130, align: 'right', noTruncate: true,
      render: r => r.excess_value > 0
        ? <span className="tabular-nums font-bold text-rose-600">{formatCurrency(r.excess_value)}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'dead', header: 'Vốn đọng 90N', width: 130, align: 'right', noTruncate: true,
      render: r => r.dead_value > 0
        ? <span className="tabular-nums font-semibold text-amber-700" title="Giá trị hàng không bán ròng được đơn vị nào trong 90 ngày">{formatCurrency(r.dead_value)}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'share', header: 'Tỉ trọng', width: 116, align: 'right', noTruncate: true,
      render: r => (
        <div className="flex items-center justify-end gap-2">
          <div className="w-10 h-1.5 bg-gray-100 rounded-full overflow-hidden hidden xl:block">
            <div className="h-full bg-[#1E5A9C] rounded-full" style={{ width: `${Math.min(100, r.value_share)}%` }} />
          </div>
          <span className="tabular-nums text-gray-600 font-semibold">{r.value_share.toLocaleString('vi-VN')}%</span>
        </div>
      ),
    },
    {
      key: 'missing', header: 'Thiếu giá vốn', width: 104, align: 'right', noTruncate: true,
      render: r => r.missing_cost_products > 0
        ? <span className="inline-flex items-center gap-1 text-tiny font-bold text-amber-600"><AlertTriangle size={11} />{r.missing_cost_products} SP</span>
        : <span className="text-gray-300">—</span>,
    },
  ], [groupLabel, formatCurrency])

  // ─────────────────────────────────────────────────────────────
  // Dòng "Tổng cộng" trên đầu bảng
  //   • tab Sản phẩm: phân trang server-side → LẤY TỔNG TỪ SERVER
  //     (cộng ở client sẽ ra tổng của TRANG, sai).
  //   • tab Top 50: cộng đúng 50 dòng đang xem, và nói rõ trong nhãn.
  //   • cột số lượng chỉ cộng khi cùng ĐVT.
  // ─────────────────────────────────────────────────────────────
  const productTotals = useMemo<Record<string, ReactNode> | undefined>(() => {
    const cols = new Set(productColumns.map(c => c.key))
    const put = (t: Record<string, ReactNode>, key: string, node: ReactNode) => {
      if (cols.has(key)) t[key] = node
    }
    const t: Record<string, ReactNode> = {}

    if (isTopLimited) {
      if (productRows.length === 0) return undefined
      const unit = uniformUnit(productRows)
      const sum = (f: (r: InvProductRow) => number) => productRows.reduce((s, r) => s + f(r), 0)
      const qty = sum(r => r.total_qty)
      const value = sum(r => r.total_value)
      put(t, 'qty', unit ? <>{fmtQty(qty)} <span className="font-normal text-tiny text-gray-400">{unit}</span></> : <MixedUnitCell />)
      put(t, 'avg_cost', unit && qty > 0 ? formatCurrency(value / qty) : null)
      put(t, 'value', formatCurrency(value))
      put(t, 'sold_window', unit ? fmtQty(sum(r => r.sold_window)) : <MixedUnitCell />)
      put(t, 'sold90', unit ? fmtQty(sum(r => r.sold_90d)) : <MixedUnitCell />)
      put(t, 'excess', <span className="text-rose-600">{formatCurrency(sum(r => r.excess_value))}</span>)
      put(t, 'lots', String(sum(r => r.lot_count)))
      return t
    }

    if (!summary) return undefined
    put(t, 'qty', summary.unit_uniform
      ? <>{fmtQty(summary.total_qty)} <span className="font-normal text-tiny text-gray-400">{summary.unit_label}</span></>
      : <MixedUnitCell />)
    put(t, 'avg_cost', summary.unit_uniform ? formatCurrency(summary.avg_cost_weighted) : null)
    put(t, 'value', formatCurrency(summary.total_value))
    put(t, 'sold_window', summary.unit_uniform ? fmtQty(summary.sold_window) : <MixedUnitCell />)
    put(t, 'excess', <span className="text-rose-600">{formatCurrency(summary.excess_value)}</span>)
    put(t, 'expiry', summary.nearest_expiry
      ? <span className="font-normal text-tiny text-gray-500">sớm nhất {fmtDate(summary.nearest_expiry)}</span>
      : null)
    return t
  }, [productColumns, isTopLimited, productRows, summary, formatCurrency])

  const groupTotals = useMemo<Record<string, ReactNode> | undefined>(() => {
    if (groupRows.length === 0) return undefined
    const sum = (f: (r: InvGroupRow) => number) => groupRows.reduce((s, r) => s + f(r), 0)
    const allUniform = groupRows.every(r => r.unit_uniform) && activeTab !== 'brand' && activeTab !== 'category'
    return {
      products: String(sum(r => r.product_count)),
      lots: String(sum(r => r.lot_count)),
      qty: allUniform ? fmtQty(sum(r => r.total_qty)) : <MixedUnitCell />,
      value: formatCurrency(sum(r => r.total_value)),
      excess: <span className="text-rose-600">{formatCurrency(sum(r => r.excess_value))}</span>,
      dead: <span className="text-amber-700">{formatCurrency(sum(r => r.dead_value))}</span>,
      share: '100%',
      missing: sum(r => r.missing_cost_products) > 0 ? `${sum(r => r.missing_cost_products)} SP` : null,
    }
  }, [groupRows, activeTab, formatCurrency])

  // ── Xuất CSV theo tab đang xem ──
  const handleExport = async () => {
    setExporting(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      let csvRows: Record<string, string | number>[] = []
      if (isProductShaped) {
        // Tab Sản phẩm: xuất TOÀN BỘ tập lọc (trước đây chỉ ra 50 dòng của trang
        // đang xem → người dùng tưởng đã xuất hết để lập kế hoạch tiền).
        const rows = activeTab === 'product'
          ? await fetchAllProductRows(productParams)
          : productRows
        csvRows = rows.map(r => ({
          'SKU': r.sku, 'Sản phẩm': r.product_name, 'ĐVT': r.unit,
          'Thương hiệu': r.brand_name, 'Nhóm hàng': r.category_name,
          'Tồn': r.total_qty, 'Giá vốn TB': r.avg_cost, 'Giá trị vốn': r.total_value,
          'Số lô': r.lot_count, 'HSD gần nhất': r.nearest_expiry ?? '',
          [`Bán ròng ${windowDays} ngày`]: r.sold_window,
          'Bán ròng 30 ngày': r.sold_30d, 'Bán ròng 90 ngày': r.sold_90d,
          'Đủ bán còn (ngày)': r.days_to_stockout ?? '',
          'Dự kiến hết hàng': r.stockout_date ?? '',
          'SL vốn thừa': r.excess_qty, 'Vốn thừa': r.excess_value,
          'Vòng quay 90 ngày': r.turnover_90d, 'Ngày tồn': r.days_of_stock ?? '',
          'Lần bán cuối': r.last_sale_at ? fmtDate(r.last_sale_at) : '',
          'Thiếu giá vốn': r.missing_cost ? 'X' : '',
        }))
      } else {
        csvRows = groupRows.map(r => ({
          [groupLabel]: r.group_name, 'Số SP': r.product_count, 'Số lô': r.lot_count,
          'Tồn': r.unit_uniform ? r.total_qty : '(nhiều ĐVT)',
          'Giá trị vốn': r.total_value, 'Tỉ trọng (%)': r.value_share,
          [`Bán ròng ${windowDays} ngày`]: r.sold_window,
          'Vốn thừa': r.excess_value, 'Vốn đọng 90 ngày': r.dead_value,
          'SP thiếu giá vốn': r.missing_cost_products,
        }))
      }
      const csv = '﻿' + Papa.unparse(csvRows)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `ton-kho-gia-von_${activeTab}_${today}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Không xuất được CSV: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  const exportDisabled = exporting || (isProductShaped ? productRows.length === 0 : groupRows.length === 0)
  const excessShare = summary && summary.total_value > 0
    ? Math.round((summary.excess_value / summary.total_value) * 100) : 0

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
            <p className="text-gray-500 text-body-md mt-1">Giá trị vốn tồn kho · vốn thừa · ngày dự kiến hết hàng — theo sản phẩm, thương hiệu, nhóm hàng, kho, chi nhánh.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3 self-start">
            <div>
              <label className="text-tiny font-bold text-gray-400 uppercase block mb-1">Khoảng thời gian</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min={1} max={365} value={windowInput}
                  onChange={e => setWindowInput(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                  className="h-10 w-20 px-2.5 bg-white border border-gray-150 rounded-lg text-tiny tabular-nums focus:border-blue-500 focus:outline-none"
                  title="Số ngày dùng để đo tốc độ bán VÀ làm mức tồn mục tiêu. Tăng lên nếu hàng bán chậm khiến vốn thừa bị thổi lên."
                />
                <span className="text-tiny text-gray-400">ngày</span>
              </div>
            </div>
            <div className="w-52">
              <label className="text-tiny font-bold text-gray-400 uppercase block mb-1">Kho</label>
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
              {exporting ? 'Đang xuất…' : 'Xuất CSV'}
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <KpiCard icon={<Coins size={20} />} label="Tổng giá trị vốn tồn" highlight
            value={summaryQ.isLoading ? '…' : formatCurrency(summary?.total_value ?? 0)}
            sub="Σ (tồn lô × giá vốn lô) — lô đang bán" />
          <KpiCard icon={<Banknote size={20} />} label={`Vốn thừa (vượt ${windowDays} ngày bán)`} tone="danger"
            value={summaryQ.isLoading ? '…' : formatCurrency(summary?.excess_value ?? 0)}
            sub={summary ? `${excessShare}% tổng vốn tồn · có thể giải phóng` : ''} />
          <KpiCard icon={<Hourglass size={20} />} label="Vốn đọng (không bán 90 ngày)" tone="warning"
            value={summaryQ.isLoading ? '…' : formatCurrency(summary?.dead_value ?? 0)}
            sub={summary ? `${summary.dead_products.toLocaleString('vi-VN')} sản phẩm không bán ròng đơn vị nào` : ''} />
          <KpiCard icon={<TimerReset size={20} />} label={`Sắp hết hàng ≤ ${windowDays} ngày`}
            value={summaryQ.isLoading ? '…' : (summary?.stockout_soon_products ?? 0).toLocaleString('vi-VN') + ' SP'}
            sub={summary ? `Đang giữ ${formatCurrency(summary.stockout_soon_value)} giá trị vốn` : ''} />
          <KpiCard icon={<CalendarClock size={20} />} label="Giá trị sắp hết hạn ≤ 90 ngày"
            value={summaryQ.isLoading ? '…' : formatCurrency(summary?.expiring_90d_value ?? 0)}
            sub={summary && summary.total_value > 0 ? `${Math.round((summary.expiring_90d_value / summary.total_value) * 100)}% tổng giá trị vốn` : ''} />
          <KpiCard icon={<Package size={20} />} label="Sản phẩm có tồn"
            value={summaryQ.isLoading ? '…' : (summary?.product_count ?? 0).toLocaleString('vi-VN')}
            sub={summary
              ? `${summary.lot_count.toLocaleString('vi-VN')} lô · ${summary.warehouse_count} kho`
                + (summary.unit_uniform ? ` · ${fmtQty(summary.total_qty)} ${summary.unit_label}` : '')
                + (summary.non_active_value > 0 ? ` · ${formatCurrency(summary.non_active_value)} ở lô cách ly/hỏng` : '')
              : ''} />
        </div>

        {/* Cảnh báo chọn N vượt quá lịch sử dữ liệu thực có — nếu không, "vốn
            thừa" bị thổi lên âm thầm: mẫu số N ngày nhưng tử số chỉ có chừng
            history_days ngày xuất bán. */}
        {summary && summary.history_days > 0 && windowDays > summary.history_days && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3.5 flex items-start gap-2.5 text-body-md text-amber-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              Hệ thống mới có <b>{summary.history_days} ngày</b> lịch sử xuất bán, nhưng anh đang chọn cửa sổ <b>{windowDays} ngày</b>.
              {' '}Phần vượt không có dữ liệu nên tốc độ bán bị tính thiếu → <b>vốn thừa bị thổi lên</b> và <b>ngày hết hàng bị kéo dài</b>.
              {' '}Nên đặt cửa sổ ≤ {summary.history_days} ngày cho tới khi tích đủ lịch sử.
            </span>
          </div>
        )}

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

        {/* Diễn giải tab dòng vốn */}
        {activeTab === 'excess' && (
          <p className="text-tiny text-gray-500 bg-rose-50/60 border border-rose-100 rounded-lg px-3.5 py-2.5">
            Tiền đang nằm chết: tồn nhiều hơn lượng <b>bán ròng {windowDays} ngày</b> qua. Xử lý bằng khuyến mãi xả, chuyển sang chi nhánh bán được, hoặc ngưng đặt thêm.
          </p>
        )}
        {activeTab === 'stockout' && (
          <p className="text-tiny text-gray-500 bg-blue-50/60 border border-blue-100 rounded-lg px-3.5 py-2.5">
            Sắp đứt hàng theo tốc độ bán ròng {windowDays} ngày qua. Bấm <b>Đặt hàng</b> để sang trang Gợi ý đặt hàng — nơi tính điểm đặt lại (ROP) và tồn an toàn theo lead time.
          </p>
        )}

        {/* Bộ lọc (áp cho MỌI tab dạng sản phẩm) */}
        {isProductShaped && (
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
            {(search || brandFilter || categoryFilter) && (
              <button
                onClick={() => { setSearch(''); setBrandFilter(''); setCategoryFilter('') }}
                className="h-10 px-3 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50"
              >
                Xoá lọc
              </button>
            )}
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
            totals={productTotals}
            totalsLabel="Tổng cộng (toàn bộ bộ lọc)"
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
            resetSignal={activeTab + topStockBy + warehouseFilter + brandFilter + categoryFilter + search + windowDays}
            totals={productTotals}
            totalsLabel={`Tổng ${productRows.length} dòng đang xem`}
          />
        ) : (
          <DataTable<InvGroupRow>
            columns={groupColumns}
            rows={groupRows}
            getRowKey={r => r.group_id ?? r.group_name}
            loading={groupQ.isLoading}
            emptyText="Không có dữ liệu"
            emptyIcon={<Boxes size={32} className="mx-auto text-gray-200" />}
            itemLabel={activeTab === 'warehouse' ? 'kho' : activeTab === 'branch' ? 'chi nhánh' : activeTab === 'brand' ? 'thương hiệu' : 'nhóm hàng'}
            pageSize={20}
            resetSignal={activeTab + warehouseFilter + windowDays}
            totals={groupTotals}
          />
        )}

        {/* Footnote */}
        <p className="text-tiny text-gray-400 leading-relaxed">
          * <b>Giá vốn TB</b> = bình quân gia quyền theo lô: Σ(tồn lô × giá vốn lô) ÷ Σ(tồn lô), chỉ tính lô trạng thái <b>Đang bán</b> còn hàng.
          {' '}<b>Bán ròng</b> = xuất bán − hàng khách trả (nếu chỉ tính xuất bán thì tốc độ bán bị thổi lên → đặt hàng dư).
          {' '}<b>Vốn thừa</b> = (tồn − bán ròng {windowDays} ngày) × giá vốn TB — phần vốn vượt nhu cầu {windowDays} ngày, có thể giải phóng.
          {' '}<b>Đủ bán còn</b> = tồn ÷ tốc độ bán ròng bình quân/ngày ({windowDays} ngày gần nhất); "Không bán" nghĩa là {windowDays} ngày qua không phát sinh bán ròng.
          {' '}<b>Vòng quay 90 ngày</b> = số lượng bán ròng 90 ngày ÷ tồn hiện tại (xấp xỉ — dùng tồn hiện tại thay cho tồn bình quân kỳ).
          {' '}Cột <b>Tồn</b> chỉ cộng được khi tập đang xem cùng một ĐVT; khác ĐVT sẽ hiện "—" thay vì một con số vô nghĩa.
          {' '}Dòng <span className="text-amber-700 font-semibold">Thiếu giá vốn</span> là sản phẩm có lô chưa khai giá vốn → giá trị tồn của lô đó đang tính = 0.
        </p>
      </div>
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// KPI card (đồng bộ ProfitReportPage)
// ─────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, highlight, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string
  highlight?: boolean; tone?: 'danger' | 'warning'
}) {
  const iconCls = tone === 'danger' ? 'bg-rose-50 text-rose-600'
    : tone === 'warning' ? 'bg-amber-50 text-amber-600'
    : highlight ? 'bg-emerald-50 text-emerald-600'
    : 'bg-blue-50 text-blue-600'
  return (
    <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <div className={`p-2 rounded-lg ${iconCls}`}>{icon}</div>
      </div>
      <p className="text-tiny text-gray-400 font-medium mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-800 tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-tiny text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}
