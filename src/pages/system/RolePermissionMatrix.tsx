import { useState, useEffect, useCallback, useMemo } from 'react'
import { Shield, X, Loader2, CheckCircle2, AlertTriangle, Lock, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAuth } from '../../contexts/AuthContext'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import {
  PERMISSION_CATALOG,
  ENFORCED_CODES,
  ALL_PERMISSION_CODES,
} from '../../lib/permissionCatalog'

interface Role {
  id: string
  code: string
  name: string
  is_system: boolean
}

interface RoleRow extends Role {
  permCount: number
}

const SUPER_ROLES = ['admin', 'ceo']

// Gom catalog theo nhóm để render ma trận có tiêu đề nhóm.
const GROUPED = (() => {
  const map = new Map<string, typeof PERMISSION_CATALOG>()
  for (const m of PERMISSION_CATALOG) {
    const arr = map.get(m.group) ?? []
    arr.push(m)
    map.set(m.group, arr)
  }
  return Array.from(map.entries())
})()

export default function RolePermissionMatrix() {
  const { hasPermission } = useAuth()
  const isAdmin = hasPermission('roles.manage') // admin/ceo bypass → true

  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)

  // Editor state
  const [editRole, setEditRole] = useState<Role | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Quyền role đang có nhưng catalog chưa mô tả — hiện để admin biết, không sửa được từ đây
  const [outOfScope, setOutOfScope] = useState<string[]>([])
  const [editorLoading, setEditorLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const loadRoles = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      // fetchAllRows: role_permissions đã >200 dòng, select thường bị cap 1000
      // → "Số quyền" đếm thiếu mà không báo gì.
      const [{ data: rolesData, error: rolesErr }, rpData] = await Promise.all([
        supabase.from('roles').select('id, code, name, is_system').order('name'),
        fetchAllRows<{ role_id: string }>((from, to) =>
          supabase.from('role_permissions').select('role_id').order('role_id').range(from, to)),
      ])
      // Nuốt lỗi ở đây = danh sách rỗng, mở editor ra trống, bấm Lưu là mất quyền.
      if (rolesErr) throw rolesErr

      const counts = new Map<string, number>()
      ;(rpData ?? []).forEach(rp => counts.set(rp.role_id, (counts.get(rp.role_id) ?? 0) + 1))
      setRoles((rolesData ?? []).map((r: any) => ({ ...r, permCount: counts.get(r.id) ?? 0 })))
    } catch (e: any) {
      setErr('Không tải được danh sách vai trò: ' + (e.message || 'lỗi không xác định'))
      setRoles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRoles() }, [loadRoles])

  const openEditor = async (role: Role) => {
    setEditRole(role); setMsg(''); setErr(''); setEditorLoading(true)
    setSelected(new Set())
    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permission:permissions(code)')
        .eq('role_id', role.id)
      // Trước đây lỗi bị nuốt → editor mở ra KHÔNG tick gì, bấm Lưu là thu hồi sạch.
      if (error) throw error

      const all = (data ?? []).map((rp: any) => rp.permission?.code).filter(Boolean)
      const known = all.filter((c: string) => ALL_PERMISSION_CODES.includes(c))
      // Quyền DB có mà catalog không biết: KHÔNG tick (không hiển thị được),
      // nhưng cũng KHÔNG bị xoá — vì scope gửi lên server chỉ gồm mã catalog.
      setOutOfScope(all.filter((c: string) => !ALL_PERMISSION_CODES.includes(c)))
      setSelected(new Set(known))
    } catch (e: any) {
      setErr('Không đọc được quyền hiện tại: ' + (e.message || 'lỗi không xác định'))
      setEditRole(null)
    } finally {
      setEditorLoading(false)
    }
  }

  const toggle = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const toggleModule = (codes: string[], on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      codes.forEach(c => on ? next.add(c) : next.delete(c))
      return next
    })
  }

  const handleSave = async () => {
    if (!editRole) return
    setSaving(true); setErr(''); setMsg('')
    try {
      // p_scope = toàn bộ mã catalog biết. Server CHỈ được thu hồi trong phạm vi
      // này → quyền DB có mà catalog chưa liệt kê không bao giờ bị xoá nhầm.
      const { error } = await supabase.rpc('fn_set_role_permissions', {
        p_role_id: editRole.id,
        p_codes: Array.from(selected),
        p_scope: ALL_PERMISSION_CODES,
      })
      if (error) throw error
      setMsg(`Đã lưu phân quyền cho "${editRole.name}".`)
      await loadRoles()
      setEditRole(null)
    } catch (e: any) {
      setErr('Lưu thất bại: ' + (e.message || 'Lỗi không xác định.'))
    } finally {
      setSaving(false)
    }
  }

  const columns: DataTableColumn<RoleRow>[] = useMemo(() => [
    {
      key: 'name', header: 'Vai trò', flex: true, minWidth: 220,
      render: r => (
        <div className="flex items-center gap-2 min-w-0">
          <Shield size={15} className="text-blue-500 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold text-gray-800 truncate">{r.name}</p>
            <p className="text-[11px] text-gray-400 font-mono">{r.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'perms', header: 'Số quyền', width: 120, align: 'center',
      render: r => SUPER_ROLES.includes(r.code)
        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">Toàn quyền</span>
        : <span className="font-bold tabular-nums text-gray-700">{r.permCount}</span>,
    },
    {
      key: 'action', header: '', width: 110, align: 'center',
      render: r => SUPER_ROLES.includes(r.code)
        ? <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><Lock size={12} /> Khóa</span>
        : (
          <button
            onClick={(e) => { e.stopPropagation(); openEditor(r) }}
            disabled={!isAdmin}
            className="h-8 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-blue-600 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Pencil size={13} /> Sửa quyền
          </button>
        ),
    },
  ], [isAdmin])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-body-lg font-bold text-gray-800 flex items-center gap-2"><Shield size={18} className="text-blue-500" /> Vai trò & Phân quyền</h3>
          <p className="text-tiny text-gray-500 mt-0.5">Gán quyền chi tiết theo Module × Chức năng (Xem / Thêm / Sửa / Xóa…). Gán vai trò cho nhân viên ở tab "Quản lý Nhân viên".</p>
        </div>
        {!isAdmin && (
          <span className="text-tiny text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Cần quyền quản trị để chỉnh sửa.
          </span>
        )}
      </div>

      {msg && (
        <div className="flex items-start gap-2 text-tiny text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> <span>{msg}</span>
        </div>
      )}

      <DataTable
        rows={roles}
        columns={columns}
        getRowKey={r => r.id}
        loading={loading}
        onRowClick={r => !SUPER_ROLES.includes(r.code) && isAdmin && openEditor(r)}
        pageSize={20}
        itemLabel="vai trò"
        card={false}
      />

      {/* Editor modal: ma trận module × action */}
      {editRole && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Shield size={18} /></div>
                <div className="min-w-0">
                  <h3 className="text-body-lg font-bold text-gray-700 leading-tight truncate">Phân quyền: {editRole.name}</h3>
                  <p className="text-tiny text-gray-400 font-mono">{editRole.code}</p>
                </div>
              </div>
              <button onClick={() => setEditRole(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-5">
              {editorLoading ? (
                <div className="py-12 flex justify-center"><Loader2 size={26} className="animate-spin text-blue-500" /></div>
              ) : (
                <>
                {outOfScope.length > 0 && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-[12px] text-amber-800">
                    <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                    <span>
                      Vai trò này còn <strong>{outOfScope.length} quyền</strong> chưa được mô tả trong
                      danh mục nên không hiện ở đây: <span className="font-mono">{outOfScope.join(', ')}</span>.
                      Lưu thay đổi sẽ <strong>không đụng tới</strong> chúng.
                    </span>
                  </div>
                )}
                {GROUPED.map(([group, modules]) => (
                  <div key={group} className="space-y-2">
                    <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">{group}</p>
                    <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 overflow-hidden">
                      {modules.map(m => {
                        const codes = m.actions.map(a => a.code)
                        const allOn = codes.every(c => selected.has(c))
                        return (
                          <div key={m.key} className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold text-gray-700 text-body-md">{m.label}</span>
                              <button
                                onClick={() => toggleModule(codes, !allOn)}
                                className="text-[11px] font-semibold text-blue-600 hover:underline"
                              >
                                {allOn ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {m.actions.map(a => {
                                const on = selected.has(a.code)
                                const enforced = ENFORCED_CODES.has(a.code)
                                return (
                                  <button
                                    key={a.code}
                                    onClick={() => toggle(a.code)}
                                    title={enforced ? 'Đã hiệu lực ở server (enforce)' : 'Hiệu lực giao diện — RLS chuyển ở phase sau'}
                                    className={`px-2.5 h-8 rounded-lg border text-tiny font-semibold transition-all flex items-center gap-1.5 ${
                                      on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-25'
                                    }`}
                                  >
                                    {on && <CheckCircle2 size={13} />}
                                    {a.label}
                                    {enforced && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Enforce" />}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
                </>
              )}
              <p className="flex items-center gap-1.5 text-[10px] text-gray-400 italic">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Chấm xanh = quyền đã được server kiểm tra thật (enforce). Còn lại đang chuyển dần — admin/ceo luôn toàn quyền.
              </p>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between gap-3">
              {err
                ? <span className="text-tiny text-red-600 flex items-center gap-1.5"><AlertTriangle size={13} /> {err}</span>
                : <span className="text-tiny text-gray-400">{selected.size} quyền được chọn</span>}
              <div className="flex gap-3">
                <button onClick={() => setEditRole(null)} disabled={saving}
                  className="h-10 px-4 border border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-25 disabled:opacity-60">Hủy</button>
                <button onClick={handleSave} disabled={saving || !isAdmin}
                  className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm flex items-center gap-2 disabled:opacity-60">
                  {saving ? <><Loader2 size={16} className="animate-spin" /> Đang lưu…</> : 'Lưu phân quyền'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
