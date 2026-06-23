import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, Search, Pencil, Trash2, ToggleLeft, ToggleRight, X, Bird } from 'lucide-react'
import Layout from '../../components/Layout'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { logger } from '../../lib/logger'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { removeVietnameseTones } from '../../components/SmartSearchSelect'

interface HerdRow {
  id: string; name: string; breed: string | null; breed_price: number | null
  current_quantity: number; entry_date: string | null; expected_exit_date: string | null
  is_active: boolean; farm_id: string; species_id: string | null
  species?: { name: string } | null
  farm?: { name: string; customer?: { farm_name: string } | null } | null
}

const emptyForm = { id: '', name: '', species_id: '', breed: '', breed_price: '', current_quantity: 0, entry_date: '', expected_exit_date: '', farm_id: '', customer_id: '' }

export default function HerdsManagePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { formatCurrency } = useDisplaySettings()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<typeof emptyForm>(emptyForm)
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [creatingFarm, setCreatingFarm] = useState(false)
  const [newFarmName, setNewFarmName] = useState('')
  const isEdit = !!form.id

  const herdsQuery = useQuery({
    queryKey: ['herd-projects', 'herds', 'manage'],
    queryFn: async (): Promise<HerdRow[]> => {
      const { data, error } = await supabase
        .from('herds')
        .select('id, name, breed, breed_price, current_quantity, entry_date, expected_exit_date, is_active, farm_id, species_id, species:species(name), farm:farms(name, customer:customers(farm_name))')
        .order('created_at', { ascending: false })
      if (error) { logger.error('[HerdsManage]', error.message); throw error }
      return (data ?? []) as unknown as HerdRow[]
    },
  })

  const speciesQuery = useQuery({
    queryKey: ['herd-projects', 'species', true],
    queryFn: async () => {
      const { data } = await supabase.from('species').select('id, name').eq('is_active', true).order('name')
      return data ?? []
    }, staleTime: 10 * 60_000,
  })
  const customersQuery = useQuery({
    queryKey: ['customers', 'all-for-herds'],
    queryFn: async () => {
      // Nạp ĐỦ khách hàng (tránh cap 1000 → KH 1001+ không tìm thấy)
      return await fetchAllRows<{ id: string; farm_name: string; code: string }>((from, to) =>
        supabase.from('customers').select('id, farm_name, code').eq('is_active', true)
          .order('farm_name', { ascending: true }).order('id').range(from, to)
      )
    }, staleTime: 10 * 60_000,
  })

  // Load farms when customer selected in modal
  useEffect(() => {
    if (!form.customer_id) { setFarms([]); return }
    supabase.from('farms').select('id, name').eq('customer_id', form.customer_id).then(({ data }: { data: { id: string; name: string }[] | null }) => setFarms(data ?? []))
  }, [form.customer_id])

  const rows = useMemo(() => {
    const all = herdsQuery.data ?? []
    const q = removeVietnameseTones(debounced.trim().toLowerCase())
    if (!q) return all
    return all.filter(h => {
      const hay = removeVietnameseTones(`${h.name} ${h.breed || ''} ${h.farm?.customer?.farm_name || ''} ${h.species?.name || ''}`.toLowerCase())
      return hay.includes(q)
    })
  }, [herdsQuery.data, debounced])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['herd-projects', 'herds', 'manage'] })

  const openCreate = () => { setForm(emptyForm); setCreatingFarm(false); setNewFarmName(''); setModalOpen(true) }

  // Mở sẵn modal tạo đàn khi điều hướng kèm ?new=1 (từ nút "Tạo đàn" ngoài trang danh sách dự án)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openCreate()
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const openEdit = (h: HerdRow) => {
    setCreatingFarm(false); setNewFarmName('')
    setForm({ id: h.id, name: h.name, species_id: h.species_id || '', breed: h.breed || '', breed_price: h.breed_price ? String(h.breed_price) : '',
      current_quantity: h.current_quantity, entry_date: h.entry_date || '', expected_exit_date: h.expected_exit_date || '', farm_id: h.farm_id, customer_id: '' })
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.species_id) { alert('Cần tên đàn và loài.'); return }
    if (!isEdit) {
      if (!form.customer_id) { alert('Cần chọn khách hàng cho đàn mới.'); return }
      if (creatingFarm ? !newFarmName.trim() : !form.farm_id) { alert('Cần chọn hoặc tạo cơ sở/trại cho đàn mới.'); return }
    }
    setBusy(true)
    try {
      const payload: any = {
        name: form.name.trim(), species_id: form.species_id, breed: form.breed.trim() || null,
        breed_price: form.breed_price ? Number(form.breed_price) : null,
        current_quantity: form.current_quantity || 0,
        entry_date: form.entry_date || null, expected_exit_date: form.expected_exit_date || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('herds').update(payload).eq('id', form.id)
        if (error) throw error
      } else {
        // Tạo cơ sở/trại inline nếu chọn
        let farmId = form.farm_id
        if (creatingFarm && newFarmName.trim()) {
          const { data: nf, error: fErr } = await supabase
            .from('farms')
            .insert({ customer_id: form.customer_id, name: newFarmName.trim() })
            .select('id').single()
          if (fErr) throw fErr
          farmId = nf.id
        }
        const { error } = await supabase.from('herds').insert({ ...payload, farm_id: farmId, is_active: true })
        if (error) throw error
        queryClient.invalidateQueries({ queryKey: ['herd-projects', 'farms'] })
      }
      setModalOpen(false); invalidate()
    } catch (e: any) { logger.error('[HerdsManage save]', e?.message); alert('Lưu thất bại (kiểm tra quyền với khách hàng/trại này).') }
    finally { setBusy(false) }
  }

  const toggle = async (h: HerdRow) => {
    const { error } = await supabase.from('herds').update({ is_active: !h.is_active }).eq('id', h.id)
    if (error) { alert('Không đổi được trạng thái (thiếu quyền).'); return }
    invalidate()
  }
  const remove = async (h: HerdRow) => {
    if (!confirm('Xóa đàn này?')) return
    const { error } = await supabase.from('herds').delete().eq('id', h.id)
    if (error) { alert('Không xóa được (đàn đang được dùng trong dự án). Hãy đặt Ngừng.'); return }
    invalidate()
  }

  const fmtDate = (s: string | null) => s ? s.split('-').reverse().join('/') : '—'

  // Cột đàn — kế thừa DataTable (desktop bảng + mobile card tự sinh)
  const columns: DataTableColumn<HerdRow>[] = [
    { key: 'name', header: 'Tên đàn', flex: true, minWidth: 160, noTruncate: true, render: (h) => <span className={`font-bold text-gray-700 ${!h.is_active ? 'opacity-50' : ''}`}>{h.name}</span> },
    { key: 'species', header: 'Loài', width: 110, render: (h) => <span className="text-gray-600">{h.species?.name || '—'}</span> },
    { key: 'breed', header: 'Con giống', width: 120, render: (h) => <span className="text-gray-600">{h.breed || '—'}</span> },
    { key: 'price', header: 'Giá giống', width: 110, align: 'right', render: (h) => <span className="tabular-nums text-gray-600">{h.breed_price ? formatCurrency(h.breed_price) : '—'}</span> },
    { key: 'qty', header: 'SL', width: 80, align: 'right', render: (h) => <span className="tabular-nums font-semibold text-gray-700">{h.current_quantity.toLocaleString('vi-VN')}</span> },
    { key: 'dates', header: 'Vào / Dự kiến xuất', width: 150, render: (h) => <span className="text-tiny text-gray-500">{fmtDate(h.entry_date)} → {fmtDate(h.expected_exit_date)}</span> },
    { key: 'farm', header: 'Khách / Trại', width: 160, render: (h) => <span className="text-tiny text-gray-600">{h.farm?.customer?.farm_name || '—'}{h.farm?.name ? ` · ${h.farm.name}` : ''}</span> },
    {
      key: 'status', header: 'Trạng thái', width: 90, align: 'center', noTruncate: true, mobileHeaderRight: true,
      render: (h) => (
        <button onClick={(e) => { e.stopPropagation(); toggle(h) }} title={h.is_active ? 'Đang nuôi' : 'Ngừng'}>
          {h.is_active ? <ToggleRight size={20} className="text-blue-600" /> : <ToggleLeft size={20} className="text-gray-400" />}
        </button>
      ),
    },
    {
      key: 'actions', header: 'Thao tác', width: 80, align: 'right', noTruncate: true,
      render: (h) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => openEdit(h)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={14} /></button>
          <button onClick={() => remove(h)} className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={14} /></button>
        </div>
      ),
    },
  ]

  return (
    <Layout activeMenu="Chăn nuôi">
      <div className="p-4 md:p-8 max-w-[1400px] w-full mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <button onClick={() => navigate('/herd-projects')} className="flex items-center gap-1.5 text-tiny text-gray-400 hover:text-blue-500 font-semibold mb-1">
              <ChevronLeft size={15} /> Quay lại dự án
            </button>
            <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2"><Bird size={22} className="text-blue-500" /> Quản lý đàn vật nuôi</h1>
          </div>
          <button onClick={openCreate} className="bg-blue-500 hover:bg-blue-600 text-white px-5 h-11 rounded-lg font-semibold text-body-md shadow-sm flex items-center gap-2">
            <Plus size={18} /> Tạo đàn mới
          </button>
        </div>

        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm đàn, con giống, khách hàng..."
                className="w-full h-9 pl-9 pr-3 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(h) => h.id}
            loading={herdsQuery.isLoading}
            pageSize={0}
            card={false}
            emptyText="Chưa có đàn nào."
            resetSignal={debounced}
          />
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-body-lg text-gray-800">{isEdit ? 'Sửa đàn' : 'Tạo đàn mới'}</h3>
              <button onClick={() => setModalOpen(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              {!isEdit && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-400 uppercase">Khách hàng <span className="text-rose-500">*</span></label>
                    <SmartSearchSelect options={(customersQuery.data ?? []).map((c: any) => ({ value: c.id, label: c.farm_name, desc: c.code }))}
                      value={form.customer_id} onChange={v => { setForm({ ...form, customer_id: v, farm_id: '' }); setCreatingFarm(false); setNewFarmName('') }} placeholder="-- Chọn khách --" searchPlaceholder="Tìm khách..." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-400 uppercase flex items-center justify-between gap-1">
                      <span>Cơ sở/Trại <span className="text-rose-500">*</span></span>
                      {form.customer_id && (
                        <button type="button" onClick={() => { setCreatingFarm(v => !v); setForm({ ...form, farm_id: '' }); setNewFarmName('') }}
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5 normal-case">
                          {creatingFarm ? <><X size={10} />Chọn có sẵn</> : <><Plus size={10} />Tạo trại mới</>}
                        </button>
                      )}
                    </label>
                    {creatingFarm ? (
                      <input value={newFarmName} onChange={e => setNewFarmName(e.target.value)} placeholder="Tên cơ sở/trại mới"
                        className="w-full h-10 px-2.5 bg-white border border-blue-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
                    ) : (
                      <select value={form.farm_id} onChange={e => setForm({ ...form, farm_id: e.target.value })} disabled={!form.customer_id}
                        className="w-full h-10 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none disabled:opacity-50">
                        <option value="">-- Chọn trại --</option>
                        {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-400 uppercase">Tên đàn <span className="text-rose-500">*</span></label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full h-10 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-400 uppercase">Loài <span className="text-rose-500">*</span></label>
                  <select value={form.species_id} onChange={e => setForm({ ...form, species_id: e.target.value })} className="w-full h-10 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none">
                    <option value="">-- Loài --</option>
                    {(speciesQuery.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-400 uppercase">Con giống</label>
                  <input value={form.breed} onChange={e => setForm({ ...form, breed: e.target.value })} className="w-full h-10 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-400 uppercase">Giá giống (₫/con)</label>
                  <input type="number" min={0} value={form.breed_price} onChange={e => setForm({ ...form, breed_price: e.target.value })} className="w-full h-10 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-400 uppercase">Số lượng</label>
                  <input type="number" min={0} value={form.current_quantity || ''} onChange={e => setForm({ ...form, current_quantity: Number(e.target.value) })} className="w-full h-10 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-400 uppercase">Ngày vào giống</label>
                  <input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} className="w-full h-10 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-400 uppercase">Dự kiến xuất</label>
                  <input type="date" value={form.expected_exit_date} onChange={e => setForm({ ...form, expected_exit_date: e.target.value })} className="w-full h-10 px-2.5 bg-gray-25 border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="h-10 px-4 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={save} disabled={busy} className="h-10 px-5 bg-blue-500 text-white rounded-lg text-tiny font-bold hover:bg-blue-600 disabled:opacity-50">{busy ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
