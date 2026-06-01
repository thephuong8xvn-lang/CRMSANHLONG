import { useState } from 'react'
import { X, Plus, Pencil, Trash2, Check, ToggleLeft, ToggleRight, Bird, FileText, MapPin } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logger } from '../../lib/logger'
import { qk } from '../../lib/queryClient'
import { useSpeciesList, useHerdRegions, useHerdProjectTypes } from '../../hooks/queries/useHerdProjects'

type CatTab = 'species' | 'types' | 'regions'

interface Props { onClose: () => void }

export default function ManageHerdCatalogModal({ onClose }: Props) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<CatTab>('species')

  // Load all (kể cả ngừng) để quản lý
  const speciesQuery = useSpeciesList(false)
  const typesQuery = useHerdProjectTypes()
  const regionsQuery = useHerdRegions(false)
  const speciesActive = (speciesQuery.data ?? []) as any[]

  const [newName, setNewName] = useState('')
  const [newExtra, setNewExtra] = useState('') // category (species) hoặc species_id (types)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['herd-projects', 'species'] })
    queryClient.invalidateQueries({ queryKey: ['herd-projects', 'types'] })
    queryClient.invalidateQueries({ queryKey: ['herd-projects', 'regions'] })
    queryClient.invalidateQueries({ queryKey: qk.herdProjects.all })
  }

  const table = tab === 'species' ? 'species' : tab === 'types' ? 'herd_project_types' : 'herd_regions'

  const add = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      const payload: any = { name: newName.trim(), is_active: true }
      if (tab === 'species') payload.category = newExtra.trim() || 'livestock'
      if (tab === 'types') { payload.species_id = newExtra || null; payload.code = newName.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 20) }
      const { error } = await supabase.from(table).insert(payload)
      if (error) throw error
      setNewName(''); setNewExtra(''); invalidate()
    } catch (e: any) { logger.error('[Catalog add]', e?.message); alert('Không thể thêm (kiểm tra quyền).') }
    finally { setBusy(false) }
  }

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return
    const { error } = await supabase.from(table).update({ name: editName.trim() }).eq('id', id)
    if (error) { logger.error('[Catalog edit]', error.message); return }
    setEditId(null); invalidate()
  }

  const toggle = async (id: string, cur: boolean) => {
    const { error } = await supabase.from(table).update({ is_active: !cur }).eq('id', id)
    if (error) { logger.error('[Catalog toggle]', error.message); return }
    invalidate()
  }

  const remove = async (id: string) => {
    if (!confirm('Xóa mục này? (Nếu đang được dùng có thể không xóa được — hãy chuyển trạng thái Ngừng)')) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { alert('Không xóa được (có thể đang được sử dụng). Hãy đặt Ngừng hoạt động.'); return }
    invalidate()
  }

  const rows: any[] =
    tab === 'species' ? speciesActive :
    tab === 'types' ? (typesQuery.data ?? []) as any[] :
    (regionsQuery.data ?? []) as any[]

  const TabBtn = ({ id, icon, label }: { id: CatTab; icon: any; label: string }) => {
    const Icon = icon
    return (
      <button onClick={() => { setTab(id); setEditId(null); setNewName(''); setNewExtra('') }}
        className={`flex-1 py-2.5 text-tiny font-bold border-b-2 flex items-center justify-center gap-1.5 transition-all ${tab === id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
        <Icon size={14} />{label}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-body-lg text-gray-800">Quản lý danh mục chăn nuôi</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full"><X size={20} /></button>
        </div>

        <div className="flex border-b border-gray-100">
          <TabBtn id="species" icon={Bird} label="Vật nuôi" />
          <TabBtn id="types" icon={FileText} label="Loại kế hoạch" />
          <TabBtn id="regions" icon={MapPin} label="Khu vực" />
        </div>

        {/* Add row */}
        <div className="p-4 border-b border-gray-100 bg-gray-25 flex flex-col sm:flex-row gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={tab === 'regions' ? 'Tên khu vực mới' : tab === 'species' ? 'Tên vật nuôi mới' : 'Tên loại kế hoạch mới'}
            className="flex-1 h-9 px-3 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
          {tab === 'species' && (
            <input value={newExtra} onChange={e => setNewExtra(e.target.value)} placeholder="Nhóm (gia cầm/gia súc...)"
              className="sm:w-40 h-9 px-3 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
          )}
          {tab === 'types' && (
            <select value={newExtra} onChange={e => setNewExtra(e.target.value)}
              className="sm:w-40 h-9 px-2 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none">
              <option value="">-- Loài (tùy chọn) --</option>
              {speciesActive.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button onClick={add} disabled={!newName.trim() || busy}
            className="h-9 px-4 bg-blue-500 text-white rounded-lg text-tiny font-bold hover:bg-blue-600 disabled:opacity-40 flex items-center gap-1.5">
            <Plus size={14} /> Thêm
          </button>
        </div>

        {/* List */}
        <div className="p-3 overflow-y-auto flex-1 divide-y divide-gray-50">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-tiny text-gray-400">Chưa có mục nào.</p>
          ) : rows.map(r => (
            <div key={r.id} className={`flex items-center gap-2 py-2 px-1 ${!r.is_active ? 'opacity-50' : ''}`}>
              {editId === r.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                    className="flex-1 h-8 px-2 border border-blue-300 rounded-lg text-tiny focus:outline-none" />
                  <button onClick={() => saveEdit(r.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Check size={16} /></button>
                  <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-gray-700 text-body-md">{r.name}</span>
                    {tab === 'species' && r.category && <span className="ml-2 text-[11px] text-gray-400">({r.category})</span>}
                    {tab === 'types' && r.species_id && <span className="ml-2 text-[11px] text-blue-500">· {speciesActive.find(s => s.id === r.species_id)?.name || 'Vật nuôi'}</span>}
                    {!r.is_active && <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Ngừng</span>}
                  </div>
                  <button onClick={() => toggle(r.id, r.is_active)} title={r.is_active ? 'Đang dùng' : 'Đang ngừng'}
                    className="p-1 text-gray-400 hover:text-blue-600">
                    {r.is_active ? <ToggleRight size={20} className="text-blue-600" /> : <ToggleLeft size={20} />}
                  </button>
                  <button onClick={() => { setEditId(r.id); setEditName(r.name) }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={14} /></button>
                  <button onClick={() => remove(r.id)} className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="h-9 px-5 bg-gray-100 text-gray-600 rounded-lg text-tiny font-bold hover:bg-gray-200">Đóng</button>
        </div>
      </div>
    </div>
  )
}
