import { useState } from 'react'
import { UserPlus, Plus, Trash2, Shield, Eye, Users as UsersIcon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logger } from '../../lib/logger'
import { qk } from '../../lib/queryClient'
import { useHerdProjectMembers } from '../../hooks/queries/useHerdProjects'
import { useSalesReps } from '../../hooks/queries/useCustomers'

interface Props {
  projectId: string
  ownerName?: string | null
  canManage: boolean
}

type Role = 'viewer' | 'collaborator' | 'manager'

const ROLE_META: Record<Role, { label: string; cls: string; icon: any }> = {
  manager:      { label: 'Quản lý',  cls: 'bg-blue-50 text-blue-700 border-blue-100', icon: Shield },
  collaborator: { label: 'Cộng tác', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: UserPlus },
  viewer:       { label: 'Chỉ xem',  cls: 'bg-gray-50 text-gray-600 border-gray-200', icon: Eye },
}

export default function HerdMembersSection({ projectId, ownerName, canManage }: Props) {
  const queryClient = useQueryClient()
  const membersQuery = useHerdProjectMembers(projectId)
  const repsQuery = useSalesReps()
  const [pick, setPick] = useState('')
  const [role, setRole] = useState<Role>('collaborator')
  const [busy, setBusy] = useState(false)

  const members = membersQuery.data ?? []
  const reps = (repsQuery.data ?? []) as { id: string; full_name: string }[]
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.herdProjects.members(projectId) })

  const addMember = async () => {
    if (!pick) return
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('herd_project_members')
        .insert({ project_id: projectId, user_id: pick, role, added_by: user?.id ?? null })
      if (error) throw error
      setPick('')
      invalidate()
    } catch (err: any) {
      logger.error('[HerdMembers] add error:', err?.message ?? err)
      alert('Không thể thêm thành viên (có thể đã tồn tại hoặc thiếu quyền).')
    } finally { setBusy(false) }
  }

  const changeRole = async (id: string, newRole: Role) => {
    const { error } = await supabase.from('herd_project_members').update({ role: newRole }).eq('id', id)
    if (error) { logger.error('[HerdMembers] role error:', error.message); return }
    invalidate()
  }

  const removeMember = async (id: string) => {
    if (!confirm('Gỡ thành viên này khỏi dự án?')) return
    const { error } = await supabase.from('herd_project_members').delete().eq('id', id)
    if (error) { logger.error('[HerdMembers] remove error:', error.message); return }
    invalidate()
  }

  const available = reps.filter(r => !members.some(m => m.user_id === r.id))

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <UsersIcon size={18} className="text-blue-500" />
        <h4 className="font-bold text-body-lg text-gray-700">Người theo dõi dự án</h4>
        <span className="text-tiny text-gray-400">({members.length} thành viên)</span>
      </div>
      <p className="text-tiny text-gray-400 -mt-2">Thành viên được thêm sẽ xem & thao tác dự án theo vai trò, kể cả khác chi nhánh.</p>

      {/* Owner */}
      <div className="flex items-center justify-between p-3 bg-blue-50/40 border border-blue-100 rounded-lg">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-tiny font-bold">{(ownerName || 'C')[0]}</div>
          <div>
            <p className="font-semibold text-gray-700 text-body-md">{ownerName || 'Chủ dự án'}</p>
            <p className="text-[11px] text-gray-400">Chủ dự án (toàn quyền)</p>
          </div>
        </div>
        <span className="px-2.5 py-0.5 rounded-full border text-[11px] font-bold bg-blue-100 text-blue-700 border-blue-200">Chủ dự án</span>
      </div>

      {/* Member list */}
      {membersQuery.isLoading ? (
        <div className="py-6 text-center text-gray-400 text-tiny">Đang tải...</div>
      ) : members.length === 0 ? (
        <div className="py-6 text-center text-gray-400 text-tiny border border-dashed border-gray-200 rounded-lg">Chưa có người theo dõi nào.</div>
      ) : (
        <div className="space-y-2">
          {members.map(m => {
            const meta = ROLE_META[m.role]
            const Icon = meta.icon
            return (
              <div key={m.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-tiny font-bold shrink-0">
                    {(m.profile?.full_name || '?')[0]}
                  </div>
                  <span className="font-semibold text-gray-700 text-body-md truncate">{m.profile?.full_name || 'Người dùng'}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManage ? (
                    <select value={m.role} onChange={e => changeRole(m.id, e.target.value as Role)}
                      className="h-8 px-2 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none">
                      <option value="viewer">Chỉ xem</option>
                      <option value="collaborator">Cộng tác</option>
                      <option value="manager">Quản lý</option>
                    </select>
                  ) : (
                    <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold flex items-center gap-1 ${meta.cls}`}>
                      <Icon size={11} />{meta.label}
                    </span>
                  )}
                  {canManage && (
                    <button onClick={() => removeMember(m.id)} className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add */}
      {canManage && (
        <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-gray-100">
          <select value={pick} onChange={e => setPick(e.target.value)}
            className="flex-1 h-9 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none">
            <option value="">-- Chọn nhân sự (mọi chi nhánh) --</option>
            {available.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
          </select>
          <select value={role} onChange={e => setRole(e.target.value as Role)}
            className="h-9 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none sm:w-36">
            <option value="viewer">Chỉ xem</option>
            <option value="collaborator">Cộng tác</option>
            <option value="manager">Quản lý</option>
          </select>
          <button onClick={addMember} disabled={!pick || busy}
            className="h-9 px-4 bg-blue-500 text-white rounded-lg text-tiny font-bold hover:bg-blue-600 disabled:opacity-40 flex items-center gap-1.5">
            <Plus size={14} /> Thêm
          </button>
        </div>
      )}
    </div>
  )
}
