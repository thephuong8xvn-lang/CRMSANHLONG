import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ChevronRight, RefreshCw, Wallet, AlertTriangle, CalendarClock, HelpCircle,
  TrendingDown, Users, Phone, Search, Truck, Info, ArrowRight, CheckCircle2,
  FileSpreadsheet, Loader2, XCircle,
} from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useRealtimeTable } from '../../hooks/useRealtimeTable'
import { generateDebtLedgerXlsx } from '../../lib/exporters/debtLedgerXlsx'
import CollectDebtModal from '../customers/CollectDebtModal'
import {
  useDebtOverview, useDebtLedger, useCustomerDebtDetail, useSupplierDebts, useRefreshDebts,
  fetchDebtLedgerAll,
  type DebtBucket, type DebtSort, type DebtLedgerRow, type SupplierDebtRow, type DebtCallRow,
} from '../../hooks/queries/useDebts'

// ═══════════════════════════════════════════════════════════════════════════
// MODULE QUẢN LÝ CÔNG NỢ
//
// Mục đích (user chốt 05/08/2026): một nơi để QUAN SÁT dư nợ, THU HỒI VỐN và
// NHẮC NHÂN VIÊN KINH DOANH. Trọng tâm là công nợ khách hàng; nợ NCC chỉ xem.
//
// ⚠️ Số liệu ở đây lấy từ SỔ CÁI CÔNG NỢ (`customer_debts`), KHÔNG phải cột
//    `orders.debt_amount` hiển thị trong màn Đơn hàng. Hai số này hiện chênh
//    nhau vì thu nợ không ghi ngược về đơn — con số ĐÚNG là con số ở đây.
// ═══════════════════════════════════════════════════════════════════════════

type Tab = 'overview' | 'ledger' | 'suppliers'

const BUCKETS: { key: DebtBucket; label: string; tone: string }[] = [
  { key: 'all',        label: 'Tất cả',          tone: 'blue' },
  { key: 'overdue',    label: 'Quá hạn',         tone: 'red' },
  { key: 'due_soon',   label: 'Đến hạn ≤7 ngày', tone: 'amber' },
  { key: 'no_duedate', label: 'Không có hạn',    tone: 'violet' },
  { key: 'current',    label: 'Chưa đến hạn',    tone: 'emerald' },
  { key: 'advance',    label: 'Khách trả trước', tone: 'gray' },
]

const AGING_TONE: Record<number, string> = {
  1: 'bg-emerald-500', 2: 'bg-amber-500', 3: 'bg-orange-500',
  4: 'bg-red-500', 5: 'bg-red-700', 6: 'bg-violet-500',
}

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

const PAGE_SIZE = 25

