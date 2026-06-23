import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeartHandshake, PhoneCall, RefreshCw, AlertCircle, X, ExternalLink, Check } from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useDisplaySettings, primaryPhone } from '../../contexts/DisplaySettingsContext'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { removeVietnameseTones } from '../../components/SmartSearchSelect'
import {
  useChurnWorklist, useRecomputeLifecycle, useLogCareCall,
  type ChurnWorklistRow,
} from '../../hooks/queries/useCustomerCare'

interface ProfileLite { id: string; full_name: string }

const LIFECYCLE_BADGE: Record<string, { label: string; cls: string }> = {
  at_risk: { label: 'Có nguy cơ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  churned: { label: 'Đã rời bỏ', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
}

function suggestAction(r: ChurnWorklistRow): string {
  const hasDebt = r.total_debt > 0
  if (r.lifecycle === 'churned') return hasDebt ? 'Gọi tái kết nối + nhắc công nợ' : 'Gọi tái kết nối / ưu đãi quay lại'
  return hasDebt ? 'Gọi hỏi thăm + nhắc công nợ' : 'Gọi hỏi thăm / chào đơn mới'
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

  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | 'at_risk' | 'churned'>('all')
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)

  const query = useChurnWorklist(ownerId, !!profile?.id)
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

  // Modal ghi nhận gọi
  const [callRow, setCallRow] = useState<ChurnWorklistRow | null>(null)
  const [callContent, setCallContent] = useState('')
  const [callErr, setCallErr] = useState('')
  const openCall = (r: ChurnWorklistRow) => { setCallRow(r); setCallContent(''); setCallErr('') }
  const submitCall = async () => {
    if (!callRow || !profile?.id) return
    setCallErr('')
    try {
      await logCall.mutateAsync({
        customerId: callRow.customer_id,
        ownerUserId: profile.id,
        farmName: callRow.farm_name,
        content: callContent.trim(),
      })
      setNotice(`Đã ghi nhận cuộc gọi cho ${callRow.farm_name}.`)
      setCallRow(null)
    } catch (e) {
      setCallErr((e as Error).message || 'Không ghi được hoạt động.')
    }
  }

  const all = query.data ?? []
  const rows = useMemo(() => {
    const q = removeVietnameseTones(debounced.trim().toLowerCase())
    return all.filter(r => {
      if (lifecycleFilter !== 'all' && r.lifecycle !== lifecycleFilter) return false
      if (q && !removeVietnameseTones(`${r.farm_name} ${r.code ?? ''}`.toLowerCase()).includes(q)) return false
      return true
    })
  }, [all, debounced, lifecycleFilter])

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('vi-VN') : '—'

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
    { key: 'owner', header: 'NV phụ trách', width: 130, render: (r) => <span className="text-gray-600">{r.owner_name || '—'}</span> },
    { key: 'last', header: 'Mua cuối', width: 96, render: (r) => <span className="tabular-nums text-gray-600">{fmtDate(r.last_order_at)}</span> },
    {
      key: 'days', header: 'Trễ', width: 86, align: 'right', noTruncate: true,
      render: (r) => {
        const c = r.lifecycle === 'churned' ? 'text-rose-600' : 'text-amber-600'
        return <span className={`tabular-nums font-bold ${c}`}>{r.days_since != null ? `${Math.round(r.days_since)}n` : '—'}</span>
      },
    },
    { key: 'interval', header: 'Nhịp mua', width: 90, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{r.avg_interval_days != null ? `~${r.avg_interval_days}n` : '—'}</span> },
    {
      key: 'risk', header: 'Rủi ro', width: 120, align: 'center', noTruncate: true,
      render: (r) => {
        const b = LIFECYCLE_BADGE[r.lifecycle]
        return (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${b.cls}`}>
            {b.label} · {r.churn_score}
          </span>
        )
      },
    },
    { key: 'suggest', header: 'Gợi ý', width: 180, render: (r) => <span className="text-tiny text-gray-500">{suggestAction(r)}</span> },
    {
      key: 'action', header: 'Hành động', width: 150, align: 'center', noTruncate: true,
      render: (r) => (
        <div className="flex items-center justify-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); openCall(r) }}
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

  return (
    <Layout activeMenu="Chăm sóc KH">
      <div className="p-4 md:p-8 max-w-[1500px] w-full mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2">
              <HeartHandshake size={22} className="text-blue-500" /> Khách cần chăm sóc
            </h1>
            <p className="text-body-md text-gray-400 mt-1">Khách có dấu hiệu rời bỏ theo nhịp mua riêng — gọi lại kịp thời để giữ chân.</p>
          </div>
          {canManageUsers && (
            <button onClick={handleRecompute} disabled={recompute.isPending}
              className="bg-white border border-gray-200 text-gray-600 px-3.5 h-10 rounded-lg font-semibold text-tiny hover:bg-gray-50 flex items-center gap-1.5 self-start disabled:opacity-50">
              <RefreshCw size={16} className={`text-blue-500 ${recompute.isPending ? 'animate-spin' : ''}`} />
              {recompute.isPending ? 'Đang tính...' : 'Tính lại phân loại'}
            </button>
          )}
        </div>

        {notice && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-tiny text-blue-700 flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="p-1 hover:bg-blue-100 rounded-full"><X size={14} /></button>
          </div>
        )}

        {query.isError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-tiny text-rose-700 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{(query.error as Error)?.message || 'Không tải được danh sách.'} — thử tải lại trang.</span>
          </div>
        )}

        {/* Controls */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <label className="text-[11px] font-bold text-gray-400 uppercase block mb-1">Tìm kiếm</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên / mã khách hàng..." className={`${inputCls} w-full`} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Mức độ</label>
            <select value={lifecycleFilter} onChange={e => setLifecycleFilter(e.target.value as any)} className={`${inputCls} w-32`}>
              <option value="all">Tất cả</option>
              <option value="at_risk">Có nguy cơ</option>
              <option value="churned">Đã rời bỏ</option>
            </select>
          </div>
          {isManager && (
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-gray-400 uppercase block">Nhân viên</label>
              <select value={ownerId ?? ''} onChange={e => setOwnerId(e.target.value || null)} className={`${inputCls} w-44`}>
                <option value="">Tất cả NV (trong phạm vi)</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}
          <span className="text-tiny text-gray-400 lg:ml-auto self-center">{rows.length} khách</span>
        </div>

        {/* Bảng */}
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.customer_id}
          loading={query.isLoading}
          resetSignal={`${debounced}|${lifecycleFilter}|${ownerId}`}
          itemLabel="khách"
          emptyIcon={<HeartHandshake className="mx-auto text-gray-300 mb-2" size={44} />}
          emptyText="Không có khách nào cần chăm sóc trong phạm vi này"
        />

        <p className="text-[11px] text-gray-400 px-1">
          Phân loại theo nhịp mua riêng mỗi khách (trễ &gt; nhịp = nguy cơ, &gt; 2× nhịp = rời bỏ). Tự cập nhật hằng đêm; quản trị có thể bấm "Tính lại".
        </p>
      </div>

      {/* Modal ghi nhận gọi */}
      {callRow && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-body-lg text-gray-800 flex items-center gap-2"><PhoneCall size={18} className="text-blue-500" /> Ghi nhận cuộc gọi</h3>
              <button onClick={() => setCallRow(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-body-md">
                <span className="text-gray-500">Khách: </span><span className="font-bold text-gray-800">{callRow.farm_name}</span>
                {renderPhone(callRow.phone, 'ml-2 text-blue-600 text-tiny hover:underline')}
              </div>
              {callErr && <p className="text-rose-600 text-tiny">{callErr}</p>}
              <label className="block text-tiny font-semibold text-gray-600">
                Nội dung / kết quả gọi
                <textarea rows={4} value={callContent} onChange={e => setCallContent(e.target.value)}
                  placeholder="VD: Đã gọi, khách hẹn đặt hàng lại tuần sau / khách phản hồi giá cao..."
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </label>
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
    </Layout>
  )
}
