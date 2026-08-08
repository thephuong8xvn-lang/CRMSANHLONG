import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Users, Search, X, Trash2, Send, RefreshCw,
  AlertTriangle, CheckCircle2, Layers, Pencil,
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

/**
 * Nhóm khách hàng — quan hệ NHIỀU-NHIỀU.
 *
 * Một khách thuộc bao nhiêu nhóm cũng được: vừa "Ân Hảo" (khu vực), vừa "VIP"
 * (hạng), vừa "Gà thịt" (chăn nuôi). Đó là lý do phải có bảng nối riêng thay
 * vì dùng `customer_type` / `value_tier` vốn mỗi khách chỉ một giá trị.
 *
 * ⚠️ Dữ liệu địa lý trong hệ thống đang TRỐNG HOÀN TOÀN (province/district/
 * address NULL cả 1.945 khách), nên nhóm khu vực không thể tự sinh. Đường
 * nhanh nhất là "Thêm hàng loạt" với ô tìm kiếm theo tên — tên trại ở đây
 * thường đã chứa địa danh ("Ân Hảo", "Hoài Ân"...).
 */

interface CustomerGroup {
  id: string
  code: string
  name: string
  kind: string
  description: string | null
  is_active: boolean
  so_thanh_vien: number
  so_co_nhom_tg: number
}

interface MemberRow {
  customer_id: string
  customers: {
    id: string
    code: string | null
    farm_name: string
    primary_phone: string | null
    telegram_chat_id: string | null
    telegram_enabled: boolean
  } | null
}

interface CustomerLite {
  id: string
  code: string | null
  farm_name: string
  primary_phone: string | null
  telegram_chat_id: string | null
}

const KINDS: { value: string; label: string; hint: string }[] = [
  { value: 'khu_vuc', label: 'Khu vực', hint: 'Ân Hảo, Hoài Ân, Phù Mỹ…' },
  { value: 'hang_khach', label: 'Hạng khách', hint: 'VIP, thân thiết, mới…' },
  { value: 'chan_nuoi', label: 'Chăn nuôi', hint: 'Gà thịt, gà đẻ, heo…' },
  { value: 'khac', label: 'Khác', hint: '' },
]

const kindLabel = (k: string) => KINDS.find(x => x.value === k)?.label ?? 'Khác'

const KIND_COLORS: Record<string, string> = {
  khu_vuc: 'bg-blue-50 text-blue-700 border-blue-100',
  hang_khach: 'bg-amber-50 text-amber-700 border-amber-100',
  chan_nuoi: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  khac: 'bg-gray-50 text-gray-600 border-gray-200',
}

