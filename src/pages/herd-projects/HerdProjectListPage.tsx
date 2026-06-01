import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, SlidersHorizontal, User, AlertCircle,
  FileText, Activity, CheckCircle2, Clock, AlertTriangle, XCircle,
  Users, Bird, ChevronLeft, ChevronRight, RotateCcw,
  Star, ClipboardList, MessageSquare, TrendingDown, ArrowRight,
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
  useUpcomingHerdTasks, useHerdOverviewStats, useHerdCustomerFeedback,
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

  // Overview data
  const tasksQuery = useUpcomingHerdTasks(7)
  const overviewQuery = useHerdOverviewStats()
  const feedbackQuery = useHerdCustomerFeedback(6)

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

  const ageLabel = (days: number | null) => {
    if (days == null) return '—'
    if (days < 7) return `${days} ngày`
    const w = Math.floor(days / 7)
    return `${w} tuần${days % 7 ? ` ${days % 7}n` : ''}`
  }
  const taskDayLabel = (d: number) => {
    if (d < 0) return `Quá hạn ${Math.abs(d)} ngày`
    if (d === 0) return 'Hôm nay'
    if (d === 1) return 'Ngày mai'
    return `Còn ${d} ngày`
  }

  // Nhóm dự án theo khách hàng (trong phạm vi trang hiện tại)
  const groupedByCustomer = useMemo(() => {
    const map = new Map<string, { customerName: string; items: typeof rows }>()
    for (const r of rows) {
      const key = r.customer_id || '—'
      if (!map.has(key)) map.set(key, { customerName: r.customer_name || 'Khách lẻ', items: [] })
      map.get(key)!.items.push(r)
    }
    return Array.from(map.values())
  }, [rows])

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
            <button onClick={() => navigate('/herd-projects/herds?new=1')}
              className="bg-white border border-gray-200 text-gray-600 px-3.5 h-11 rounded-lg font-semibold text-tiny hover:bg-gray-50 transition-all flex items-center gap-1.5">
              <Plus size={16} className="text-blue-500" /> Tạo đàn
            </button>
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

        {/* ── OVERVIEW ─────────────────────────────────────────── */}
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Dự án đang hoạt động', value: overviewQuery.data?.activeCount ?? 0, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Tổng đàn đang nuôi', value: (overviewQuery.data?.totalHeadActive ?? 0).toLocaleString('vi-VN'), icon: Bird, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Lượt thành viên theo dõi', value: overviewQuery.data?.memberTotal ?? 0, icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
            { label: 'Hao hụt trung bình', value: `${overviewQuery.data?.avgMortality ?? 0}%`, icon: TrendingDown, color: 'text-rose-600', bg: 'bg-rose-50' },
          ].map((kpi, i) => {
            const Icon = kpi.icon
            return (
              <div key={i} className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${kpi.bg} ${kpi.color} flex items-center justify-center flex-shrink-0`}><Icon size={20} /></div>
                <div className="min-w-0">
                  <div className="text-h2 font-bold text-gray-700 tabular-nums leading-tight">{kpi.value}</div>
                  <div className="text-[11px] text-gray-400 font-semibold truncate">{kpi.label}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Công việc 7 ngày + Ý kiến khách hàng */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Công việc 7 ngày tới */}
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="text-body-lg font-bold text-gray-700 flex items-center gap-2 mb-4">
              <ClipboardList size={18} className="text-blue-500" /> Công việc 7 ngày tới
            </h3>
            {tasksQuery.isLoading ? (
              <p className="text-tiny text-gray-400 py-6 text-center">Đang tải...</p>
            ) : (tasksQuery.data ?? []).length === 0 ? (
              <p className="text-tiny text-gray-400 italic py-6 text-center">Không có công việc nào trong 7 ngày tới.</p>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {(tasksQuery.data ?? []).map(t => {
                  const urgent = t.days_left <= 3
                  return (
                    <button key={t.step_id} onClick={() => navigate(`/herd-projects/${t.project_id}`)}
                      className="w-full text-left flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-25 transition-colors">
                      <div className="min-w-0">
                        <p className={`text-tiny font-bold truncate ${urgent ? 'text-rose-600' : 'text-blue-600'}`}>{t.step_name}</p>
                        <p className="text-[11px] text-gray-400 truncate">{t.project_name} · {t.customer_name || 'Khách lẻ'}{t.assigned_name ? ` · ${t.assigned_name}` : ''}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${urgent ? 'bg-rose-50 text-rose-700 border-rose-150' : 'bg-blue-50 text-blue-700 border-blue-150'}`}>
                        {taskDayLabel(t.days_left)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Ý kiến khách hàng gần đây */}
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="text-body-lg font-bold text-gray-700 flex items-center gap-2 mb-4">
              <MessageSquare size={18} className="text-amber-500" /> Ý kiến khách hàng gần đây
            </h3>
            {feedbackQuery.isLoading ? (
              <p className="text-tiny text-gray-400 py-6 text-center">Đang tải...</p>
            ) : (feedbackQuery.data ?? []).length === 0 ? (
              <p className="text-tiny text-gray-400 italic py-6 text-center">Chưa có ý kiến đánh giá nào.</p>
            ) : (
              <div className="space-y-2.5 max-h-[280px] overflow-y-auto">
                {(feedbackQuery.data ?? []).map(f => (
                  <button key={f.id} onClick={() => navigate(`/herd-projects/${f.projectId}`)}
                    className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:bg-gray-25 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex text-amber-400">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} size={12} fill={i < f.rating ? '#f59e0b' : 'none'} className={i < f.rating ? 'text-amber-400' : 'text-gray-300'} />
                        ))}
                      </div>
                      <span className="text-[10px] text-gray-400 font-medium">{f.source === 'outcome' ? 'Kết quả dự án' : 'Theo bước'}</span>
                    </div>
                    {f.comment && <p className="text-tiny text-gray-600 italic mt-1 line-clamp-2">“{f.comment}”</p>}
                    <p className="text-[11px] text-gray-400 mt-1 truncate">{f.projectName} · {f.customerName || 'Khách lẻ'}</p>
                  </button>
                ))}
              </div>
            )}
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
            {/* Danh sách dự án — nhóm theo Khách hàng (dạng list) */}
            <div className="space-y-4">
              {groupedByCustomer.map(group => (
                <div key={group.customerName} className="bg-gray-0 border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-25 border-b border-gray-100">
                    <h3 className="font-bold text-body-md text-gray-700 flex items-center gap-2">
                      <User size={15} className="text-blue-500" /> {group.customerName}
                    </h3>
                    <span className="text-tiny text-gray-400 font-semibold">{group.items.length} dự án</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-gray-100 text-gray-500 uppercase text-[10px] font-bold tracking-wider whitespace-nowrap">
                          <th className="py-2 px-4">Mã / Tên dự án</th>
                          <th className="py-2 px-3">Vật nuôi</th>
                          <th className="py-2 px-3">Khu vực</th>
                          <th className="py-2 px-3 text-right">Tổng đàn</th>
                          <th className="py-2 px-3 text-right">Tuổi đàn</th>
                          <th className="py-2 px-3 text-right">Chi phí</th>
                          <th className="py-2 px-3 text-right">Hao hụt</th>
                          <th className="py-2 px-3">Người phụ trách</th>
                          <th className="py-2 px-3 text-center">Trạng thái</th>
                          <th className="py-2 px-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {group.items.map(proj => {
                          const StatusIcon = STATUS_ICONS[proj.status] || FileText
                          const today = new Date().toISOString().split('T')[0]
                          const isOverdue = proj.status !== 'completed' && proj.status !== 'cancelled' && !!proj.end_date && proj.end_date < today
                          return (
                            <tr key={proj.id} onClick={() => navigate(`/herd-projects/${proj.id}`)}
                              className="hover:bg-blue-50/30 cursor-pointer transition-colors group">
                              <td className="py-3 px-4">
                                <div className="font-bold text-gray-700 line-clamp-1 group-hover:text-blue-600">{proj.name}</div>
                                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{proj.project_code}</div>
                              </td>
                              <td className="py-3 px-3 text-gray-600 whitespace-nowrap">
                                {proj.species_name || proj.project_type_name || 'Đàn'}{proj.breed ? <span className="text-gray-400"> · {proj.breed}</span> : ''}
                              </td>
                              <td className="py-3 px-3 text-gray-600 max-w-[140px] truncate">{proj.region_name || [proj.district, proj.province].filter(Boolean).join(', ') || '—'}</td>
                              <td className="py-3 px-3 text-right tabular-nums font-semibold text-gray-700">{proj.head_count.toLocaleString('vi-VN')}</td>
                              <td className="py-3 px-3 text-right tabular-nums text-gray-600">{ageLabel(proj.age_days)}</td>
                              <td className="py-3 px-3 text-right tabular-nums font-semibold text-blue-700">{formatCurrency(proj.cost_to_date)}</td>
                              <td className="py-3 px-3 text-right tabular-nums font-semibold text-rose-600">{proj.mortality_rate}%</td>
                              <td className="py-3 px-3 text-gray-600 max-w-[130px] truncate">{proj.owner_name || 'Hệ thống'}</td>
                              <td className="py-3 px-3 text-center whitespace-nowrap">
                                {isOverdue && <span className="mr-1 inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-100 text-rose-700 border border-rose-200 align-middle"><AlertTriangle size={9} /></span>}
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-bold align-middle ${STATUS_COLORS[proj.status]}`}>
                                  <StatusIcon size={11} />{STATUS_LABELS[proj.status]}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-right"><ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500" /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
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
