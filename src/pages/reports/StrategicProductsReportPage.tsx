import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import {
  ChevronRight, ChevronLeft, Download, Target, Layers, Radio,
  LineChart as LineChartIcon, Lightbulb, Flag, AlertTriangle,
  Building2, Package, TrendingUp, Coins, Scale, ShoppingCart, Plus,
  Settings2, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ComposedChart, Line,
} from 'recharts'
import Layout from '../../components/Layout'
import DataTable, { DataTableColumn } from '../../components/DataTable'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import AssignStrategyModal from './AssignStrategyModal'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useRealtimeTable } from '../../hooks/useRealtimeTable'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useBranches } from '../../hooks/queries/useBranches'
import { qk } from '../../lib/queryClient'
import {
  useStrategicSummary, useStrategicProductList, useStrategicSuggestions,
  useStrategicAlerts, useStrategicTrend, useStrategicToday, useStrategicTodayOrders,
  useBranchMonthTargets, useStrategicConfig, useAssignStrategy,
  useUpsertBranchTarget, useSaveStrategicConfig,
  StratProductRow, StratSuggestionRow, StratAlertRow, StratTodayOrderRow,
  StratSummaryRow, StratProductSort, StrategyClass, DEFAULT_STRATEGIC_CONFIG,
} from '../../hooks/queries/useStrategicProducts'

// ─────────────────────────────────────────────────────────────
// Báo cáo SP chiến lược & Tối ưu lợi nhuận (admin-only)
// Nhóm 1 (strategic): markup ≥50% giá vốn — nguồn lãi chính, mục tiêu ≥30% doanh số.
// Nhóm 2 (baseline): hàng nền bắt buộc có, quay nhanh, hòa/lỗ — nhóm 1 bù nhóm 2.
// Realtime: subscribe orders → debounce 2s → invalidate toàn bộ query module.
// ─────────────────────────────────────────────────────────────

type TabId = 'today' | 'overview' | 'strategic' | 'baseline' | 'suggestions' | 'targets'

const TABS: { id: TabId; label: string; icon: typeof Target }[] = [
  { id: 'today', label: 'Hôm nay (LIVE)', icon: Radio },
  { id: 'overview', label: 'Tổng quan & Cảnh báo', icon: LineChartIcon },
  { id: 'strategic', label: 'SP nhóm 1 — Chiến lược', icon: Target },
  { id: 'baseline', label: 'SP nhóm 2 — Hàng nền', icon: Layers },
  { id: 'suggestions', label: 'Gợi ý phân loại', icon: Lightbulb },
  { id: 'targets', label: 'Mục tiêu & Cấu hình', icon: Flag },
]

const PAGE_SIZE = 50

const ORDER_STATUS_VI: Record<string, string> = {
  confirmed: 'Đã xác nhận', shipping: 'Đang giao', delivered: 'Đã giao',
  paid: 'Đã thanh toán', completed: 'Hoàn tất',
}

const SORT_OPTIONS: { value: StratProductSort; label: string }[] = [
  { value: 'revenue', label: 'Doanh thu cao nhất' },
  { value: 'profit', label: 'Lợi nhuận cao nhất' },
  { value: 'markup', label: 'Markup cao nhất' },
  { value: 'qty', label: 'Số lượng bán' },
  { value: 'sold_30d', label: 'Bán chạy 30 ngày' },
  { value: 'days_to_oos', label: 'Sắp hết hàng trước' },
  { value: 'gmroi', label: 'GMROI cao nhất' },
]

const fmtQty = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : `${(v * 100).toLocaleString('vi-VN', { maximumFractionDigits: digits })}%`
const fmtGmroi = (v: number | null) =>
  v == null ? '—' : `${v.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}×`
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'

function alertText(a: StratAlertRow, formatCurrency: (n: number) => string): string {
  switch (a.alert_type) {
    case 'share_below_target':
      return `${a.branch_name}: tỉ trọng nhóm 1 mới đạt ${fmtPct(a.metric)} — dưới mục tiêu ${fmtPct(a.threshold)}. Đẩy bán SP chiến lược.`
    case 'strategic_below_markup':
      return `${a.branch_name}: ${a.item_count} SP nhóm 1 đang bán DƯỚI markup chuẩn ${fmtPct(a.threshold, 0)} — xem tab "SP nhóm 1" để tăng giá/cắt chiết khấu.`
    case 'baseline_deep_loss':
      return `${a.branch_name}: ${a.item_count} SP hàng nền lỗ sâu hơn sàn cho phép (${fmtPct(a.threshold)}) — xem tab "SP nhóm 2".`
    case 'cross_subsidy_negative':
      return `${a.branch_name}: nhóm 1 KHÔNG gánh nổi lỗ nhóm 2 — lợi nhuận gộp 2 nhóm = ${formatCurrency(a.metric ?? 0)}. Cơ cấu giá đang âm, cần xử lý ngay.`
    case 'pace_behind':
      return `${a.branch_name}: doanh thu ${formatCurrency(a.metric ?? 0)} chậm tiến độ tháng — theo pace lẽ ra phải đạt ${formatCurrency(a.threshold ?? 0)}.`
    case 'strategic_oos_risk':
      return `${a.branch_name}: ${a.item_count} SP nhóm 1 sắp hết hàng (tồn ≤ ${a.threshold ?? 7} ngày bán) — hết là mất nguồn lãi cao.`
    case 'baseline_oos_risk':
      return `${a.branch_name}: ${a.item_count} SP HÀNG NỀN sắp hết (≤ ${a.threshold ?? 7} ngày) — hàng bắt buộc có mặt, nhập bù NGAY kẻo mất khách.`
    default:
      return `${a.branch_name}: ${a.alert_type}`
  }
}

