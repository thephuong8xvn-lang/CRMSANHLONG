import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, SlidersHorizontal, User, Calendar, Layers, AlertCircle,
  FileText, Activity, CheckCircle2, Clock, AlertTriangle, XCircle,
  MapPin, Users, Bird, Wallet, ChevronLeft, ChevronRight, RotateCcw,
} from 'lucide-react'
import Layout from '../../components/Layout'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import ManageHerdCatalogModal from './ManageHerdCatalogModal'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { useSalesReps } from '../../hooks/queries/useCustomers'
import {
  useHerdProjectsList, useHerdProjectTypes, useSpeciesList, useHerdRegions,
} from '../../hooks/queries/useHerdProjects'
import { Settings2, Bird as BirdIcon } from 'lucide-react'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Bản nháp', active: 'Đang hoạt động', on_hold: 'Tạm ngưng',
  completed: 'Đã hoàn thành', cancelled: 'Đã hủy',
}
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  active: 'bg-blue-50 text-blue-700 border-blue-150',
  on_hold: 'bg-amber-50 text-amber-700 border-amber-150',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-150',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-150',
}
const STATUS_ICONS: Record<string, React.ComponentType<any>> = {
  draft: FileText, active: Activity, on_hold: Clock, completed: CheckCircle2, cancelled: XCircle,
}
const PAGE_SIZE = 12

