import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  Save,
  Layers,
  Users,
  Home,
  User,
  Calendar,
  FileText,
  CheckSquare,
  Plus,
  X,
  UserPlus,
  Bird,
} from 'lucide-react'
import Layout from '../../components/Layout'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { logger } from '../../lib/logger'

interface Customer {
  id: string
  farm_name: string
  code: string
}

interface Farm {
  id: string
  name: string
}

interface Herd {
  id: string
  name: string
  current_quantity: number
  breed_price: number | null
}

interface ProjectType {
  id: string
  name: string
  code: string
}

interface DefaultStep {
  id: string
  step_name: string
  sort_order: number
  days_offset: number
  description: string | null
}

interface Profile {
  id: string
  full_name: string
}

export default function HerdProjectFormPage() {
  const navigate = useNavigate()

  // Data lists
  const [customers, setCustomers] = useState<Customer[]>([])
  const [farms, setFarms] = useState<Farm[]>([])
  const [herds, setHerds] = useState<Herd[]>([])
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([])
  const [defaultSteps, setDefaultSteps] = useState<DefaultStep[]>([])
  const [vets, setVets] = useState<Profile[]>([])

  // Form states
  const [name, setName] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [selectedFarmId, setSelectedFarmId] = useState('')
  const [selectedHerdId, setSelectedHerdId] = useState('')
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [selectedVetId, setSelectedVetId] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState('')
  const [headCount, setHeadCount] = useState<number>(0)
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'draft' | 'active'>('draft')

  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  // Tạo cơ sở / đàn inline (standalone — không cần sang module khách hàng)
  const today = new Date().toISOString().split('T')[0]
  const [speciesList, setSpeciesList] = useState<{ id: string; name: string }[]>([])
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([])
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [creatingFarm, setCreatingFarm] = useState(false)
  const [newFarmName, setNewFarmName] = useState('')
  const [creatingHerd, setCreatingHerd] = useState(false)
  const [newHerd, setNewHerd] = useState({
    name: '', species_id: '', breed: '', breed_price: '', entry_date: today, expected_exit_date: '', current_quantity: 0,
  })

  // Thành viên theo dõi dự án (đa người, đa chi nhánh)
  const [members, setMembers] = useState<{ user_id: string; role: 'viewer' | 'collaborator' | 'manager' }[]>([])
  const [memberPick, setMemberPick] = useState('')
  const [memberRole, setMemberRole] = useState<'viewer' | 'collaborator' | 'manager'>('collaborator')

  const addMember = () => {
    if (!memberPick || members.some(m => m.user_id === memberPick) || memberPick === selectedVetId) return
    setMembers(prev => [...prev, { user_id: memberPick, role: memberRole }])
    setMemberPick('')
  }
  const removeMember = (uid: string) => setMembers(prev => prev.filter(m => m.user_id !== uid))
  const roleLabel = (r: string) => r === 'manager' ? 'Quản lý' : r === 'collaborator' ? 'Cộng tác' : 'Chỉ xem'

  // Load Initial Lookups
  useEffect(() => {
    const loadInitialLookups = async () => {
      try {
        // Fetch active customers — nạp ĐỦ (tránh cap 1000 → KH 1001+ không tìm thấy)
        const custs = await fetchAllRows<{ id: string; farm_name: string; code: string }>((from, to) =>
          supabase
            .from('customers')
            .select('id, farm_name, code')
            .eq('is_active', true)
            .order('farm_name', { ascending: true }).order('id')
            .range(from, to)
        )
        setCustomers(custs)

        // Fetch active project types
        const { data: types } = await supabase
          .from('herd_project_types')
          .select('id, name, code')
          .eq('is_active', true)
        if (types) setProjectTypes(types)

        const { data: sp } = await supabase.from('species').select('id, name').eq('is_active', true).order('name')
        if (sp) setSpeciesList(sp)

        const { data: rg } = await supabase.from('herd_regions').select('id, name').eq('is_active', true).order('name')
        if (rg) setRegions(rg)

        // Fetch vets/profiles — nạp ĐỦ (tránh cap 1000)
        const profiles = await fetchAllRows<{ id: string; full_name: string }>((from, to) =>
          supabase.from('profiles').select('id, full_name').eq('is_active', true)
            .order('full_name', { ascending: true }).order('id').range(from, to)
        )
        if (profiles) {
          setVets(profiles)
          // Set default vet as current user if possible
          const { data: { user } } = await supabase.auth.getUser()
          if (user && (profiles as Profile[]).some((p: Profile) => p.id === user.id)) {
            setSelectedVetId(user.id)
          } else if (profiles.length > 0) {
            setSelectedVetId(profiles[0].id)
          }
        }
      } catch (err) {
        console.error('Error preloading lookups:', err)
      } finally {
        setInitialLoading(false)
      }
    }
    loadInitialLookups()
  }, [])

  // Load Farms when Customer changes
  useEffect(() => {
    const loadFarms = async () => {
      if (!selectedCustomerId) {
        setFarms([])
        setSelectedFarmId('')
        return
      }
      try {
        const { data } = await supabase
          .from('farms')
          .select('id, name')
          .eq('customer_id', selectedCustomerId)
        if (data) setFarms(data)
      } catch (err) {
        console.error('Error fetching farms:', err)
      }
    }
    loadFarms()
  }, [selectedCustomerId])

  // Load Herds when Farm changes
  useEffect(() => {
    const loadHerds = async () => {
      if (!selectedFarmId) {
        setHerds([])
        setSelectedHerdId('')
        return
      }
      try {
        const { data } = await supabase
          .from('herds')
          .select('id, name, current_quantity, breed_price')
          .eq('farm_id', selectedFarmId)
          .eq('is_active', true)
        if (data) setHerds(data)
      } catch (err) {
        console.error('Error fetching herds:', err)
      }
    }
    loadHerds()
  }, [selectedFarmId])

  // Set default head_count when Herd changes
  useEffect(() => {
    if (selectedHerdId) {
      const selectedHerd = herds.find(h => h.id === selectedHerdId)
      if (selectedHerd) {
        setHeadCount(selectedHerd.current_quantity)
      }
    } else {
      setHeadCount(0)
    }
  }, [selectedHerdId, herds])

  // Load Default Steps when Project Type changes
  useEffect(() => {
    const loadDefaultSteps = async () => {
      if (!selectedTypeId) {
        setDefaultSteps([])
        return
      }
      try {
        const { data } = await supabase
          .from('herd_project_type_default_steps')
          .select('id, step_name, sort_order, days_offset, description')
          .eq('project_type_id', selectedTypeId)
          .order('sort_order')
        if (data) {
          setDefaultSteps(data)
          // Estimate end date: start_date + max(days_offset) + 7 days
          if (data.length > 0) {
            const maxOffset = Math.max(...(data as DefaultStep[]).map((d: DefaultStep) => d.days_offset))
            const start = new Date(startDate)
            const end = new Date(start.getTime() + (maxOffset + 7) * 24 * 60 * 60 * 1000)
            setEndDate(end.toISOString().split('T')[0])
          } else {
            // Default 30 days
            const start = new Date(startDate)
            const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000)
            setEndDate(end.toISOString().split('T')[0])
          }
        }
      } catch (err) {
        console.error('Error fetching default steps:', err)
      }
    }
    loadDefaultSteps()
  }, [selectedTypeId, startDate])

  // Form Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !selectedCustomerId || !selectedVetId || !startDate || !endDate) {
      alert('Vui lòng điền đầy đủ các thông tin bắt buộc.')
      return
    }

    setLoading(true)
    try {
      // 0a. Tạo cơ sở (trại) mới nếu chọn inline
      let farmId = selectedFarmId || null
      if (creatingFarm && newFarmName.trim()) {
        const { data: nf, error: fErr } = await supabase
          .from('farms')
          .insert({ customer_id: selectedCustomerId, name: newFarmName.trim() })
          .select('id').single()
        if (fErr) throw fErr
        farmId = nf.id
      }

      // 0b. Tạo đàn mới nếu chọn inline (cần có trại)
      let herdId = selectedHerdId || null
      let resolvedHeadCount = headCount
      if (creatingHerd) {
        if (!farmId) { alert('Vui lòng chọn/tạo cơ sở trại trước khi tạo đàn.'); setLoading(false); return }
        if (!newHerd.name.trim() || !newHerd.species_id) { alert('Đàn mới cần tên và loài vật nuôi.'); setLoading(false); return }
        const { data: nh, error: hErr } = await supabase
          .from('herds')
          .insert({
            farm_id: farmId,
            species_id: newHerd.species_id,
            name: newHerd.name.trim(),
            breed: newHerd.breed.trim() || null,
            breed_price: newHerd.breed_price ? Number(newHerd.breed_price) : null,
            entry_date: newHerd.entry_date || null,
            expected_exit_date: newHerd.expected_exit_date || null,
            current_quantity: newHerd.current_quantity || 0,
            is_active: true,
          })
          .select('id, current_quantity').single()
        if (hErr) throw hErr
        herdId = nh.id
        if (!resolvedHeadCount) resolvedHeadCount = nh.current_quantity || 0
      }

      // 1. Insert into herd_projects
      const { data: newProj, error: insertErr } = await supabase
        .from('herd_projects')
        .insert({
          name: name.trim(),
          customer_id: selectedCustomerId,
          farm_id: farmId,
          herd_id: herdId,
          project_type_id: selectedTypeId || null,
          region_id: selectedRegionId || null,
          status: status,
          start_date: startDate,
          end_date: endDate,
          head_count: resolvedHeadCount,
          owner_user_id: selectedVetId,
          notes: notes.trim() || null
        })
        .select()
        .single()

      if (insertErr) throw insertErr
      if (newProj) {
        // 1b. Thêm thành viên theo dõi (đa chi nhánh)
        if (members.length > 0) {
          const { data: { user } } = await supabase.auth.getUser()
          const { error: mErr } = await supabase.from('herd_project_members').insert(
            members.map(m => ({ project_id: newProj.id, user_id: m.user_id, role: m.role, added_by: user?.id ?? null }))
          )
          if (mErr) logger.error('[HerdProjectForm] members insert error:', mErr.message)
        }

        // 1c. Chi phí con giống = giá giống × số con (cộng vào chi phí dự án)
        const breedPrice = creatingHerd
          ? (newHerd.breed_price ? Number(newHerd.breed_price) : 0)
          : Number(herds.find(h => h.id === herdId)?.breed_price || 0)
        if (breedPrice > 0 && resolvedHeadCount > 0) {
          const { data: { user } } = await supabase.auth.getUser()
          const { error: cErr } = await supabase.from('herd_project_costs').insert({
            project_id: newProj.id,
            cost_type: 'breeding_stock',
            quantity: resolvedHeadCount,
            unit_cost: breedPrice,
            amount: breedPrice * resolvedHeadCount,
            incurred_date: startDate,
            notes: 'Con giống (giá giống × số con)',
            created_by: user?.id ?? null,
          })
          if (cErr) logger.error('[HerdProjectForm] breeding cost error:', cErr.message)
        }
        // 2. Generate actual steps in herd_project_steps if template is preloaded
        if (defaultSteps.length > 0) {
          const stepsToInsert = defaultSteps.map(step => {
            // Calculate planned_date
            const pDate = new Date(new Date(startDate).getTime() + step.days_offset * 24 * 60 * 60 * 1000)
            return {
              project_id: newProj.id,
              default_step_id: step.id,
              step_name: step.step_name,
              sort_order: step.sort_order,
              planned_date: pDate.toISOString().split('T')[0],
              status: 'pending',
              products_used: [],
              notes: ''
            }
          })

          const { error: stepsErr } = await supabase
            .from('herd_project_steps')
            .insert(stepsToInsert)
          
          if (stepsErr) {
            console.error('Error creating project steps:', stepsErr)
            alert('Dự án đã tạo nhưng không thể khởi tạo các bước lịch trình.')
          }
        }

        // Navigate to project detail page
        navigate(`/herd-projects/${newProj.id}`)
      }
    } catch (err: any) {
      console.error('Error creating herd project:', err)
      alert('Đã xảy ra lỗi khi tạo dự án chăn nuôi: ' + (err?.message || err?.details || JSON.stringify(err)))
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return (
      <Layout activeMenu="Chăn nuôi">
        <div className="py-32 flex flex-col items-center justify-center text-gray-400">
          <div className="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
          <span>Đang nạp các cấu hình ban đầu...</span>
        </div>
      </Layout>
    )
  }

  return (
    <Layout activeMenu="Chăn nuôi">
      <div className="p-4 md:p-10 max-w-4xl w-full mx-auto space-y-6">
        {/* Navigation & Title */}
        <div className="space-y-1">
          <button
            onClick={() => navigate('/herd-projects')}
            className="flex items-center gap-1.5 text-body-md text-gray-400 hover:text-blue-500 transition-colors font-semibold"
          >
            <ChevronLeft size={16} />
            Quay lại danh sách
          </button>
          <h1 className="text-h1 font-bold text-gray-700">Tạo dự án chăn nuôi</h1>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-0 border border-gray-100 rounded-xl p-6 md:p-8 shadow-sm">
          {/* Project Title */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">
              Tên Dự án <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Ví dụ: Kế hoạch tiêm phòng đàn heo thịt CP-Hưng Yên"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all placeholder-gray-400"
              required
            />
          </div>

          {/* Customer Selection */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-1">
              <Users size={14} className="text-gray-400" />
              Khách hàng / Trang trại chủ <span className="text-rose-500">*</span>
            </label>
            <SmartSearchSelect
              options={customers.map(c => ({ value: c.id, label: c.farm_name, desc: c.code }))}
              value={selectedCustomerId}
              onChange={v => { setSelectedCustomerId(v); setCreatingFarm(false); setCreatingHerd(false); setSelectedFarmId(''); setSelectedHerdId('') }}
              placeholder="-- Chọn khách hàng --"
              searchPlaceholder="Tìm mã / tên khách hàng..."
              required
            />
          </div>

          {/* Farm Selection */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between gap-1">
              <span className="flex items-center gap-1"><Home size={14} className="text-gray-400" />Cơ sở Chuồng trại</span>
              {selectedCustomerId && (
                <button type="button" onClick={() => { setCreatingFarm(v => !v); setSelectedFarmId(''); }}
                  className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5 normal-case">
                  {creatingFarm ? <><X size={11} />Chọn có sẵn</> : <><Plus size={11} />Tạo cơ sở mới</>}
                </button>
              )}
            </label>
            {creatingFarm ? (
              <input type="text" placeholder="Tên cơ sở/trại mới" value={newFarmName} onChange={e => setNewFarmName(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-blue-200 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
            ) : (
              <select value={selectedFarmId} onChange={e => setSelectedFarmId(e.target.value)}
                className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none appearance-none cursor-pointer text-gray-700 disabled:opacity-50"
                disabled={!selectedCustomerId}>
                <option value="">-- Chọn cơ sở (nếu có) --</option>
                {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
          </div>

          {/* Herd Selection */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between gap-1">
              <span className="flex items-center gap-1"><Layers size={14} className="text-gray-400" />Đàn vật nuôi</span>
              {(selectedFarmId || creatingFarm) && (
                <button type="button" onClick={() => { setCreatingHerd(v => !v); setSelectedHerdId(''); }}
                  className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5 normal-case">
                  {creatingHerd ? <><X size={11} />Chọn có sẵn</> : <><Plus size={11} />Tạo đàn mới</>}
                </button>
              )}
            </label>
            {!creatingHerd && (
              <select value={selectedHerdId} onChange={e => setSelectedHerdId(e.target.value)}
                className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none appearance-none cursor-pointer text-gray-700 disabled:opacity-50"
                disabled={!selectedFarmId}>
                <option value="">-- Chọn đàn vật nuôi --</option>
                {herds.map(h => <option key={h.id} value={h.id}>{h.name} ({h.current_quantity.toLocaleString()} con)</option>)}
              </select>
            )}
          </div>

          {/* Inline herd creation fields */}
          {creatingHerd && (
            <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3 bg-blue-50/30 border border-blue-100 rounded-xl p-4">
              <div className="col-span-2 md:col-span-1 space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase">Tên đàn <span className="text-rose-500">*</span></label>
                <input type="text" placeholder="VD: Đàn gà thịt lứa 1" value={newHerd.name} onChange={e => setNewHerd({ ...newHerd, name: e.target.value })}
                  className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase flex items-center gap-1"><Bird size={11} />Loài <span className="text-rose-500">*</span></label>
                <select value={newHerd.species_id} onChange={e => setNewHerd({ ...newHerd, species_id: e.target.value })}
                  className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none">
                  <option value="">-- Loài --</option>
                  {speciesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase">Con giống</label>
                <input type="text" placeholder="VD: Ri lai" value={newHerd.breed} onChange={e => setNewHerd({ ...newHerd, breed: e.target.value })}
                  className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase">Giá giống (₫/con)</label>
                <input type="number" min={0} value={newHerd.breed_price} onChange={e => setNewHerd({ ...newHerd, breed_price: e.target.value })}
                  className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase">Số lượng vào</label>
                <input type="number" min={0} value={newHerd.current_quantity || ''} onChange={e => setNewHerd({ ...newHerd, current_quantity: Number(e.target.value) })}
                  className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase">Ngày vào giống</label>
                <input type="date" value={newHerd.entry_date} onChange={e => setNewHerd({ ...newHerd, entry_date: e.target.value })}
                  className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-400 uppercase">Dự kiến xuất</label>
                <input type="date" value={newHerd.expected_exit_date} onChange={e => setNewHerd({ ...newHerd, expected_exit_date: e.target.value })}
                  className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
          )}

          {/* Project Type */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-1">
              <FileText size={14} className="text-gray-400" />
              Loại kế hoạch <span className="text-rose-500">*</span>
            </label>
            <select
              value={selectedTypeId}
              onChange={e => setSelectedTypeId(e.target.value)}
              className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all appearance-none cursor-pointer text-gray-700"
              required
            >
              <option value="">-- Chọn loại kế hoạch --</option>
              {projectTypes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Khu vực */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-1">
              <Home size={14} className="text-gray-400" /> Khu vực
            </label>
            <SmartSearchSelect
              options={regions.map(r => ({ value: r.id, label: r.name }))}
              value={selectedRegionId}
              onChange={setSelectedRegionId}
              placeholder="-- Chọn khu vực --"
              searchPlaceholder="Tìm khu vực..."
            />
          </div>

          {/* Lead Vet */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-1">
              <User size={14} className="text-gray-400" />
              BSTY Phụ trách chính <span className="text-rose-500">*</span>
            </label>
            <select
              value={selectedVetId}
              onChange={e => setSelectedVetId(e.target.value)}
              className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all appearance-none cursor-pointer text-gray-700"
              required
            >
              <option value="">-- Chọn Bác sĩ phụ trách --</option>
              {vets.map(v => (
                <option key={v.id} value={v.id}>{v.full_name}</option>
              ))}
            </select>
          </div>

          {/* Herd size / Head Count */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">
              Quy mô đàn (Số đầu con)
            </label>
            <input
              type="number"
              value={headCount || ''}
              onChange={e => setHeadCount(Number(e.target.value))}
              placeholder="Nhập số con"
              className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all placeholder-gray-400"
            />
          </div>

          {/* Dates */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-1">
              <Calendar size={14} className="text-gray-400" />
              Ngày bắt đầu <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-1">
              <Calendar size={14} className="text-gray-400" />
              Ngày kết thúc dự kiến <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all"
              required
            />
          </div>

          {/* Project Status */}
          <div className="space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">
              Trạng thái khởi tạo
            </label>
            <div className="flex gap-4 h-10 items-center">
              <label className="flex items-center gap-2 cursor-pointer text-body-md">
                <input
                  type="radio"
                  name="status"
                  value="draft"
                  checked={status === 'draft'}
                  onChange={() => setStatus('draft')}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                Lưu bản nháp (Draft)
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-body-md">
                <input
                  type="radio"
                  name="status"
                  value="active"
                  checked={status === 'active'}
                  onChange={() => setStatus('active')}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                Kích hoạt ngay (Active)
              </label>
            </div>
          </div>

          {/* Project Notes */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">
              Ghi chú thêm
            </label>
            <textarea
              placeholder="Nhập các ghi chú kỹ thuật ban đầu..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all placeholder-gray-400"
            />
          </div>

          {/* Thành viên theo dõi */}
          <div className="md:col-span-2 space-y-2 bg-gray-25 border border-gray-100 rounded-xl p-4">
            <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <UserPlus size={14} className="text-gray-400" /> Người theo dõi dự án (có thể khác chi nhánh)
            </label>
            <p className="text-[11px] text-gray-400">Thành viên được tick sẽ xem & thao tác dự án theo vai trò, kể cả khác chi nhánh.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={memberPick} onChange={e => setMemberPick(e.target.value)}
                className="flex-1 h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none">
                <option value="">-- Chọn nhân sự --</option>
                {vets.filter(v => v.id !== selectedVetId && !members.some(m => m.user_id === v.id)).map(v => (
                  <option key={v.id} value={v.id}>{v.full_name}</option>
                ))}
              </select>
              <select value={memberRole} onChange={e => setMemberRole(e.target.value as any)}
                className="h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none sm:w-36">
                <option value="viewer">Chỉ xem</option>
                <option value="collaborator">Cộng tác</option>
                <option value="manager">Quản lý</option>
              </select>
              <button type="button" onClick={addMember} disabled={!memberPick}
                className="h-9 px-3 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg text-tiny font-bold hover:bg-blue-100 disabled:opacity-40 flex items-center gap-1">
                <Plus size={13} /> Thêm
              </button>
            </div>
            {members.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {members.map(m => {
                  const v = vets.find(x => x.id === m.user_id)
                  return (
                    <span key={m.user_id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-tiny">
                      <span className="font-semibold text-gray-700">{v?.full_name || 'N/A'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full font-bold">{roleLabel(m.role)}</span>
                      <button type="button" onClick={() => removeMember(m.user_id)} className="text-gray-400 hover:text-rose-500"><X size={12} /></button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* Preloaded steps preview */}
          {defaultSteps.length > 0 && (
            <div className="md:col-span-2 space-y-3 bg-blue-50/30 border border-blue-100 rounded-xl p-5 mt-2">
              <h3 className="font-bold text-body-lg text-blue-700 flex items-center gap-2">
                <CheckSquare size={18} />
                Lịch trình các bước mẫu sẽ được tạo ({defaultSteps.length} bước)
              </h3>
              <div className="divide-y divide-blue-50 space-y-2 max-h-56 overflow-y-auto">
                {defaultSteps.map((step, idx) => (
                  <div key={step.id} className="pt-2 first:pt-0 flex items-start justify-between text-body-md">
                    <div>
                      <p className="font-semibold text-gray-700">
                        {idx + 1}. {step.step_name}
                      </p>
                      {step.description && (
                        <p className="text-tiny text-gray-450 mt-0.5">{step.description}</p>
                      )}
                    </div>
                    <span className="text-tiny font-bold text-blue-650 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded flex-shrink-0">
                      Ngày +{step.days_offset}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submit Buttons */}
          <div className="md:col-span-2 flex justify-end gap-3 pt-6 border-t border-gray-100 mt-4">
            <button
              type="button"
              onClick={() => navigate('/herd-projects')}
              className="px-5 h-11 bg-gray-25 text-gray-500 border border-gray-150 rounded-lg font-semibold text-body-md hover:bg-gray-50 active:scale-95 transition-all"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white px-6 h-11 rounded-lg font-semibold text-body-md shadow-sm active:scale-95 transition-all flex items-center gap-2"
            >
              <Save size={18} />
              {loading ? 'Đang lưu...' : 'Lưu dự án'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  )
}