function ClassBadge({ cls }: { cls: string }) {
  if (cls === 'strategic')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold bg-blue-50 text-[#1E5A9C]"><Target size={10} />Nhóm 1</span>
  if (cls === 'baseline')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold bg-emerald-50 text-emerald-700"><Layers size={10} />Nhóm 2</span>
  return <span className="px-2 py-0.5 rounded-full text-tiny font-bold bg-gray-100 text-gray-500">Thường</span>
}

export default function StrategicProductsReportPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { formatCurrency } = useDisplaySettings()

  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // ── Bộ lọc chung: tháng (giờ địa phương) + chi nhánh ──
  const nowLocal = new Date()
  const [ym, setYm] = useState(`${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}`)
  const [branchFilter, setBranchFilter] = useState('')
  const year = Number(ym.slice(0, 4)) || nowLocal.getFullYear()
  const month = Number(ym.slice(5, 7)) || nowLocal.getMonth() + 1

  // ── State tab SP nhóm 1/2 ──
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 350)
  const [sort, setSort] = useState<StratProductSort>('revenue')
  const [page, setPage] = useState(1)
  const [suggestPage, setSuggestPage] = useState(1)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignDefault, setAssignDefault] = useState<StrategyClass>('strategic')
  const [configOpen, setConfigOpen] = useState(false)

  useEffect(() => { setPage(1) }, [debouncedSearch, sort, branchFilter, ym, activeTab])
  useEffect(() => { setSuggestPage(1) }, [branchFilter])

  // ── Queries ──
  const branchesQ = useBranches()
  const period = { year, month, branchId: branchFilter || null }
  const summaryQ = useStrategicSummary(period)
  const alertsQ = useStrategicAlerts(period)
  const trendQ = useStrategicTrend(branchFilter || null, 12)
  const todayQ = useStrategicToday(branchFilter || null)
  const todayOrdersQ = useStrategicTodayOrders(branchFilter || null, 20)
  const productCls: StrategyClass = activeTab === 'baseline' ? 'baseline' : 'strategic'
  const productsQ = useStrategicProductList({
    ...period, cls: productCls, search: debouncedSearch || undefined,
    sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
  })
  const suggestionsQ = useStrategicSuggestions({
    branchId: branchFilter || null, limit: PAGE_SIZE, offset: (suggestPage - 1) * PAGE_SIZE,
  })
  const targetsQ = useBranchMonthTargets(year, month)
  const configQ = useStrategicConfig()
  const config = configQ.data ?? DEFAULT_STRATEGIC_CONFIG

  const assignMutation = useAssignStrategy()
  const targetMutation = useUpsertBranchTarget()
  const configMutation = useSaveStrategicConfig()

  // ── Realtime: đơn mới/đổi trạng thái → debounce 2s → invalidate toàn module ──
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleOrderChange = useCallback(() => {
    if (invalidateTimer.current) clearTimeout(invalidateTimer.current)
    invalidateTimer.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: qk.reports.strategicAll })
    }, 2000)
  }, [queryClient])
  useEffect(() => () => { if (invalidateTimer.current) clearTimeout(invalidateTimer.current) }, [])
  useRealtimeTable({ table: 'orders', event: '*', onData: handleOrderChange })

  const errorMsg = summaryQ.error?.message || productsQ.error?.message
    || alertsQ.error?.message || todayQ.error?.message || suggestionsQ.error?.message

  // ── Tổng hợp KPI ──
  const summaryRows = useMemo(() => summaryQ.data ?? [], [summaryQ.data])
  const overview = useMemo(() => {
    const acc = {
      revenue: 0, revStrategic: 0, revBaseline: 0, revOther: 0,
      profitS: 0, profitB: 0, target: 0, hasTarget: false,
      violations: 0, deepLoss: 0, elapsed: 0,
    }
    for (const r of summaryRows) {
      acc.revenue += r.revenue_total
      acc.revStrategic += r.revenue_strategic
      acc.revBaseline += r.revenue_baseline
      acc.revOther += r.revenue_other
      acc.profitS += r.profit_strategic
      acc.profitB += r.profit_baseline
      acc.violations += r.strategic_violation_count
      acc.deepLoss += r.baseline_deep_loss_count
      acc.elapsed = r.month_elapsed_ratio
      if (r.revenue_target != null) { acc.target += r.revenue_target; acc.hasTarget = true }
    }
    return acc
  }, [summaryRows])
  const overviewShare = overview.revenue > 0 ? overview.revStrategic / overview.revenue : null
  const paceExpected = overview.hasTarget ? overview.target * overview.elapsed : null
  const pacePct = paceExpected && paceExpected > 0 ? overview.revenue / paceExpected : null

  const todayRows = useMemo(() => todayQ.data ?? [], [todayQ.data])
  const today = useMemo(() => {
    const acc = { revenue: 0, revS: 0, revB: 0, profitS: 0, profitB: 0, orders: 0, last: null as string | null }
    for (const r of todayRows) {
      acc.revenue += r.revenue_total; acc.revS += r.revenue_strategic; acc.revB += r.revenue_baseline
      acc.profitS += r.profit_strategic; acc.profitB += r.profit_baseline; acc.orders += r.order_count
      if (r.last_order_at && (!acc.last || r.last_order_at > acc.last)) acc.last = r.last_order_at
    }
    return acc
  }, [todayRows])
  const todayShare = today.revenue > 0 ? today.revS / today.revenue : null

  const alerts = alertsQ.data ?? []
  const productRows = productsQ.data ?? []
  const totalProducts = productRows[0]?.total_count ?? 0
  const suggestionRows = suggestionsQ.data ?? []
  const totalSuggestions = suggestionRows[0]?.total_count ?? 0

  // ── Chart data ──
  const branchBarData = useMemo(() => summaryRows.map(r => ({
    name: r.branch_name.replace('Chi nhánh ', ''),
    'Nhóm 1': r.revenue_strategic,
    'Nhóm 2': r.revenue_baseline,
    'Thường': r.revenue_other,
  })), [summaryRows])

  const trendData = useMemo(() => (trendQ.data ?? []).map(r => ({
    ym: r.ym,
    sharePct: r.strategic_share == null ? 0 : Math.round(r.strategic_share * 1000) / 10,
    crossSubsidy: r.cross_subsidy,
  })), [trendQ.data])

  // ── Thao tác gán/gỡ nhóm ──
  const handleRemove = (r: StratProductRow) => {
    if (!window.confirm(`Gỡ "${r.product_name}" khỏi nhóm? SP sẽ trở về hàng thường.`)) return
    assignMutation.mutate({ productId: r.product_id, cls: null })
  }
  const handleMove = (r: StratProductRow, cls: StrategyClass) => {
    assignMutation.mutate({ productId: r.product_id, cls, note: r.note || undefined })
  }
  const handleAcceptSuggestion = (r: StratSuggestionRow, cls?: StrategyClass) => {
    assignMutation.mutate({ productId: r.product_id, cls: cls ?? r.suggested_class, note: 'Gán từ gợi ý hệ thống' })
  }

  // ── Cột bảng SP nhóm 1/2 ──
  const productColumns = useMemo<DataTableColumn<StratProductRow>[]>(() => {
    const isStrategic = productCls === 'strategic'
    const cols: DataTableColumn<StratProductRow>[] = [
      { key: 'sku', header: 'SKU', width: 105, render: r => <span className="text-gray-400 font-medium">{r.sku}</span> },
      {
        key: 'name', header: 'Sản phẩm', flex: true, minWidth: 210,
        render: r => (
          <div className="min-w-0">
            <div className="font-semibold text-gray-800 truncate">{r.product_name}</div>
            <div className="text-tiny text-gray-400 truncate">{r.brand_name}{r.note ? ` · ${r.note}` : ''}</div>
          </div>
        ),
      },
      {
        key: 'revenue', header: 'Doanh thu', width: 120, align: 'right', mobileHeaderRight: true,
        render: r => <span className="tabular-nums font-bold text-[#143C69]">{formatCurrency(r.revenue)}</span>,
      },
      {
        key: 'profit', header: 'Lợi nhuận', width: 115, align: 'right',
        render: r => <span className={`tabular-nums font-semibold ${r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatCurrency(r.profit)}</span>,
      },
      {
        key: 'markup', header: isStrategic ? 'Markup' : 'Margin', width: 130, align: 'right', noTruncate: true,
        render: r => {
          if (r.missing_cost) return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold bg-amber-50 text-amber-700" title="Có doanh thu nhưng giá vốn = 0 — cập nhật giá vốn lô để tính đúng">
              <AlertTriangle size={11} />Thiếu giá vốn
            </span>
          )
          const v = isStrategic ? r.markup_actual : r.margin
          if (v == null) return <span className="text-gray-300">—</span>
          const unitCost = r.qty > 0 ? r.cogs / r.qty : null
          return (
            <div className="text-right">
              <span className={`tabular-nums font-bold ${r.is_violation ? 'text-red-600' : 'text-emerald-700'}`}>{fmtPct(v)}</span>
              {r.is_violation && isStrategic && unitCost != null && (
                <div className="text-tiny text-red-500" title="Giá bán tối thiểu để đạt markup chuẩn">
                  cần bán ≥ {formatCurrency(Math.ceil(unitCost * (1 + config.markup_min)))}
                </div>
              )}
              {r.is_violation && !isStrategic && (
                <div className="text-tiny text-red-500">lỗ sâu hơn sàn {fmtPct(config.baseline_loss_floor)}</div>
              )}
            </div>
          )
        },
      },
      { key: 'sold30', header: 'Bán 30n', width: 85, align: 'right', hideOnMobile: true, render: r => <span className="tabular-nums text-gray-600">{fmtQty(r.sold_30d)}</span> },
      {
        key: 'stock', header: 'Tồn / Hết sau', width: 125, align: 'right', noTruncate: true,
        render: r => (
          <div className="text-right">
            <span className="tabular-nums font-semibold">{fmtQty(r.stock_on_hand)}<span className="text-gray-400 font-normal text-tiny"> {r.unit}</span></span>
            {r.days_to_oos != null && (
              <div className={`text-tiny font-semibold ${r.days_to_oos <= config.oos_warn_days ? 'text-red-600' : 'text-gray-400'}`}>
                {r.days_to_oos <= config.oos_warn_days ? '⚠ ' : ''}hết sau ~{Math.round(r.days_to_oos)} ngày
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'gmroi', header: 'GMROI', width: 80, align: 'right', hideOnMobile: true,
        render: r => <span className={`tabular-nums font-semibold ${r.gmroi != null && r.gmroi < 0 ? 'text-red-600' : 'text-gray-700'}`} title="Lãi gộp 90 ngày quy năm ÷ vốn tồn kho hiện tại">{fmtGmroi(r.gmroi)}</span>,
      },
      {
        key: 'actions', header: '', width: 120, align: 'right', noTruncate: true,
        render: r => (
          <div className="flex justify-end gap-1.5">
            <button
              onClick={e => { e.stopPropagation(); handleMove(r, isStrategic ? 'baseline' : 'strategic') }}
              className="px-2 py-1 rounded text-tiny font-semibold text-gray-500 hover:bg-gray-100"
              title={isStrategic ? 'Chuyển sang nhóm 2 — Hàng nền' : 'Chuyển sang nhóm 1 — Chiến lược'}
            >
              → Nhóm {isStrategic ? '2' : '1'}
            </button>
            <button
              onClick={e => { e.stopPropagation(); handleRemove(r) }}
              className="px-2 py-1 rounded text-tiny font-semibold text-red-500 hover:bg-red-50"
              title="Gỡ khỏi nhóm (về hàng thường)"
            >
              Gỡ
            </button>
          </div>
        ),
      },
    ]
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productCls, formatCurrency, config.markup_min, config.baseline_loss_floor, config.oos_warn_days])

  const suggestionColumns = useMemo<DataTableColumn<StratSuggestionRow>[]>(() => [
    { key: 'sku', header: 'SKU', width: 105, render: r => <span className="text-gray-400 font-medium">{r.sku}</span> },
    {
      key: 'name', header: 'Sản phẩm', flex: true, minWidth: 200,
      render: r => <span className="font-semibold text-gray-800">{r.product_name}</span>,
    },
    { key: 'suggest', header: 'Gợi ý', width: 100, noTruncate: true, render: r => <ClassBadge cls={r.suggested_class} /> },
    {
      key: 'rev', header: 'DT 90 ngày', width: 125, align: 'right', mobileHeaderRight: true,
      render: r => <span className="tabular-nums font-bold text-[#143C69]">{formatCurrency(r.revenue_90d)}</span>,
    },
    { key: 'qty', header: 'SL 90n', width: 85, align: 'right', hideOnMobile: true, render: r => <span className="tabular-nums text-gray-600">{fmtQty(r.qty_90d)}</span> },
    {
      key: 'markup', header: 'Markup 90n', width: 100, align: 'right',
      render: r => <span className={`tabular-nums font-semibold ${r.markup_90d != null && r.markup_90d >= config.markup_min ? 'text-emerald-700' : 'text-gray-600'}`}>{fmtPct(r.markup_90d)}</span>,
    },
    {
      key: 'actions', header: '', width: 170, align: 'right', noTruncate: true,
      render: r => (
        <div className="flex justify-end gap-1.5">
          <button
            onClick={e => { e.stopPropagation(); handleAcceptSuggestion(r) }}
            className="px-2.5 py-1 rounded-md text-tiny font-bold text-white bg-[#1E5A9C] hover:bg-[#143C69]"
          >
            Chấp nhận
          </button>
          <button
            onClick={e => { e.stopPropagation(); handleAcceptSuggestion(r, r.suggested_class === 'strategic' ? 'baseline' : 'strategic') }}
            className="px-2 py-1 rounded-md text-tiny font-semibold text-gray-500 hover:bg-gray-100"
            title="Gán vào nhóm còn lại"
          >
            Nhóm {r.suggested_class === 'strategic' ? '2' : '1'}
          </button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [formatCurrency, config.markup_min])

  const summaryColumns = useMemo<DataTableColumn<StratSummaryRow>[]>(() => [
    {
      key: 'branch', header: 'Chi nhánh', flex: true, minWidth: 160,
      render: r => <span className="font-semibold text-gray-800">{r.branch_name}</span>,
    },
    { key: 'rev', header: 'Doanh thu', width: 125, align: 'right', mobileHeaderRight: true, render: r => <span className="tabular-nums font-bold text-[#143C69]">{formatCurrency(r.revenue_total)}</span> },
    {
      key: 'share', header: 'Tỉ trọng N1', width: 110, align: 'right', noTruncate: true,
      render: r => {
        const below = r.strategic_share != null && r.strategic_share < r.strategic_share_target
        return <span className={`tabular-nums font-bold ${below ? 'text-red-600' : 'text-emerald-700'}`}>{fmtPct(r.strategic_share)}<span className="text-gray-400 font-normal text-tiny"> /{fmtPct(r.strategic_share_target, 0)}</span></span>
      },
    },
    { key: 'profitS', header: 'LN nhóm 1', width: 110, align: 'right', render: r => <span className="tabular-nums text-gray-700">{formatCurrency(r.profit_strategic)}</span> },
    { key: 'profitB', header: 'LN nhóm 2', width: 110, align: 'right', render: r => <span className={`tabular-nums ${r.profit_baseline < 0 ? 'text-red-600' : 'text-gray-700'}`}>{formatCurrency(r.profit_baseline)}</span> },
    {
      key: 'cross', header: 'Bù chéo', width: 110, align: 'right', noTruncate: true,
      render: r => <span className={`tabular-nums font-bold ${r.cross_subsidy < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatCurrency(r.cross_subsidy)}</span>,
    },
    {
      key: 'target', header: 'Mục tiêu tháng', width: 130, align: 'right', hideOnMobile: true,
      render: r => r.revenue_target == null
        ? <span className="text-gray-300">Chưa đặt</span>
        : <span className="tabular-nums text-gray-600">{formatCurrency(r.revenue_target)}</span>,
    },
    {
      key: 'gmroi', header: 'GMROI N1/N2', width: 110, align: 'right', hideOnMobile: true,
      render: r => <span className="tabular-nums text-gray-600">{fmtGmroi(r.gmroi_strategic)} / {fmtGmroi(r.gmroi_baseline)}</span>,
    },
  ], [formatCurrency])

  const todayOrderColumns = useMemo<DataTableColumn<StratTodayOrderRow>[]>(() => [
    { key: 'code', header: 'Code', width: 130, render: r => <span className="font-semibold text-[#1E5A9C]">{r.order_code}</span> },
    { key: 'time', header: 'Giờ', width: 70, render: r => <span className="tabular-nums text-gray-500">{fmtTime(r.created_at)}</span> },
    { key: 'customer', header: 'Khách hàng', flex: true, minWidth: 160, render: r => <span className="text-gray-700">{r.customer_name}</span> },
    { key: 'branch', header: 'CN', width: 120, hideOnMobile: true, render: r => <span className="text-gray-500">{r.branch_name.replace('Chi nhánh ', '')}</span> },
    {
      key: 'total', header: 'Tổng', width: 115, align: 'right', mobileHeaderRight: true,
      render: r => <span className="tabular-nums font-bold text-[#143C69]">{formatCurrency(r.grand_total)}</span>,
    },
    {
      key: 'mix', header: 'Cơ cấu N1/N2', width: 160, align: 'right', noTruncate: true,
      render: r => (
        <span className="text-tiny tabular-nums">
          <span className="text-[#1E5A9C] font-semibold">{formatCurrency(r.revenue_strategic)}</span>
          <span className="text-gray-300"> / </span>
          <span className="text-emerald-700 font-semibold">{formatCurrency(r.revenue_baseline)}</span>
        </span>
      ),
    },
    {
      key: 'status', header: 'Trạng thái', width: 110, noTruncate: true,
      render: r => <span className="px-2 py-0.5 rounded-full text-tiny font-semibold bg-gray-100 text-gray-600 whitespace-nowrap">{ORDER_STATUS_VI[r.status] ?? r.status}</span>,
    },
  ], [formatCurrency])

  // ── Tab Mục tiêu: state edit theo chi nhánh ──
  const branches = useMemo(() => branchesQ.data ?? [], [branchesQ.data])
  const [targetEdits, setTargetEdits] = useState<Record<string, { rev: string; share: string }>>({})
  useEffect(() => {
    const map: Record<string, { rev: string; share: string }> = {}
    for (const b of branches) {
      const t = (targetsQ.data ?? []).find(x => x.branch_id === b.id)
      map[b.id] = {
        rev: t ? String(t.revenue_target) : '',
        share: t ? String(Math.round(t.strategic_share_target * 100)) : '30',
      }
    }
    setTargetEdits(map)
  }, [branches, targetsQ.data])

  const handleSaveTarget = (branchId: string) => {
    const e = targetEdits[branchId]
    if (!e) return
    const rev = Number(e.rev.replace(/[^\d]/g, '')) || 0
    const share = Math.min(100, Math.max(0, Number(e.share) || 30))
    targetMutation.mutate({ branchId, year, month, revenueTarget: rev, shareTarget: share / 100 })
  }

  // ── Cấu hình ngưỡng ──
  const [cfgEdit, setCfgEdit] = useState({ markup: '50', loss: '5', minRev: '5000000', minQty: '30', oosDays: '7' })
  useEffect(() => {
    if (!configQ.data) return
    setCfgEdit({
      markup: String(Math.round(configQ.data.markup_min * 100)),
      loss: String(Math.round(Math.abs(configQ.data.baseline_loss_floor) * 100)),
      minRev: String(configQ.data.suggest_min_revenue_90d),
      minQty: String(configQ.data.suggest_min_qty_90d),
      oosDays: String(configQ.data.oos_warn_days),
    })
  }, [configQ.data])
  const handleSaveConfig = () => {
    configMutation.mutate({
      markup_min: (Number(cfgEdit.markup) || 50) / 100,
      baseline_loss_floor: -Math.abs(Number(cfgEdit.loss) || 5) / 100,
      suggest_min_revenue_90d: Number(cfgEdit.minRev) || 5_000_000,
      suggest_min_qty_90d: Number(cfgEdit.minQty) || 30,
      oos_warn_days: Number(cfgEdit.oosDays) || 7,
    })
  }

  // ── Xuất CSV theo tab ──
  const handleExport = () => {
    const todayStr = new Date().toISOString().slice(0, 10)
    let csvRows: Record<string, string | number>[] = []
    if (activeTab === 'strategic' || activeTab === 'baseline') {
      csvRows = productRows.map(r => ({
        'SKU': r.sku, 'Sản phẩm': r.product_name, 'ĐVT': r.unit, 'Nhóm': r.class === 'strategic' ? 'Nhóm 1' : 'Nhóm 2',
        'SL bán': r.qty, 'Doanh thu': r.revenue, 'Giá vốn': r.cogs, 'Lợi nhuận': r.profit,
        'Markup (%)': r.markup_actual == null ? '' : Math.round(r.markup_actual * 1000) / 10,
        'Margin (%)': r.margin == null ? '' : Math.round(r.margin * 1000) / 10,
        'Bán 30 ngày': r.sold_30d, 'Tồn': r.stock_on_hand, 'Hết sau (ngày)': r.days_to_oos ?? '',
        'GMROI': r.gmroi ?? '', 'Vi phạm': r.is_violation ? 'X' : '', 'Thiếu giá vốn': r.missing_cost ? 'X' : '',
        'Ghi chú': r.note ?? '',
      }))
    } else if (activeTab === 'suggestions') {
      csvRows = suggestionRows.map(r => ({
        'SKU': r.sku, 'Sản phẩm': r.product_name, 'Gợi ý': r.suggested_class === 'strategic' ? 'Nhóm 1' : 'Nhóm 2',
        'DT 90 ngày': r.revenue_90d, 'SL 90 ngày': r.qty_90d, 'LN 90 ngày': r.profit_90d,
        'Markup 90n (%)': r.markup_90d == null ? '' : Math.round(r.markup_90d * 1000) / 10,
      }))
    } else if (activeTab === 'today') {
      csvRows = (todayOrdersQ.data ?? []).map(r => ({
        'Code': r.order_code, 'Giờ': fmtTime(r.created_at), 'Khách hàng': r.customer_name, 'Chi nhánh': r.branch_name,
        'Tổng': r.grand_total, 'DT nhóm 1': r.revenue_strategic, 'DT nhóm 2': r.revenue_baseline, 'Trạng thái': r.status,
      }))
    } else {
      csvRows = summaryRows.map(r => ({
        'Chi nhánh': r.branch_name, 'Doanh thu': r.revenue_total,
        'DT nhóm 1': r.revenue_strategic, 'DT nhóm 2': r.revenue_baseline, 'DT thường': r.revenue_other,
        'Tỉ trọng N1 (%)': r.strategic_share == null ? '' : Math.round(r.strategic_share * 1000) / 10,
        'LN nhóm 1': r.profit_strategic, 'LN nhóm 2': r.profit_baseline, 'Bù chéo': r.cross_subsidy,
        'Mục tiêu': r.revenue_target ?? '', 'GMROI N1': r.gmroi_strategic ?? '', 'GMROI N2': r.gmroi_baseline ?? '',
      }))
    }
    const csv = '﻿' + Papa.unparse(csvRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `sp-chien-luoc_${activeTab}_${todayStr}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const branchOptions = useMemo(() => [
    { value: '', label: 'Tất cả chi nhánh' },
    ...branches.map(b => ({ value: b.id, label: b.name })),
  ], [branches])

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
          <span className="text-blue-600 font-semibold">Sản phẩm chiến lược & Tối ưu lợi nhuận</span>
        </div>

        {/* Header + bộ lọc chung */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-gray-800 leading-tight">Sản phẩm chiến lược & Tối ưu lợi nhuận</h1>
            <p className="text-gray-500 text-body-md mt-1">
              Nhóm 1 (markup ≥{fmtPct(config.markup_min, 0)} giá vốn) phải đạt ≥{fmtPct(0.3, 0)} doanh số · nhóm 2 hàng nền quay nhanh, nhóm 1 bù nhóm 2.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start">
            <div className="w-52">
              <SmartSearchSelect
                options={branchOptions}
                value={branchFilter}
                onChange={setBranchFilter}
                placeholder="Tất cả chi nhánh"
                searchPlaceholder="Tìm chi nhánh…"
                icon={<Building2 size={16} />}
              />
            </div>
            {activeTab !== 'today' && (
              <input
                type="month"
                value={ym}
                onChange={e => e.target.value && setYm(e.target.value)}
                className="h-10 px-3 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            )}
            <button
              onClick={handleExport}
              className="h-10 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-[#143C69] active:scale-95 transition-all shadow-sm"
            >
              <Download size={16} />
              Xuất CSV
            </button>
          </div>
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-4 text-body-md text-red-700">{errorMsg}</div>
        )}

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
                <Icon size={15} className={t.id === 'today' ? 'text-emerald-500' : undefined} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* ════════ TAB: HÔM NAY (LIVE) ════════ */}
        {activeTab === 'today' && (
          <>
            <div className="flex items-center gap-2 text-tiny text-gray-500">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <span className="font-semibold text-emerald-700">Live</span>
              · tự cập nhật khi có đơn mới
              {todayQ.dataUpdatedAt > 0 && <span>· cập nhật lúc {fmtTime(new Date(todayQ.dataUpdatedAt).toISOString())}</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <KpiCard icon={<Coins size={20} />} label="Doanh thu hôm nay" highlight
                value={todayQ.isLoading ? '…' : formatCurrency(today.revenue)}
                sub={`${today.orders} đơn đã chốt${today.last ? ` · đơn gần nhất ${fmtTime(today.last)}` : ''}`} />
              <KpiCard icon={<Target size={20} />} label="Tỉ trọng nhóm 1 hôm nay"
                value={todayQ.isLoading ? '…' : fmtPct(todayShare)}
                sub={`Mục tiêu ≥ ${fmtPct(0.3, 0)} · DT nhóm 1: ${formatCurrency(today.revS)}`}
                valueClass={todayShare != null && todayShare < 0.3 ? 'text-red-600' : 'text-emerald-700'} />
              <KpiCard icon={<Scale size={20} />} label="LN nhóm 1 / nhóm 2 hôm nay"
                value={todayQ.isLoading ? '…' : `${formatCurrency(today.profitS)} / ${formatCurrency(today.profitB)}`}
                sub={`Bù chéo: ${formatCurrency(today.profitS + today.profitB)}`} />
              <KpiCard icon={<ShoppingCart size={20} />} label="DT hàng nền hôm nay"
                value={todayQ.isLoading ? '…' : formatCurrency(today.revB)}
                sub="Hàng nền kéo khách — theo dõi xoay dòng tiền" />
            </div>
            <DataTable<StratTodayOrderRow>
              columns={todayOrderColumns}
              rows={todayOrdersQ.data ?? []}
              getRowKey={r => r.order_id}
              loading={todayOrdersQ.isLoading}
              emptyText="Hôm nay chưa có đơn hàng nào được chốt"
              emptyIcon={<ShoppingCart size={32} className="mx-auto text-gray-200" />}
              itemLabel="đơn hôm nay"
              pageSize={20}
            />
          </>
        )}

        {/* ════════ TAB: TỔNG QUAN & CẢNH BÁO ════════ */}
        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <KpiCard icon={<Coins size={20} />} label={`Doanh thu tháng ${month}/${year}`} highlight
                value={summaryQ.isLoading ? '…' : formatCurrency(overview.revenue)}
                sub={pacePct != null
                  ? `Pace: ${fmtPct(pacePct, 0)} so với tiến độ mục tiêu (${formatCurrency(paceExpected ?? 0)})`
                  : overview.hasTarget ? '' : 'Chưa đặt mục tiêu tháng — vào tab Mục tiêu'} />
              <KpiCard icon={<Target size={20} />} label="Tỉ trọng nhóm 1"
                value={summaryQ.isLoading ? '…' : fmtPct(overviewShare)}
                sub={`Mục tiêu ≥ 30% · DT nhóm 1: ${formatCurrency(overview.revStrategic)}`}
                valueClass={overviewShare != null && overviewShare < 0.3 ? 'text-red-600' : 'text-emerald-700'} />
              <KpiCard icon={<Scale size={20} />} label="LN nhóm 1 / nhóm 2"
                value={summaryQ.isLoading ? '…' : `${formatCurrency(overview.profitS)} / ${formatCurrency(overview.profitB)}`}
                sub={`${overview.violations} SP nhóm 1 dưới markup · ${overview.deepLoss} SP nền lỗ sâu`} />
              <KpiCard icon={<TrendingUp size={20} />} label="Bù chéo (LN nhóm 1 + nhóm 2)"
                value={summaryQ.isLoading ? '…' : formatCurrency(overview.profitS + overview.profitB)}
                sub="Dương = nhóm 1 gánh được hàng nền"
                valueClass={overview.profitS + overview.profitB < 0 ? 'text-red-600' : 'text-emerald-700'} />
            </div>

            {/* Banner cảnh báo */}
            {!alertsQ.isLoading && alerts.length > 0 && (
              <div className="flex flex-col gap-2">
                {alerts.map((a, i) => (
                  <div key={i} className={`rounded-lg p-3.5 flex items-start gap-2.5 text-body-md border ${
                    a.severity === 'critical' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-800'
                  }`}>
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>{alertText(a, formatCurrency)}</span>
                  </div>
                ))}
              </div>
            )}
            {!alertsQ.isLoading && alerts.length === 0 && overview.revenue > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3.5 text-body-md text-emerald-700">
                ✓ Không có cảnh báo nào trong kỳ — cơ cấu nhóm 1/nhóm 2 đang lành mạnh.
              </div>
            )}

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
                <h3 className="text-body-md font-bold text-gray-700 mb-4">Doanh thu 3 nhóm theo chi nhánh</h3>
                <div className="h-72">
                  {summaryQ.isLoading ? (
                    <div className="h-full flex items-center justify-center text-gray-300 text-tiny">Đang tải…</div>
                  ) : branchBarData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-300 text-tiny">Không có dữ liệu</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={branchBarData} margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v >= 1e9 ? `${(v / 1e9).toLocaleString('vi-VN')}tỷ` : `${Math.round(v / 1e6)}tr`} />
                        <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Nhóm 1" stackId="a" fill="#1E5A9C" />
                        <Bar dataKey="Nhóm 2" stackId="a" fill="#10b981" />
                        <Bar dataKey="Thường" stackId="a" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
                <h3 className="text-body-md font-bold text-gray-700 mb-4">Xu hướng 12 tháng: tỉ trọng nhóm 1 & bù chéo</h3>
                <div className="h-72">
                  {trendQ.isLoading ? (
                    <div className="h-full flex items-center justify-center text-gray-300 text-tiny">Đang tải…</div>
                  ) : trendData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-300 text-tiny">Không có dữ liệu</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={trendData} margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="ym" tick={{ fontSize: 11, fill: '#475569' }} />
                        <YAxis yAxisId="money" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `${Math.round(v / 1e6)}tr`} />
                        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#1E5A9C' }} tickFormatter={(v: number) => `${v}%`} />
                        <Tooltip formatter={(v, name) => name === 'Tỉ trọng N1 (%)' ? `${v}%` : formatCurrency(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar yAxisId="money" dataKey="crossSubsidy" name="Bù chéo (LN N1+N2)" fill="#10b981" radius={[4, 4, 0, 0]} barSize={18} />
                        <Line yAxisId="pct" type="monotone" dataKey="sharePct" name="Tỉ trọng N1 (%)" stroke="#1E5A9C" strokeWidth={2.5} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Bảng summary theo chi nhánh */}
            <DataTable<StratSummaryRow>
              columns={summaryColumns}
              rows={summaryRows}
              getRowKey={r => r.branch_id ?? 'no-branch'}
              loading={summaryQ.isLoading}
              emptyText="Chưa có doanh thu trong kỳ"
              emptyIcon={<Building2 size={32} className="mx-auto text-gray-200" />}
              itemLabel="chi nhánh"
              pageSize={0}
            />
          </>
        )}

        {/* ════════ TAB: SP NHÓM 1 / NHÓM 2 ════════ */}
        {(activeTab === 'strategic' || activeTab === 'baseline') && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm SP theo tên (không dấu) hoặc SKU…"
                className="h-10 px-3 w-full sm:w-72 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
              />
              <select
                value={sort}
                onChange={e => setSort(e.target.value as StratProductSort)}
                className="h-10 px-3 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-700 bg-white focus:outline-none"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button
                onClick={() => { setAssignDefault(productCls); setAssignOpen(true) }}
                className="h-10 px-4 border border-[#1E5A9C] text-[#1E5A9C] rounded-lg font-semibold text-tiny flex items-center gap-1.5 hover:bg-blue-50 transition-all"
              >
                <Plus size={15} />
                Gán SP vào nhóm {productCls === 'strategic' ? '1' : '2'}
              </button>
            </div>
            <DataTable<StratProductRow>
              columns={productColumns}
              rows={productRows}
              getRowKey={r => r.product_id}
              loading={productsQ.isLoading}
              emptyText={`Chưa có SP nào trong nhóm ${productCls === 'strategic' ? '1 — Chiến lược' : '2 — Hàng nền'}. Bấm "Gán SP" hoặc dùng tab Gợi ý phân loại.`}
              emptyIcon={<Package size={32} className="mx-auto text-gray-200" />}
              itemLabel="sản phẩm"
              manualPagination
              page={page}
              onPageChange={setPage}
              pageSize={PAGE_SIZE}
              totalItems={totalProducts}
            />
          </>
        )}

        {/* ════════ TAB: GỢI Ý PHÂN LOẠI ════════ */}
        {activeTab === 'suggestions' && (
          <>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3.5 text-body-md text-blue-800">
              Hệ thống quét <b>90 ngày bán gần nhất</b> của các SP <b>chưa gán nhóm</b>: markup ≥ {fmtPct(config.markup_min, 0)} và doanh thu ≥ {formatCurrency(config.suggest_min_revenue_90d)} → gợi ý <b>Nhóm 1</b>; bán chạy (≥ {config.suggest_min_qty_90d} đơn vị) nhưng biên thấp → gợi ý <b>Nhóm 2</b>.
            </div>
            <DataTable<StratSuggestionRow>
              columns={suggestionColumns}
              rows={suggestionRows}
              getRowKey={r => r.product_id}
              loading={suggestionsQ.isLoading}
              emptyText="Không còn SP nào đủ điều kiện gợi ý — tất cả SP đáng chú ý đã được gán nhóm"
              emptyIcon={<Lightbulb size={32} className="mx-auto text-gray-200" />}
              itemLabel="gợi ý"
              manualPagination
              page={suggestPage}
              onPageChange={setSuggestPage}
              pageSize={PAGE_SIZE}
              totalItems={totalSuggestions}
            />
          </>
        )}

        {/* ════════ TAB: MỤC TIÊU & CẤU HÌNH ════════ */}
        {activeTab === 'targets' && (
          <>
            <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-800">Mục tiêu tháng {month}/{year} theo chi nhánh</h3>
                <p className="text-tiny text-gray-400 mt-0.5">Doanh thu mục tiêu + tỉ trọng nhóm 1 tối thiểu. Pace và cảnh báo tính theo số này.</p>
              </div>
              <div className="divide-y divide-gray-50">
                {branches.map(b => {
                  const edit = targetEdits[b.id] ?? { rev: '', share: '30' }
                  const actual = summaryRows.find(r => r.branch_id === b.id)
                  return (
                    <div key={b.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3">
                      <div className="w-full sm:w-48 font-semibold text-gray-700">{b.name}</div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-tiny text-gray-400">Doanh thu</label>
                        <input
                          value={edit.rev ? Number(edit.rev).toLocaleString('vi-VN') : ''}
                          onChange={e => setTargetEdits(s => ({ ...s, [b.id]: { ...edit, rev: e.target.value.replace(/[^\d]/g, '') } }))}
                          placeholder="VD: 500.000.000"
                          className="h-9 px-3 w-44 border border-gray-200 rounded-lg text-tiny tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <span className="text-tiny text-gray-400">₫</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-tiny text-gray-400">Tỉ trọng N1 ≥</label>
                        <input
                          value={edit.share}
                          onChange={e => setTargetEdits(s => ({ ...s, [b.id]: { ...edit, share: e.target.value.replace(/[^\d]/g, '') } }))}
                          className="h-9 px-2 w-16 border border-gray-200 rounded-lg text-tiny tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <span className="text-tiny text-gray-400">%</span>
                      </div>
                      <button
                        onClick={() => handleSaveTarget(b.id)}
                        disabled={targetMutation.isPending}
                        className="h-9 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny hover:bg-[#143C69] active:scale-95 transition-all disabled:opacity-50"
                      >
                        Lưu
                      </button>
                      {actual && (
                        <div className="text-tiny text-gray-400 ml-auto">
                          Thực tế: <b className="text-gray-600">{formatCurrency(actual.revenue_total)}</b> · N1 {fmtPct(actual.strategic_share)}
                        </div>
                      )}
                    </div>
                  )
                })}
                {branches.length === 0 && (
                  <div className="px-5 py-8 text-center text-gray-300 text-tiny">Chưa có chi nhánh</div>
                )}
              </div>
            </div>

            {/* Cấu hình ngưỡng */}
            <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => setConfigOpen(o => !o)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 font-bold text-gray-800"><Settings2 size={16} />Cấu hình ngưỡng cảnh báo</div>
                {configOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </button>
              {configOpen && (
                <div className="px-5 pb-5 pt-1 border-t border-gray-100 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <ConfigField label="Markup tối thiểu nhóm 1 (%)" hint="SP nhóm 1 bán dưới mức này → vi phạm"
                      value={cfgEdit.markup} onChange={v => setCfgEdit(s => ({ ...s, markup: v }))} suffix="%" />
                    <ConfigField label="Sàn lỗ hàng nền (% doanh thu)" hint="Hàng nền lỗ sâu hơn mức này → cảnh báo"
                      value={cfgEdit.loss} onChange={v => setCfgEdit(s => ({ ...s, loss: v }))} suffix="%" />
                    <ConfigField label="Cảnh báo sắp hết hàng (ngày)" hint="Tồn còn đủ bán ≤ N ngày → cảnh báo"
                      value={cfgEdit.oosDays} onChange={v => setCfgEdit(s => ({ ...s, oosDays: v }))} suffix="ngày" />
                    <ConfigField label="DT 90 ngày tối thiểu để gợi ý nhóm 1 (₫)" hint="Lọc SP doanh thu quá nhỏ khỏi gợi ý"
                      value={cfgEdit.minRev} onChange={v => setCfgEdit(s => ({ ...s, minRev: v }))} suffix="₫" formatNumber />
                    <ConfigField label="SL 90 ngày tối thiểu để gợi ý nhóm 2" hint="Bán đủ chạy mới được coi là hàng nền"
                      value={cfgEdit.minQty} onChange={v => setCfgEdit(s => ({ ...s, minQty: v }))} suffix="đv" />
                  </div>
                  <button
                    onClick={handleSaveConfig}
                    disabled={configMutation.isPending}
                    className="h-10 px-5 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny hover:bg-[#143C69] active:scale-95 transition-all disabled:opacity-50"
                  >
                    {configMutation.isPending ? 'Đang lưu…' : 'Lưu cấu hình'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footnote */}
        <p className="text-tiny text-gray-400 leading-relaxed">
          * <b>Markup</b> = (doanh thu − giá vốn) ÷ giá vốn (chuẩn nhóm 1 ≥ {fmtPct(config.markup_min, 0)}); khác <b>Margin</b> = lợi nhuận ÷ doanh thu.
          {' '}<b>Bù chéo</b> = LN nhóm 1 + LN nhóm 2 — dương nghĩa là nhóm 1 gánh được lỗ hàng nền.
          {' '}<b>GMROI</b> = lãi gộp 90 ngày quy năm ÷ vốn tồn kho hiện tại (xấp xỉ) — hàng nền GMROI cao = quay nhanh đáng giữ dù biên thấp.
          {' '}<b>Hết sau ~N ngày</b> = tồn ÷ tốc độ bán bình quân 30 ngày.
          {' '}Phân loại nhóm áp <b>hồi tố</b>: đổi nhóm hôm nay sẽ áp cho toàn bộ số liệu lịch sử.
          {' '}SP <span className="text-amber-700 font-semibold">Thiếu giá vốn</span> không bị tính vi phạm — cập nhật giá vốn lô để số liệu chính xác.
        </p>
      </div>

      <AssignStrategyModal open={assignOpen} onClose={() => setAssignOpen(false)} defaultClass={assignDefault} />
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// KPI card (đồng bộ InventoryValuationReportPage, thêm valueClass)
// ─────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, highlight, valueClass }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; highlight?: boolean; valueClass?: string
}) {
  return (
    <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <div className={`p-2 rounded-lg ${highlight ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>{icon}</div>
      </div>
      <p className="text-tiny text-gray-400 font-medium mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums leading-tight ${valueClass ?? 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-tiny text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function ConfigField({ label, hint, value, onChange, suffix, formatNumber }: {
  label: string; hint: string; value: string; onChange: (v: string) => void; suffix: string; formatNumber?: boolean
}) {
  return (
    <div>
      <label className="block text-tiny font-semibold text-gray-600 mb-1">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          value={formatNumber && value ? Number(value).toLocaleString('vi-VN') : value}
          onChange={e => onChange(e.target.value.replace(/[^\d]/g, ''))}
          className="h-9 px-3 w-full border border-gray-200 rounded-lg text-tiny tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        <span className="text-tiny text-gray-400 shrink-0">{suffix}</span>
      </div>
      <p className="text-tiny text-gray-400 mt-0.5">{hint}</p>
    </div>
  )
}