/** Bỏ dấu + gạch nối để sinh mã nhóm từ tên, giống cách đặt mã ở nơi khác. */
function slugify(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

export default function CustomerGroupsPage() {
  const navigate = useNavigate()

  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [editing, setEditing] = useState<Partial<CustomerGroup> | null>(null)
  const [openGroup, setOpenGroup] = useState<CustomerGroup | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_customer_groups_overview')
    if (error) setAlertMsg({ type: 'error', text: 'Lỗi tải nhóm: ' + error.message })
    else setGroups((data ?? []) as CustomerGroup[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!alertMsg) return
    const t = setTimeout(() => setAlertMsg(null), 4000)
    return () => clearTimeout(t)
  }, [alertMsg])

  const byKind = useMemo(() => {
    const m = new Map<string, CustomerGroup[]>()
    groups.forEach(g => {
      if (!m.has(g.kind)) m.set(g.kind, [])
      m.get(g.kind)!.push(g)
    })
    return m
  }, [groups])

  const saveGroup = async () => {
    if (!editing?.name?.trim()) { setAlertMsg({ type: 'error', text: 'Chưa nhập tên nhóm' }); return }
    const payload = {
      name: editing.name.trim(),
      kind: editing.kind || 'khac',
      description: editing.description?.trim() || null,
    }
    const { error } = editing.id
      ? await supabase.from('customer_groups').update(payload).eq('id', editing.id)
      : await supabase.from('customer_groups').insert({
          ...payload,
          code: slugify(editing.name) || 'nhom_' + Date.now(),
        })
    if (error) { setAlertMsg({ type: 'error', text: error.message }); return }
    setEditing(null)
    setAlertMsg({ type: 'success', text: editing.id ? 'Đã lưu nhóm.' : 'Đã tạo nhóm.' })
    load()
  }

  const deleteGroup = async (g: CustomerGroup) => {
    if (!confirm(`Xoá nhóm "${g.name}"? Toàn bộ ${g.so_thanh_vien} thành viên trong nhóm sẽ bị gỡ. Khách hàng KHÔNG bị xoá.`)) return
    const { error } = await supabase.from('customer_groups').delete().eq('id', g.id)
    if (error) { setAlertMsg({ type: 'error', text: error.message }); return }
    setAlertMsg({ type: 'success', text: 'Đã xoá nhóm.' })
    load()
  }

  return (
    <Layout activeMenu="Khách hàng">
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-55 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-body-md font-medium ${
            alertMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            {alertMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            {alertMsg.text}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/customers')}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-heading-md font-semibold text-gray-900">Nhóm khách hàng</h1>
              <p className="text-tiny text-gray-500">
                Một khách có thể thuộc nhiều nhóm — dùng để nhắm tin khuyến mãi.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => setEditing({ kind: 'khu_vuc' })}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-500 text-gray-0 rounded-lg text-body-md hover:bg-blue-600">
              <Plus size={16} /> Tạo nhóm
            </button>
          </div>
        </div>

        {!loading && groups.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center space-y-2">
            <Layers className="mx-auto text-gray-300" size={32} />
            <p className="text-body-md text-gray-600">Chưa có nhóm nào.</p>
            <p className="text-tiny text-gray-500 max-w-md mx-auto">
              Tạo nhóm theo khu vực, hạng khách hoặc loại chăn nuôi. Sau đó vào
              Khuyến mãi → nút ✈️ → “Theo nhóm khách” để gửi đúng nhóm cần gửi.
            </p>
          </div>
        )}

        {KINDS.map(k => {
          const list = byKind.get(k.value) ?? []
          if (list.length === 0) return null
          return (
            <div key={k.value} className="space-y-2">
              <h2 className="text-body-md font-semibold text-gray-700">{k.label}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map(g => (
                  <div key={g.id} className="rounded-lg border border-gray-200 bg-gray-0 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-body-md font-medium text-gray-900 truncate">{g.name}</p>
                        {g.description && (
                          <p className="text-tiny text-gray-500 truncate">{g.description}</p>
                        )}
                      </div>
                      <span className={`shrink-0 text-tiny px-2 py-0.5 rounded-lg border ${KIND_COLORS[g.kind] ?? KIND_COLORS.khac}`}>
                        {kindLabel(g.kind)}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-3 text-tiny">
                      <span className="text-gray-600">
                        <Users size={12} className="inline mb-0.5" /> {g.so_thanh_vien} khách
                      </span>
                      <span className={g.so_co_nhom_tg > 0 ? 'text-emerald-600' : 'text-gray-400'}>
                        <Send size={12} className="inline mb-0.5" /> {g.so_co_nhom_tg} nhắn được
                      </span>
                    </div>

                    <div className="mt-2 flex gap-1.5">
                      <button onClick={() => setOpenGroup(g)}
                        className="px-2.5 py-1 text-tiny border border-gray-200 rounded-lg hover:bg-gray-50">
                        Thành viên
                      </button>
                      <button onClick={() => setEditing(g)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteGroup(g)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {groups.length > 0 && (
          <p className="text-tiny text-gray-400">
            “Nhắn được” = khách trong nhóm đã có id nhóm Telegram và đang bật nhận tin.
            Số này mới là số thật sẽ nhận khuyến mãi.
          </p>
        )}
      </div>

      {editing && (
        <GroupFormModal
          value={editing}
          onChange={setEditing}
          onSave={saveGroup}
          onClose={() => setEditing(null)}
        />
      )}

      {openGroup && (
        <GroupMembersModal
          group={openGroup}
          onClose={() => { setOpenGroup(null); load() }}
          onAlert={setAlertMsg}
        />
      )}
    </Layout>
  )
}

/* ─────────────────────────────────────────────────────────────────── */

function GroupFormModal({ value, onChange, onSave, onClose }: {
  value: Partial<CustomerGroup>
  onChange: (v: Partial<CustomerGroup>) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-0 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-body-lg font-semibold text-gray-900">
            {value.id ? 'Sửa nhóm' : 'Tạo nhóm khách hàng'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-tiny text-gray-500">Tên nhóm</label>
            <input
              autoFocus
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-body-md"
              placeholder="Ví dụ: Khu vực Ân Hảo"
              value={value.name ?? ''}
              onChange={e => onChange({ ...value, name: e.target.value })}
            />
          </div>

          <div>
            <label className="text-tiny text-gray-500">Loại nhóm</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {KINDS.map(k => (
                <button key={k.value} type="button"
                  onClick={() => onChange({ ...value, kind: k.value })}
                  className={`px-2.5 py-1 text-tiny rounded-lg border ${
                    (value.kind ?? 'khac') === k.value
                      ? 'bg-blue-500 text-gray-0 border-blue-500'
                      : 'bg-gray-0 text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {k.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-tiny text-gray-400">
              {KINDS.find(k => k.value === (value.kind ?? 'khac'))?.hint}
            </p>
          </div>

          <div>
            <label className="text-tiny text-gray-500">Ghi chú (tuỳ chọn)</label>
            <input
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-body-md"
              value={value.description ?? ''}
              onChange={e => onChange({ ...value, description: e.target.value })}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-body-md text-gray-600 hover:bg-gray-100 rounded-lg">
            Huỷ
          </button>
          <button onClick={onSave}
            className="px-4 py-2 text-body-md bg-blue-500 text-gray-0 rounded-lg hover:bg-blue-600">
            Lưu
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */

function GroupMembersModal({ group, onClose, onAlert }: {
  group: CustomerGroup
  onClose: () => void
  onAlert: (a: { type: 'success' | 'error'; text: string }) => void
}) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<CustomerLite[]>([])
  const [busy, setBusy] = useState(false)

  const memberIds = useMemo(() => new Set(members.map(m => m.customer_id)), [members])

  const loadMembers = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('customer_group_members')
      .select('customer_id, customers(id, code, farm_name, primary_phone, telegram_chat_id, telegram_enabled)')
      .eq('group_id', group.id)
      .limit(1000)
    if (error) onAlert({ type: 'error', text: error.message })
    else setMembers((data ?? []) as unknown as MemberRow[])
    setLoading(false)
  }, [group.id, onAlert])

  useEffect(() => { loadMembers() }, [loadMembers])

  // Tìm khách để thêm. Debounce vì gõ tên trại thì mỗi ký tự là một lượt gọi.
  useEffect(() => {
    const kw = q.trim()
    if (kw.length < 2) { setFound([]); return }
    let alive = true
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, code, farm_name, primary_phone, telegram_chat_id')
        .is('merged_into_id', null)
        .or(`farm_name.ilike.%${kw}%,code.ilike.%${kw}%,primary_phone.ilike.%${kw}%`)
        .order('farm_name')
        .limit(30)
      if (alive) setFound((data ?? []) as CustomerLite[])
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  const add = async (customerId: string) => {
    const { error } = await supabase.from('customer_group_members')
      .insert({ group_id: group.id, customer_id: customerId })
    if (error) { onAlert({ type: 'error', text: error.message }); return }
    loadMembers()
  }

  const remove = async (customerId: string) => {
    const { error } = await supabase.from('customer_group_members')
      .delete().eq('group_id', group.id).eq('customer_id', customerId)
    if (error) { onAlert({ type: 'error', text: error.message }); return }
    loadMembers()
  }

  /** Thêm hàng loạt theo đúng từ khoá đang gõ — đường nhanh nhất khi gom nhóm
   *  khu vực, vì tên trại thường đã chứa địa danh. */
  const addAllMatching = async () => {
    const kw = q.trim()
    if (kw.length < 2) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_customer_group_add_by_filter', {
      p_group_id: group.id, p_filter: { search: kw },
    })
    setBusy(false)
    if (error) { onAlert({ type: 'error', text: error.message }); return }
    if (data && data.ok === false) { onAlert({ type: 'error', text: data.loi }); return }
    onAlert({ type: 'success', text: `Đã thêm ${data?.da_them ?? 0} khách vào nhóm.` })
    loadMembers()
  }

  const nhanDuoc = members.filter(
    m => m.customers?.telegram_chat_id && m.customers?.telegram_enabled).length

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-0 w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h3 className="text-body-lg font-semibold text-gray-900">{group.name}</h3>
            <p className="text-tiny text-gray-400">
              {members.length} khách · {nhanDuoc} nhắn được qua Telegram
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5">
              <Search size={14} className="text-gray-400 shrink-0" />
              <input
                className="w-full text-body-md outline-none"
                placeholder="Tìm khách theo tên, mã hoặc số điện thoại…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>

            {found.length > 0 && (
              <>
                <div className="mt-1.5 flex items-center justify-between">
                  <p className="text-tiny text-gray-500">{found.length} kết quả</p>
                  <button onClick={addAllMatching} disabled={busy}
                    className="text-tiny text-blue-600 hover:underline disabled:opacity-50">
                    {busy ? 'Đang thêm…' : `Thêm tất cả khách khớp “${q.trim()}”`}
                  </button>
                </div>
                <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {found.map(c => {
                    const on = memberIds.has(c.id)
                    return (
                      <button key={c.id} type="button" disabled={on}
                        onClick={() => add(c.id)}
                        className={`w-full text-left px-2.5 py-1.5 text-body-md ${
                          on ? 'bg-gray-50 text-gray-400' : 'hover:bg-blue-50 text-gray-800'}`}>
                        {c.farm_name}
                        <span className="text-tiny text-gray-400 font-mono ml-1.5">{c.code}</span>
                        {c.telegram_chat_id && <span className="text-tiny text-emerald-600 ml-1.5">• có nhóm TG</span>}
                        {on && <span className="text-tiny ml-1.5">— đã trong nhóm</span>}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div>
            <p className="text-tiny text-gray-500 mb-1">Thành viên ({members.length})</p>
            {loading && <p className="text-body-md text-gray-500">Đang tải…</p>}
            {!loading && members.length === 0 && (
              <p className="text-body-md text-gray-400">
                Chưa có ai. Dùng ô tìm kiếm phía trên để thêm.
              </p>
            )}
            {members.length > 0 && (
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {members.map(m => (
                  <div key={m.customer_id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <p className="text-body-md text-gray-800 truncate">
                        {m.customers?.farm_name ?? '(khách đã xoá)'}
                      </p>
                      <p className="text-tiny text-gray-400 font-mono">
                        {m.customers?.code}
                        {m.customers?.telegram_chat_id && m.customers?.telegram_enabled
                          ? ' · nhắn được'
                          : ' · chưa nhắn được'}
                      </p>
                    </div>
                    <button onClick={() => remove(m.customer_id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-body-md bg-blue-500 text-gray-0 rounded-lg hover:bg-blue-600">
            Xong
          </button>
        </div>
      </div>
    </div>
  )
}
