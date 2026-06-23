import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, Package, AlertCircle, ShoppingCart, Save, Truck } from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { removeVietnameseTones } from '../../components/SmartSearchSelect'
import { useAuth } from '../../contexts/AuthContext'
import {
  useReorderPlanning, useReorderConfig, useSaveReorderConfig,
  computeReorderPlan, zForServiceLevel, DEFAULT_REORDER_CONFIG,
  type ReorderRow, type ReorderPlan,
} from '../../hooks/queries/useInventoryInsights'

type ReorderVM = ReorderRow & { plan: ReorderPlan }

const SERVICE_OPTIONS = [
  { value: 0.90, label: '90%' },
  { value: 0.95, label: '95%' },
  { value: 0.99, label: '99%' },
]

const numFmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })

export default function ReorderPage() {
  const navigate = useNavigate()
  const { userRole, hasPermission } = useAuth()
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'
  const canCreatePO = hasPermission('purchase_orders.create')

  // Config (nạp mặc định từ system_settings, sau đó là input live mỗi phiên)
  const cfgQuery = useReorderConfig()
  const [leadTimeDays, setLeadTimeDays] = useState(DEFAULT_REORDER_CONFIG.lead_time_days)
  const [serviceLevel, setServiceLevel] = useState(DEFAULT_REORDER_CONFIG.service_level)
  const [coverDays, setCoverDays] = useState(DEFAULT_REORDER_CONFIG.cover_days)
  const [minOrders, setMinOrders] = useState(DEFAULT_REORDER_CONFIG.min_orders)
  const [cfgLoaded, setCfgLoaded] = useState(false)
  useEffect(() => {
    if (cfgQuery.data && !cfgLoaded) {
      setLeadTimeDays(cfgQuery.data.lead_time_days)
      setServiceLevel(cfgQuery.data.service_level)
      setCoverDays(cfgQuery.data.cover_days)
      setMinOrders(cfgQuery.data.min_orders)
      setCfgLoaded(true)
    }
  }, [cfgQuery.data, cfgLoaded])

  const saveCfg = useSaveReorderConfig()
  const handleSaveDefaults = async () => {
    try {
      await saveCfg.mutateAsync({ lead_time_days: leadTimeDays, service_level: serviceLevel, cover_days: coverDays, min_orders: minOrders })
    } catch { alert('Không lưu được cấu hình mặc định (cần quyền quản trị).') }
  }

  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // minOrders là bộ lọc server → đổi sẽ refetch. coverDays/leadTime/Z tính client-side.
  const query = useReorderPlanning(minOrders, true)
  const all = query.data ?? []
  const z = zForServiceLevel(serviceLevel)

  const rows: ReorderVM[] = useMemo(() => {
    const q = removeVietnameseTones(debounced.trim().toLowerCase())
    const withPlan = all.map(r => ({ ...r, plan: computeReorderPlan(r, { leadTimeDays, z, coverDays }) }))
    const filtered = q
      ? withPlan.filter(r => removeVietnameseTones(`${r.name} ${r.sku}`.toLowerCase()).includes(q))
      : withPlan
    // Cần đặt ngay lên đầu; trong cùng nhóm, đủ-bán-còn ít hơn lên trước.
    return filtered.sort((a, b) => {
      if (a.plan.needsReorder !== b.plan.needsReorder) return a.plan.needsReorder ? -1 : 1
      return (a.days_cover ?? 1e9) - (b.days_cover ?? 1e9)
    })
  }, [all, debounced, leadTimeDays, z, coverDays])

  const urgentCount = useMemo(() => rows.filter(r => r.plan.needsReorder).length, [rows])

  // ── Chọn dòng (cho cầu nối tạo PO) ──
  const selectableIds = useMemo(() => rows.map(r => r.product_id), [rows])
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))
  const toggleAll = () => {
    setSelected(prev => {
      if (selectableIds.every(id => prev.has(id))) {
        const next = new Set(prev); selectableIds.forEach(id => next.delete(id)); return next
      }
      return new Set([...prev, ...selectableIds])
    })
  }
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const createPO = () => {
    const prefillLines = rows
      .filter(r => selected.has(r.product_id) && r.plan.suggestedQty > 0)
      .map(r => ({ productId: r.product_id, sku: r.sku, name: r.name, quantity: r.plan.suggestedQty, unitPrice: 0 }))
    if (prefillLines.length === 0) { alert('Chưa chọn mặt hàng nào có gợi ý đặt > 0.'); return }
    navigate('/purchase-orders/new', { state: { prefillLines } })
  }

  const coverColor = (d: number | null) => {
    if (d == null) return 'text-gray-500'
    if (d <= 7) return 'text-danger-600'
    if (d <= 14) return 'text-amber-600'
    return 'text-gray-700'
  }

  const columns: DataTableColumn<ReorderVM>[] = []

  if (canCreatePO) {
    columns.push({
      key: 'sel', header: (
        <input type="checkbox" checked={allSelected} onChange={toggleAll}
          className="cursor-pointer" title="Chọn tất cả" />
      ), width: 44, align: 'center', noTruncate: true, hideOnMobile: false,
      render: (r) => (
        <input type="checkbox" checked={selected.has(r.product_id)}
          onChange={() => toggleOne(r.product_id)} onClick={(e) => e.stopPropagation()}
          className="cursor-pointer" />
      ),
    })
  }

  columns.push(
    {
      key: 'product', header: 'Sản phẩm', flex: true, minWidth: 190,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-bold text-gray-700 flex items-center gap-1.5 truncate">
            <Package size={13} className="text-gray-300 shrink-0" />{r.name}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider truncate">{r.sku}</span>
            {r.plan.needsReorder && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 whitespace-nowrap shrink-0">Cần đặt ngay</span>
            )}
          </div>
        </div>
      ),
    },
    { key: 'soh', header: 'Tồn', width: 96, align: 'right', render: (r) => <span className="tabular-nums font-semibold text-gray-700">{numFmt(r.stock_on_hand)} {r.unit}</span> },
    { key: 'avg', header: 'TB/tuần', width: 84, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{numFmt(r.avg_weekly)}</span> },
    { key: 'sigma', header: 'Biến động σ', width: 90, align: 'right', render: (r) => <span className="tabular-nums text-gray-500" title="Độ lệch chuẩn nhu cầu theo tuần (12 tuần)">{numFmt(r.weekly_stddev)}</span> },
    { key: 'ss', header: 'Tồn an toàn', width: 100, align: 'right', render: (r) => <span className="tabular-nums text-gray-600" title="Z × σ × √(lead time / 7)">{numFmt(r.plan.safetyStock)}</span> },
    { key: 'rop', header: 'Điểm đặt', width: 96, align: 'right', render: (r) => <span className={`tabular-nums font-semibold ${r.plan.needsReorder ? 'text-danger-600' : 'text-gray-700'}`} title="Điểm đặt lại = D × lead time + tồn an toàn">{numFmt(r.plan.reorderPoint)}</span> },
    { key: 'cover', header: 'Đủ bán còn', width: 96, align: 'right', render: (r) => <span className={`tabular-nums font-bold ${coverColor(r.days_cover)}`}>{r.days_cover != null ? `${numFmt(r.days_cover)} ngày` : '—'}</span> },
    {
      key: 'suggest', header: 'Gợi ý đặt', width: 110, align: 'right', noTruncate: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1 text-tiny font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 tabular-nums">
          <ShoppingCart size={11} />{numFmt(r.plan.suggestedQty)} {r.unit}
        </span>
      ),
    },
  )

  const inputCls = 'h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none'

  return (
    <Layout activeMenu="Gợi ý đặt hàng">
      <div className="p-4 md:p-8 max-w-[1500px] w-full mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2">
              <TrendingUp size={22} className="text-blue-500" /> Gợi ý đặt hàng
            </h1>
            <p className="text-body-md text-gray-400 mt-1">Điểm đặt lại (ROP) + tồn an toàn theo lead time & độ biến động cầu — gợi ý số lượng đặt chuẩn.</p>
          </div>
          {canCreatePO && selected.size > 0 && (
            <button onClick={createPO}
              className="bg-[#1E5A9C] text-white px-4 h-10 rounded-lg font-semibold text-tiny hover:bg-[#143C69] flex items-center gap-1.5 self-start shadow-sm">
              <Truck size={16} /> Tạo đơn đặt ({selected.size})
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <label className="text-[11px] font-bold text-gray-400 uppercase block mb-1">Tìm kiếm</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên sản phẩm / mã SKU..."
              className={`${inputCls} w-full`} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Lead time (ngày)</label>
            <input type="number" min={0} value={leadTimeDays} onChange={e => setLeadTimeDays(Math.max(0, Number(e.target.value)))} className={`${inputCls} w-28`} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Mức phục vụ</label>
            <select value={serviceLevel} onChange={e => setServiceLevel(Number(e.target.value))} className={`${inputCls} w-24`}>
              {SERVICE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Đủ bán trong (ngày)</label>
            <input type="number" min={1} value={coverDays} onChange={e => setCoverDays(Math.max(1, Number(e.target.value)))} className={`${inputCls} w-28`} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Bán ≥ (đơn/90n)</label>
            <input type="number" min={1} value={minOrders} onChange={e => setMinOrders(Math.max(1, Number(e.target.value)))} className={`${inputCls} w-24`} />
          </div>
          {isAdmin && (
            <button onClick={handleSaveDefaults} disabled={saveCfg.isPending}
              className="h-9 px-3 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50"
              title="Lưu các thông số hiện tại làm mặc định toàn hệ">
              <Save size={15} className="text-blue-500" /> {saveCfg.isPending ? 'Đang lưu...' : 'Lưu mặc định'}
            </button>
          )}
        </div>

        {/* Error banner — trước đây trang nuốt lỗi → bảng trống khó hiểu */}
        {query.isError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-tiny text-rose-700 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Không tải được dữ liệu gợi ý đặt hàng.</p>
              <p className="mt-0.5">{(query.error as Error)?.message || 'Lỗi không xác định.'} — thử tải lại trang.</p>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="flex items-center gap-4 text-tiny px-1">
          <span className="text-gray-400">Số mặt hàng: <strong className="text-gray-700">{rows.length}</strong></span>
          {urgentCount > 0 && <span className="text-rose-600 font-bold">{urgentCount} cần đặt ngay (tồn ≤ điểm đặt)</span>}
        </div>

        {/* Bảng DataTable chuẩn */}
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.product_id}
          loading={query.isLoading}
          resetSignal={`${debounced}|${minOrders}`}
          itemLabel="mặt hàng"
          emptyIcon={<AlertCircle className="mx-auto text-gray-300 mb-2" size={44} />}
          emptyText="Không có mặt hàng nào cần đặt thêm"
        />

        {/* Ghi chú phạm vi dữ liệu */}
        <p className="text-[11px] text-gray-400 px-1">
          Số liệu bán dựa trên phạm vi đơn hàng bạn được xem. Để gợi ý đặt hàng đầy đủ toàn công ty, dùng tài khoản quản trị/thủ kho.
        </p>
      </div>
    </Layout>
  )
}