export default function HerdProjectListPage() {
  const navigate = useNavigate()
  const { formatCurrency } = useDisplaySettings()
  const { profile } = useAuth()

  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedSpecies, setSelectedSpecies] = useState('')
  const [selectedOwner, setSelectedOwner] = useState('')
  const [selectedRegion, setSelectedRegion] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [headMin, setHeadMin] = useState('')
  const [headMax, setHeadMax] = useState('')
  const [preset, setPreset] = useState<'all' | 'my' | 'active'>('all')
  const [page, setPage] = useState(1)
  const [showCatalog, setShowCatalog] = useState(false)
  const debouncedSearch = useDebouncedValue(searchTerm, 300)

  useMemo(() => { setPage(1) }, [debouncedSearch, selectedType, selectedStatus, selectedSpecies, selectedOwner, selectedRegion, fromDate, toDate, headMin, headMax, preset])

  const typesQuery = useHerdProjectTypes()
  const speciesQuery = useSpeciesList()
  const regionsQuery = useHerdRegions()
  const repsQuery = useSalesReps()

  const listParams = useMemo(() => ({
    page, pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    speciesId: selectedSpecies || undefined,
    status: preset === 'active' ? 'active' : (selectedStatus || undefined),
    projectTypeId: selectedType || undefined,
    ownerId: preset === 'my' ? (profile?.id || undefined) : (selectedOwner || undefined),
    regionId: selectedRegion || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    headCountMin: headMin ? Number(headMin) : undefined,
    headCountMax: headMax ? Number(headMax) : undefined,
  }), [page, debouncedSearch, selectedSpecies, selectedStatus, selectedType, selectedOwner, selectedRegion, fromDate, toDate, headMin, headMax, preset, profile?.id])

  const listQuery = useHerdProjectsList(listParams)
  const rows = listQuery.data?.rows ?? []
  const total = listQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const hasActiveFilters = !!(selectedType || selectedStatus || selectedSpecies || selectedOwner || selectedRegion || fromDate || toDate || headMin || headMax || debouncedSearch)
  const resetFilters = () => {
    setSearchTerm(''); setSelectedType(''); setSelectedStatus(''); setSelectedSpecies('')
    setSelectedOwner(''); setSelectedRegion(''); setFromDate(''); setToDate(''); setHeadMin(''); setHeadMax(''); setPreset('all')
  }
  const regionOptions = (regionsQuery.data ?? []).map((r: any) => ({ value: r.id, label: r.name }))

  const formatDate = (s: string | null) => { if (!s) return 'N/A'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
  const ageLabel = (days: number | null) => {
    if (days == null) return '—'
    if (days < 7) return `${days} ngày`
    const w = Math.floor(days / 7)
    return `${w} tuần${days % 7 ? ` ${days % 7}n` : ''}`
  }

  return (
    <Layout activeMenu="Chăn nuôi">
      <div className="p-4 md:p-8 max-w-[1500px] w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-h1 font-bold text-gray-700">Dự án Chăn nuôi</h1>
            <p className="text-body-md text-gray-400 mt-1">Theo dõi đàn vật nuôi: lịch vaccine, chi phí, hao hụt cho khách hàng.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/herd-projects/herds')}
              className="bg-white border border-gray-200 text-gray-600 px-3.5 h-11 rounded-lg font-semibold text-tiny hover:bg-gray-50 transition-all flex items-center gap-1.5">
              <BirdIcon size={16} className="text-blue-500" /> Quản lý đàn
            </button>
            <button onClick={() => setShowCatalog(true)}
              className="bg-white border border-gray-200 text-gray-600 px-3.5 h-11 rounded-lg font-semibold text-tiny hover:bg-gray-50 transition-all flex items-center gap-1.5">
              <Settings2 size={16} className="text-blue-500" /> Quản lý danh mục
            </button>
            <button onClick={() => navigate('/herd-projects/new')}
              className="bg-blue-500 hover:bg-blue-600 text-white px-5 h-11 rounded-lg font-semibold text-body-md shadow-sm active:scale-95 transition-all flex items-center gap-2">
              <Plus size={18} strokeWidth={2.5} /> Tạo dự án mới
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input type="text" placeholder="Tìm tên dự án, mã, khách hàng..." value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
            </div>
            <select value={selectedSpecies} onChange={e => setSelectedSpecies(e.target.value)}
              className="h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none cursor-pointer text-gray-650">
              <option value="">Tất cả vật nuôi</option>
              {(speciesQuery.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={selectedStatus} onChange={e => { setSelectedStatus(e.target.value); if (preset === 'active') setPreset('all') }}
              className="h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none cursor-pointer text-gray-650">
              <option value="">Tất cả trạng thái</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <select value={selectedType} onChange={e => setSelectedType(e.target.value)}
              className="h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none cursor-pointer text-gray-600">
              <option value="">Loại kế hoạch</option>
              {(typesQuery.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <SmartSearchSelect
              options={regionOptions}
              value={selectedRegion}
              onChange={setSelectedRegion}
              placeholder="Khu vực"
              searchPlaceholder="Tìm khu vực..."
              className="!h-9 !text-tiny"
            />
            <select value={selectedOwner} onChange={e => { setSelectedOwner(e.target.value); if (preset === 'my') setPreset('all') }}
              className="h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none cursor-pointer text-gray-600">
              <option value="">Người phụ trách</option>
              {(repsQuery.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
            </select>
            <input type="number" min={0} placeholder="SL từ" value={headMin} onChange={e => setHeadMin(e.target.value)}
              className="h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
            <input type="number" min={0} placeholder="SL đến" value={headMax} onChange={e => setHeadMax(e.target.value)}
              className="h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
            <div className="flex gap-1">
              <input type="date" title="Bắt đầu từ" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="h-9 px-1.5 bg-gray-25 border border-gray-150 rounded-lg text-[11px] focus:border-blue-500 focus:outline-none w-1/2" />
              <input type="date" title="Đến" value={toDate} onChange={e => setToDate(e.target.value)}
                className="h-9 px-1.5 bg-gray-25 border border-gray-150 rounded-lg text-[11px] focus:border-blue-500 focus:outline-none w-1/2" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-3 border-t border-gray-100 gap-3">
            <div className="flex flex-wrap gap-2">
              {([['all', 'Tất cả'], ['my', 'Của tôi'], ['active', 'Đang hoạt động']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setPreset(k)}
                  className={`px-3 py-1.5 rounded-lg text-tiny font-semibold border transition-all ${preset === k ? 'bg-blue-500 text-white border-blue-500 shadow-sm' : 'bg-gray-25 text-gray-500 border-gray-150 hover:bg-gray-50'}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {hasActiveFilters && (
                <button onClick={resetFilters} className="text-tiny font-semibold text-gray-500 hover:text-blue-600 flex items-center gap-1">
                  <RotateCcw size={13} /> Xóa lọc
                </button>
              )}
              <span className="text-tiny text-gray-400 flex items-center gap-1"><SlidersHorizontal size={14} /> {total} dự án</span>
            </div>
          </div>
        </div>

        {/* Grid */}
        {listQuery.isLoading ? (
          <div className="py-32 flex flex-col items-center justify-center text-gray-400">
            <div className="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4" />
            <span>Đang tải danh sách dự án...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-16 text-center text-gray-400 shadow-sm">
            <AlertCircle className="mx-auto text-gray-300 mb-4" size={48} />
            <h3 className="font-semibold text-gray-600 text-body-lg">Không tìm thấy dự án nào</h3>
            <p className="text-body-md mt-1">Thử thay đổi từ khóa hoặc bộ lọc, hoặc tạo dự án mới.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {rows.map(proj => {
                const StatusIcon = STATUS_ICONS[proj.status] || FileText
                const today = new Date().toISOString().split('T')[0]
                const isOverdue = proj.status !== 'completed' && proj.status !== 'cancelled' && !!proj.end_date && proj.end_date < today
                return (
                  <div key={proj.id} onClick={() => navigate(`/herd-projects/${proj.id}`)}
                    className="bg-gray-0 border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-gray-150 hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between group">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider">{proj.project_code}</span>
                        <div className="flex items-center gap-1.5">
                          {isOverdue && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-0.5"><AlertTriangle size={10} />Quá hạn</span>}
                          <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold flex items-center gap-1 ${STATUS_COLORS[proj.status]}`}>
                            <StatusIcon size={12} />{STATUS_LABELS[proj.status]}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-bold text-body-lg text-gray-700 group-hover:text-blue-500 transition-colors line-clamp-1">{proj.name}</h3>
                        <p className="text-tiny text-gray-450 font-medium flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1"><Bird size={13} className="text-gray-400" />{proj.species_name || proj.project_type_name || 'Đàn'}</span>
                          {proj.breed && <span className="text-gray-400">· {proj.breed}</span>}
                        </p>
                      </div>
                      <div className="bg-gray-25 p-3 rounded-lg border border-gray-100/50 space-y-1.5 text-tiny text-gray-500">
                        <div className="flex justify-between"><span className="text-gray-400">Khách hàng</span><span className="font-semibold text-gray-600 max-w-[150px] truncate">{proj.customer_name || 'Khách lẻ'}</span></div>
                        <div className="flex justify-between items-center"><span className="text-gray-400 flex items-center gap-1"><MapPin size={11} />Khu vực</span><span className="font-medium text-gray-600 max-w-[150px] truncate">{proj.region_name || [proj.district, proj.province].filter(Boolean).join(', ') || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Số con / Tuổi đàn</span><span className="font-semibold text-gray-700">{proj.head_count.toLocaleString('vi-VN')} · {ageLabel(proj.age_days)}</span></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-blue-50/40 rounded-lg py-1.5"><span className="block text-[9px] text-gray-400 uppercase font-bold">Chi phí</span><span className="text-tiny font-bold text-blue-700 tabular-nums">{formatCurrency(proj.cost_to_date)}</span></div>
                        <div className="bg-rose-50/40 rounded-lg py-1.5"><span className="block text-[9px] text-gray-400 uppercase font-bold">Hao hụt</span><span className="text-tiny font-bold text-rose-600 tabular-nums">{proj.mortality_rate}%</span></div>
                        <div className="bg-gray-50 rounded-lg py-1.5"><span className="block text-[9px] text-gray-400 uppercase font-bold">Theo dõi</span><span className="text-tiny font-bold text-gray-700 flex items-center justify-center gap-0.5"><Users size={11} />{proj.member_count}</span></div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-50">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 h-6 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500"><User size={13} /></div>
                        <span className="text-[11px] font-semibold text-gray-500 truncate max-w-[120px]">{proj.owner_name || 'Hệ thống'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-gray-400 font-medium"><Calendar size={12} /><span>{formatDate(proj.start_date)}</span></div>
                    </div>
                  </div>
                )
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="w-9 h-9 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40"><ChevronLeft size={16} /></button>
                <span className="text-tiny font-semibold text-gray-600">Trang {page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="w-9 h-9 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40"><ChevronRight size={16} /></button>
              </div>
            )}
          </>
        )}
      </div>

      {showCatalog && <ManageHerdCatalogModal onClose={() => setShowCatalog(false)} />}
    </Layout>
  )
}