export default function DebtManagementPage() {
  const { formatCurrency } = useDisplaySettings()
  const { hasPermission } = useAuth()
  const refreshAll = useRefreshDebts()

  // ── Trạng thái nằm trên URL: F5 không mất bộ lọc, gửi link được ──
  const [sp, setSp] = useSearchParams()
  const tab     = (sp.get('tab') as Tab) || 'overview'
  const bucket  = (sp.get('loc') as DebtBucket) || 'all'
  const sort    = (sp.get('sx') as DebtSort) || 'du_no'
  const ownerId = sp.get('nv')
  const page    = Math.max(1, Number(sp.get('trang') || 1))

  const patch = useCallback((next: Record<string, string | null>) => {
    setSp(prev => {
      const p = new URLSearchParams(prev)
      Object.entries(next).forEach(([k, v]) => { if (v == null || v === '') p.delete(k); else p.set(k, v) })
      return p
    }, { replace: true })
  }, [setSp])

  const setTab     = (t: Tab)        => patch({ tab: t === 'overview' ? null : t })
  const setSort    = (s: DebtSort)   => patch({ sx: s === 'du_no' ? null : s, trang: null })
  const setPage    = (p: number)     => patch({ trang: p <= 1 ? null : String(p) })
  const setOwnerId = (id: string | null) => patch({ nv: id, trang: null })

  // Ô tìm kiếm gõ tới đâu hiện tới đó, nhưng chỉ gọi server khi ngừng gõ.
  const [searchInput, setSearchInput] = useState(sp.get('tim') ?? '')
  const search = useDebouncedValue(searchInput, 350)
  useEffect(() => {
    // Chỉ ghi khi thực sự khác URL — nếu không, mỗi lần ghi lại kích hoạt
    // render → effect chạy lại → lặp vô hạn.
    if ((sp.get('tim') ?? '') === search) return
    patch({ tim: search || null, trang: null })
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const [collectFor, setCollectFor] = useState<{ id: string; name: string; code?: string; debt: number } | null>(null)
  const [toast, setToast] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState('')

  const canCollect = hasPermission('customers.collect_debt')

  const ov = useDebtOverview()
  const ledger = useDebtLedger({ search, bucket, ownerId, sort, page, pageSize: PAGE_SIZE })
  const sup = useSupplierDebts(tab === 'suppliers')

  // Ai đó thu nợ / ghi nợ ở máy khác → số trên màn hình tự cập nhật.
  // Gom sự kiện tối đa 1 lần/5 giây: mỗi đơn bán chịu đều sinh 1 dòng
  // `customer_debts`, giờ POS cao điểm sẽ dội hàng chục sự kiện liên tiếp.
  const lastRefresh = useRef(0)
  const refreshOnChange = useCallback(() => {
    const now = Date.now()
    if (now - lastRefresh.current < 5000) return
    lastRefresh.current = now
    refreshAll()
  }, [refreshAll])
  useRealtimeTable({ table: 'debt_payments',  onData: refreshOnChange })
  useRealtimeTable({ table: 'customer_debts', onData: refreshOnChange })

  // Lọc xong còn ít dòng hơn → kéo về trang cuối hợp lệ, tránh kẹt ở trang trắng.
  const totalPages = Math.max(1, Math.ceil((ledger.data?.total ?? 0) / PAGE_SIZE))
  useEffect(() => {
    if (!ledger.isFetching && page > totalPages) setPage(totalPages)
  }, [page, totalPages, ledger.isFetching]) // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = ov.data?.kpi
  const agingMax = useMemo(
    () => Math.max(1, ...(ov.data?.aging ?? []).map(a => Number(a.so_tien))),
    [ov.data],
  )
  const trendMax = useMemo(
    () => Math.max(1, ...(ov.data?.trend ?? []).flatMap(t => [Number(t.no_moi), Number(t.thu_ve)])),
    [ov.data],
  )

  const resetFilters = (b: DebtBucket) => patch({ loc: b === 'all' ? null : b, trang: null })

  const openCollect = (r: { customer_id: string; ten: string; code: string | null; du_no: number }) =>
    setCollectFor({ id: r.customer_id, name: r.ten, code: r.code ?? undefined, debt: Number(r.du_no) })

  const ownerLabel = ownerId
    ? ov.data?.by_staff.find(s => s.owner_id === ownerId)?.nhan_vien ?? 'NV đã chọn'
    : ''

  // Xuất TOÀN BỘ bộ lọc (không chỉ trang đang xem) — đi đòi nợ cần cả danh sách.
  const handleExport = async () => {
    setExporting(true); setExportErr('')
    try {
      const all = await fetchDebtLedgerAll({ search, bucket, ownerId, sort })
      await generateDebtLedgerXlsx({
        rows: all,
        filterLabel: BUCKETS.find(b => b.key === bucket)?.label ?? 'Tất cả',
        searchLabel: search || undefined,
        ownerLabel: ownerLabel || undefined,
        tongDuNo: all.length ? Number(all[0].tong_du_no) : 0,
        tongQuaHan: all.length ? Number(all[0].tong_qua_han) : 0,
        tongSoKh: all.length ? Number(all[0].tong_so_kh) : 0,
      })
      setToast(`Đã xuất ${all.length} khách hàng ra file Excel.`)
    } catch (e: any) {
      setExportErr('Xuất Excel thất bại: ' + (e?.message || 'lỗi không xác định'))
    } finally {
      setExporting(false)
    }
  }

  // ── Cột bảng chi tiết công nợ ──
  const ledgerCols: DataTableColumn<DebtLedgerRow>[] = [
    {
      key: 'ten', header: 'Khách hàng', flex: true, minWidth: 220,
      render: (r, expanded) => (
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight size={14} className={`text-gray-300 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <div className="min-w-0">
            <p className="font-semibold text-gray-700 truncate">{r.ten}</p>
            <p className="text-tiny text-gray-400 truncate">
              {r.code ?? '—'}{r.dien_thoai ? ` · ${r.dien_thoai}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'du_no', header: 'Dư nợ', width: 130, align: 'right',
      cellClassName: 'tabular-nums font-bold',
      render: r => (
        <span className={Number(r.du_no) < 0 ? 'text-emerald-600' : 'text-gray-800'}>
          {formatCurrency(Number(r.du_no))}
        </span>
      ),
    },
    {
      key: 'qua_han', header: 'Quá hạn', width: 130, align: 'right',
      cellClassName: 'tabular-nums',
      render: r => Number(r.qua_han) > 0
        ? <span className="font-bold text-red-600">{formatCurrency(Number(r.qua_han))}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'so_ngay_qua_han', header: 'Trễ', width: 76, align: 'center', noTruncate: true,
      render: r => r.so_ngay_qua_han == null
        ? <span className="text-gray-300">—</span>
        : (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
            r.so_ngay_qua_han > 60 ? 'bg-red-100 text-red-700'
              : r.so_ngay_qua_han > 30 ? 'bg-orange-100 text-orange-700'
              : 'bg-amber-100 text-amber-700'}`}>
            {r.so_ngay_qua_han}n
          </span>
        ),
    },
    {
      key: 'khong_han', header: 'Không hạn', width: 120, align: 'right', hideOnMobile: true,
      cellClassName: 'tabular-nums',
      render: r => Number(r.khong_han) > 0
        ? <span className="text-violet-600 font-semibold">{formatCurrency(Number(r.khong_han))}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'ty_le_dung_han_muc', header: 'Dùng hạn mức', width: 118, align: 'center', noTruncate: true,
      hideOnMobile: true,
      render: r => {
        if (Number(r.credit_limit) <= 0) {
          return <span className="text-tiny text-gray-400 italic">chưa đặt</span>
        }
        const pct = Number(r.ty_le_dung_han_muc ?? 0)
        return (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </div>
            <span className="text-[11px] text-gray-500 tabular-nums">{pct}%</span>
          </div>
        )
      },
    },
    {
      key: 'nhan_vien', header: 'NV phụ trách', width: 130, hideOnMobile: true,
      render: r => <span className="text-gray-500">{r.nhan_vien}</span>,
    },
    {
      key: 'lan_thu_gan_nhat', header: 'Thu gần nhất', width: 108, align: 'center', hideOnMobile: true,
      render: r => <span className="text-gray-500 tabular-nums">{fmtDate(r.lan_thu_gan_nhat)}</span>,
    },
    {
      key: 'act', header: '', width: 96, align: 'right', noTruncate: true, mobileHeaderRight: true,
      render: r => canCollect && Number(r.du_no) > 0 ? (
        <button
          onClick={e => { e.stopPropagation(); openCollect(r) }}
          className="px-2.5 h-7 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold transition-all active:scale-95"
        >
          Thu nợ
        </button>
      ) : null,
    },
  ]

  const supplierCols: DataTableColumn<SupplierDebtRow>[] = [
    {
      key: 'ten', header: 'Nhà cung cấp', flex: true, minWidth: 220,
      render: r => (
        <Link to={`/suppliers/${r.id}`} onClick={e => e.stopPropagation()} className="min-w-0 block group">
          <p className="font-semibold text-gray-700 truncate group-hover:text-blue-600">{r.ten}</p>
          <p className="text-tiny text-gray-400 truncate">{r.code ?? '—'} · {r.dieu_khoan}</p>
        </Link>
      ),
    },
    {
      key: 'phai_tra', header: 'Phải trả', width: 140, align: 'right',
      cellClassName: 'tabular-nums font-bold',
      render: r => <span className={Number(r.phai_tra) > 0 ? 'text-orange-600' : 'text-gray-400'}>
        {formatCurrency(Number(r.phai_tra))}
      </span>,
    },
    {
      key: 'da_nhap', header: 'Đã nhập', width: 140, align: 'right', hideOnMobile: true,
      cellClassName: 'tabular-nums text-gray-500',
      render: r => formatCurrency(Number(r.da_nhap)),
    },
    {
      key: 'tra_hang', header: 'Trả hàng', width: 120, align: 'right', hideOnMobile: true,
      cellClassName: 'tabular-nums',
      render: r => Number(r.tra_hang) > 0
        ? <span className="text-emerald-600">{formatCurrency(Number(r.tra_hang))}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'da_thanh_toan', header: 'Đã thanh toán', width: 130, align: 'right',
      cellClassName: 'tabular-nums',
      render: r => Number(r.da_thanh_toan) > 0
        ? <span className="text-emerald-600 font-semibold">{formatCurrency(Number(r.da_thanh_toan))}</span>
        : <span className="text-red-400 font-semibold">chưa ghi nhận</span>,
    },
    {
      key: 'nhap_gan_nhat', header: 'Nhập gần nhất', width: 112, align: 'center', hideOnMobile: true,
      render: r => <span className="text-gray-500 tabular-nums">{fmtDate(r.nhap_gan_nhat)}</span>,
    },
  ]

  return (
    <Layout activeMenu="Công nợ">
      <div className="p-4 md:p-8 max-w-[1600px] mx-auto flex flex-col space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <nav className="flex items-center gap-2 text-tiny text-gray-400 mb-2">
              <span>Tài chính</span><ChevronRight size={12} />
              <span className="text-blue-600 font-semibold">Quản lý công nợ</span>
            </nav>
            <h1 className="text-[28px] md:text-[32px] font-bold text-gray-800 leading-tight">Quản lý công nợ</h1>
            <p className="text-gray-500 text-body-md mt-1">
              Theo dõi dư nợ, thu hồi vốn và đôn đốc nhân viên kinh doanh.
              {ov.data && <span className="text-gray-400"> · Số liệu tới {fmtDate(ov.data.as_of)}</span>}
            </p>
          </div>
          <button
            onClick={() => { refreshAll(); setToast('Đã làm mới số liệu công nợ.') }}
            className="shrink-0 self-start md:self-auto flex items-center gap-1.5 px-3 h-9 rounded-lg border border-gray-200 text-gray-600 font-semibold text-tiny hover:bg-gray-25 transition-all"
          >
            <RefreshCw size={14} className={ov.isFetching ? 'animate-spin' : ''} />
            Làm mới
          </button>
        </div>

        {toast && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-lg px-4 py-2.5 text-body-md">
            <CheckCircle2 size={16} className="shrink-0" />
            <span className="flex-1">{toast}</span>
            <button onClick={() => setToast('')} className="text-emerald-600 font-bold text-tiny hover:underline">Đóng</button>
          </div>
        )}

        {/* ── Báo lỗi. Số liệu tài chính mà hỏng thì PHẢI nói, tuyệt đối không
            được hiện bảng rỗng cho người dùng tưởng là đã hết nợ. ── */}
        {exportErr && <ErrorBanner text={exportErr} onRetry={handleExport} onClose={() => setExportErr('')} />}
        {ov.isError && (
          <ErrorBanner
            text={`Không tải được số liệu tổng quan: ${(ov.error as any)?.message || 'lỗi không xác định'}`}
            onRetry={() => ov.refetch()}
          />
        )}
        {ledger.isError && tab === 'ledger' && (
          <ErrorBanner
            text={`Không tải được danh sách công nợ: ${(ledger.error as any)?.message || 'lỗi không xác định'}`}
            onRetry={() => ledger.refetch()}
          />
        )}
        {sup.isError && tab === 'suppliers' && (
          <ErrorBanner
            text={`Không tải được công nợ nhà cung cấp: ${(sup.error as any)?.message || 'lỗi không xác định'}`}
            onRetry={() => sup.refetch()}
          />
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl self-start overflow-x-auto no-scrollbar">
          {([
            ['overview', 'Tổng quan'],
            ['ledger', 'Chi tiết công nợ'],
            ['suppliers', 'Nợ nhà cung cấp'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-lg text-body-md font-semibold whitespace-nowrap transition-all ${
                tab === k ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ════════════ TAB 1 — TỔNG QUAN ════════════ */}
        {tab === 'overview' && (
          <div className="flex flex-col space-y-6">

            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiCard icon={<Wallet size={15} />} tone="blue"
                label="Dư nợ ròng" value={kpi ? formatCurrency(kpi.du_no_rong) : '…'}
                sub={kpi ? `${kpi.so_kh_no} khách còn nợ` : ''}
                hint="Tổng nợ gốc trừ tiền khách đã trả trước. Đây là số vốn đang nằm ngoài." />
              <KpiCard icon={<AlertTriangle size={15} />} tone="red"
                label="Quá hạn" value={kpi ? formatCurrency(kpi.qua_han) : '…'}
                sub={kpi ? `${kpi.so_kh_qua_han} khách · ${kpi.ty_le_qua_han}% nợ gốc` : ''}
                hint="Các khoản đã qua ngày hẹn trả. Ưu tiên gọi trước." />
              <KpiCard icon={<CalendarClock size={15} />} tone="amber"
                label="Đến hạn ≤7 ngày" value={kpi ? formatCurrency(kpi.den_han_7n) : '…'}
                sub={kpi ? `${kpi.den_han_7n_dong} khoản` : ''}
                hint="Sắp tới hạn trong 7 ngày — nhắc trước để không rơi vào quá hạn." />
              <KpiCard icon={<HelpCircle size={15} />} tone="violet"
                label="Không có hạn" value={kpi ? formatCurrency(kpi.khong_han) : '…'}
                sub={kpi ? `${kpi.so_kh_khong_han} khách · ${kpi.khong_han_dong} khoản` : ''}
                hint="Nợ ghi bằng tay, chưa gán ngày hẹn trả nên KHÔNG BAO GIỜ bị tính là quá hạn. Cần rà lại." />
              <KpiCard icon={<TrendingDown size={15} />} tone="emerald"
                label="Đã thu tháng này" value={kpi ? formatCurrency(kpi.thu_thang_nay) : '…'}
                sub={kpi ? `30 ngày: ${formatCurrency(kpi.thu_30n)}` : ''}
                hint="Tiền công nợ thực thu, đã vào sổ quỹ." />
              <KpiCard icon={<Users size={15} />} tone="gray"
                label="Số ngày thu tiền (DSO)" value={kpi?.dso != null ? `${kpi.dso} ngày` : '…'}
                sub={kpi ? `Nợ mới 30n: ${formatCurrency(kpi.no_moi_30n)}` : ''}
                hint="Dư nợ tương đương bao nhiêu ngày doanh thu (theo doanh thu 90 ngày gần nhất). Càng thấp càng tốt." />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {/* Tuổi nợ */}
              <Panel title="Tuổi nợ" note="Bấm vào một nhóm để xem danh sách khách trong nhóm đó.">
                <div className="space-y-2.5">
                  {(ov.data?.aging ?? []).map(a => {
                    const target: DebtBucket | null =
                      a.thu_tu === 6 ? 'no_duedate' : a.thu_tu === 1 ? 'current'
                        : a.thu_tu >= 2 ? 'overdue' : null
                    return (
                      <button
                        key={a.thu_tu}
                        onClick={() => { if (target) { resetFilters(target); setTab('ledger') } }}
                        className="w-full text-left group"
                      >
                        <div className="flex items-baseline justify-between mb-1 gap-2">
                          <span className="text-body-md text-gray-600 group-hover:text-blue-600 font-medium">{a.nhan}</span>
                          <span className="text-body-md font-bold text-gray-800 tabular-nums shrink-0">
                            {formatCurrency(Number(a.so_tien))}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${AGING_TONE[a.thu_tu]}`}
                              style={{ width: `${(Number(a.so_tien) / agingMax) * 100}%` }} />
                          </div>
                          <span className="text-tiny text-gray-400 tabular-nums w-24 text-right shrink-0">
                            {a.so_kh} KH · {a.so_dong} khoản
                          </span>
                        </div>
                      </button>
                    )
                  })}
                  {ov.isLoading && <p className="text-body-md text-gray-400">Đang tải…</p>}
                </div>
              </Panel>

              {/* Xu hướng */}
              <Panel title="Nợ mới phát sinh vs Tiền thu về" note="6 tháng gần nhất.">
                <div className="flex items-end justify-between gap-2 h-52 pt-2">
                  {(ov.data?.trend ?? []).map(t => (
                    <div key={t.thang} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                      <div className="w-full flex items-end justify-center gap-1 h-40">
                        <div className="w-1/2 max-w-[26px] bg-orange-400 rounded-t transition-all"
                          style={{ height: `${(Number(t.no_moi) / trendMax) * 100}%` }}
                          title={`Nợ mới: ${formatCurrency(Number(t.no_moi))}`} />
                        <div className="w-1/2 max-w-[26px] bg-emerald-500 rounded-t transition-all"
                          style={{ height: `${(Number(t.thu_ve) / trendMax) * 100}%` }}
                          title={`Thu về: ${formatCurrency(Number(t.thu_ve))}`} />
                      </div>
                      <span className="text-[11px] text-gray-400 tabular-nums">{t.thang}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 pt-3 border-t border-gray-100 mt-3">
                  <Legend color="bg-orange-400" label="Nợ mới phát sinh" />
                  <Legend color="bg-emerald-500" label="Tiền thu về" />
                </div>
              </Panel>
            </div>

            {/* Cần gọi hôm nay */}
            <Panel
              title="Cần gọi hôm nay"
              note="Khách quá hạn xếp trước, rồi tới khách đến hạn trong 7 ngày."
              right={<span className="text-tiny text-gray-400">{ov.data?.call_list.length ?? 0} khách</span>}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {(ov.data?.call_list ?? []).map((c: DebtCallRow) => (
                  <div key={c.customer_id}
                    className={`rounded-xl border p-3 flex flex-col gap-2 ${
                      c.uu_tien === 1 ? 'border-red-150 bg-red-50/40' : 'border-gray-150 bg-white'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/customers/${c.customer_id}`} className="min-w-0 group">
                        <p className="font-bold text-gray-700 text-body-md truncate group-hover:text-blue-600">{c.ten}</p>
                        <p className="text-tiny text-gray-400 truncate">{c.nhan_vien}</p>
                      </Link>
                      {c.so_ngay_qua_han != null && (
                        <span className="shrink-0 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold">
                          trễ {c.so_ngay_qua_han}n
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-tiny text-gray-400">Dư nợ</span>
                      <span className="font-bold text-gray-800 tabular-nums">{formatCurrency(Number(c.du_no))}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.dien_thoai ? (
                        <a href={`tel:${c.dien_thoai}`}
                          className="flex-1 h-8 rounded-lg border border-gray-200 text-gray-600 font-semibold text-tiny flex items-center justify-center gap-1.5 hover:bg-gray-25 transition-all">
                          <Phone size={13} /> {c.dien_thoai}
                        </a>
                      ) : (
                        <span className="flex-1 h-8 rounded-lg bg-gray-50 text-gray-400 text-tiny flex items-center justify-center italic">
                          chưa có SĐT
                        </span>
                      )}
                      {canCollect && (
                        <button
                          onClick={() => setCollectFor({ id: c.customer_id, name: c.ten, code: c.code ?? undefined, debt: Number(c.du_no) })}
                          className="px-3 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-tiny font-bold transition-all active:scale-95">
                          Thu
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!ov.isLoading && (ov.data?.call_list.length ?? 0) === 0 && (
                  <p className="text-body-md text-gray-400 col-span-full py-6 text-center">
                    Không có khách nào quá hạn hoặc đến hạn trong 7 ngày tới.
                  </p>
                )}
              </div>
            </Panel>

            {/* Theo nhân viên */}
            <Panel
              title="Theo nhân viên kinh doanh"
              note="Dư nợ do từng người phụ trách. Bấm vào một dòng để lọc danh sách theo người đó."
            >
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full min-w-[720px] text-body-md">
                  <thead>
                    <tr className="text-tiny text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="text-left font-semibold py-2">Nhân viên</th>
                      <th className="text-right font-semibold py-2">Dư nợ</th>
                      <th className="text-right font-semibold py-2">Quá hạn</th>
                      <th className="text-center font-semibold py-2 w-32">Tỉ lệ quá hạn</th>
                      <th className="text-right font-semibold py-2">Thu 30 ngày</th>
                      <th className="text-center font-semibold py-2">Khách nợ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(ov.data?.by_staff ?? []).map(s => (
                      <tr key={s.owner_id ?? 'none'}
                        onClick={() => { setOwnerId(s.owner_id); setPage(1); setTab('ledger') }}
                        className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                        <td className="py-2.5">
                          <p className="font-semibold text-gray-700">{s.nhan_vien}</p>
                          <p className="text-tiny text-gray-400">{s.chi_nhanh}</p>
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-bold text-gray-800">
                          {formatCurrency(Number(s.du_no))}
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-bold text-red-600">
                          {Number(s.qua_han) > 0 ? formatCurrency(Number(s.qua_han)) : <span className="text-gray-300 font-normal">—</span>}
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2 justify-center">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${Number(s.ty_le_qua_han) >= 20 ? 'bg-red-500' : Number(s.ty_le_qua_han) >= 10 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(100, Number(s.ty_le_qua_han))}%` }} />
                            </div>
                            <span className="text-tiny text-gray-500 tabular-nums w-10">{s.ty_le_qua_han}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-emerald-600 font-semibold">
                          {formatCurrency(Number(s.thu_30n))}
                        </td>
                        <td className="py-2.5 text-center tabular-nums text-gray-600">
                          {s.so_kh_no}
                          {s.so_kh_qua_han > 0 && <span className="text-red-500 font-bold"> ({s.so_kh_qua_han} trễ)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}

        {/* ════════════ TAB 2 — CHI TIẾT ════════════ */}
        {tab === 'ledger' && (
          <div className="flex flex-col space-y-4">
            {/* Bộ lọc */}
            <div className="bg-white border border-gray-150 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {BUCKETS.map(b => (
                  <button key={b.key} onClick={() => resetFilters(b.key)}
                    className={`px-3 h-8 rounded-lg text-tiny font-bold border transition-all ${
                      bucket === b.key
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-25'}`}>
                    {b.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder="Tìm theo tên khách, mã KH hoặc số điện thoại…"
                    className="w-full h-10 pl-9 pr-9 bg-gray-25 border border-gray-150 rounded-lg text-body-md placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                  />
                  {searchInput && (
                    <button onClick={() => setSearchInput('')} aria-label="Xóa tìm kiếm"
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                      <XCircle size={15} />
                    </button>
                  )}
                </div>
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value as DebtSort)}
                  className="h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none md:w-56"
                >
                  <option value="du_no">Sắp xếp: Dư nợ lớn nhất</option>
                  <option value="qua_han">Sắp xếp: Quá hạn nhiều nhất</option>
                  <option value="cu_nhat">Sắp xếp: Trễ lâu nhất</option>
                  <option value="ten">Sắp xếp: Tên khách A→Z</option>
                </select>
                {ownerId && (
                  <button onClick={() => setOwnerId(null)}
                    className="h-10 px-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-tiny font-bold whitespace-nowrap">
                    NV: {ownerLabel} · Bỏ lọc ✕
                  </button>
                )}
                <button
                  onClick={handleExport}
                  disabled={exporting || (ledger.data?.total ?? 0) === 0}
                  className="h-10 px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-tiny font-bold whitespace-nowrap flex items-center justify-center gap-1.5 hover:bg-emerald-100 transition-all disabled:opacity-50"
                  title="Xuất toàn bộ danh sách đang lọc ra Excel (không chỉ trang đang xem)"
                >
                  {exporting
                    ? <><Loader2 size={14} className="animate-spin" /> Đang xuất…</>
                    : <><FileSpreadsheet size={14} /> Xuất Excel</>}
                </button>
              </div>
            </div>

            {/* Vì sao hai tab hiện hai con số tổng khác nhau — nói thẳng ra để
                không ai phải ngồi đoán xem hệ thống có sai không. */}
            {bucket === 'all' && kpi != null && (ledger.data?.total ?? 0) > 0 && (
              <p className="text-tiny text-gray-400 px-1 -mt-1">
                Bảng này cộng <b className="text-gray-500">{formatCurrency(ledger.data?.tongDuNo ?? 0)}</b> của{' '}
                {ledger.data?.total} khách đang <b>dư nợ dương</b>. Thẻ &ldquo;Dư nợ ròng&rdquo; ở tab Tổng quan là{' '}
                <b className="text-gray-500">{formatCurrency(kpi.du_no_rong)}</b> vì đã trừ{' '}
                <button onClick={() => resetFilters('advance')} className="text-blue-600 font-semibold underline">
                  {formatCurrency(Math.abs(kpi.tra_truoc))} khách trả trước
                </button>. Hai số đều đúng, khác nhau ở cách tính.
              </p>
            )}

            {bucket === 'no_duedate' && (
              <NoteBanner tone="violet">
                Đây là các khoản ghi bằng tay chưa gán ngày hẹn trả. Vì không có hạn nên chúng
                <b> không bao giờ bị tính là quá hạn</b> và <b>không xuất hiện trong tin nhắc nợ</b>.
                Nên rà lại và gán hạn cho từng khoản.
              </NoteBanner>
            )}
            {bucket === 'advance' && (
              <NoteBanner tone="emerald">
                Khách đã trả nhiều hơn số nợ — phần dư được ghi có và sẽ tự khấu trừ ở các lần mua sau.
              </NoteBanner>
            )}

            <DataTable<DebtLedgerRow>
              columns={ledgerCols}
              rows={ledger.data?.rows ?? []}
              getRowKey={r => r.customer_id}
              loading={ledger.isLoading}
              manualPagination
              page={page}
              onPageChange={setPage}
              totalItems={ledger.data?.total ?? 0}
              pageSize={PAGE_SIZE}
              itemLabel="khách hàng"
              emptyText="Không có khách nào khớp bộ lọc."
              totals={{
                du_no: formatCurrency(ledger.data?.tongDuNo ?? 0),
                qua_han: formatCurrency(ledger.data?.tongQuaHan ?? 0),
              }}
              totalsLabel={`Tổng cộng (${ledger.data?.total ?? 0} khách)`}
              expandedRowRender={row => <DebtRowDetail customerId={row.customer_id} />}
            />
          </div>
        )}

        {/* ════════════ TAB 3 — NỢ NCC ════════════ */}
        {tab === 'suppliers' && (
          <div className="flex flex-col space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard icon={<Truck size={15} />} tone="orange"
                label="Tổng phải trả" value={sup.data ? formatCurrency(sup.data.kpi.tong_phai_tra) : '…'}
                sub={sup.data ? `${sup.data.kpi.so_ncc_con_no}/${sup.data.kpi.so_ncc} nhà cung cấp` : ''} />
              <KpiCard icon={<Wallet size={15} />} tone="blue"
                label="Đã nhập hàng" value={sup.data ? formatCurrency(sup.data.kpi.tong_da_nhap) : '…'}
                sub="Phiếu nhập đã hoàn tất" />
              <KpiCard icon={<RefreshCw size={15} />} tone="emerald"
                label="Trả hàng NCC" value={sup.data ? formatCurrency(sup.data.kpi.tong_tra_hang) : '…'}
                sub="Đã giảm trừ công nợ" />
              <KpiCard icon={<AlertTriangle size={15} />} tone="red"
                label="Đã thanh toán" value={sup.data ? formatCurrency(sup.data.kpi.tong_da_thanh_toan) : '…'}
                sub={sup.data ? `${sup.data.kpi.so_phieu_thanh_toan} phiếu chi` : ''} />
            </div>

            {sup.data && sup.data.kpi.so_phieu_thanh_toan === 0 && (
              <NoteBanner tone="amber">
                <b>Chưa có phiếu thanh toán nhà cung cấp nào được ghi nhận trong hệ thống.</b> Vì vậy số
                &ldquo;phải trả&rdquo; bên dưới là <b>tổng tiền hàng đã nhập trừ hàng đã trả lại</b>, chưa trừ tiền
                thực tế đã chuyển cho nhà cung cấp. Muốn số này đúng, hãy ghi phiếu chi trong{' '}
                <Link to="/cashbook" className="text-blue-600 font-bold underline">Sổ quỹ → Thanh toán NCC</Link>,
                hoặc làm một lần đối soát mở sổ.
              </NoteBanner>
            )}

            <DataTable<SupplierDebtRow>
              columns={supplierCols}
              rows={sup.data?.rows ?? []}
              getRowKey={r => r.id}
              loading={sup.isLoading}
              pageSize={25}
              itemLabel="nhà cung cấp"
              emptyText="Chưa có nhà cung cấp nào."
              totals={{
                phai_tra: formatCurrency(sup.data?.kpi.tong_phai_tra ?? 0),
                da_nhap: formatCurrency(sup.data?.kpi.tong_da_nhap ?? 0),
                tra_hang: formatCurrency(sup.data?.kpi.tong_tra_hang ?? 0),
                da_thanh_toan: formatCurrency(sup.data?.kpi.tong_da_thanh_toan ?? 0),
              }}
            />
          </div>
        )}
      </div>

      {collectFor && (
        <CollectDebtModal
          customer={{ id: collectFor.id, name: collectFor.name, code: collectFor.code }}
          currentDebt={collectFor.debt}
          onClose={() => setCollectFor(null)}
          onSuccess={msg => { setCollectFor(null); setToast(msg); refreshAll() }}
        />
      )}
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// Bung dòng: các khoản nợ đang mở + lịch sử thu tiền
// ─────────────────────────────────────────────────────────────
function DebtRowDetail({ customerId }: { customerId: string }) {
  const { formatCurrency } = useDisplaySettings()
  const { data, isLoading } = useCustomerDebtDetail(customerId)

  if (isLoading) return <p className="p-4 text-body-md text-gray-400">Đang tải chi tiết…</p>

  return (
    <div className="p-4 bg-gray-25 grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* Các khoản đang mở */}
      <div>
        <h4 className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
          Các khoản còn mở ({data?.lines.length ?? 0})
        </h4>
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {(data?.lines ?? []).map(l => (
            <div key={l.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    l.loai === 'Khách trả trước' ? 'bg-emerald-100 text-emerald-700'
                      : l.loai === 'Điều chỉnh tay' ? 'bg-violet-100 text-violet-700'
                      : 'bg-blue-100 text-blue-700'}`}>{l.loai}</span>
                  {l.ma_don && (
                    <Link to={`/orders/${l.order_id}`} className="text-tiny text-blue-600 font-semibold hover:underline">
                      {l.ma_don}
                    </Link>
                  )}
                  {l.so_ngay_qua_han != null && (
                    <span className="text-[10px] font-bold text-red-600">trễ {l.so_ngay_qua_han} ngày</span>
                  )}
                  {l.han_tra == null && l.so_tien > 0 && (
                    <span className="text-[10px] font-bold text-violet-600">chưa gán hạn · {l.tuoi_ngay} ngày</span>
                  )}
                </div>
                <p className="text-tiny text-gray-400 truncate mt-0.5">
                  Ghi {fmtDate(l.ghi_ngay)}
                  {l.han_tra ? ` · hạn ${fmtDate(l.han_tra)}` : ''}
                  {l.nguoi_lap !== '—' ? ` · ${l.nguoi_lap}` : ''}
                  {l.ghi_chu ? ` · ${l.ghi_chu}` : ''}
                </p>
              </div>
              <span className={`shrink-0 font-bold tabular-nums ${l.so_tien < 0 ? 'text-emerald-600' : 'text-gray-800'}`}>
                {formatCurrency(Number(l.so_tien))}
              </span>
            </div>
          ))}
          {(data?.lines.length ?? 0) === 0 && <p className="text-body-md text-gray-400">Không còn khoản nào mở.</p>}
        </div>
      </div>

      {/* Lịch sử thu */}
      <div>
        <h4 className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
          Lịch sử thu tiền (20 gần nhất)
        </h4>
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {(data?.payments ?? []).map(p => (
            <div key={p.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-body-md font-semibold text-gray-700">
                  {fmtDate(p.ngay_thu)}
                  <span className="ml-2 text-tiny font-normal text-gray-400">
                    {p.hinh_thuc === 'cash' ? 'Tiền mặt' : p.hinh_thuc === 'bank_transfer' ? 'Chuyển khoản' : p.hinh_thuc}
                  </span>
                </p>
                <p className="text-tiny text-gray-400 truncate">
                  {p.nguoi_thu} · {p.chi_nhanh}{p.tham_chieu ? ` · ${p.tham_chieu}` : ''}
                </p>
              </div>
              <span className="shrink-0 font-bold tabular-nums text-emerald-600">
                {formatCurrency(Number(p.so_tien))}
              </span>
            </div>
          ))}
          {(data?.payments.length ?? 0) === 0 && <p className="text-body-md text-gray-400">Chưa có lần thu nào.</p>}
        </div>
        <Link to={`/customers/${customerId}`}
          className="inline-flex items-center gap-1 text-tiny font-bold text-blue-600 hover:underline mt-2.5">
          Mở hồ sơ khách hàng <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mảnh giao diện dùng lại
// ─────────────────────────────────────────────────────────────
const TONES: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600', red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600', gray: 'bg-gray-100 text-gray-500',
  orange: 'bg-orange-50 text-orange-600',
}

function KpiCard({ icon, tone, label, value, sub, hint }: {
  icon: React.ReactNode; tone: string; label: string; value: string; sub?: string; hint?: string
}) {
  // Gợi ý phải BẤM được, không chỉ hover: nhân viên đi thu nợ dùng điện thoại,
  // mà điện thoại thì không có con trỏ để rê lên thuộc tính `title`.
  const [showHint, setShowHint] = useState(false)
  return (
    <div className="bg-white border border-gray-150 rounded-xl p-4 flex flex-col gap-1.5 relative">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone]}`}>{icon}</span>
        <span className="text-tiny text-gray-400 font-semibold leading-tight flex-1">{label}</span>
        {hint && (
          <button
            onClick={() => setShowHint(v => !v)}
            aria-label={showHint ? 'Ẩn giải thích' : 'Xem giải thích'}
            aria-expanded={showHint}
            className={`shrink-0 p-0.5 rounded transition-colors ${showHint ? 'text-blue-600' : 'text-gray-300 hover:text-gray-500'}`}
          >
            <Info size={13} />
          </button>
        )}
      </div>
      <p className="text-xl font-bold text-gray-800 tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-tiny text-gray-400 leading-tight">{sub}</p>}
      {hint && showHint && (
        <p className="text-tiny text-gray-500 leading-snug bg-gray-25 border border-gray-100 rounded-lg p-2 mt-0.5">
          {hint}
        </p>
      )}
    </div>
  )
}

/** Dải báo lỗi kèm nút thử lại. Dùng cho MỌI lỗi tải số liệu tài chính. */
function ErrorBanner({ text, onRetry, onClose }: { text: string; onRetry?: () => void; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2.5 bg-red-50 border border-red-150 text-red-800 rounded-xl px-4 py-3 text-body-md">
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      <span className="flex-1 leading-relaxed">{text}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 font-bold text-tiny text-red-700 underline hover:no-underline">
          Thử lại
        </button>
      )}
      {onClose && (
        <button onClick={onClose} aria-label="Đóng" className="shrink-0 text-red-500 hover:text-red-700">
          <XCircle size={15} />
        </button>
      )}
    </div>
  )
}

function Panel({ title, note, right, children }: {
  title: string; note?: string; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-gray-150 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-body-lg font-bold text-gray-800">{title}</h3>
          {note && <p className="text-tiny text-gray-400 mt-0.5">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-tiny text-gray-500">
      <span className={`w-2.5 h-2.5 rounded-sm ${color}`} /> {label}
    </span>
  )
}

function NoteBanner({ tone, children }: { tone: 'violet' | 'emerald' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'violet' ? 'bg-violet-50 border-violet-100 text-violet-800'
    : tone === 'emerald' ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
    : 'bg-amber-50 border-amber-100 text-amber-800'
  return (
    <div className={`flex items-start gap-2.5 border rounded-xl px-4 py-3 text-body-md ${cls}`}>
      <Info size={16} className="shrink-0 mt-0.5" />
      <p className="leading-relaxed">{children}</p>
    </div>
  )
}
