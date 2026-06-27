import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, GitMerge, AlertTriangle, CheckCircle2, Phone, ShieldCheck } from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface DupMember {
  primary_phone_norm: string
  id: string
  code: string | null
  farm_name: string
  value_tier: string | null
  created_at: string
  order_count: number
  open_debt_count: number
  herd_count: number
  is_suggested_winner: boolean
}

interface DupGroup {
  phone: string
  members: DupMember[]
}

export default function CustomerDuplicatesPage() {
  const navigate = useNavigate()
  const { hasAnyRole } = useAuth()
  const isAdmin = hasAnyRole(['admin'])

  const [groups, setGroups] = useState<DupGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [winnerByPhone, setWinnerByPhone] = useState<Record<string, string>>({})
  const [mergingPhone, setMergingPhone] = useState<string | null>(null)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('customer_duplicate_members')
        .select('*')
        .order('primary_phone_norm')
        .order('is_suggested_winner', { ascending: false })
        .order('order_count', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as DupMember[]
      // Gom nhóm theo SĐT chuẩn hóa
      const map = new Map<string, DupMember[]>()
      rows.forEach(r => {
        if (!map.has(r.primary_phone_norm)) map.set(r.primary_phone_norm, [])
        map.get(r.primary_phone_norm)!.push(r)
      })
      const grouped: DupGroup[] = Array.from(map.entries()).map(([phone, members]) => ({ phone, members }))
      setGroups(grouped)
      // Mặc định winner = bản được gợi ý
      const defaults: Record<string, string> = {}
      grouped.forEach(g => {
        const suggested = g.members.find(m => m.is_suggested_winner) || g.members[0]
        defaults[g.phone] = suggested.id
      })
      setWinnerByPhone(defaults)
    } catch (err: any) {
      console.error('Load duplicates error:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi tải danh sách trùng: ' + (err.message || 'Không xác định') })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!alertMsg) return
    const t = setTimeout(() => setAlertMsg(null), 4000)
    return () => clearTimeout(t)
  }, [alertMsg])

  const handleMerge = async (group: DupGroup) => {
    const winnerId = winnerByPhone[group.phone]
    if (!winnerId) return
    const winner = group.members.find(m => m.id === winnerId)
    const losers = group.members.filter(m => m.id !== winnerId)
    if (losers.length === 0) return
    const ok = window.confirm(
      `GỘP ${losers.length} bản thừa vào "${winner?.farm_name}" (mã ${winner?.code || 'N/A'})?\n\n` +
      `Toàn bộ đơn hàng, công nợ, liên hệ… của ${losers.length} bản kia sẽ được chuyển về bản này; ` +
      `các bản thừa sẽ bị ẩn (không xóa cứng).`
    )
    if (!ok) return
    setMergingPhone(group.phone)
    try {
      const { data, error } = await supabase.rpc('fn_merge_customers', {
        p_winner: winnerId,
        p_losers: losers.map(l => l.id),
      })
      if (error) throw error
      const merged = (data as any)?.merged_count ?? losers.length
      setGroups(prev => prev.filter(g => g.phone !== group.phone))
      setAlertMsg({ type: 'success', text: `Đã gộp ${merged} bản vào "${winner?.farm_name}".` })
    } catch (err: any) {
      console.error('Merge error:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi gộp khách: ' + (err.message || 'Không xác định') })
    } finally {
      setMergingPhone(null)
    }
  }

  const columns = useMemo<DataTableColumn<DupMember>[]>(() => [
    {
      key: 'pick',
      header: 'Giữ',
      width: 52,
      align: 'center',
      noTruncate: true,
      render: (row) => {
        const phone = row.primary_phone_norm
        const checked = winnerByPhone[phone] === row.id
        return (
          <input
            type="radio"
            name={`winner-${phone}`}
            checked={checked}
            onChange={() => setWinnerByPhone(prev => ({ ...prev, [phone]: row.id }))}
            className="w-4 h-4 accent-blue-600 cursor-pointer"
            aria-label="Chọn bản giữ lại"
          />
        )
      },
    },
    {
      key: 'name',
      header: 'Tên khách / trại',
      flex: true,
      minWidth: 160,
      render: (row) => (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-gray-800 truncate">{row.farm_name}</span>
          {row.is_suggested_winner && (
            <span className="shrink-0 text-[9px] font-bold uppercase bg-emerald-50 text-emerald-700 px-1 py-0.5 rounded">gợi ý</span>
          )}
          {(row.value_tier === 'vip') && (
            <span className="shrink-0 text-[9px] font-bold uppercase bg-blue-600 text-white px-1 py-0.5 rounded">VIP</span>
          )}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'Mã KH',
      width: 132,
      cellClassName: 'font-mono text-tiny text-gray-500',
      render: (row) => row.code || 'N/A',
    },
    {
      key: 'orders',
      header: 'Đơn',
      width: 60,
      align: 'right',
      render: (row) => <span className={row.order_count > 0 ? 'font-bold text-gray-800' : 'text-gray-400'}>{row.order_count}</span>,
    },
    {
      key: 'debts',
      header: 'Nợ mở',
      width: 70,
      align: 'right',
      render: (row) => <span className={row.open_debt_count > 0 ? 'font-bold text-amber-600' : 'text-gray-400'}>{row.open_debt_count}</span>,
    },
    {
      key: 'created',
      header: 'Ngày tạo',
      width: 104,
      align: 'right',
      hideOnMobile: true,
      cellClassName: 'text-tiny text-gray-500',
      render: (row) => new Date(row.created_at).toLocaleDateString('vi-VN'),
    },
  ], [winnerByPhone])

  if (!isAdmin) {
    return (
      <Layout activeMenu="Khách hàng">
        <div className="p-8 text-center text-gray-500">
          <ShieldCheck className="mx-auto mb-2 text-gray-300" size={32} />
          Chỉ quản trị viên (admin) được phép gộp khách hàng trùng.
        </div>
      </Layout>
    )
  }

  return (
    <Layout activeMenu="Khách hàng">
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-body-md font-medium ${
            alertMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            {alertMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            {alertMsg.text}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => navigate('/customers')} className="p-1.5 hover:bg-gray-50 border border-gray-100 rounded-lg text-gray-500 shrink-0">
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <h3 className="text-body-lg font-bold text-gray-800 flex items-center gap-1.5"><GitMerge size={18} className="text-blue-600" /> Khách hàng trùng SĐT</h3>
              <p className="text-tiny text-gray-500">Gộp các bản ghi cùng số điện thoại về một khách chuẩn (giữ đơn hàng & công nợ).</p>
            </div>
          </div>
          <button onClick={load} disabled={loading} className="h-9 px-3 border border-gray-200 text-gray-700 rounded-lg text-body-md font-semibold hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 shrink-0">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Tải lại
          </button>
        </div>

        {/* Empty state */}
        {!loading && groups.length === 0 && (
          <div className="p-10 text-center bg-white border border-gray-100 rounded-xl">
            <CheckCircle2 className="mx-auto mb-2 text-emerald-400" size={36} />
            <p className="text-body-md font-semibold text-gray-700">Không còn khách hàng trùng số điện thoại.</p>
          </div>
        )}

        {loading && (
          <div className="p-10 text-center text-gray-400"><RefreshCw className="mx-auto animate-spin" size={24} /></div>
        )}

        {/* Groups */}
        {!loading && groups.map(group => {
          const winnerId = winnerByPhone[group.phone]
          const loserCount = group.members.length - 1
          const merging = mergingPhone === group.phone
          return (
            <div key={group.phone} className="bg-white border border-gray-150 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-gray-25 border-b border-gray-100">
                <span className="flex items-center gap-1.5 text-body-md font-bold text-gray-800">
                  <Phone size={14} className="text-gray-400" /> {group.phone}
                  <span className="text-tiny font-medium text-gray-400">· {group.members.length} bản ghi</span>
                </span>
                <button
                  onClick={() => handleMerge(group)}
                  disabled={merging || !winnerId}
                  className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-tiny font-bold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {merging ? <RefreshCw size={13} className="animate-spin" /> : <GitMerge size={13} />}
                  Gộp {loserCount} bản vào bản đã chọn
                </button>
              </div>
              <div className="p-2">
                <DataTable
                  columns={columns}
                  rows={group.members}
                  getRowKey={(m) => m.id}
                  pageSize={0}
                  card={false}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Layout>
  )
}
