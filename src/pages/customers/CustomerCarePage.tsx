import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  HeartHandshake, PhoneCall, RefreshCw, AlertCircle, X, ExternalLink, Check, Repeat,
  Settings2, Clock,
} from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useDisplaySettings, primaryPhone } from '../../contexts/DisplaySettingsContext'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { removeVietnameseTones } from '../../components/SmartSearchSelect'
import CareConfigModal from './CareConfigModal'
import {
  useChurnWorklist, useRecomputeLifecycle, useLogCareCall, useReorderReminders,
  useCareCallHistory, CARE_OUTCOMES, careOutcomeLabel,
  type ChurnWorklistRow, type ReorderReminderRow,
} from '../../hooks/queries/useCustomerCare'

interface ProfileLite { id: string; full_name: string }
interface CallTarget {
  customer_id: string
  farm_name: string
  phone: string | null
  note?: string
  kind: 'churn' | 'reorder'
  call_count?: number
}
type CareTab = 'care' | 'reorder'
/** Lọc theo tiến độ gọi — thứ quyết định hôm nay còn phải làm gì. */
type CallFilter = 'all' | 'chua_goi' | 'den_han' | 'dang_cho'

const LIFECYCLE_BADGE: Record<string, { label: string; cls: string }> = {
  at_risk: { label: 'Có nguy cơ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  churned: { label: 'Đã rời bỏ', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
}

export default function CustomerCarePage() {
  const navigate = useNavigate()
  const { profile, userRole, hasPermission } = useAuth()
  const { formatCurrency, formatPhone, maskData } = useDisplaySettings()
  // Hiển thị SĐT an toàn: tách số đầu (bỏ số phụ/CCCD ghép) → format → áp chính sách che số
  const renderPhone = (raw: string | null, cls: string) => {
    const p = primaryPhone(raw)
    if (!p) return null
    return (
      <a href={`tel:${p.replace(/\D/g, '')}`} onClick={(e) => e.stopPropagation()} className={cls}>
        {maskData(formatPhone(p), 'phone')}
      </a>
    )
  }
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'
  const isManager = isAdmin || userRole.code === 'branch_manager' || userRole.code === 'team_lead'
  const canManageUsers = hasPermission('users.manage') || isAdmin
  // Cấu hình nhắc việc đi qua fn_is_sysadmin() — CHỈ vai trò `admin`, không gồm ceo.
  const isSysAdmin = userRole.code === 'admin'

  const [tab, setTab] = useState<CareTab>('care')
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | 'at_risk' | 'churned'>('all')
  const [callFilter, setCallFilter] = useState<CallFilter>('all')
  const [search, setSearch] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const debounced = useDebouncedValue(search, 300)

  const query = useChurnWorklist(ownerId, !!profile?.id && tab === 'care')
  const reorderQuery = useReorderReminders(ownerId, !!profile?.id && tab === 'reorder')
  const recompute = useRecomputeLifecycle()
  const logCall = useLogCareCall()

  const [profiles, setProfiles] = useState<ProfileLite[]>([])
  useEffect(() => {
    if (!isManager) return
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')
      .then(({ data }: { data: ProfileLite[] | null }) => { if (data) setProfiles(data) })
  }, [isManager])

  const [notice, setNotice] = useState<string | null>(null)
  const handleRecompute = async () => {
    try {
      const res = await recompute.mutateAsync()
      setNotice(`Đã tính lại: ${res.active} hoạt động · ${res.at_risk} nguy cơ · ${res.churned} rời bỏ · ${res.new} mới.`)
    } catch (e) {
      setNotice(`Lỗi tính lại: ${(e as Error).message}`)
    }
  }

  // ── Hộp thoại ghi nhận gọi ──
  const [callRow, setCallRow] = useState<CallTarget | null>(null)
  const [callContent, setCallContent] = useState('')
  const [callOutcome, setCallOutcome] = useState('hen_mua')
  const [callNext, setCallNext] = useState('')
  const [callErr, setCallErr] = useState('')
  const history = useCareCallHistory(callRow?.customer_id ?? null)

  const openCall = (t: CallTarget) => {
    setCallRow(t); setCallContent(t.note ?? ''); setCallOutcome('hen_mua')
    setCallNext(''); setCallErr('')
  }
  const submitCall = async () => {
    if (!callRow || !profile?.id) return
    setCallErr('')
    try {
      const res = await logCall.mutateAsync({
        customerId: callRow.customer_id,
        content: callContent.trim(),
        outcome: callOutcome,
        nextFollowup: callNext || null,
        kind: callRow.kind,
      })
      setNotice(`Đã ghi nhận cuộc gọi cho ${callRow.farm_name} — tổng ${res.call_count} lần gọi.`)
      setCallRow(null)
    } catch (e) {
      setCallErr((e as Error).message || 'Không ghi được hoạt động.')
    }
  }

  const all = useMemo(() => query.data ?? [], [query.data])
  // Mốc "bây giờ" cố định theo mỗi lần tải dữ liệu — để Date.now() trần thì
  // useMemo lọc lại ở mọi lần render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `all` là mốc làm mới có chủ đích
  const now = useMemo(() => Date.now(), [all])
  const rows = useMemo(() => {
    const q = removeVietnameseTones(debounced.trim().toLowerCase())
    return all.filter(r => {
      if (lifecycleFilter !== 'all' && r.lifecycle !== lifecycleFilter) return false
      if (callFilter !== 'all') {
        const waiting = !!r.snooze_until && new Date(r.snooze_until).getTime() > now
        if (callFilter === 'chua_goi' && (r.call_count > 0 || waiting)) return false
        if (callFilter === 'dang_cho' && !waiting) return false
        if (callFilter === 'den_han' && (waiting || r.call_count === 0)) return false
      }
      if (q && !removeVietnameseTones(`${r.farm_name} ${r.code ?? ''}`.toLowerCase()).includes(q)) return false
      return true
    })
  }, [all, debounced, lifecycleFilter, callFilter, now])

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('vi-VN') : '—'
  const fmtShort = (s: string | null) => s ? new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : '—'

  const columns: DataTableColumn<ChurnWorklistRow>[] = [
    {
      key: 'customer', header: 'Khách hàng', flex: true, minWidth: 190,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-bold text-gray-700 truncate">{r.farm_name}</div>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            {r.code && <span className="uppercase tracking-wider">{r.code}</span>}
            {renderPhone(r.phone, 'text-blue-500 hover:underline')}
          </div>
          {r.total_debt > 0 && <div className="text-[11px] text-rose-600 font-semibold">Nợ: {formatCurrency(r.total_debt)}</div>}
        </div>
      ),
    },
    {
      key: 'risk', header: 'Ưu tiên', width: 118, align: 'center', noTruncate: true, mobileHeaderRight: true,
      render: (r) => {
        const b = LIFECYCLE_BADGE[r.lifecycle] ?? { label: r.lifecycle, cls: 'bg-gray-100 text-gray-600 border-gray-200' }
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${b.cls}`}>{b.label}</span>
            <span className="text-[10px] text-gray-400 tabular-nums">điểm {r.priority}</span>
          </div>
        )
      },
    },
    {
      key: 'days', header: 'Im lặng', width: 84, align: 'right', noTruncate: true,
      render: (r) => {
        const c = r.lifecycle === 'churned' ? 'text-rose-600' : 'text-amber-600'
        return <span className={`tabular-nums font-bold ${c}`}>{r.days_since != null ? `${Math.round(r.days_since)}n` : '—'}</span>
      },
    },
    { key: 'last', header: 'Mua cuối', width: 92, render: (r) => <span className="tabular-nums text-gray-600">{fmtDate(r.last_order_at)}</span> },
    {
      key: 'revenue', header: 'DT 90 ngày', width: 104, align: 'right',
      render: (r) => <span className="tabular-nums text-gray-600 font-semibold">{formatCurrency(r.revenue_90d)}</span>,
    },
    {
      key: 'calls', header: 'Đã gọi', width: 138, noTruncate: true,
      render: (r) => {
        if (r.call_count === 0) return <span className="text-[11px] text-gray-300">Chưa gọi</span>
        const waiting = !!r.snooze_until && new Date(r.snooze_until).getTime() > now
        return (
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
              <PhoneCall size={10} /> {r.call_count} lần
            </span>
            <div className="text-[10px] text-gray-400 truncate">
              {fmtShort(r.last_call_at)}
              {r.last_outcome && ` · ${careOutcomeLabel(r.last_outcome)}`}
            </div>
            {waiting && (
              <div className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                <Clock size={9} /> chờ tới {fmtShort(r.snooze_until)}
              </div>
            )}
          </div>
        )
      },
    },
    { key: 'owner', header: 'NV phụ trách', width: 108, hideOnMobile: true, render: (r) => <span className="text-gray-600">{r.owner_name || '—'}</span> },
    {
      key: 'action', header: 'Hành động', width: 146, align: 'center', noTruncate: true,
      render: (r) => (
        <div className="flex items-center justify-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); openCall({ customer_id: r.customer_id, farm_name: r.farm_name, phone: r.phone, kind: 'churn', call_count: r.call_count }) }}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 whitespace-nowrap">
            <PhoneCall size={11} /> Ghi nhận gọi
          </button>
          <button onClick={(e) => { e.stopPropagation(); navigate(`/customers/${r.customer_id}`) }}
            className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="Xem khách hàng">
            <ExternalLink size={14} />
          </button>
        </div>
      ),
    },
  ]

  // ── Tab Nhắc mua lại ──
  const allReorder = useMemo(() => reorderQuery.data ?? [], [reorderQuery.data])
  const reorderRows = useMemo(() => {
    const q = removeVietnameseTones(debounced.trim().toLowerCase())
    return allReorder.filter(r => {
      if (q && !removeVietnameseTones(`${r.farm_name} ${r.code ?? ''} ${r.product_name}`.toLowerCase()).includes(q)) return false
      return true
    })
  }, [allReorder, debounced])

  const reorderColumns: DataTableColumn<ReorderReminderRow>[] = [
    {
      key: 'customer', header: 'Khách hàng', flex: true, minWidth: 180,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-bold text-gray-700 truncate">{r.farm_name}</div>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            {r.code && <span className="uppercase tracking-wider">{r.code}</span>}
            {renderPhone(r.phone, 'text-blue-500 hover:underline')}
          </div>
        </div>
      ),
    },
    {
      key: 'product', header: 'Sản phẩm', flex: true, minWidth: 170,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-gray-600 truncate">{r.product_name}</div>
          <div className="text-[11px] text-gray-400">
            {r.n_buys} lần · lần cuối {r.last_qty != null ? `${r.last_qty}${r.unit ? ' ' + r.unit : ''}` : '—'}
          </div>
        </div>
      ),
    },
    { key: 'last', header: 'Mua cuối', width: 96, render: (r) => <span className="tabular-nums text-gray-600">{fmtDate(r.last_bought_at)}</span> },
    { key: 'interval', header: 'Nhịp mua', width: 90, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{r.avg_interval_days != null ? `~${r.avg_interval_days}n` : '—'}</span> },
    {
      key: 'due', header: 'Trễ', width: 96, align: 'right', noTruncate: true,
      render: (r) => {
        const ratio = r.overdue_ratio ?? 0
        const c = ratio >= 2 ? 'text-rose-600' : ratio >= 1.3 ? 'text-amber-600' : 'text-gray-500'
        return (
          <span className={`tabular-nums font-bold ${c}`}>
            {r.days_since != null ? `${Math.round(r.days_since)}n` : '—'}
            {ratio ? <span className="text-[10px] font-normal"> ({ratio}×)</span> : null}
          </span>
        )
      },
    },
    { key: 'next', header: 'Dự kiến kỳ tới', width: 110, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{fmtDate(r.predicted_next)}</span> },
    {
      key: 'action', header: 'Hành động', width: 150, align: 'center', noTruncate: true,
      render: (r) => (
        <div className="flex items-center justify-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); openCall({ customer_id: r.customer_id, farm_name: r.farm_name, phone: r.phone, kind: 'reorder', note: `Nhắc mua lại: ${r.product_name}. ` }) }}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 whitespace-nowrap">
            <PhoneCall size={11} /> Ghi nhận gọi
          </button>
          <button onClick={(e) => { e.stopPropagation(); navigate(`/customers/${r.customer_id}`) }}
            className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="Xem khách hàng">
            <ExternalLink size={14} />
          </button>
        </div>
      ),
    },
  ]

  const inputCls = 'h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none'

  // Đếm nhanh để nhân viên biết hôm nay còn bao nhiêu việc.
  const stat = useMemo(() => {
    const waiting = all.filter(r => r.snooze_until && new Date(r.snooze_until).getTime() > now).length
    return {
      chua_goi: all.filter(r => r.call_count === 0 && !(r.snooze_until && new Date(r.snooze_until).getTime() > now)).length,
      dang_cho: waiting,
      churned: all.filter(r => r.lifecycle === 'churned').length,
    }
  }, [all, now])

  return (
    <Layout activeMenu="Chăm sóc KH">
      <div className="p-4 md:p-8 max-w-[1500px] w-full mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2">
              <HeartHandshake size={22} className="text-blue-500" /> Chăm sóc khách hàng
            </h1>
            <p className="text-body-md text-gray-400 mt-1">
              {tab === 'care'
                ? 'Khách có dấu hiệu rời bỏ theo nhịp mua riêng — gọi lại kịp thời để giữ chân.'
                : 'Khách tới kỳ mua lại sản phẩm quen — chào đơn đúng lúc.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 self-start">
            {tab === 'care' && isSysAdmin && (
              <button onClick={() => setShowConfig(true)}
                className="bg-white border border-gray-200 text-gray-600 px-3.5 h-10 rounded-lg font-semibold text-tiny hover:bg-gray-50 flex items-center gap-1.5">
                <Settings2 size={16} className="text-blue-500" /> Cấu hình nhắc việc
              </button>
            )}
            {tab === 'care' && canManageUsers && (
              <button onClick={handleRecompute} disabled={recompute.isPending}
                className="bg-white border border-gray-200 text-gray-600 px-3.5 h-10 rounded-lg font-semibold text-tiny hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCw size={16} className={`text-blue-500 ${recompute.isPending ? 'animate-spin' : ''}`} />
                {recompute.isPending ? 'Đang tính...' : 'Tính lại phân loại'}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-150">
          {([['care', 'Khách cần chăm sóc', HeartHandshake], ['reorder', 'Nhắc mua lại', Repeat]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-tiny font-bold border-b-2 -mb-px transition-colors ${
                tab === k ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {notice && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-tiny text-blue-700 flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="p-1 hover:bg-blue-100 rounded-full"><X size={14} /></button>
          </div>
        )}

        {(tab === 'care' ? query.isError : reorderQuery.isError) && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-tiny text-rose-700 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{((tab === 'care' ? query.error : reorderQuery.error) as Error)?.message || 'Không tải được danh sách.'} — thử tải lại trang.</span>
          </div>
        )}

        {/* Controls */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <label className="text-[11px] font-bold text-gray-400 uppercase block mb-1">Tìm kiếm</label>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={tab === 'care' ? 'Tên / mã khách hàng...' : 'Tên khách / sản phẩm...'} className={`${inputCls} w-full`} />
          </div>
          {tab === 'care' && (
            <>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase block">Mức độ</label>
                <select value={lifecycleFilter} onChange={e => setLifecycleFilter(e.target.value as typeof lifecycleFilter)} className={`${inputCls} w-32`}>
                  <option value="all">Tất cả</option>
                  <option value="at_risk">Có nguy cơ</option>
                  <option value="churned">Đã rời bỏ</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase block">Tiến độ gọi</label>
                <select value={callFilter} onChange={e => setCallFilter(e.target.value as CallFilter)} className={`${inputCls} w-40`}>
                  <option value="all">Tất cả</option>
                  <option value="chua_goi">Chưa gọi lần nào</option>
                  <option value="den_han">Đã gọi, tới lúc gọi lại</option>
                  <option value="dang_cho">Đang chờ khách</option>
                </select>
              </div>
            </>
          )}
          {isManager && (
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-gray-400 uppercase block">Nhân viên</label>
              <select value={ownerId ?? ''} onChange={e => setOwnerId(e.target.value || null)} className={`${inputCls} w-44`}>
                <option value="">Tất cả NV (trong phạm vi)</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}
          <span className="text-tiny text-gray-400 lg:ml-auto self-center">
            {tab === 'care'
              ? `${rows.length} khách · chưa gọi ${stat.chua_goi} · đang chờ ${stat.dang_cho}`
              : `${reorderRows.length} lượt`}
          </span>
        </div>

        {/* Bảng */}
        {tab === 'care' ? (
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.customer_id}
            loading={query.isLoading}
            resetSignal={`${debounced}|${lifecycleFilter}|${callFilter}|${ownerId}`}
            itemLabel="khách"
            emptyIcon={<HeartHandshake className="mx-auto text-gray-300 mb-2" size={44} />}
            emptyText="Không có khách nào cần chăm sóc trong phạm vi này"
          />
        ) : (
          <DataTable
            columns={reorderColumns}
            rows={reorderRows}
            getRowKey={(r) => `${r.customer_id}|${r.product_id}`}
            loading={reorderQuery.isLoading}
            resetSignal={`${debounced}|${ownerId}`}
            itemLabel="lượt"
            emptyIcon={<Repeat className="mx-auto text-gray-300 mb-2" size={44} />}
            emptyText="Chưa có khách nào tới kỳ mua lại trong phạm vi này"
          />
        )}

        <p className="text-[11px] text-gray-400 px-1">
          {tab === 'care'
            ? 'Phân loại theo nhịp mua riêng mỗi khách, kèm sàn số ngày im lặng tối thiểu (mặc định 21 ngày = nguy cơ, 45 ngày = rời bỏ) để khách mua dày không bị báo oan. Điểm ưu tiên = giá trị khách × độ trễ − số lần đã gọi. Nhóm Telegram nhận danh sách 2 lần/ngày.'
            : 'Gợi ý theo nhịp mua từng sản phẩm của mỗi khách (mua ≥3 lần, chu kỳ 7–120 ngày). "Trễ" = số ngày kể từ lần mua cuối, kèm bội số so với nhịp mua.'}
        </p>
      </div>

      {/* Modal ghi nhận gọi */}
      {callRow && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-body-lg text-gray-800 flex items-center gap-2"><PhoneCall size={18} className="text-blue-500" /> Ghi nhận cuộc gọi</h3>
              <button onClick={() => setCallRow(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="text-body-md">
                <span className="text-gray-500">Khách: </span><span className="font-bold text-gray-800">{callRow.farm_name}</span>
                {renderPhone(callRow.phone, 'ml-2 text-blue-600 text-tiny hover:underline')}
                {!!callRow.call_count && (
                  <span className="ml-2 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-1.5 py-0.5">
                    đã gọi {callRow.call_count} lần
                  </span>
                )}
              </div>

              {callErr && <p className="text-rose-600 text-tiny">{callErr}</p>}

              <div>
                <span className="block text-tiny font-semibold text-gray-600 mb-1.5">Kết quả cuộc gọi</span>
                <div className="flex flex-wrap gap-1.5">
                  {CARE_OUTCOMES.map(o => (
                    <button key={o.code} type="button" onClick={() => setCallOutcome(o.code)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${
                        callOutcome === o.code ? o.cls : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Sau khi lưu, khách tạm ẩn khỏi tin nhắc việc{' '}
                  {CARE_OUTCOMES.find(o => o.code === callOutcome)?.days} ngày (trừ khi bạn đặt ngày hẹn riêng bên dưới).
                </p>
              </div>

              <label className="block text-tiny font-semibold text-gray-600">
                Ngày hẹn gọi lại <span className="font-normal text-gray-400">(tùy chọn)</span>
                <input type="date" value={callNext} onChange={e => setCallNext(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </label>

              <label className="block text-tiny font-semibold text-gray-600">
                Nội dung / ghi chú
                <textarea rows={3} value={callContent} onChange={e => setCallContent(e.target.value)}
                  placeholder="VD: Đã gọi, khách hẹn đặt hàng lại tuần sau / khách phản hồi giá cao..."
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </label>

              {!!history.data?.length && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-tiny font-bold text-gray-600 mb-1.5">Lịch sử gọi ({history.data.length})</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {history.data.map(h => (
                      <div key={h.id} className="text-[11px] text-gray-500 border-l-2 border-gray-150 pl-2">
                        <span className="font-semibold text-gray-600">{fmtShort(h.called_at)}</span>
                        {h.by_name && <span className="text-gray-400"> · {h.by_name}</span>}
                        {h.outcome && <span className="text-blue-600"> · {careOutcomeLabel(h.outcome)}</span>}
                        {h.content && <div className="text-gray-400 truncate">{h.content}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setCallRow(null)} className="h-10 px-4 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={submitCall} disabled={logCall.isPending}
                className="h-10 px-5 bg-blue-500 text-white rounded-lg text-tiny font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                <Check size={15} /> {logCall.isPending ? 'Đang lưu...' : 'Lưu hoạt động'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfig && <CareConfigModal onClose={() => setShowConfig(false)} />}
    </Layout>
  )
}
